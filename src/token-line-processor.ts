import { SessionTracker } from './session-tracker.js';
import chalk from 'chalk';

export class TokenLineProcessor {
	private tracker: SessionTracker;
	private lastTimeInfo: string = '';
	private lastUpdateTime: number = 0;
	private currentTokens: number = 0;
	private lastProcessedTokens: number = 0;
	private isProcessingUpdate: boolean = false;
	private updateInterval: NodeJS.Timeout | null = null;

	constructor(tracker: SessionTracker) {
		this.tracker = tracker;
		// Update cached time info periodically
		this.updateTimeInfo();
		this.updateInterval = setInterval(() => this.updateTimeInfo(), 5000);
	}

	private async updateTimeInfo() {
		const timeRemaining = await this.tracker.getSessionTimeRemaining();

		if (timeRemaining) {
			const timeStr = `${timeRemaining.hours}:${timeRemaining.minutes.toString().padStart(2, '0')} remaining`;
			this.lastTimeInfo = `🎅 ${timeStr}`;
		} else {
			this.lastTimeInfo = `🎅 No active session`;
		}
	}

	processOutput(data: string): string {
		// Check for token updates and extract the count
		const tokenMatch = data.match(/(\d+)\s+tokens?/);
		if (tokenMatch) {
			const newTokens = parseInt(tokenMatch[1]);

			// Only update if tokens actually changed (not just UI refresh)
			if (newTokens !== this.currentTokens) {
				this.currentTokens = newTokens;
				const now = Date.now();
				// Increase throttling to 500ms to reduce updates during typing
				if (now - this.lastUpdateTime > 500) {
					this.updateTimeInfo();
					this.lastUpdateTime = now;
				}
			}
		}

		// Only inject our status if:
		// 1. We have token info to display
		// 2. The data contains a complete token count line (with significant spacing)
		// 3. We haven't just processed this exact token count
		// 4. The line appears to be a complete render (contains newline or is long enough)
		if (this.lastTimeInfo && data.match(/\d+\s+tokens?/)) {
			// Check if this looks like a complete UI update (not a partial update during typing)
			const hasNewline = data.includes('\n') || data.includes('\r');
			const isLongEnough = data.length > 80;

			// Skip if this appears to be a partial update or we're in rapid succession
			if (!hasNewline && !isLongEnough) {
				return data;
			}

			// Check if we've already processed this exact token count recently
			const currentTokenMatch = data.match(/(\d+)\s+tokens?/);
			if (currentTokenMatch) {
				const currentCount = parseInt(currentTokenMatch[1]);
				if (currentCount === this.lastProcessedTokens && Date.now() - this.lastUpdateTime < 500) {
					// Skip duplicate processing within 500ms window
					return data;
				}
				this.lastProcessedTokens = currentCount;
			}

			// Look for pattern with many spaces (50+) followed by optional ANSI codes and tokens
			// This conservative pattern avoids interfering with UI rendering
			const tokenPattern = /(\s{50,})((?:\x1b\[[0-9;]*m)*)(\d+\s+tokens?)/;
			const match = data.match(tokenPattern);

			if (match) {
				// Prevent recursive processing
				if (this.isProcessingUpdate) {
					return data;
				}

				this.isProcessingUpdate = true;

				const [_fullMatch, spaces, ansiCodes, tokenText] = match;

				// Use chalk to match Claude's gray color #787C7F
				const ourInfo = chalk.hex('#787C7F')(this.lastTimeInfo);

				// Calculate total width needed
				const minPadding = 2; // Consistent left padding
				const ourInfoLength = this.lastTimeInfo.length;

				// Only inject if we have enough space
				if (spaces.length > ourInfoLength + minPadding + 5) {
					// Always place our info at a fixed position from the left
					// This prevents jumping around
					const remainingSpaces = spaces.length - ourInfoLength - minPadding;

					const replacement =
						' '.repeat(minPadding) + ourInfo + ' '.repeat(remainingSpaces) + ansiCodes + tokenText;

					this.isProcessingUpdate = false;
					return data.replace(tokenPattern, replacement);
				}

				this.isProcessingUpdate = false;
			}

			return data;
		}

		return data;
	}

	close() {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
	}
}
