import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { startOfMonth, startOfWeek } from 'date-fns';
import path from 'path';
import { homedir } from 'os';
import fs from 'fs/promises';
import configManager from './config.js';
import { ValidationError } from './errors.js';
import logger from './logger.js';
import type { SessionRow, DailyUsageRow, HourCountRow, DayOfWeekCountRow, CountRow, TokenStatsRow } from './types.js';
import { statsCache } from './cache.js';

export interface DetailedAnalytics {
	mostActiveHour: number;
	mostActiveDay?: string;
	modelUsage: Array<{ model: string; count: number }>;
	dailyUsage: Array<{ date: string; sessions: number; totalTokens: number }>;
}

export interface SessionData {
	id: string;
	startTime: Date;
	endTime: Date;
}


export interface SessionWithStats extends SessionData {
	totalTokens: number;
}

export class SessionTracker {
	private dbPath: string;
	private db!: Database<sqlite3.Database, sqlite3.Statement>;

	constructor() {
		// Support in-memory database for tests
		if (process.env.SANTA_CLAUDE_TEST_DB === ':memory:') {
			this.dbPath = ':memory:';
		} else {
			const configDir = path.join(homedir(), '.santa-claude');
			this.dbPath = path.join(configDir, 'sessions.db');
		}
	}

