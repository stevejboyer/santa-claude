import { homedir } from 'os';
import path from 'path';
import fs from 'fs/promises';

interface SantaClaudeConfig {
	sessionLengthHours: number;
	subscriptionRenewalDay?: number; // Day of month (1-31) when subscription renews
}

const DEFAULT_CONFIG: SantaClaudeConfig = {
	sessionLengthHours: 5.0, // Default to 5 hours (Claude session length so far)
};

const CONFIG_DIR = path.join(homedir(), '.santa-claude');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export class ConfigManager {
	private static instance: ConfigManager;
	private config: SantaClaudeConfig | null = null;

	private constructor() {}

	static getInstance(): ConfigManager {
		if (!ConfigManager.instance) {
			ConfigManager.instance = new ConfigManager();
		}
		return ConfigManager.instance;
	}

	async ensureConfigDir(): Promise<void> {
		try {
			await fs.mkdir(CONFIG_DIR, { recursive: true });
		} catch (_error) {
			// Directory might already exist, ignore error
		}
	}

	async loadConfig(): Promise<SantaClaudeConfig> {
		try {
			await this.ensureConfigDir();
			const configData = await fs.readFile(CONFIG_FILE, 'utf-8');
			const parsedConfig = JSON.parse(configData);
			this.config = { ...DEFAULT_CONFIG, ...parsedConfig };
		} catch (_error) {
			// Config file doesn't exist or is invalid, use defaults
			this.config = { ...DEFAULT_CONFIG };
			await this.saveConfig();
		}

		return this.config!;
	}

	async saveConfig(): Promise<void> {
		if (!this.config) {
			this.config = { ...DEFAULT_CONFIG };
		}

		await this.ensureConfigDir();
		await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config!, null, 2));
	}

	async getSessionLengthHours(): Promise<number> {
		const config = await this.loadConfig();
		return config.sessionLengthHours;
	}

	async getSessionLengthMinutes(): Promise<number> {
		const hours = await this.getSessionLengthHours();
		return hours * 60;
	}

	async getSessionLengthMs(): Promise<number> {
		const minutes = await this.getSessionLengthMinutes();
		return minutes * 60 * 1000;
	}

	async updateSessionLength(hours: number): Promise<void> {
		if (hours <= 0) {
			throw new Error('Session length must be greater than 0 hours');
		}

		const config = await this.loadConfig();
		config.sessionLengthHours = hours;
		this.config = config;
		await this.saveConfig();
	}

	async getConfig(): Promise<SantaClaudeConfig> {
		return await this.loadConfig();
	}

	async getSubscriptionRenewalDay(): Promise<number | undefined> {
		const config = await this.loadConfig();
		return config.subscriptionRenewalDay;
	}

	async setSubscriptionRenewalDay(day: number | undefined): Promise<void> {
		if (day !== undefined && (day < 1 || day > 31)) {
			throw new Error('Subscription renewal day must be between 1 and 31');
		}

		const config = await this.loadConfig();
		config.subscriptionRenewalDay = day;
		this.config = config;
		await this.saveConfig();
	}

	// For testing - clear cached config
	clearCache(): void {
		this.config = null;
	}
}

export default ConfigManager.getInstance();
