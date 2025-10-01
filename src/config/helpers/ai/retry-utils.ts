/**
 * Enhanced retry utilities for AI operations
 * Provides robust error handling with exponential backoff and circuit breaker patterns
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  timeoutMs?: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  timeoutMs: 120000, // 2 minutes
};

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly originalError: Error,
    public readonly attempt: number,
    public readonly maxRetries: number,
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class RetryUtils {
  private static circuitBreaker = new Map<
    string,
    {
      failures: number;
      lastFailure: number;
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    }
  >();

  /**
   * Execute an operation with enhanced retry logic
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    operationId: string = 'default',
  ): Promise<T> {
    const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: Error | null = null;

    // Check circuit breaker
    if (this.isCircuitOpen(operationId)) {
      throw new CircuitBreakerError(
        `Circuit breaker is OPEN for operation: ${operationId}`,
      );
    }

    for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
      try {
        // Add timeout if specified
        if (finalConfig.timeoutMs) {
          return await this.executeWithTimeout(
            operation,
            finalConfig.timeoutMs,
          );
        }

        const result = await operation();

        // Reset circuit breaker on success
        this.resetCircuitBreaker(operationId);
        return result;
      } catch (error) {
        lastError = error as Error;

        // Log the attempt
        console.warn(
          `Attempt ${attempt}/${finalConfig.maxRetries} failed for ${operationId}:`,
          error.message,
        );

        // Don't retry on certain error types
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        // Update circuit breaker
        this.recordFailure(operationId);

        // If this was the last attempt, throw the error
        if (attempt === finalConfig.maxRetries) {
          throw new RetryError(
            `Operation failed after ${finalConfig.maxRetries} attempts`,
            lastError,
            attempt,
            finalConfig.maxRetries,
          );
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, finalConfig);
        console.log(
          `Waiting ${delay}ms before retry ${attempt + 1}/${finalConfig.maxRetries}`,
        );

        await this.sleep(delay);
      }
    }

    throw new RetryError(
      `Operation failed after ${finalConfig.maxRetries} attempts`,
      lastError!,
      finalConfig.maxRetries,
      finalConfig.maxRetries,
    );
  }

  /**
   * Execute operation with timeout
   */
  private static async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private static calculateDelay(attempt: number, config: RetryConfig): number {
    const exponentialDelay =
      config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

    if (config.jitter) {
      // Add random jitter to prevent thundering herd
      const jitterRange = cappedDelay * 0.1; // 10% jitter
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      return Math.max(0, cappedDelay + jitter);
    }

    return cappedDelay;
  }

  /**
   * Check if error is non-retryable
   */
  private static isNonRetryableError(error: any): boolean {
    // Don't retry on authentication errors, rate limits, or client errors
    if (error.status === 401 || error.status === 403) return true;
    if (error.status === 429) return true; // Rate limit
    if (error.status >= 400 && error.status < 500) return true; // Client errors

    // Don't retry on certain error messages
    const nonRetryableMessages = [
      'invalid api key',
      'authentication failed',
      'quota exceeded',
      'rate limit exceeded',
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    return nonRetryableMessages.some((msg) => errorMessage.includes(msg));
  }

  /**
   * Circuit breaker implementation
   */
  private static isCircuitOpen(operationId: string): boolean {
    const breaker = this.circuitBreaker.get(operationId);
    if (!breaker) return false;

    const now = Date.now();
    const timeSinceLastFailure = now - breaker.lastFailure;

    // If circuit is open and enough time has passed, move to half-open
    if (breaker.state === 'OPEN' && timeSinceLastFailure > 60000) {
      // 1 minute
      breaker.state = 'HALF_OPEN';
    }

    return breaker.state === 'OPEN';
  }

  private static recordFailure(operationId: string): void {
    const breaker = this.circuitBreaker.get(operationId) || {
      failures: 0,
      lastFailure: 0,
      state: 'CLOSED' as const,
    };

    breaker.failures++;
    breaker.lastFailure = Date.now();

    // Open circuit if too many failures
    if (breaker.failures >= 5) {
      breaker.state = 'OPEN';
    }

    this.circuitBreaker.set(operationId, breaker);
  }

  /**
   * Sleep utility
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker status
   */
  static getCircuitBreakerStatus(
    operationId: string,
  ): { state: string; failures: number; lastFailure: number } | null {
    const breaker = this.circuitBreaker.get(operationId);
    if (!breaker) return null;

    return {
      state: breaker.state,
      failures: breaker.failures,
      lastFailure: breaker.lastFailure,
    };
  }

  /**
   * Reset circuit breaker manually
   */
  static resetCircuitBreaker(operationId: string): void {
    this.circuitBreaker.set(operationId, {
      failures: 0,
      lastFailure: 0,
      state: 'CLOSED',
    });
  }
}
