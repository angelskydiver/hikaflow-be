/**
 * AI Model Configuration
 *
 * This module provides configuration options for AI model selection
 * in impact analysis, allowing for cost-performance optimization.
 */

export interface ModelConfig {
  useCrossValidation: boolean;
  primaryModel: 'deepseek' | 'gemini';
  fallbackModel: 'deepseek' | 'gemini';
  enableCostOptimization: boolean;
  maxFilesForCrossValidation: number;
  highRiskThreshold: string;
  useDeepSeekReasoner: boolean;
  sensitivityThreshold: 'low' | 'medium' | 'high' | 'critical';
  costOptimizationMode: 'balanced' | 'cost-focused' | 'quality-focused';
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  useCrossValidation: false, // Disable cross-validation for cost optimization
  primaryModel: 'gemini', // Use Gemini 2.5 Pro as default
  fallbackModel: 'gemini', // Use Gemini as fallback too
  enableCostOptimization: true,
  maxFilesForCrossValidation: 5, // Reduced for cost optimization
  highRiskThreshold: 'critical', // Only use DeepSeek for critical cases
  useDeepSeekReasoner: true, // Enable but with strict criteria
  sensitivityThreshold: 'critical', // Only for critical sensitivity
  costOptimizationMode: 'cost-focused', // Focus on cost optimization
};

export const COST_OPTIMIZED_CONFIG: ModelConfig = {
  useCrossValidation: false,
  primaryModel: 'gemini', // Use Gemini 2.5 Pro for cost optimization
  fallbackModel: 'gemini',
  enableCostOptimization: true,
  maxFilesForCrossValidation: 5,
  highRiskThreshold: 'critical',
  useDeepSeekReasoner: false, // Never use expensive DeepSeek Reasoner
  sensitivityThreshold: 'critical',
  costOptimizationMode: 'cost-focused',
};

export const PERFORMANCE_OPTIMIZED_CONFIG: ModelConfig = {
  useCrossValidation: true,
  primaryModel: 'gemini', // Use Gemini 2.5 Pro for performance
  fallbackModel: 'deepseek',
  enableCostOptimization: false,
  maxFilesForCrossValidation: 20,
  highRiskThreshold: 'medium',
  useDeepSeekReasoner: true, // Use DeepSeek Reasoner for high-quality analysis
  sensitivityThreshold: 'medium',
  costOptimizationMode: 'quality-focused',
};

export class ModelConfigManager {
  private static config: ModelConfig = DEFAULT_MODEL_CONFIG;

