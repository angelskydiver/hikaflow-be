export interface PerformanceMetrics {
  operationId: string;
  operationType:
    | 'analysis'
    | 'chunking'
    | 'validation'
    | 'ai-call'
    | 'file-processing';
  startTime: number;
  endTime: number;
  duration: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpuUsage: number;
  fileCount?: number;
  chunkCount?: number;
  aiModel?: string;
  success: boolean;
  errorMessage?: string;
  metadata: Record<string, any>;
}

export interface PerformanceReport {
  summary: {
    totalOperations: number;
    totalDuration: number;
    averageDuration: number;
    successRate: number;
    memoryPeak: number;
    cpuPeak: number;
  };
  byOperationType: Record<
    string,
    {
      count: number;
      totalDuration: number;
      averageDuration: number;
      successRate: number;
      memoryUsage: number;
    }
  >;
  byAIModel: Record<
    string,
    {
      count: number;
      totalDuration: number;
      averageDuration: number;
      successRate: number;
    }
  >;
  trends: {
    duration: Array<{ timestamp: number; value: number }>;
    memory: Array<{ timestamp: number; value: number }>;
    cpu: Array<{ timestamp: number; value: number }>;
  };
  recommendations: string[];
}

export interface PerformanceThresholds {
  maxDuration: number;
  maxMemoryUsage: number;
  maxCpuUsage: number;
  minSuccessRate: number;
  warningThresholds: {
    duration: number;
    memory: number;
    cpu: number;
  };
}

export class PerformanceMonitor {
  private static metrics: PerformanceMetrics[] = [];
  private static readonly MAX_METRICS_HISTORY = 1000;
  private static readonly THRESHOLDS: PerformanceThresholds = {
    maxDuration: 30000, // 30 seconds
    maxMemoryUsage: 500 * 1024 * 1024, // 500MB
    maxCpuUsage: 80, // 80%
    minSuccessRate: 0.95, // 95%
    warningThresholds: {
      duration: 10000, // 10 seconds
      memory: 200 * 1024 * 1024, // 200MB
      cpu: 60, // 60%
    },
  };

  /**
   * Start monitoring an operation
   */
  static startOperation(
    operationId: string,
    operationType: PerformanceMetrics['operationType'],
    metadata: Record<string, any> = {},
  ): PerformanceMetrics {
    const startTime = Date.now();
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const metric: PerformanceMetrics = {
      operationId,
      operationType,
      startTime,
      endTime: 0,
      duration: 0,
      memoryUsage,
      cpuUsage: cpuUsage.user + cpuUsage.system,
      success: false,
      metadata,
    };

    this.metrics.push(metric);
    this.cleanupOldMetrics();

    return metric;
  }

  /**
   * End monitoring an operation
   */
  static endOperation(
    operationId: string,
    success: boolean = true,
    errorMessage?: string,
    additionalMetadata: Record<string, any> = {},
  ): PerformanceMetrics | null {
    const metric = this.metrics.find((m) => m.operationId === operationId);
    if (!metric) {
      console.warn(`No metric found for operation ${operationId}`);
      return null;
    }

    const endTime = Date.now();
    const finalMemoryUsage = process.memoryUsage();
    const finalCpuUsage = process.cpuUsage();

    metric.endTime = endTime;
    metric.duration = endTime - metric.startTime;
    metric.memoryUsage = finalMemoryUsage;
    metric.cpuUsage = finalCpuUsage.user + finalCpuUsage.system;
    metric.success = success;
    metric.errorMessage = errorMessage;
    metric.metadata = { ...metric.metadata, ...additionalMetadata };

    // Check for performance issues
    this.checkPerformanceIssues(metric);

    return metric;
  }

