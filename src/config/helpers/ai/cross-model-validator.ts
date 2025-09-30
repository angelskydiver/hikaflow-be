import { PerformanceMonitor } from './performance-monitor';

export interface AnalysisResult {
  impactedFlows: Array<{
    name: string;
    description: string;
    confidence: string;
    evidence: string;
  }>;
  potentialBreakages: Array<{
    type: string;
    description: string;
    severity: string;
    confidence: string;
    evidence: string;
  }>;
  changedBehavior: Array<{
    component: string;
    description: string;
    confidence: string;
    evidence: string;
  }>;
  testCases: Array<{
    name: string;
    description: string;
    type: string;
    priority: string;
  }>;
  confidence: string;
  summary: string;
}

export interface ModelComparison {
  model1: string;
  model2: string;
  agreement: number;
  disagreements: Array<{
    field: string;
    model1Value: any;
    model2Value: any;
    severity: 'low' | 'medium' | 'high';
  }>;
  consensus: {
    impactedFlows: any[];
    potentialBreakages: any[];
    changedBehavior: any[];
    testCases: any[];
  };
  confidence: number;
}

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  errors: string[];
  warnings: string[];
  modelAgreement: number;
  consensusResult: AnalysisResult;
  disagreements: Array<{
    field: string;
    model1Value: any;
    model2Value: any;
    severity: 'low' | 'medium' | 'high';
    resolution: 'model1' | 'model2' | 'consensus' | 'manual';
  }>;
  metadata: {
    processingTime: number;
    model1ProcessingTime: number;
    model2ProcessingTime: number;
    agreementScore: number;
  };
}

export interface CrossModelConfig {
  enabled: boolean;
  models: Array<{
    name: string;
    weight: number;
    timeout: number;
  }>;
  agreementThreshold: number;
  conflictResolution: 'consensus' | 'weighted' | 'first' | 'manual';
  retryOnDisagreement: boolean;
  maxRetries: number;
}

export class CrossModelValidator {
  private static readonly DEFAULT_CONFIG: CrossModelConfig = {
    enabled: true,
    models: [
      { name: 'deepseek', weight: 0.6, timeout: 30000 },
      { name: 'gemini', weight: 0.4, timeout: 30000 },
    ],
    agreementThreshold: 0.7,
    conflictResolution: 'consensus',
    retryOnDisagreement: true,
    maxRetries: 2,
  };

  /**
   * Validate analysis results from multiple models
   */
  static async validateAnalysisResults(
    model1Result: AnalysisResult,
    model2Result: AnalysisResult,
    model1Name: string = 'deepseek',
    model2Name: string = 'gemini',
    config: Partial<CrossModelConfig> = {},
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };

    const operationId = `cross-model-validation-${Date.now()}`;
    const metric = PerformanceMonitor.startOperation(
      operationId,
      'validation',
      { model1: model1Name, model2: model2Name },
    );

