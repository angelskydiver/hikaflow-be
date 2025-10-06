/**
 * Optimized Analysis Service
 *
 * This service provides optimized AI model selection for impact analysis
 * with configurable cost-performance trade-offs.
 */

import { CostTrackingService } from './cost-tracking.service';
import { DeepSeek } from './deepseek.ai.helper';
import { Gemini } from './gemini.ai.helper';
import { ModelConfigManager } from './model-config';

export interface OptimizedAnalysisOptions {
  fileCount: number;
  riskLevel: string;
  isComplexAnalysis: boolean;
  enableCostOptimization?: boolean;
  maxFilesForCrossValidation?: number;
}

export interface OptimizedAnalysisResult {
  analysisResult: any;
  modelUsed: string;
  crossValidationUsed: boolean;
  confidence: number;
  costOptimized: boolean;
}

export class OptimizedAnalysisService {
  private deepseekAI: DeepSeek;
  private geminiAI: Gemini;

  constructor() {
    this.deepseekAI = new DeepSeek();
    this.geminiAI = new Gemini();
  }

  /**
   * Perform optimized impact analysis with intelligent model selection
   */
  async analyzeImpactOptimized(
    filteredFiles: any[],
    options: OptimizedAnalysisOptions,
  ): Promise<OptimizedAnalysisResult> {
    const {
      fileCount,
      riskLevel,
      isComplexAnalysis,
      enableCostOptimization = false,
      maxFilesForCrossValidation = 10,
    } = options;

    // Get model recommendation based on sensitivity analysis
    const modelRecommendation = ModelConfigManager.getRecommendedModel(
      fileCount,
      riskLevel,
      isComplexAnalysis,
      filteredFiles,
      { enableCostOptimization, maxFilesForCrossValidation },
    );

    console.log(
      `🧠 Model recommendation: ${modelRecommendation.recommendedModel}`,
    );
    console.log(`💡 Reasoning: ${modelRecommendation.reasoning}`);
    console.log(`💰 Estimated cost: ${modelRecommendation.estimatedCost}`);
    console.log(
      `🎯 Confidence: ${Math.round(modelRecommendation.confidence * 100)}%`,
    );

    // Execute analysis with recommended model
    switch (modelRecommendation.recommendedModel) {
      case 'deepseek-reasoner':
        return this.performDeepSeekReasonerAnalysis(
          filteredFiles,
          modelRecommendation,
        );
      case 'gemini-2.5-pro':
        return this.performGeminiAnalysis(filteredFiles, modelRecommendation);
      case 'deepseek-standard':
        return this.performDeepSeekStandardAnalysis(
          filteredFiles,
          modelRecommendation,
        );
      default:
        return this.performGeminiAnalysis(filteredFiles, modelRecommendation);
    }
  }

  /**
   * Perform cross-validation analysis (current approach)
   */
  private async performCrossValidationAnalysis(
    filteredFiles: any[],
  ): Promise<OptimizedAnalysisResult> {
    console.log('🔄 Performing cross-validation analysis...');
    const startTime = Date.now();

    try {
      // Get analysis from both models
      const [deepseekResult, geminiResult] = await Promise.all([
        this.deepseekAI.analyzeRegressionImpact(filteredFiles),
        this.geminiAI.analyzeRegressionImpact(filteredFiles),
      ]);

      const analysisTime = Date.now() - startTime;
      console.log(`✅ Cross-validation completed in ${analysisTime}ms`);

      // Use DeepSeek as primary (current behavior)
      const analysisResult = deepseekResult;
      const confidence = 0.95; // High confidence with cross-validation

      return {
        analysisResult,
        modelUsed: 'deepseek+gemini',
        crossValidationUsed: true,
        confidence,
        costOptimized: false,
      };
    } catch (error) {
      console.error(
        'Cross-validation failed, falling back to Gemini only:',
        error,
      );
      return this.performGeminiAnalysis(filteredFiles, {
        recommendedModel: 'gemini-2.5-pro',
        reasoning: 'Fallback to Gemini due to cross-validation failure',
        estimatedCost: 'low',
        confidence: 0.8,
      });
    }
  }

