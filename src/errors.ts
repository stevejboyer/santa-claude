export class SantaClaudeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SantaClaudeError';
	}
}

export class ValidationError extends SantaClaudeError {
	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}

export class ConfigError extends SantaClaudeError {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

export class SessionError extends SantaClaudeError {
	constructor(message: string) {
		super(message);
		this.name = 'SessionError';
	}
}

export class ProcessError extends SantaClaudeError {
	public readonly exitCode: number;

	constructor(message: string, exitCode: number) {
		super(message);
		this.name = 'ProcessError';
		this.exitCode = exitCode;
	}
}