  /**
   * Record a quick metric without start/end tracking
   */
  static recordMetric(
    operationType: PerformanceMetrics['operationType'],
    duration: number,
    success: boolean = true,
    metadata: Record<string, any> = {},
  ): void {
    const metric: PerformanceMetrics = {
      operationId: `quick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      operationType,
      startTime: Date.now() - duration,
      endTime: Date.now(),
      duration,
      memoryUsage: process.memoryUsage(),
      cpuUsage: 0,
      success,
      metadata,
    };

    this.metrics.push(metric);
    this.cleanupOldMetrics();
  }

  /**
   * Get performance report for a specific time range
   */
  static getPerformanceReport(
    startTime?: number,
    endTime?: number,
    operationType?: PerformanceMetrics['operationType'],
  ): PerformanceReport {
    const filteredMetrics = this.filterMetrics(
      startTime,
      endTime,
      operationType,
    );

    if (filteredMetrics.length === 0) {
      return this.createEmptyReport();
    }

    const summary = this.calculateSummary(filteredMetrics);
    const byOperationType = this.calculateByOperationType(filteredMetrics);
    const byAIModel = this.calculateByAIModel(filteredMetrics);
    const trends = this.calculateTrends(filteredMetrics);
    const recommendations = this.generateRecommendations(filteredMetrics);

    return {
      summary,
      byOperationType,
      byAIModel,
      trends,
      recommendations,
    };
  }

  /**
   * Get real-time performance status
   */
  static getCurrentStatus(): {
    activeOperations: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
    recentErrors: number;
    averageResponseTime: number;
  } {
    const activeOperations = this.metrics.filter((m) => m.endTime === 0).length;
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const recentMetrics = this.metrics.filter(
      (m) => m.endTime > 0 && m.endTime > Date.now() - 60000, // Last minute
    );

    const recentErrors = recentMetrics.filter((m) => !m.success).length;
    const averageResponseTime =
      recentMetrics.length > 0
        ? recentMetrics.reduce((sum, m) => sum + m.duration, 0) /
          recentMetrics.length
        : 0;

    return {
      activeOperations,
      memoryUsage,
      cpuUsage,
      recentErrors,
      averageResponseTime,
    };
  }

  /**
   * Get performance alerts
   */
  static getPerformanceAlerts(): Array<{
    type: 'warning' | 'error' | 'critical';
    message: string;
    metric: PerformanceMetrics;
    timestamp: number;
  }> {
    const alerts: Array<{
      type: 'warning' | 'error' | 'critical';
      message: string;
      metric: PerformanceMetrics;
      timestamp: number;
    }> = [];

    const recentMetrics = this.metrics.filter(
      (m) => m.endTime > 0 && m.endTime > Date.now() - 300000, // Last 5 minutes
    );

    for (const metric of recentMetrics) {
      // Check duration
      if (metric.duration > this.THRESHOLDS.maxDuration) {
        alerts.push({
          type: 'critical',
          message: `Operation ${metric.operationId} took ${metric.duration}ms (exceeds ${this.THRESHOLDS.maxDuration}ms limit)`,
          metric,
          timestamp: metric.endTime,
        });
      } else if (metric.duration > this.THRESHOLDS.warningThresholds.duration) {
        alerts.push({
          type: 'warning',
          message: `Operation ${metric.operationId} took ${metric.duration}ms (approaching ${this.THRESHOLDS.maxDuration}ms limit)`,
          metric,
          timestamp: metric.endTime,
        });
      }

      // Check memory usage
      if (metric.memoryUsage.heapUsed > this.THRESHOLDS.maxMemoryUsage) {
        alerts.push({
          type: 'critical',
          message: `Operation ${metric.operationId} used ${Math.round(metric.memoryUsage.heapUsed / 1024 / 1024)}MB (exceeds ${Math.round(this.THRESHOLDS.maxMemoryUsage / 1024 / 1024)}MB limit)`,
          metric,
          timestamp: metric.endTime,
        });
      } else if (
        metric.memoryUsage.heapUsed > this.THRESHOLDS.warningThresholds.memory
      ) {
        alerts.push({
          type: 'warning',
          message: `Operation ${metric.operationId} used ${Math.round(metric.memoryUsage.heapUsed / 1024 / 1024)}MB (approaching ${Math.round(this.THRESHOLDS.maxMemoryUsage / 1024 / 1024)}MB limit)`,
          metric,
          timestamp: metric.endTime,
        });
      }

      // Check success rate
      if (!metric.success) {
        alerts.push({
          type: 'error',
          message: `Operation ${metric.operationId} failed: ${metric.errorMessage || 'Unknown error'}`,
          metric,
          timestamp: metric.endTime,
        });
      }
    }

    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Clear old metrics to prevent memory leaks
   */
  static clearOldMetrics(olderThanMs: number = 3600000): void {
    // 1 hour default
    const cutoffTime = Date.now() - olderThanMs;
    this.metrics = this.metrics.filter((m) => m.startTime > cutoffTime);
  }

  /**
   * Reset all metrics
   */
  static resetMetrics(): void {
    this.metrics = [];
  }

  /**
   * Get metrics for a specific operation
   */
  static getOperationMetrics(operationId: string): PerformanceMetrics | null {
    return this.metrics.find((m) => m.operationId === operationId) || null;
  }

  /**
   * Get all metrics (for debugging)
   */
  static getAllMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  // Private helper methods
  private static cleanupOldMetrics(): void {
    if (this.metrics.length > this.MAX_METRICS_HISTORY) {
      this.metrics = this.metrics
        .sort((a, b) => b.startTime - a.startTime)
        .slice(0, this.MAX_METRICS_HISTORY);
    }
  }

  private static filterMetrics(
    startTime?: number,
    endTime?: number,
    operationType?: PerformanceMetrics['operationType'],
  ): PerformanceMetrics[] {
    let filtered = this.metrics.filter((m) => m.endTime > 0);

    if (startTime) {
      filtered = filtered.filter((m) => m.startTime >= startTime);
    }

    if (endTime) {
      filtered = filtered.filter((m) => m.endTime <= endTime);
    }

    if (operationType) {
      filtered = filtered.filter((m) => m.operationType === operationType);
    }

    return filtered;
  }

  private static calculateSummary(
    metrics: PerformanceMetrics[],
  ): PerformanceReport['summary'] {
    const totalOperations = metrics.length;
    const totalDuration = metrics.reduce((sum, m) => sum + m.duration, 0);
    const averageDuration = totalDuration / totalOperations;
    const successCount = metrics.filter((m) => m.success).length;
    const successRate = successCount / totalOperations;
    const memoryPeak = Math.max(...metrics.map((m) => m.memoryUsage.heapUsed));
    const cpuPeak = Math.max(...metrics.map((m) => m.cpuUsage));

    return {
      totalOperations,
      totalDuration,
      averageDuration,
      successRate,
      memoryPeak,
      cpuPeak,
    };
  }

  private static calculateByOperationType(
    metrics: PerformanceMetrics[],
  ): Record<string, any> {
    const grouped = metrics.reduce(
      (acc, metric) => {
        const type = metric.operationType;
        if (!acc[type]) {
          acc[type] = [];
        }
        acc[type].push(metric);
        return acc;
      },
      {} as Record<string, PerformanceMetrics[]>,
    );

    const result: Record<string, any> = {};

    for (const [type, typeMetrics] of Object.entries(grouped)) {
      const count = typeMetrics.length;
      const totalDuration = typeMetrics.reduce((sum, m) => sum + m.duration, 0);
      const averageDuration = totalDuration / count;
      const successCount = typeMetrics.filter((m) => m.success).length;
      const successRate = successCount / count;
      const memoryUsage =
        typeMetrics.reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) / count;

      result[type] = {
        count,
        totalDuration,
        averageDuration,
        successRate,
        memoryUsage,
      };
    }

    return result;
  }

  private static calculateByAIModel(
    metrics: PerformanceMetrics[],
  ): Record<string, any> {
    const grouped = metrics.reduce(
      (acc, metric) => {
        const model = metric.aiModel || 'unknown';
        if (!acc[model]) {
          acc[model] = [];
        }
        acc[model].push(metric);
        return acc;
      },
      {} as Record<string, PerformanceMetrics[]>,
    );

    const result: Record<string, any> = {};

    for (const [model, modelMetrics] of Object.entries(grouped)) {
      const count = modelMetrics.length;
      const totalDuration = modelMetrics.reduce(
        (sum, m) => sum + m.duration,
        0,
      );
      const averageDuration = totalDuration / count;
      const successCount = modelMetrics.filter((m) => m.success).length;
      const successRate = successCount / count;

      result[model] = {
        count,
        totalDuration,
        averageDuration,
        successRate,
      };
    }

    return result;
  }

  private static calculateTrends(
    metrics: PerformanceMetrics[],
  ): PerformanceReport['trends'] {
    const sortedMetrics = metrics.sort((a, b) => a.endTime - b.endTime);
    const timeWindow = 60000; // 1 minute windows
    const now = Date.now();
    const startTime = now - 24 * 60 * 60 * 1000; // 24 hours ago

    const duration: Array<{ timestamp: number; value: number }> = [];
    const memory: Array<{ timestamp: number; value: number }> = [];
    const cpu: Array<{ timestamp: number; value: number }> = [];

    for (let time = startTime; time < now; time += timeWindow) {
      const windowMetrics = sortedMetrics.filter(
        (m) => m.endTime >= time && m.endTime < time + timeWindow,
      );

      if (windowMetrics.length > 0) {
        const avgDuration =
          windowMetrics.reduce((sum, m) => sum + m.duration, 0) /
          windowMetrics.length;
        const avgMemory =
          windowMetrics.reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) /
          windowMetrics.length;
        const avgCpu =
          windowMetrics.reduce((sum, m) => sum + m.cpuUsage, 0) /
          windowMetrics.length;

        duration.push({ timestamp: time, value: avgDuration });
        memory.push({ timestamp: time, value: avgMemory });
        cpu.push({ timestamp: time, value: avgCpu });
      }
    }

    return { duration, memory, cpu };
  }

  private static generateRecommendations(
    metrics: PerformanceMetrics[],
  ): string[] {
    const recommendations: string[] = [];

    const avgDuration =
      metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
    const avgMemory =
      metrics.reduce((sum, m) => sum + m.memoryUsage.heapUsed, 0) /
      metrics.length;
    const successRate =
      metrics.filter((m) => m.success).length / metrics.length;

    if (avgDuration > 10000) {
      recommendations.push(
        'Consider optimizing slow operations or implementing caching',
      );
    }

    if (avgMemory > 100 * 1024 * 1024) {
      // 100MB
      recommendations.push(
        'Memory usage is high - consider implementing memory optimization strategies',
      );
    }

    if (successRate < 0.95) {
      recommendations.push(
        'Success rate is below 95% - investigate and fix failing operations',
      );
    }

    const errorCount = metrics.filter((m) => !m.success).length;
    if (errorCount > metrics.length * 0.1) {
      recommendations.push(
        'Error rate is above 10% - review error handling and retry logic',
      );
    }

    return recommendations;
  }

  private static createEmptyReport(): PerformanceReport {
    return {
      summary: {
        totalOperations: 0,
        totalDuration: 0,
        averageDuration: 0,
        successRate: 0,
        memoryPeak: 0,
        cpuPeak: 0,
      },
      byOperationType: {},
      byAIModel: {},
      trends: {
        duration: [],
        memory: [],
        cpu: [],
      },
      recommendations: [],
    };
  }

  private static checkPerformanceIssues(metric: PerformanceMetrics): void {
    const issues: string[] = [];

    if (metric.duration > this.THRESHOLDS.maxDuration) {
      issues.push(
        `Duration exceeded limit: ${metric.duration}ms > ${this.THRESHOLDS.maxDuration}ms`,
      );
    }

    if (metric.memoryUsage.heapUsed > this.THRESHOLDS.maxMemoryUsage) {
      issues.push(
        `Memory usage exceeded limit: ${Math.round(metric.memoryUsage.heapUsed / 1024 / 1024)}MB > ${Math.round(this.THRESHOLDS.maxMemoryUsage / 1024 / 1024)}MB`,
      );
    }

    if (metric.cpuUsage > this.THRESHOLDS.maxCpuUsage) {
      issues.push(
        `CPU usage exceeded limit: ${metric.cpuUsage}% > ${this.THRESHOLDS.maxCpuUsage}%`,
      );
    }

    if (issues.length > 0) {
      console.warn(
        `Performance issues detected for operation ${metric.operationId}:`,
        issues,
      );
    }
  }
}
