import { Injectable } from '@nestjs/common';

/**
 * Simple file cache service for caching file content
 */
@Injectable()
export class FileCache {
  private cache: Map<string, any> = new Map();

  /**
   * Get a file from the cache
   * @param key Cache key
   * @returns Cached content or null
   */
  get(key: string): any | null {
    if (!this.cache.has(key)) {
      return null;
    }

    const { data, expiry } = this.cache.get(key);

    if (expiry < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return data;
  }

  /**
   * Set a file in the cache
   * @param key Cache key
   * @param data Data to cache
   * @param ttlSeconds Time to live in seconds
   */
  set(key: string, data: any, ttlSeconds: number = 3600): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Delete a specific key from the cache
   * @param key Cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }
}
