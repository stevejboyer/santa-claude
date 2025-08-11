import chalk from 'chalk';
import { createWriteStream, WriteStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { promises as fsp } from 'fs';

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

export interface LoggerOptions {
	level?: LogLevel;
	logToFile?: boolean;
	logDir?: string;
}

class Logger {
	private level: LogLevel;
	private fileStream?: WriteStream;
	private static instance: Logger;

	private constructor(options: LoggerOptions = {}) {
		this.level = options.level ?? (process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO);

		if (options.logToFile) {
			const logDir = options.logDir ?? join(homedir(), '.santa-claude', 'logs');
			// Ensure directory exists (async, non-blocking)
			fsp.mkdir(logDir, { recursive: true }).catch(() => {
				// Directory creation failed, continue without file logging
			});

			const logFile = join(logDir, `santa-claude-${new Date().toISOString().split('T')[0]}.log`);
			this.fileStream = createWriteStream(logFile, { flags: 'a' });
		}
	}

	static getInstance(options?: LoggerOptions): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger(options);
		}
		return Logger.instance;
	}

	private log(level: LogLevel, message: string, ...args: unknown[]): void {
		if (level < this.level) return;

		const timestamp = new Date().toISOString();
		const levelStr = LogLevel[level];
		const formattedMessage = `[${timestamp}] [${levelStr}] ${message}`;

		// Log to file if configured
		if (this.fileStream) {
			this.fileStream.write(formattedMessage + ' ' + args.map(arg => JSON.stringify(arg)).join(' ') + '\n');
		}

		// Log to console with colors
		if (level === LogLevel.ERROR) {
			console.error(chalk.red(`[${levelStr}]`), message, ...args);
		} else if (level === LogLevel.WARN) {
			console.warn(chalk.yellow(`[${levelStr}]`), message, ...args);
		} else if (level === LogLevel.DEBUG) {
			if (process.env.DEBUG) {
				console.log(chalk.gray(`[${levelStr}]`), message, ...args);
			}
		} else {
			// INFO level - no prefix in console for cleaner output
			console.log(message, ...args);
		}
	}

	debug(message: string, ...args: unknown[]): void {
		this.log(LogLevel.DEBUG, message, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		this.log(LogLevel.INFO, message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.log(LogLevel.WARN, message, ...args);
	}

	error(message: string, error?: Error | unknown, ...args: unknown[]): void {
		if (error instanceof Error) {
			this.log(LogLevel.ERROR, `${message}: ${error.message}`, ...args);
			if (this.level === LogLevel.DEBUG && error.stack) {
				this.log(LogLevel.DEBUG, `Stack trace: ${error.stack}`);
			}
		} else if (error) {
			this.log(LogLevel.ERROR, message, error, ...args);
		} else {
			this.log(LogLevel.ERROR, message, ...args);
		}
	}

	close(): void {
		if (this.fileStream) {
			this.fileStream.end();
		}
	}
}

export default Logger.getInstance();