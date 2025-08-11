import { promises as fsp } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import logger from './logger.js';

export interface LogManagerOptions {
	maxLogFiles?: number;
	maxLogAgeMs?: number;
	logDir?: string;
}

const DEFAULT_OPTIONS: Required<LogManagerOptions> = {
	maxLogFiles: 50,
	maxLogAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
	logDir: join(homedir(), '.santa-claude', 'logs'),
};

export class LogManager {
	private options: Required<LogManagerOptions>;
	private cleanupInterval?: NodeJS.Timeout;

	constructor(options: LogManagerOptions = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Start automatic log cleanup
	 */
	startAutoCleanup(intervalMs: number = 24 * 60 * 60 * 1000): void {
		// Clean up immediately on start
		this.cleanupOldLogs().catch(err => {
			logger.error('Failed to cleanup logs on startup', err);
		});

		// Then set up interval for periodic cleanup
		this.cleanupInterval = setInterval(() => {
			this.cleanupOldLogs().catch(err => {
				logger.error('Failed to cleanup logs', err);
			});
		}, intervalMs);

		// Ensure cleanup on process exit
		process.on('exit', () => this.stop());
		process.on('SIGINT', () => this.stop());
		process.on('SIGTERM', () => this.stop());
	}

	/**
	 * Stop automatic cleanup
	 */
	stop(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = undefined;
		}
	}

	/**
	 * Clean up old log files based on age and count limits
	 */
	async cleanupOldLogs(): Promise<number> {
		try {
			// Ensure log directory exists
			await fsp.mkdir(this.options.logDir, { recursive: true });

			// Get all log files
			const files = await fsp.readdir(this.options.logDir);
			const logFiles = files.filter(f => f.endsWith('.log'));

			if (logFiles.length === 0) {
				return 0;
			}

			// Get file stats
			const fileStats = await Promise.all(
				logFiles.map(async file => {
					const filePath = join(this.options.logDir, file);
					try {
						const stats = await fsp.stat(filePath);
						return {
							path: filePath,
							name: file,
							mtime: stats.mtime.getTime(),
							size: stats.size,
						};
					} catch (_err) {
						// File might have been deleted
						return null;
					}
				})
			);

			// Filter out nulls and sort by modification time (newest first)
			const validFiles = fileStats
				.filter((f): f is NonNullable<typeof f> => f !== null)
				.sort((a, b) => b.mtime - a.mtime);

			const now = Date.now();
			const filesToDelete: string[] = [];

			// Mark files for deletion based on age and count
			validFiles.forEach((file, index) => {
				const age = now - file.mtime;
				
				// Delete if too old
				if (age > this.options.maxLogAgeMs) {
					filesToDelete.push(file.path);
				}
				// Delete if we have too many files (keep newest)
				else if (index >= this.options.maxLogFiles) {
					filesToDelete.push(file.path);
				}
			});

			// Delete marked files
			await Promise.all(
				filesToDelete.map(async filePath => {
					try {
						await fsp.unlink(filePath);
						logger.debug(`Deleted old log file: ${filePath}`);
					} catch (err) {
						logger.error(`Failed to delete log file: ${filePath}`, err);
					}
				})
			);

			return filesToDelete.length;
		} catch (err) {
			logger.error('Error during log cleanup', err);
			return 0;
		}
	}

	/**
	 * Get log directory statistics
	 */
	async getLogStats(): Promise<{
		totalFiles: number;
		totalSizeBytes: number;
		oldestLog?: Date;
		newestLog?: Date;
	}> {
		try {
			const files = await fsp.readdir(this.options.logDir);
			const logFiles = files.filter(f => f.endsWith('.log'));

			if (logFiles.length === 0) {
				return { totalFiles: 0, totalSizeBytes: 0 };
			}

			const fileStats = await Promise.all(
				logFiles.map(async file => {
					const filePath = join(this.options.logDir, file);
					const stats = await fsp.stat(filePath);
					return {
						mtime: stats.mtime.getTime(),
						size: stats.size,
					};
				})
			);

			const totalSizeBytes = fileStats.reduce((sum, f) => sum + f.size, 0);
			const mtimes = fileStats.map(f => f.mtime).sort((a, b) => a - b);

			return {
				totalFiles: logFiles.length,
				totalSizeBytes,
				oldestLog: new Date(mtimes[0]),
				newestLog: new Date(mtimes[mtimes.length - 1]),
			};
		} catch (err) {
			logger.error('Failed to get log stats', err);
			return { totalFiles: 0, totalSizeBytes: 0 };
		}
	}
}

// Export singleton instance
export default new LogManager();