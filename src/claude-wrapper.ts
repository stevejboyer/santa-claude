import { SessionTracker } from './session-tracker.js';
import chalk from 'chalk';
import { getOrdinalSuffix } from './cli.js';
import { randomUUID } from 'crypto';
import { TokenMonitor } from './token-monitor.js';
import { TokenLineProcessor } from './token-line-processor.js';
import * as pty from 'node-pty';
import configManager from './config.js';

export interface WrapperOptions {
	sessionId?: string;
	verbose?: boolean;
}

export class ClaudeWrapper {
	private tracker: SessionTracker;
	private currentSessionId?: string;

	constructor() {
		this.tracker = new SessionTracker();
	}

	async initialize() {
		await this.tracker.initialize();
	}

	async runSession(args: string[], options: WrapperOptions = {}) {
		// Check if there's an active session within the 5-hour window
		const activeSession = await this.tracker.getActiveSession();
		if (activeSession) {
			// Reuse the active session ID if it's still within the window
			this.currentSessionId = activeSession.id;
		} else {
			// Generate a new session ID if no active session or window expired
			// This ensures Claude Code starts fresh after 5 hours
			this.currentSessionId = options.sessionId || randomUUID();
		}

		await this.showSessionStart();

		// Build the command arguments
		const claudeArgs = [...args];

		// Always add --verbose to monitor token usage
		if (!args.includes('--verbose')) {
			claudeArgs.push('--verbose');
		}

		// Don't add session-id to avoid conflicts with Claude's session management
		// Claude handles its own session IDs for resume/continue operations and regular usage
		// We'll track usage through our wrapper session ID internally

		// Always use PTY for monitoring while preserving interactivity
		const tokenMonitor = new TokenMonitor(this.currentSessionId, this.tracker);
		const tokenLineProcessor = new TokenLineProcessor(this.tracker);

		const terminalRows = process.stdout.rows || 24;
		const terminalCols = process.stdout.columns || 80;

		const claudePty = pty.spawn('claude', claudeArgs, {
			name: 'xterm-256color',
			cols: terminalCols,
			rows: terminalRows,
			env: process.env,
		});

		// Pass stdin to PTY
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.on('data', data => {
			claudePty.write(data.toString());
		});

		// Pass PTY output to stdout and monitor it
		claudePty.onData(data => {
			const processedData = tokenLineProcessor.processOutput(data);
			process.stdout.write(processedData);
			tokenMonitor.processOutput(data);
		});

		// Handle resize events
		process.stdout.on('resize', () => {
			const newRows = process.stdout.rows || 24;
			const newCols = process.stdout.columns || 80;
			claudePty.resize(newCols, newRows);
		});

		// Track process lifecycle
		return new Promise<void>((resolve, reject) => {
			claudePty.onExit(async ({ exitCode }) => {
				if (process.stdin.isTTY) {
					process.stdin.setRawMode(false);
				}

				// Remove all stdin listeners to prevent hanging
				process.stdin.removeAllListeners('data');
				process.stdin.pause();

				// Close the token monitor and line processor
				tokenMonitor.close();
				tokenLineProcessor.close();

				// Sessions now have fixed end times, no need to update

				await this.showSessionEnd();

				if (exitCode === 0) {
					resolve();
				} else {
					reject(new Error(`Process exited with code ${exitCode}`));
				}
			});
		});
	}

	async showStats() {
		const timeRemaining = await this.tracker.getSessionTimeRemaining();
		const thirtyDayStats = await this.tracker.get30DayStats();
		const weeklyStats = await this.tracker.getWeeklyStats();
		const subscriptionDay = await configManager.getSubscriptionRenewalDay();

		console.log(chalk.cyan('\n📊 Claude Usage Stats\n'));

		// Current session
		console.log(chalk.yellow('⏱️  Current Session:'));
		if (timeRemaining) {
			console.log(`   Time remaining: ${timeRemaining.hours}h ${timeRemaining.minutes}m`);
		} else {
			console.log(`   No active Claude Code session`);
		}

		console.log(chalk.green('\n📅 Session Usage:'));

		// Calculate billing cycle stats if subscription day is set
		let billingStats = null;
		if (subscriptionDay) {
			billingStats = await this.tracker.getBillingCycleStats(subscriptionDay);
		}

		// Format the table
		const formatRow = (label: string, sessions: number, tokens: number) => {
			const sessionsStr = sessions.toString().padStart(14, ' ');
			const tokensStr = tokens > 0 ? tokens.toLocaleString().padStart(14, ' ') : '             -';
			return `${label.padEnd(20, ' ')}${sessionsStr}${tokensStr}`;
		};

		// Table header
		console.log(chalk.gray('                    sessions used   tokens used'));

		// 30-day stats
		const thirtyDayTokens = thirtyDayStats.totalTokens.input + thirtyDayStats.totalTokens.output;
		console.log(formatRow('Last 30 days', thirtyDayStats.sessionCount, thirtyDayTokens));

		// Weekly stats
		const weeklyTokens = weeklyStats.totalTokens.input + weeklyStats.totalTokens.output;
		console.log(formatRow('This week', weeklyStats.sessionCount, weeklyTokens));

		// Billing cycle stats
		if (billingStats) {
			const billingTokens = billingStats.totalTokens.input + billingStats.totalTokens.output;
			console.log(formatRow('This billing cycle', billingStats.sessionCount, billingTokens));
		} else {
			console.log(chalk.gray(formatRow('This billing cycle', 0, 0) + '  (renewal date not set)'));
		}
	}

