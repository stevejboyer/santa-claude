import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { startOfMonth, startOfWeek } from 'date-fns';
import path from 'path';
import { homedir } from 'os';
import fs from 'fs/promises';
import configManager from './config.js';

export interface SessionData {
	id: string;
	startTime: Date;
	endTime: Date;
}

export interface DetailedAnalytics {
	mostActiveHour: number;
	mostActiveDay?: string;
	modelUsage: Array<{ model: string; count: number }>;
	dailyUsage: Array<{ date: string; sessions: number; totalTokens: number }>;
}

export class SessionTracker {
	private dbPath: string;
	private db: any;

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
    `);
	}

	async createSession(sessionId: string): Promise<SessionData> {
		const now = Date.now();
		const sessionLengthMs = await configManager.getSessionLengthMs();
		const adjustedSessionLengthMs = sessionLengthMs - 60000; // Subtract 1 minute for safety
		const endTime = now + adjustedSessionLengthMs;

		// Check if there's already an active session
		const activeSession = await this.getActiveSession();
		if (activeSession) {
			console.error(`[Debug] Reusing existing active session from ${activeSession.startTime.toLocaleTimeString()}`);
			return activeSession;
		}

		// Create new session with calculated end time
		await this.db.run(`INSERT INTO sessions (id, start_time, end_time) VALUES (?, ?, ?)`, sessionId, now, endTime);

		return {
			id: sessionId,
			startTime: new Date(now),
			endTime: new Date(endTime),
		};
	}

	async getActiveSession(): Promise<SessionData | null> {
		const now = Date.now();
		const row = await this.db.get(
			`SELECT * FROM sessions WHERE start_time <= ? AND end_time > ? ORDER BY start_time DESC LIMIT 1`,
			now,
			now
		);

		if (!row) return null;

		return this.rowToSessionData(row);
	}

	// Removed unused getSessionStartTime

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
		const startOfMonthTimestamp = startOfMonth(new Date()).getTime();

		// Simply count sessions that started this month
		const result = await this.db.get(
			`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`,
			startOfMonthTimestamp
		);

		return result?.count || 0;
	}

	async getWeeklySessionCount(): Promise<number> {
		const startOfWeekTimestamp = startOfWeek(new Date(), { weekStartsOn: 0 }).getTime(); // Sunday as start

		// Count sessions that started this week
		const result = await this.db.get(
			`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`,
			startOfWeekTimestamp
		);

		return result?.count || 0;
	}

	async getBillingCycleSessionCount(renewalDay: number): Promise<number> {
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
		const result = await this.db.get(
			`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`,
			cycleStartTimestamp
		);

		return result?.count || 0;
	}

	// Removed unused getMonthlyStats

	async get30DayStats(): Promise<{
		sessionCount: number;
		totalCost: number;
		totalTokens: { input: number; output: number };
	}> {
		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

		const sessionCount = await this.getSessionCountSince(thirtyDaysAgo);

		// Get token stats from sessions
		const tokenStats = await this.db.get(
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
		const tokenStats = await this.db.get(
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
		const tokenStats = await this.db.get(
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
		const result = await this.db.get(`SELECT COUNT(*) as count FROM sessions WHERE start_time >= ?`, timestamp);
		return result?.count || 0;
	}

	// Removed unused getAllSessions

	async getSessionsWithStats(limit: number = 10): Promise<any[]> {
		const rows = await this.db.all(
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

		return rows.map((row: any) => ({
			...this.rowToSessionData(row),
			totalTokens: row.total_tokens || 0,
		}));
	}

	async updateSessionTokens(sessionId: string, totalTokens: number): Promise<void> {
		await this.db.run(`UPDATE sessions SET total_tokens = ? WHERE id = ?`, totalTokens, sessionId);
	}

	async incrementSessionTokens(sessionId: string, tokensToAdd: number): Promise<void> {
		// Use COALESCE to handle NULL values (treat as 0)
		await this.db.run(
			`UPDATE sessions SET total_tokens = COALESCE(total_tokens, 0) + ? WHERE id = ?`,
			tokensToAdd,
			sessionId
		);
	}

	private rowToSessionData(row: any): SessionData {
		return {
			id: row.id,
			startTime: new Date(row.start_time),
			endTime: new Date(row.end_time),
		};
	}

	async getDetailedAnalytics(): Promise<DetailedAnalytics> {
		const startOfMonthTimestamp = startOfMonth(new Date()).getTime();

		// Get most active hour based on session starts
		const hourCounts = await this.db.all(
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
		const dayOfWeekCounts = await this.db.all(
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
		const dailyUsage = await this.db.all(
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
			dailyUsage: dailyUsage.map((d: any) => ({
				date: d.date,
				sessions: d.sessions,
				totalTokens: d.total_tokens,
			})),
		};
	}

	async close() {
		if (this.db) {
			await this.db.close();
		}
	}
}
