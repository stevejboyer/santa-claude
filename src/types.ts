// Type definitions for santa-claude

export interface SessionRow {
	id: string;
	start_time: number;
	end_time: number;
	total_tokens: number | null;
}

export interface DailyUsageRow {
	date: string;
	sessions: number;
	total_tokens: number;
}

export interface HourCountRow {
	hour: string;
	count: number;
}

export interface DayOfWeekCountRow {
	dow: string;
	count: number;
}

export interface CountRow {
	count: number;
}

export interface TokenStatsRow {
	total_tokens: number | null;
}