	async listRecentSessions(limit: number = 10) {
		const sessions = await this.tracker.getSessionsWithStats(limit);

		console.log(chalk.cyan(`\n📋 Recent Sessions (last ${limit}):\n`));

		// Format dates as "M/D/YYYY h:mma"
		const formatDate = (date: Date) => {
			const month = date.getMonth() + 1;
			const day = date.getDate();
			const year = date.getFullYear();
			const hours = date.getHours();
			const minutes = date.getMinutes();
			const ampm = hours >= 12 ? 'pm' : 'am';
			const displayHours = hours % 12 || 12;
			const displayMinutes = minutes.toString().padStart(2, '0');
			return `${month}/${day}/${year} ${displayHours}:${displayMinutes}${ampm}`;
		};

		// Process all sessions to find maximum column widths
		const processedSessions = sessions.map(session => {
			const startDate = session.startTime;
			const endDate = session.endTime;
			const dateRange = `${formatDate(startDate)} - ${formatDate(endDate)}`;
			const tokensStr = `${session.totalTokens.toLocaleString()} tokens`;

			return { dateRange, tokensStr };
		});

		// Find max lengths for padding
		const maxDateLength = Math.max(...processedSessions.map(s => s.dateRange.length));

		// Print with proper padding
		for (const session of processedSessions) {
			const paddedDate = session.dateRange.padEnd(maxDateLength);
			console.log(`${paddedDate} | ${session.tokensStr}`);
		}
	}

	private async showSessionStart() {
		const monthlySessionCount = await this.tracker.getMonthlySessionCount();
		const weeklySessionCount = await this.tracker.getWeeklySessionCount();
		const subscriptionDay = await configManager.getSubscriptionRenewalDay();

		const timeRemaining = await this.tracker.getSessionTimeRemaining();
		const sessionRemainingString = timeRemaining
			? `(${timeRemaining.hours}h ${timeRemaining.minutes}m remaining in current session)`
			: `(no active session)`;
		console.log(chalk.gray(`\n🎅 Santa Claude launching Claude Code instance... ${sessionRemainingString}`));

		// Show billing cycle count if subscription day is set, otherwise show monthly count
		if (subscriptionDay) {
			const billingCycleCount = await this.tracker.getBillingCycleSessionCount(subscriptionDay);
			console.log(
				chalk.dim(
					`   ${billingCycleCount} sessions used so far in current billing cycle (renews ${subscriptionDay}${getOrdinalSuffix(
						subscriptionDay
					)} of the month)`
				)
			);
		} else {
			const monthName = new Date().toLocaleString('default', { month: 'long' });
			console.log(chalk.dim(`   ${monthlySessionCount} sessions used so far in ${monthName}`));
		}

		// Always show weekly count
		console.log(chalk.dim(`   ${weeklySessionCount} sessions used so far this week\n`));

		// Show subscription renewal reminder if not set
		if (!subscriptionDay) {
			console.log(
				chalk.gray(
					`   Your Claude Code subscription renewal date is not set. To set it, see --help for instructions\n`
				)
			);
		}
	}

	private async showSessionEnd() {
		const timeRemaining = await this.tracker.getSessionTimeRemaining();
		if (timeRemaining) {
			console.log(
				chalk.gray(`\n👋🎅 Current session time remaining: ${timeRemaining.hours}h ${timeRemaining.minutes}m\n`)
			);
		} else {
			console.log(chalk.gray(`\n👋🎅 Session ended\n`));
		}
	}

	async getSessionTimeRemaining() {
		return this.tracker.getSessionTimeRemaining();
	}

	async getDetailedAnalytics() {
		return this.tracker.getDetailedAnalytics();
	}

	async close() {
		await this.tracker.close();
	}
}
