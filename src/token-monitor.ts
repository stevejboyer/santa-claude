import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionTracker, SessionData } from './session-tracker.js';
// configManager no longer needed here after removing rollover logic

export class TokenMonitor {
	private logStream: NodeJS.WritableStream;
	private sessionId: string;
	private lastTokenCount: number = 0;
	private sessionStarted: boolean = false;
	private sessionTracker?: SessionTracker;
	private actualSessionId?: string;
	private instanceStartTokenCount: number = 0;
	private lastReportedTokens: number = 0;

	constructor(sessionId: string, sessionTracker?: SessionTracker) {
		this.sessionId = sessionId;
		this.sessionTracker = sessionTracker;

		// Ensure log directory exists
		const logDir = join(homedir(), '.santa-claude', 'logs');
		if (!existsSync(logDir)) {
			mkdirSync(logDir, { recursive: true });
		}

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
					const isLikelyResume = this.lastTokenCount === 0 && currentTokens > 2000;
					
					if (isLikelyResume) {
						// This is resuming an existing session - use current count as baseline
						this.instanceStartTokenCount = currentTokens;
						this.log(`Detected session resume with ${currentTokens} existing tokens (treating as baseline)`);
					} else {
						// Normal start - use the previous count as baseline
						this.instanceStartTokenCount = this.lastTokenCount;
						this.log(`Session started with first token activity: ${currentTokens} tokens (instance started from ${this.instanceStartTokenCount})`);
					}

					if (this.sessionTracker) {
						this.sessionTracker
							.createSession(this.sessionId)
							.then((session: SessionData) => {
								// Always use the returned session ID (might be an existing active session)
								this.actualSessionId = session.id;
								this.log(`Using session in database: ${session.id} (requested: ${this.sessionId})`);
							})
							.catch((err: Error) => {
								this.log(`Failed to create session: ${err.message}`);
							});
					}
				} else if (this.sessionTracker && !this.actualSessionId) {
					// Session was started but we don't have an actualSessionId yet
					// This can happen if we're resuming after the initial session creation
					this.sessionTracker
						.getActiveSession()
						.then((session: SessionData | null) => {
							if (session) {
								this.actualSessionId = session.id;
								this.log(`Retrieved active session: ${session.id}`);
							}
						})
						.catch((err: Error) => {
							this.log(`Failed to get active session: ${err.message}`);
						});
				}

				// Update token count in database
				if (this.sessionTracker) {
					// Calculate the tokens this instance has contributed since we started
					const tokensFromThisInstance = currentTokens - this.instanceStartTokenCount;
					
					// Calculate the delta since our last report
					const tokenDelta = tokensFromThisInstance - this.lastReportedTokens;
					
					if (tokenDelta > 0) {
						// Always try to get the current active session before updating
						this.sessionTracker
							.getActiveSession()
							.then((activeSession: SessionData | null) => {
								if (activeSession) {
									// Use the active session ID for token updates
									const sessionIdToUpdate = activeSession.id;
									this.actualSessionId = sessionIdToUpdate; // Keep our reference current
									
									// Increment the session tokens by just the new delta
									this.lastReportedTokens = tokensFromThisInstance; // Track what we've reported
									return this.sessionTracker!.incrementSessionTokens(sessionIdToUpdate, tokenDelta);
								} else {
									this.log(`No active session found for token update`);
								}
							})
							.catch((err: Error) => {
								this.log(`Failed to update token count: ${err.message}`);
							});
					}
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