  /**
   * Set the model configuration
   */
  static setConfig(config: Partial<ModelConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration
   */
  static getConfig(): ModelConfig {
    return this.config;
  }

  /**
   * Determine if cross-validation should be used
   */
  static shouldUseCrossValidation(
    fileCount: number,
    riskLevel: string,
    isComplexAnalysis: boolean,
  ): boolean {
    if (!this.config.useCrossValidation) {
      return false;
    }

    if (this.config.enableCostOptimization) {
      return (
        fileCount <= this.config.maxFilesForCrossValidation &&
        riskLevel === this.config.highRiskThreshold
      );
    }

    return true;
  }

  /**
   * Get the primary model for analysis
   */
  static getPrimaryModel(): string {
    return this.config.primaryModel;
  }

  /**
   * Get the fallback model for analysis
   */
  static getFallbackModel(): string {
    return this.config.fallbackModel;
  }

  /**
   * Check if cost optimization is enabled
   */
  static isCostOptimizationEnabled(): boolean {
    return this.config.enableCostOptimization;
  }

  /**
   * Determine if DeepSeek Reasoner should be used based on sensitivity
   * Strategy: Use DeepSeek Reasoner ONLY for minimum and highly sensitive cases
   */
  static shouldUseDeepSeekReasoner(
    fileCount: number,
    riskLevel: string,
    isComplexAnalysis: boolean,
    hasSensitiveFiles: boolean,
    hasCriticalComponents: boolean,
  ): boolean {
    if (!this.config.useDeepSeekReasoner) {
      return false;
    }

    // ONLY use DeepSeek Reasoner for CRITICAL cases with sensitive files
    if (riskLevel === 'critical' && hasSensitiveFiles) {
      return true;
    }

    // ONLY use DeepSeek Reasoner for critical components (auth, payment, security)
    if (
      hasCriticalComponents &&
      (riskLevel === 'critical' || riskLevel === 'high')
    ) {
      return true;
    }

    // ONLY use DeepSeek Reasoner for very small, highly sensitive changes
    if (fileCount <= 3 && hasSensitiveFiles && riskLevel === 'high') {
      return true;
    }

    // For everything else, use Gemini 2.5 Pro (cost-effective)
    return false;
  }

  /**
   * Detect sensitive files and components
   */
  static detectSensitivity(
    files: any[],
    analysisContext: any,
  ): {
    hasSensitiveFiles: boolean;
    hasCriticalComponents: boolean;
    sensitiveFileTypes: string[];
    criticalComponents: string[];
  } {
    const sensitiveFileTypes = [];
    const criticalComponents = [];
    let hasSensitiveFiles = false;
    let hasCriticalComponents = false;

    // Define sensitive file patterns
    const sensitivePatterns = [
      /auth/i,
      /security/i,
      /encryption/i,
      /password/i,
      /token/i,
      /payment/i,
      /billing/i,
      /subscription/i,
      /pricing/i,
      /database/i,
      /migration/i,
      /schema/i,
      /api\/v\d+\/.*/,
      /endpoint/i,
      /route/i,
      /config/i,
      /environment/i,
      /secret/i,
    ];

    // Define critical component patterns
    const criticalPatterns = [
      /middleware/i,
      /guard/i,
      /interceptor/i,
      /service.*\.ts$/i,
      /controller.*\.ts$/i,
      /module.*\.ts$/i,
      /provider.*\.ts$/i,
    ];

    for (const file of files) {
      const filename = file.filename || '';
      const content = file.content || '';
      const patch = file.patch || '';

      // Check for sensitive file patterns
      for (const pattern of sensitivePatterns) {
        if (
          pattern.test(filename) ||
          pattern.test(content) ||
          pattern.test(patch)
        ) {
          hasSensitiveFiles = true;
          sensitiveFileTypes.push(filename);
          break;
        }
      }

      // Check for critical component patterns
      for (const pattern of criticalPatterns) {
        if (pattern.test(filename) || pattern.test(content)) {
          hasCriticalComponents = true;
          criticalComponents.push(filename);
          break;
        }
      }
    }

    return {
      hasSensitiveFiles,
      hasCriticalComponents,
      sensitiveFileTypes,
      criticalComponents,
    };
  }

  /**
   * Get the recommended model based on analysis context
   */
  static getRecommendedModel(
    fileCount: number,
    riskLevel: string,
    isComplexAnalysis: boolean,
    files: any[],
    analysisContext: any,
  ): {
    recommendedModel:
      | 'deepseek-reasoner'
      | 'gemini-2.5-pro'
      | 'deepseek-standard';
    reasoning: string;
    estimatedCost: 'low' | 'medium' | 'high';
    confidence: number;
  } {
    const sensitivity = this.detectSensitivity(files, analysisContext);
    const shouldUseReasoner = this.shouldUseDeepSeekReasoner(
      fileCount,
      riskLevel,
      isComplexAnalysis,
      sensitivity.hasSensitiveFiles,
      sensitivity.hasCriticalComponents,
    );

    if (shouldUseReasoner) {
      return {
        recommendedModel: 'deepseek-reasoner',
        reasoning:
          'CRITICAL sensitivity detected - using DeepSeek Reasoner for maximum accuracy (expensive but necessary)',
        estimatedCost: 'high',
        confidence: 0.98,
      };
    }

    // For everything else, use Gemini 2.5 Pro (cost-effective)
    return {
      recommendedModel: 'gemini-2.5-pro',
      reasoning:
        'Standard analysis - using Gemini 2.5 Pro for cost-effective analysis (recommended for most cases)',
      estimatedCost: 'low',
      confidence: 0.85,
    };
  }
}