	async initialize() {
		// Ensure config directory exists (skip for in-memory db)
		if (this.dbPath !== ':memory:') {
			const dir = path.dirname(this.dbPath);
			await fs.mkdir(dir, { recursive: true });
		}

		// Open database
		this.db = await open({
			filename: this.dbPath,
			driver: sqlite3.Database,
		});

		// Create tables if they don't exist
		await this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        total_tokens INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_start_time ON sessions(start_time);
      CREATE INDEX IF NOT EXISTS idx_end_time ON sessions(end_time);
      CREATE INDEX IF NOT EXISTS idx_total_tokens ON sessions(total_tokens);
      CREATE INDEX IF NOT EXISTS idx_start_time_tokens ON sessions(start_time, total_tokens);
    `);
	}

	async createSession(sessionId: string): Promise<SessionData> {
		// Validate sessionId
		if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
			throw new ValidationError('Invalid session ID');
		}
		// Sanitize sessionId - allow only alphanumeric and dashes
		if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
			throw new ValidationError('Session ID contains invalid characters');
		}

		const now = Date.now();
		const sessionLengthMs = await configManager.getSessionLengthMs();
		const adjustedSessionLengthMs = sessionLengthMs - 60000; // Subtract 1 minute for safety
		const endTime = now + adjustedSessionLengthMs;

		// Check if there's already an active session
		const activeSession = await this.getActiveSession();
		if (activeSession) {
			logger.debug(`Reusing existing active session from ${activeSession.startTime.toLocaleTimeString()}`);
			// Update cache with the active session to ensure consistency
			statsCache.set('active_session', activeSession, 10000);
			return activeSession;
		}

		try {
			// Create new session with calculated end time
			await this.db.run(`INSERT INTO sessions (id, start_time, end_time) VALUES (?, ?, ?)`, sessionId, now, endTime);
		} catch (error) {
			// Handle potential race condition where another process created a session
			logger.debug('Session creation failed, checking for existing session:', error);
			const existingSession = await this.getActiveSession();
			if (existingSession) {
				return existingSession;
			}
			throw error;
		}

		const newSession = {
			id: sessionId,
			startTime: new Date(now),
			endTime: new Date(endTime),
		};

		// Invalidate relevant caches and immediately cache the new session
		statsCache.delete('monthly_session_count');
		statsCache.delete('weekly_session_count');
		statsCache.set('active_session', newSession, 10000);

		return newSession;
	}

	async getActiveSession(): Promise<SessionData | null> {
		const cacheKey = 'active_session';
		
		// Try to get from cache first
		const cached = statsCache.get(cacheKey) as SessionData | null | undefined;
		if (cached !== undefined) {
			// Validate that cached session is still active
			if (cached && cached.endTime.getTime() > Date.now()) {
				return cached;
			}
			// Clear expired cache immediately
			statsCache.delete(cacheKey);
		}

		const now = Date.now();
		let row: SessionRow | undefined;
		
		try {
			row = await this.db.get<SessionRow>(
				`SELECT * FROM sessions WHERE start_time <= ? AND end_time > ? ORDER BY start_time DESC LIMIT 1`,
				now,
				now
			);
		} catch (error) {
			logger.error('Failed to query active session:', error);
			return null;
		}

		const result = row ? this.rowToSessionData(row) : null;
		
		// Cache for 10 seconds (frequent access during session)
		statsCache.set(cacheKey, result, 10000);
		
		return result;
	}

	//

	async getSessionTimeRemaining(): Promise<{ hours: number; minutes: number } | null> {
		// Get the currently active session
		const activeSession = await this.getActiveSession();
		if (!activeSession) {
			return null;
		}

		// Calculate time remaining until end_time
		const now = Date.now();
		const remainingMs = activeSession.endTime.getTime() - now;

		if (remainingMs <= 0) {
			return { hours: 0, minutes: 0 };
		}

		const remainingHours = remainingMs / (1000 * 60 * 60);
		const hours = Math.floor(remainingHours);
		const minutes = Math.floor((remainingHours - hours) * 60);

		return { hours, minutes };
	}

	async getMonthlySessionCount(): Promise<number> {
		const cacheKey = 'monthly_session_count';
		
		// Try cache first
		const cached = statsCache.get(cacheKey) as number | undefined;
		if (cached !== undefined) {
			return cached;
		}

		const startOfMonthTimestamp = startOfMonth(new Date()).getTime();

		// Simply count sessions that started this month
		const result = await this.db.get<CountRow>(
			`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`,
			startOfMonthTimestamp
		);

		const count = result?.count || 0;
		
		// Cache for 30 seconds
		statsCache.set(cacheKey, count, 30000);
		
		return count;
	}

	async getWeeklySessionCount(): Promise<number> {
		const cacheKey = 'weekly_session_count';
		
		// Try cache first
		const cached = statsCache.get(cacheKey) as number | undefined;
		if (cached !== undefined) {
			return cached;
		}

		const startOfWeekTimestamp = startOfWeek(new Date(), { weekStartsOn: 0 }).getTime(); // Sunday as start

		// Count sessions that started this week
		const result = await this.db.get<CountRow>(
			`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`,
			startOfWeekTimestamp
		);

		const count = result?.count || 0;
		
		// Cache for 30 seconds
		statsCache.set(cacheKey, count, 30000);
		
		return count;
	}

	async getBillingCycleSessionCount(renewalDay: number): Promise<number> {
		// Validate renewal day
		if (typeof renewalDay !== 'number' || renewalDay < 1 || renewalDay > 31) {
			throw new ValidationError('Invalid renewal day');
		}
		
		// Calculate the start of the current billing cycle
		const now = new Date();
		const currentDay = now.getDate();

		let cycleStart: Date;
		if (currentDay >= renewalDay) {
			// We're past the renewal day this month
			cycleStart = new Date(now.getFullYear(), now.getMonth(), renewalDay);
		} else {
			// We haven't reached the renewal day yet, so cycle started last month
			cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, renewalDay);
		}

		const cycleStartTimestamp = cycleStart.getTime();

		// Count sessions since cycle start
		const result = await this.db.get<CountRow>(
			`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`,
			cycleStartTimestamp
		);

		return result?.count || 0;
	}

	//

	async get30DayStats(): Promise<{
		sessionCount: number;
		totalCost: number;
		totalTokens: { input: number; output: number };
	}> {
		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

		const sessionCount = await this.getSessionCountSince(thirtyDaysAgo);

		// Get token stats from sessions
		const tokenStats = await this.db.get<TokenStatsRow>(
			`
      SELECT 
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM sessions
      WHERE start_time >= ?
    `,
			thirtyDaysAgo
		);

		return {
			sessionCount,
			totalCost: 0,
			totalTokens: {
				input: tokenStats?.total_tokens || 0,
				output: 0,
			},
		};
	}

	async getWeeklyStats(): Promise<{
		sessionCount: number;
		totalCost: number;
		totalTokens: { input: number; output: number };
	}> {
		const startOfWeekTimestamp = startOfWeek(new Date(), { weekStartsOn: 0 }).getTime(); // Sunday as start

		const sessionCount = await this.getSessionCountSince(startOfWeekTimestamp);

		// Get token stats from sessions
		const tokenStats = await this.db.get<TokenStatsRow>(
			`
      SELECT 
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM sessions
      WHERE start_time >= ?
    `,
			startOfWeekTimestamp
		);

		return {
			sessionCount,
			totalCost: 0, // No cost tracking for now
			totalTokens: {
				input: tokenStats?.total_tokens || 0,
				output: 0,
			},
		};
	}

	async getBillingCycleStats(renewalDay: number): Promise<{
		sessionCount: number;
		totalCost: number;
		totalTokens: { input: number; output: number };
	}> {
		// Validate renewal day
		if (typeof renewalDay !== 'number' || renewalDay < 1 || renewalDay > 31) {
			throw new ValidationError('Invalid renewal day');
		}
		
		// Calculate the start of the current billing cycle
		const now = new Date();
		const currentDay = now.getDate();

		let cycleStart: Date;
		if (currentDay >= renewalDay) {
			// We're past the renewal day this month
			cycleStart = new Date(now.getFullYear(), now.getMonth(), renewalDay);
		} else {
			// We haven't reached the renewal day yet, so cycle started last month
			cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, renewalDay);
		}

		const cycleStartTimestamp = cycleStart.getTime();

		const sessionCount = await this.getSessionCountSince(cycleStartTimestamp);

		// Get token stats from sessions
		const tokenStats = await this.db.get<TokenStatsRow>(
			`
      SELECT 
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM sessions
      WHERE start_time >= ?
    `,
			cycleStartTimestamp
		);

		return {
			sessionCount,
			totalCost: 0,
			totalTokens: {
				input: tokenStats?.total_tokens || 0,
				output: 0,
			},
		};
	}

	private async getSessionCountSince(timestamp: number): Promise<number> {
		// Simply count sessions since timestamp
		const result = await this.db.get<CountRow>(`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`, timestamp);
		return result?.count || 0;
	}

	//

	async getSessionsWithStats(limit: number = 10): Promise<SessionWithStats[]> {
		// Validate limit
		if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
			limit = 10; // Default to safe value
		}
		const rows = await this.db.all<SessionRow[]>(
			`
			SELECT 
				s.*,
				COALESCE(s.total_tokens, 0) as total_tokens
			FROM sessions s
			ORDER BY s.start_time DESC
			LIMIT ?
		`,
			limit
		);

		return rows.map((row) => ({
			...this.rowToSessionData(row),
			totalTokens: row.total_tokens || 0,
		}));
	}

	async updateSessionTokens(sessionId: string, totalTokens: number): Promise<void> {
		// Validate inputs
		if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
			throw new Error('Invalid session ID');
		}
		if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
			throw new Error('Session ID contains invalid characters');
		}
		if (typeof totalTokens !== 'number' || totalTokens < 0 || totalTokens > Number.MAX_SAFE_INTEGER) {
			throw new ValidationError('Invalid token count');
		}

		await this.db.run(`UPDATE sessions SET total_tokens = ? WHERE id = ?`, totalTokens, sessionId);
	}

	async incrementSessionTokens(sessionId: string, tokensToAdd: number): Promise<void> {
		// Validate inputs
		if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
			throw new Error('Invalid session ID');
		}
		if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
			throw new Error('Session ID contains invalid characters');
		}
		if (typeof tokensToAdd !== 'number' || tokensToAdd < 0 || tokensToAdd > Number.MAX_SAFE_INTEGER) {
			throw new ValidationError('Invalid token count');
		}

		// Use COALESCE to handle NULL values (treat as 0)
		await this.db.run(
			`UPDATE sessions SET total_tokens = COALESCE(total_tokens, 0) + ? WHERE id = ?`,
			tokensToAdd,
			sessionId
		);
	}

	async purgeSessionsKeepLatest(keep: number): Promise<number> {
		// Validate input
		if (typeof keep !== 'number' || !Number.isInteger(keep)) {
			throw new ValidationError('Keep count must be an integer');
		}
		if (keep < 0) keep = 0;
		if (keep > 10000) {
			throw new ValidationError('Keep count too large (max 10000)');
		}

		// Delete all sessions except the latest N by start_time
		const result = await this.db.run(
			`DELETE FROM sessions WHERE id NOT IN (
        SELECT id FROM sessions ORDER BY start_time DESC LIMIT ?
      )`,
			keep
		);
		// sqlite3 run returns { changes }
		return result?.changes ?? 0;
	}

	private rowToSessionData(row: SessionRow): SessionData {
		return {
			id: row.id,
			startTime: new Date(row.start_time),
			endTime: new Date(row.end_time),
		};
	}

	async getDetailedAnalytics(): Promise<DetailedAnalytics> {
		const startOfMonthTimestamp = startOfMonth(new Date()).getTime();

		// Get most active hour based on session starts
		const hourCounts = await this.db.all<HourCountRow[]>(
			`
      SELECT strftime('%H', datetime(start_time/1000, 'unixepoch', 'localtime')) as hour,
             COUNT(*) as count
      FROM sessions
      WHERE start_time >= ?
      GROUP BY hour
      ORDER BY count DESC
      LIMIT 1
    `,
			startOfMonthTimestamp
		);

		const mostActiveHour = hourCounts.length > 0 ? parseInt(hourCounts[0].hour) : 0;

		// Get most active day of week
		const dayOfWeekCounts = await this.db.all<DayOfWeekCountRow[]>(
			`
      SELECT strftime('%w', datetime(start_time/1000, 'unixepoch', 'localtime')) as dow,
             COUNT(*) as count
      FROM sessions
      WHERE start_time >= ?
      GROUP BY dow
      ORDER BY count DESC
      LIMIT 1
    `,
			startOfMonthTimestamp
		);

		const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const mostActiveDay = dayOfWeekCounts.length > 0 ? daysOfWeek[parseInt(dayOfWeekCounts[0].dow)] : '';

		// Model usage no longer tracked
		const modelUsage: Array<{ model: string; count: number }> = [];

		// Get daily usage for last 7 days with total tokens
		const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const dailyUsage = await this.db.all<DailyUsageRow[]>(
			`
      SELECT 
        date(start_time/1000, 'unixepoch', 'localtime') as date,
        COUNT(*) as sessions,
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM sessions
      WHERE start_time >= ?
      GROUP BY date
      ORDER BY date DESC
    `,
			sevenDaysAgo
		);

		return {
			mostActiveHour,
			mostActiveDay,
			modelUsage,
			dailyUsage: dailyUsage.map((d) => ({
				date: d.date,
				sessions: d.sessions,
				totalTokens: d.total_tokens,
			})),
		};
	}

	async close() {
		// Clear cache on close
		statsCache.clear();
		
		if (this.db) {
			await this.db.close();
		}
	}
}
