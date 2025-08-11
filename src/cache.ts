interface CacheEntry<T> {
	value: T;
	timestamp: number;
	ttl: number;
}

export class SimpleCache<T = unknown> {
	private cache: Map<string, CacheEntry<T>> = new Map();
	private cleanupInterval?: NodeJS.Timeout;

	constructor(private defaultTTL: number = 60000) {
		// Cleanup expired entries every minute
		this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
	}

	/**
	 * Get a value from cache
	 */
	get(key: string): T | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;

		const now = Date.now();
		if (now > entry.timestamp + entry.ttl) {
			// Entry expired
			this.cache.delete(key);
			return undefined;
		}

		return entry.value;
	}

	/**
	 * Set a value in cache
	 */
	set(key: string, value: T, ttl?: number): void {
		this.cache.set(key, {
			value,
			timestamp: Date.now(),
			ttl: ttl ?? this.defaultTTL,
		});
	}

	/**
	 * Check if key exists and is not expired
	 */
	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	/**
	 * Delete a key from cache
	 */
	delete(key: string): boolean {
		return this.cache.delete(key);
	}

	/**
	 * Clear all cache entries
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get or compute a value
	 */
	async getOrCompute<R = T>(
		key: string,
		compute: () => Promise<R>,
		ttl?: number
	): Promise<R> {
		const cached = this.get(key) as R | undefined;
		if (cached !== undefined) {
			return cached;
		}

		const value = await compute();
		this.set(key, value as T, ttl);
		return value;
	}

	/**
	 * Clean up expired entries
	 */
	private cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.timestamp + entry.ttl) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Stop the cleanup interval
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = undefined;
		}
		this.cache.clear();
	}

	/**
	 * Get cache statistics
	 */
	getStats(): { size: number; keys: string[] } {
		return {
			size: this.cache.size,
			keys: Array.from(this.cache.keys()),
		};
	}
}

// Export singleton instances for common use cases
export const sessionCache = new SimpleCache(5 * 60 * 1000); // 5 minutes
export const statsCache = new SimpleCache(60 * 1000); // 1 minute