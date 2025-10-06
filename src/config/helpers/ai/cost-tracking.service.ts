/**
 * Cost Tracking Service
 *
 * This service tracks AI model usage and costs for optimization
 */

export interface ModelUsage {
  model: string;
  timestamp: Date;
  fileCount: number;
  estimatedCost: number;
  processingTime: number;
  confidence: number;
  sensitivity: 'low' | 'medium' | 'high' | 'critical';
}

export interface CostSummary {
  totalCost: number;
  modelBreakdown: Record<string, number>;
  averageCostPerAnalysis: number;
  totalAnalyses: number;
  costOptimization: {
    potentialSavings: number;
    recommendedActions: string[];
  };
}

export class CostTrackingService {
  private static usageHistory: ModelUsage[] = [];
  private static costRates = {
    'deepseek-reasoner': 0.1, // $0.10 per analysis (expensive)
    'gemini-2.5-pro': 0.05, // $0.05 per analysis (balanced)
    'deepseek-standard': 0.03, // $0.03 per analysis (cheap)
  };

  /**
   * Track model usage
   */
  static trackUsage(usage: Omit<ModelUsage, 'timestamp'>): void {
    const fullUsage: ModelUsage = {
      ...usage,
      timestamp: new Date(),
    };

    this.usageHistory.push(fullUsage);
    console.log(
      `💰 Cost tracking: ${usage.model} - $${usage.estimatedCost.toFixed(4)}`,
    );
  }

  /**
   * Get cost summary
   */
  static getCostSummary(): CostSummary {
    const totalAnalyses = this.usageHistory.length;
    const totalCost = this.usageHistory.reduce(
      (sum, usage) => sum + usage.estimatedCost,
      0,
    );

    const modelBreakdown = this.usageHistory.reduce(
      (breakdown, usage) => {
        breakdown[usage.model] =
          (breakdown[usage.model] || 0) + usage.estimatedCost;
        return breakdown;
      },
      {} as Record<string, number>,
    );

    const averageCostPerAnalysis =
      totalAnalyses > 0 ? totalCost / totalAnalyses : 0;

    // Calculate potential savings
    const potentialSavings = this.calculatePotentialSavings();
    const recommendedActions = this.getRecommendedActions();

    return {
      totalCost,
      modelBreakdown,
      averageCostPerAnalysis,
      totalAnalyses,
      costOptimization: {
        potentialSavings,
        recommendedActions,
      },
    };
  }

  /**
   * Calculate potential savings from optimization
   */
  private static calculatePotentialSavings(): number {
    const reasonerUsage = this.usageHistory.filter(
      (u) => u.model === 'deepseek-reasoner',
    );
    const geminiUsage = this.usageHistory.filter(
      (u) => u.model === 'gemini-2.5-pro',
    );

    let potentialSavings = 0;

    // Calculate savings if we used Gemini instead of DeepSeek Reasoner for non-critical cases
    reasonerUsage.forEach((usage) => {
      if (usage.sensitivity !== 'critical') {
        const geminiCost = this.costRates['gemini-2.5-pro'];
        const currentCost = usage.estimatedCost;
        potentialSavings += currentCost - geminiCost;
      }
    });

    return potentialSavings;
  }

  /**
   * Get recommended actions for cost optimization
   */
  private static getRecommendedActions(): string[] {
    const actions: string[] = [];
    const summary = this.getCostSummary();

    // Check if we're using too much DeepSeek Reasoner
    const reasonerUsage = this.usageHistory.filter(
      (u) => u.model === 'deepseek-reasoner',
    );
    const totalUsage = this.usageHistory.length;

    if (reasonerUsage.length / totalUsage > 0.3) {
      actions.push(
        'Consider using Gemini 2.5 Pro for non-critical analyses to reduce costs',
      );
    }

    // Check if we can optimize sensitivity detection
    const nonCriticalReasoner = reasonerUsage.filter(
      (u) => u.sensitivity !== 'critical',
    );
    if (nonCriticalReasoner.length > 0) {
      actions.push(
        'Review sensitivity detection - some non-critical analyses used expensive DeepSeek Reasoner',
      );
    }

    // Check cost trends
    if (summary.averageCostPerAnalysis > 0.08) {
      actions.push(
        'Average cost is high - consider implementing stricter cost controls',
      );
    }

    return actions;
  }

  /**
   * Get usage statistics
   */
  static getUsageStatistics(): {
    totalAnalyses: number;
    averageProcessingTime: number;
    modelDistribution: Record<string, number>;
    costTrend: Array<{ date: string; cost: number }>;
  } {
    const totalAnalyses = this.usageHistory.length;
    const averageProcessingTime =
      totalAnalyses > 0
        ? this.usageHistory.reduce(
            (sum, usage) => sum + usage.processingTime,
            0,
          ) / totalAnalyses
        : 0;

    const modelDistribution = this.usageHistory.reduce(
      (dist, usage) => {
        dist[usage.model] = (dist[usage.model] || 0) + 1;
        return dist;
      },
      {} as Record<string, number>,
    );

    // Group by date for cost trend
    const costTrend = this.usageHistory.reduce(
      (trend, usage) => {
        const date = usage.timestamp.toISOString().split('T')[0];
        const existing = trend.find((t) => t.date === date);
        if (existing) {
          existing.cost += usage.estimatedCost;
        } else {
          trend.push({ date, cost: usage.estimatedCost });
        }
        return trend;
      },
      [] as Array<{ date: string; cost: number }>,
    );

    return {
      totalAnalyses,
      averageProcessingTime,
      modelDistribution,
      costTrend,
    };
  }

  /**
   * Reset usage history
   */
  static resetHistory(): void {
    this.usageHistory = [];
    console.log('📊 Cost tracking history reset');
  }

  /**
   * Export usage data
   */
  static exportUsageData(): string {
    return JSON.stringify(
      {
        usageHistory: this.usageHistory,
        costSummary: this.getCostSummary(),
        statistics: this.getUsageStatistics(),
      },
      null,
      2,
    );
  }
}