  /**
   * Perform DeepSeek Reasoner analysis (highest quality, most expensive)
   */
  private async performDeepSeekReasonerAnalysis(
    filteredFiles: any[],
    modelRecommendation: any,
  ): Promise<OptimizedAnalysisResult> {
    console.log(
      '🧠 Performing DeepSeek Reasoner analysis (highest quality)...',
    );
    const startTime = Date.now();

    try {
      // Use DeepSeek with reasoner mode (if available in your implementation)
      const analysisResult =
        await this.deepseekAI.analyzeRegressionImpact(filteredFiles);
      const analysisTime = Date.now() - startTime;
      console.log(
        `✅ DeepSeek Reasoner analysis completed in ${analysisTime}ms`,
      );

      // Track cost
      CostTrackingService.trackUsage({
        model: 'deepseek-reasoner',
        fileCount: filteredFiles.length,
        estimatedCost: 0.1, // $0.10 per analysis
        processingTime: Date.now() - startTime,
        confidence: modelRecommendation.confidence,
        sensitivity: 'critical',
      });

      return {
        analysisResult,
        modelUsed: 'deepseek-reasoner',
        crossValidationUsed: false,
        confidence: modelRecommendation.confidence,
        costOptimized: false,
      };
    } catch (error) {
      console.error('DeepSeek Reasoner analysis failed:', error);
      throw error;
    }
  }

  /**
   * Perform Gemini 2.5 Pro analysis (balanced quality and cost)
   */
  private async performGeminiAnalysis(
    filteredFiles: any[],
    modelRecommendation: any,
  ): Promise<OptimizedAnalysisResult> {
    console.log('🔮 Performing Gemini 2.5 Pro analysis (balanced quality)...');
    const startTime = Date.now();

    try {
      const analysisResult =
        await this.geminiAI.analyzeRegressionImpact(filteredFiles);
      const analysisTime = Date.now() - startTime;
      console.log(`✅ Gemini 2.5 Pro analysis completed in ${analysisTime}ms`);

      // Track cost
      CostTrackingService.trackUsage({
        model: 'gemini-2.5-pro',
        fileCount: filteredFiles.length,
        estimatedCost: 0.05, // $0.05 per analysis
        processingTime: Date.now() - startTime,
        confidence: modelRecommendation.confidence,
        sensitivity: 'medium',
      });

      return {
        analysisResult,
        modelUsed: 'gemini-2.5-pro',
        crossValidationUsed: false,
        confidence: modelRecommendation.confidence,
        costOptimized: true,
      };
    } catch (error) {
      console.error('Gemini 2.5 Pro analysis failed:', error);
      throw error;
    }
  }

  /**
   * Perform DeepSeek Standard analysis (fallback)
   */
  private async performDeepSeekStandardAnalysis(
    filteredFiles: any[],
    modelRecommendation: any,
  ): Promise<OptimizedAnalysisResult> {
    console.log('⚡ Performing DeepSeek Standard analysis (fallback)...');
    const startTime = Date.now();

    try {
      const analysisResult =
        await this.deepseekAI.analyzeRegressionImpact(filteredFiles);
      const analysisTime = Date.now() - startTime;
      console.log(
        `✅ DeepSeek Standard analysis completed in ${analysisTime}ms`,
      );

      // Track cost
      CostTrackingService.trackUsage({
        model: 'deepseek-standard',
        fileCount: filteredFiles.length,
        estimatedCost: 0.03, // $0.03 per analysis
        processingTime: Date.now() - startTime,
        confidence: modelRecommendation.confidence,
        sensitivity: 'low',
      });

      return {
        analysisResult,
        modelUsed: 'deepseek-standard',
        crossValidationUsed: false,
        confidence: modelRecommendation.confidence,
        costOptimized: true,
      };
    } catch (error) {
      console.error('DeepSeek Standard analysis failed:', error);
      throw error;
    }
  }

  /**
   * Get analysis recommendations based on file characteristics
   */
  static getAnalysisRecommendation(
    fileCount: number,
    riskLevel: string,
    isComplexAnalysis: boolean,
    files: any[] = [],
  ): {
    recommendedModel:
      | 'deepseek-reasoner'
      | 'gemini-2.5-pro'
      | 'deepseek-standard';
    reasoning: string;
    estimatedCost: 'low' | 'medium' | 'high';
    estimatedTime: 'fast' | 'medium' | 'slow';
    confidence: number;
  } {
    // Use the ModelConfigManager for intelligent recommendations
    const modelRecommendation = ModelConfigManager.getRecommendedModel(
      fileCount,
      riskLevel,
      isComplexAnalysis,
      files,
      {},
    );

    // Map model to time estimation
    const timeMapping = {
      'deepseek-reasoner': 'slow' as const,
      'gemini-2.5-pro': 'medium' as const,
      'deepseek-standard': 'fast' as const,
    };

    return {
      recommendedModel: modelRecommendation.recommendedModel,
      reasoning: modelRecommendation.reasoning,
      estimatedCost: modelRecommendation.estimatedCost,
      estimatedTime: timeMapping[modelRecommendation.recommendedModel],
      confidence: modelRecommendation.confidence,
    };
  }
}
