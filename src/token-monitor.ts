import { createWriteStream, WriteStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionTracker, SessionData } from './session-tracker.js';
import { promises as fsp } from 'fs';
import logManager from './log-manager.js';

export class TokenMonitor {
	private logStream: WriteStream;
	private sessionId: string;
	private lastTokenCount: number = 0;
	private sessionStarted: boolean = false;
	private sessionTracker?: SessionTracker;
	private actualSessionId?: string;
	private instanceStartTokenCount: number = 0;
	private lastReportedTokens: number = 0;
	private sessionPromise?: Promise<SessionData>;
	private sessionLock: boolean = false;
	private static cleanupStarted: boolean = false;

	constructor(sessionId: string, sessionTracker?: SessionTracker) {
		this.sessionId = sessionId;
		this.sessionTracker = sessionTracker;

		// Start automatic log cleanup (only once per process)
		if (!TokenMonitor.cleanupStarted) {
			TokenMonitor.cleanupStarted = true;
			logManager.startAutoCleanup();
		}

		// Ensure log directory exists
		const logDir = join(homedir(), '.santa-claude', 'logs');
		// Ensure directory exists (async)
		fsp.mkdir(logDir, { recursive: true }).catch(() => {});

		// Create log file with timestamp
		const logFile = join(logDir, `session-${sessionId.slice(0, 8)}-${Date.now()}.log`);
		this.logStream = createWriteStream(logFile, { flags: 'a' });
	}

	processOutput(data: string): void {
		// Look for token count in the output
		const tokenMatch = data.match(/(\d+)\s+tokens/);

		if (tokenMatch) {
			const currentTokens = parseInt(tokenMatch[1]);

			// Check if tokens increased (indicating activity)
			if (currentTokens > this.lastTokenCount) {
				if (!this.sessionStarted) {
					// First token increase = actual session start
					this.sessionStarted = true;

					// Check if this is a large jump from 0 (resuming existing session)
					// If the jump is > 2000 tokens and we started from 0, it's likely resuming
					const RESUME_JUMP_THRESHOLD = 2000;
					const isLikelyResume = this.lastTokenCount === 0 && currentTokens > RESUME_JUMP_THRESHOLD;

					if (isLikelyResume) {
						// This is resuming an existing session - use current count as baseline
						this.instanceStartTokenCount = currentTokens;
						this.log(`Detected session resume with ${currentTokens} existing tokens (treating as baseline)`);
					} else {
						// Normal start - use the previous count as baseline
						this.instanceStartTokenCount = this.lastTokenCount;
						this.log(
							`Session started with first token activity: ${currentTokens} tokens (instance started from ${this.instanceStartTokenCount})`
						);
					}

					if (this.sessionTracker && !this.sessionPromise) {
						// Create session only once, store the promise
						this.sessionPromise = this.sessionTracker.createSession(this.sessionId);
						this.sessionPromise
							.then((session: SessionData) => {
								// Always use the returned session ID (might be an existing active session)
								this.actualSessionId = session.id;
								this.log(`Using session in database: ${session.id} (requested: ${this.sessionId})`);
							})
							.catch((err: Error) => {
								this.log(`Failed to create session: ${err.message}`);
							});
					}
				}

				// Update token count in database
				if (this.sessionTracker && this.actualSessionId && !this.sessionLock) {
					// Calculate the tokens this instance has contributed since we started
					const tokensFromThisInstance = currentTokens - this.instanceStartTokenCount;

					// Calculate the delta since our last report
					const tokenDelta = tokensFromThisInstance - this.lastReportedTokens;

					if (tokenDelta > 0) {
						// Prevent concurrent updates
						this.sessionLock = true;
						const sessionIdToUpdate = this.actualSessionId;
						
						// Increment the session tokens by just the new delta
						this.lastReportedTokens = tokensFromThisInstance; // Track what we've reported
						this.sessionTracker
							.incrementSessionTokens(sessionIdToUpdate, tokenDelta)
							.then(() => {
								this.sessionLock = false;
							})
							.catch((err: Error) => {
								this.log(`Failed to update token count: ${err.message}`);
								this.sessionLock = false;
							});
					}
				} else if (this.sessionTracker && !this.actualSessionId && this.sessionPromise) {
					// Wait for session creation to complete before updating tokens
					this.sessionPromise.then(() => {
						// Tokens will be updated on next processOutput call
					}).catch(() => {
						// Session creation failed, logged above
					});
				}

				this.lastTokenCount = currentTokens;
				this.log(`Token count increased to ${currentTokens}`);
			}
		}
	}

	private log(message: string): void {
		const timestamp = new Date().toISOString();
		const logEntry = `[${timestamp}] ${message}\n`;
		this.logStream.write(logEntry);
	}

	close(): void {
		this.log(`Session monitor closing. Total tokens used: ${this.lastTokenCount}`);
		this.logStream.end();
	}
}