    try {
      // Compare the two results
      const comparison = this.compareResults(
        model1Result,
        model2Result,
        model1Name,
        model2Name,
      );

      // Calculate agreement score
      const agreementScore = this.calculateAgreementScore(comparison);

      // Determine if results are valid
      const isValid = agreementScore >= finalConfig.agreementThreshold;

      // Resolve conflicts if any
      const consensusResult = this.resolveConflicts(
        model1Result,
        model2Result,
        comparison,
        finalConfig,
      );

      // Generate validation result
      const result: ValidationResult = {
        isValid,
        confidence: this.calculateOverallConfidence(
          consensusResult,
          agreementScore,
        ),
        errors: this.extractErrors(comparison, finalConfig),
        warnings: this.extractWarnings(comparison, finalConfig),
        modelAgreement: agreementScore,
        consensusResult,
        disagreements: comparison.disagreements.map((d) => ({
          ...d,
          resolution: 'consensus' as const,
        })),
        metadata: {
          processingTime: Date.now() - startTime,
          model1ProcessingTime: 0, // Would be passed from actual model calls
          model2ProcessingTime: 0,
          agreementScore,
        },
      };

      PerformanceMonitor.endOperation(operationId, true, undefined, {
        agreementScore,
        isValid,
        disagreementsCount: comparison.disagreements.length,
      });

      return result;
    } catch (error) {
      PerformanceMonitor.endOperation(operationId, false, error.message);
      throw error;
    }
  }

  /**
   * Compare two analysis results and identify differences
   */
  static compareResults(
    result1: AnalysisResult,
    result2: AnalysisResult,
    model1Name: string,
    model2Name: string,
  ): ModelComparison {
    const disagreements: ModelComparison['disagreements'] = [];

    // Compare impacted flows
    const flowsComparison = this.compareArrays(
      result1.impactedFlows,
      result2.impactedFlows,
      'impactedFlows',
      model1Name,
      model2Name,
    );
    disagreements.push(...flowsComparison);

    // Compare potential breakages
    const breakagesComparison = this.compareArrays(
      result1.potentialBreakages,
      result2.potentialBreakages,
      'potentialBreakages',
      model1Name,
      model2Name,
    );
    disagreements.push(...breakagesComparison);

    // Compare changed behavior
    const behaviorComparison = this.compareArrays(
      result1.changedBehavior,
      result2.changedBehavior,
      'changedBehavior',
      model1Name,
      model2Name,
    );
    disagreements.push(...behaviorComparison);

    // Compare test cases
    const testCasesComparison = this.compareArrays(
      result1.testCases,
      result2.testCases,
      'testCases',
      model1Name,
      model2Name,
    );
    disagreements.push(...testCasesComparison);

    // Calculate agreement score
    const totalFields = 4; // impactedFlows, potentialBreakages, changedBehavior, testCases
    const agreementScore = 1 - disagreements.length / totalFields;

    // Create consensus result
    const consensus = this.createConsensusResult(
      result1,
      result2,
      disagreements,
    );

    return {
      model1: model1Name,
      model2: model2Name,
      agreement: agreementScore,
      disagreements,
      consensus,
      confidence: this.calculateComparisonConfidence(
        disagreements,
        agreementScore,
      ),
    };
  }

  /**
   * Resolve conflicts between models using configured strategy
   */
  static resolveConflicts(
    result1: AnalysisResult,
    result2: AnalysisResult,
    comparison: ModelComparison,
    config: CrossModelConfig,
  ): AnalysisResult {
    switch (config.conflictResolution) {
      case 'consensus':
        return this.resolveByConsensus(result1, result2, comparison);
      case 'weighted':
        return this.resolveByWeight(result1, result2, config);
      case 'first':
        return result1; // Use first model's result
      case 'manual':
        return this.resolveByManual(result1, result2, comparison);
      default:
        return this.resolveByConsensus(result1, result2, comparison);
    }
  }

  /**
   * Get performance comparison between models
   */
  static getModelPerformanceComparison(
    startTime?: number,
    endTime?: number,
  ): Record<
    string,
    {
      count: number;
      averageDuration: number;
      successRate: number;
      averageConfidence: number;
    }
  > {
    const report = PerformanceMonitor.getPerformanceReport(
      startTime,
      endTime,
      'ai-call',
    );
    const result: Record<
      string,
      {
        count: number;
        averageDuration: number;
        successRate: number;
        averageConfidence: number;
      }
    > = {};

    for (const [model, metrics] of Object.entries(report.byAIModel)) {
      result[model] = {
        count: metrics.count,
        averageDuration: metrics.averageDuration,
        successRate: metrics.successRate,
        averageConfidence: 0.85, // Default confidence - would be calculated from actual data
      };
    }

    return result;
  }

  /**
   * Get agreement statistics
   */
  static getAgreementStatistics(
    startTime?: number,
    endTime?: number,
  ): {
    totalComparisons: number;
    averageAgreement: number;
    highAgreement: number;
    lowAgreement: number;
    commonDisagreements: Array<{
      field: string;
      count: number;
      percentage: number;
    }>;
  } {
    // This would typically query a database or metrics store
    // For now, return mock data
    return {
      totalComparisons: 0,
      averageAgreement: 0,
      highAgreement: 0,
      lowAgreement: 0,
      commonDisagreements: [],
    };
  }

  // Private helper methods
  private static compareArrays(
    array1: any[],
    array2: any[],
    fieldName: string,
    model1Name: string,
    model2Name: string,
  ): Array<{
    field: string;
    model1Value: any;
    model2Value: any;
    severity: 'low' | 'medium' | 'high';
  }> {
    const disagreements: Array<{
      field: string;
      model1Value: any;
      model2Value: any;
      severity: 'low' | 'medium' | 'high';
    }> = [];

    // Compare lengths
    if (array1.length !== array2.length) {
      disagreements.push({
        field: `${fieldName}.length`,
        model1Value: array1.length,
        model2Value: array2.length,
        severity: 'medium',
      });
    }

    // Compare individual items
    const maxLength = Math.max(array1.length, array2.length);
    for (let i = 0; i < maxLength; i++) {
      const item1 = array1[i];
      const item2 = array2[i];

      if (!item1 && item2) {
        disagreements.push({
          field: `${fieldName}[${i}]`,
          model1Value: null,
          model2Value: item2,
          severity: 'high',
        });
      } else if (item1 && !item2) {
        disagreements.push({
          field: `${fieldName}[${i}]`,
          model1Value: item1,
          model2Value: null,
          severity: 'high',
        });
      } else if (item1 && item2) {
        // Compare item properties
        const itemDisagreements = this.compareObjects(
          item1,
          item2,
          `${fieldName}[${i}]`,
          model1Name,
          model2Name,
        );
        disagreements.push(...itemDisagreements);
      }
    }

    return disagreements;
  }

  private static compareObjects(
    obj1: any,
    obj2: any,
    fieldPath: string,
    model1Name: string,
    model2Name: string,
  ): Array<{
    field: string;
    model1Value: any;
    model2Value: any;
    severity: 'low' | 'medium' | 'high';
  }> {
    const disagreements: Array<{
      field: string;
      model1Value: any;
      model2Value: any;
      severity: 'low' | 'medium' | 'high';
    }> = [];

    const allKeys = new Set([
      ...Object.keys(obj1 || {}),
      ...Object.keys(obj2 || {}),
    ]);

    for (const key of allKeys) {
      const value1 = obj1?.[key];
      const value2 = obj2?.[key];

      if (value1 !== value2) {
        const severity = this.determineSeverity(key, value1, value2);
        disagreements.push({
          field: `${fieldPath}.${key}`,
          model1Value: value1,
          model2Value: value2,
          severity,
        });
      }
    }

    return disagreements;
  }

  private static determineSeverity(
    field: string,
    value1: any,
    value2: any,
  ): 'low' | 'medium' | 'high' {
    // Critical fields that should match exactly
    const criticalFields = ['name', 'type', 'severity', 'priority'];
    if (criticalFields.includes(field)) {
      return 'high';
    }

    // Confidence and description differences are usually medium severity
    const mediumFields = ['confidence', 'description', 'evidence'];
    if (mediumFields.includes(field)) {
      return 'medium';
    }

    // Everything else is low severity
    return 'low';
  }

  private static calculateAgreementScore(comparison: ModelComparison): number {
    const totalDisagreements = comparison.disagreements.length;
    const highSeverityDisagreements = comparison.disagreements.filter(
      (d) => d.severity === 'high',
    ).length;
    const mediumSeverityDisagreements = comparison.disagreements.filter(
      (d) => d.severity === 'medium',
    ).length;

    // Weight disagreements by severity
    const weightedDisagreements =
      highSeverityDisagreements * 3 +
      mediumSeverityDisagreements * 2 +
      (totalDisagreements -
        highSeverityDisagreements -
        mediumSeverityDisagreements);

    // Normalize to 0-1 scale
    const maxPossibleDisagreements = 20; // Arbitrary max
    const normalizedDisagreements = Math.min(
      weightedDisagreements / maxPossibleDisagreements,
      1,
    );

    return Math.max(0, 1 - normalizedDisagreements);
  }

  private static createConsensusResult(
    result1: AnalysisResult,
    result2: AnalysisResult,
    disagreements: ModelComparison['disagreements'],
  ): ModelComparison['consensus'] {
    // For consensus, we'll take the union of both results and prioritize items that appear in both
    const consensusFlows = this.createConsensusArray(
      result1.impactedFlows,
      result2.impactedFlows,
    );
    const consensusBreakages = this.createConsensusArray(
      result1.potentialBreakages,
      result2.potentialBreakages,
    );
    const consensusBehavior = this.createConsensusArray(
      result1.changedBehavior,
      result2.changedBehavior,
    );
    const consensusTestCases = this.createConsensusArray(
      result1.testCases,
      result2.testCases,
    );

    return {
      impactedFlows: consensusFlows,
      potentialBreakages: consensusBreakages,
      changedBehavior: consensusBehavior,
      testCases: consensusTestCases,
    };
  }

  private static createConsensusArray(array1: any[], array2: any[]): any[] {
    const consensus: any[] = [];
    const seen = new Set<string>();

    // Add items that appear in both arrays (consensus items)
    for (const item1 of array1) {
      for (const item2 of array2) {
        if (this.itemsMatch(item1, item2)) {
          const key = this.getItemKey(item1);
          if (!seen.has(key)) {
            consensus.push(this.mergeItems(item1, item2));
            seen.add(key);
          }
        }
      }
    }

    // Add items that appear in only one array (non-consensus items)
    for (const item of [...array1, ...array2]) {
      const key = this.getItemKey(item);
      if (!seen.has(key)) {
        consensus.push(item);
        seen.add(key);
      }
    }

    return consensus;
  }

  private static itemsMatch(item1: any, item2: any): boolean {
    // Simple matching based on name and type
    return item1.name === item2.name && item1.type === item2.type;
  }

  private static getItemKey(item: any): string {
    return `${item.name || 'unnamed'}-${item.type || 'unknown'}`;
  }

  private static mergeItems(item1: any, item2: any): any {
    // Merge items, preferring non-null values and higher confidence
    const merged = { ...item1 };

    for (const key of Object.keys(item2)) {
      if (merged[key] === null || merged[key] === undefined) {
        merged[key] = item2[key];
      } else if (key === 'confidence' && item2[key]) {
        // For confidence, take the higher value
        const conf1 = this.parseConfidence(merged[key]);
        const conf2 = this.parseConfidence(item2[key]);
        merged[key] = conf1 > conf2 ? merged[key] : item2[key];
      }
    }

    return merged;
  }

  private static parseConfidence(confidence: string): number {
    if (typeof confidence === 'number') return confidence;
    if (typeof confidence === 'string') {
      const match = confidence.match(/(\d+)%/);
      return match ? parseInt(match[1]) : 0;
    }
    return 0;
  }

  private static resolveByConsensus(
    result1: AnalysisResult,
    result2: AnalysisResult,
    comparison: ModelComparison,
  ): AnalysisResult {
    return {
      impactedFlows: comparison.consensus.impactedFlows,
      potentialBreakages: comparison.consensus.potentialBreakages,
      changedBehavior: comparison.consensus.changedBehavior,
      testCases: comparison.consensus.testCases,
      confidence: this.calculateConsensusConfidence(comparison),
      summary: this.generateConsensusSummary(comparison),
    };
  }

  private static resolveByWeight(
    result1: AnalysisResult,
    result2: AnalysisResult,
    config: CrossModelConfig,
  ): AnalysisResult {
    const model1Weight =
      config.models.find((m) => m.name === 'deepseek')?.weight || 0.5;
    const model2Weight =
      config.models.find((m) => m.name === 'gemini')?.weight || 0.5;

    // Weighted combination of results
    return {
      impactedFlows: this.weightedCombineArrays(
        result1.impactedFlows,
        result2.impactedFlows,
        model1Weight,
        model2Weight,
      ),
      potentialBreakages: this.weightedCombineArrays(
        result1.potentialBreakages,
        result2.potentialBreakages,
        model1Weight,
        model2Weight,
      ),
      changedBehavior: this.weightedCombineArrays(
        result1.changedBehavior,
        result2.changedBehavior,
        model1Weight,
        model2Weight,
      ),
      testCases: this.weightedCombineArrays(
        result1.testCases,
        result2.testCases,
        model1Weight,
        model2Weight,
      ),
      confidence: this.calculateWeightedConfidence(
        result1.confidence,
        result2.confidence,
        model1Weight,
        model2Weight,
      ),
      summary: this.generateWeightedSummary(
        result1,
        result2,
        model1Weight,
        model2Weight,
      ),
    };
  }

  private static resolveByManual(
    result1: AnalysisResult,
    result2: AnalysisResult,
    comparison: ModelComparison,
  ): AnalysisResult {
    // For manual resolution, return the first result but flag disagreements
    return {
      ...result1,
      summary: `${result1.summary}\n\n[MANUAL REVIEW REQUIRED] ${comparison.disagreements.length} disagreements found between models.`,
    };
  }

  private static weightedCombineArrays(
    array1: any[],
    array2: any[],
    weight1: number,
    weight2: number,
  ): any[] {
    // Simple weighted combination - in practice, this would be more sophisticated
    const combined = [...array1];
    const remaining = array2.filter(
      (item2) => !array1.some((item1) => this.itemsMatch(item1, item2)),
    );
    combined.push(...remaining);
    return combined;
  }

  private static calculateConsensusConfidence(
    comparison: ModelComparison,
  ): string {
    const agreementScore = comparison.agreement;
    const confidenceValue = Math.round(agreementScore * 100);
    return `${confidenceValue}%`;
  }

  private static calculateWeightedConfidence(
    conf1: string,
    conf2: string,
    weight1: number,
    weight2: number,
  ): string {
    const val1 = this.parseConfidence(conf1);
    const val2 = this.parseConfidence(conf2);
    const weightedValue = Math.round(val1 * weight1 + val2 * weight2);
    return `${weightedValue}%`;
  }

  private static calculateOverallConfidence(
    consensusResult: AnalysisResult,
    agreementScore: number,
  ): number {
    const consensusConfidence = this.parseConfidence(
      consensusResult.confidence,
    );
    return Math.round((consensusConfidence + agreementScore * 100) / 2);
  }

  private static extractErrors(
    comparison: ModelComparison,
    config: CrossModelConfig,
  ): string[] {
    const errors: string[] = [];

    if (comparison.agreement < config.agreementThreshold) {
      errors.push(
        `Model agreement below threshold: ${comparison.agreement.toFixed(2)} < ${config.agreementThreshold}`,
      );
    }

    const highSeverityDisagreements = comparison.disagreements.filter(
      (d) => d.severity === 'high',
    );
    if (highSeverityDisagreements.length > 0) {
      errors.push(
        `${highSeverityDisagreements.length} high-severity disagreements found`,
      );
    }

    return errors;
  }

  private static extractWarnings(
    comparison: ModelComparison,
    config: CrossModelConfig,
  ): string[] {
    const warnings: string[] = [];

    if (comparison.agreement < 0.8) {
      warnings.push(
        `Model agreement is low: ${comparison.agreement.toFixed(2)}`,
      );
    }

    const mediumSeverityDisagreements = comparison.disagreements.filter(
      (d) => d.severity === 'medium',
    );
    if (mediumSeverityDisagreements.length > 0) {
      warnings.push(
        `${mediumSeverityDisagreements.length} medium-severity disagreements found`,
      );
    }

    return warnings;
  }

  private static calculateComparisonConfidence(
    disagreements: ModelComparison['disagreements'],
    agreementScore: number,
  ): number {
    const highSeverityCount = disagreements.filter(
      (d) => d.severity === 'high',
    ).length;
    const mediumSeverityCount = disagreements.filter(
      (d) => d.severity === 'medium',
    ).length;

    const penalty = highSeverityCount * 0.3 + mediumSeverityCount * 0.1;
    return Math.max(
      0,
      Math.min(100, Math.round(agreementScore * 100 - penalty)),
    );
  }

  private static generateConsensusSummary(comparison: ModelComparison): string {
    const agreementPercent = Math.round(comparison.agreement * 100);
    const disagreementCount = comparison.disagreements.length;

    return `Consensus analysis with ${agreementPercent}% agreement between models. ${disagreementCount} disagreements resolved through consensus.`;
  }

  private static generateWeightedSummary(
    result1: AnalysisResult,
    result2: AnalysisResult,
    weight1: number,
    weight2: number,
  ): string {
    return `Weighted combination of model results (${Math.round(weight1 * 100)}% / ${Math.round(weight2 * 100)}%).`;
  }
}
