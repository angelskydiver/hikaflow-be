/**
 * Analysis Consistency Framework
 *
 * This module ensures consistent, predictable AI analysis results by:
 * 1. Standardizing AI prompts and instructions
 * 2. Implementing result validation and normalization
 * 3. Creating consistent decision trees for analysis
 * 4. Providing fallback mechanisms for inconsistent results
 * 5. Integrating sophisticated impact detection
 */

import { AIPoweredDetectionEngine } from './ai-powered-detection';
import { ImpactDetectionEngine } from './impact-detection-engine';

export interface ConsistentAnalysisResult {
  impactedFlows: string[];
  changedBehavior: string[];
  potentialBreakages: string[];
  testCases: Array<{
    name: string;
    type: string;
    priority: string;
    description: string;
    willCatchBreakage: boolean;
    confidence: number;
  }>;
  confidence: number;
  reasoning: string;
  consistencyScore: number;
}

export interface AnalysisConsistencyRules {
  flowDetection: {
    keywords: string[];
    patterns: string[];
    confidenceThreshold: number;
  };
  behaviorChange: {
    keywords: string[];
    patterns: string[];
    confidenceThreshold: number;
  };
  breakageDetection: {
    keywords: string[];
    patterns: string[];
    confidenceThreshold: number;
  };
  testCaseGeneration: {
    keywords: string[];
    patterns: string[];
    confidenceThreshold: number;
  };
}

export class AnalysisConsistencyFramework {
  private static readonly CONSISTENCY_RULES: AnalysisConsistencyRules = {
    flowDetection: {
      keywords: [
        'import',
        'export',
        'require',
        'from',
        'to',
        'through',
        'via',
        'calls',
        'invokes',
        'triggers',
        'executes',
        'runs',
        'processes',
      ],
      patterns: [
        'function.*calls.*function',
        'service.*calls.*service',
        'api.*calls.*api',
        'controller.*calls.*service',
        'model.*used.*by.*service',
      ],
      confidenceThreshold: 0.7,
    },
    behaviorChange: {
      keywords: [
        'modify',
        'change',
        'update',
        'alter',
        'transform',
        'convert',
        'add',
        'remove',
        'delete',
        'insert',
        'replace',
        'substitute',
      ],
      patterns: [
        'function.*modified',
        'service.*changed',
        'api.*updated',
        'model.*altered',
        'config.*modified',
      ],
      confidenceThreshold: 0.8,
    },
    breakageDetection: {
      keywords: [
        'delete',
        'remove',
        'deprecate',
        'breaking',
        'migration',
        'schema',
        'interface',
        'type',
        'export',
        'import',
        'dependency',
      ],
      patterns: [
        'function.*deleted',
        'service.*removed',
        'api.*deprecated',
        'model.*changed',
        'config.*modified',
      ],
      confidenceThreshold: 0.9,
    },
    testCaseGeneration: {
      keywords: [
        'test',
        'spec',
        'mock',
        'stub',
        'fixture',
        'scenario',
        'unit',
        'integration',
        'e2e',
        'performance',
        'security',
      ],
      patterns: [
        'test.*function',
        'test.*service',
        'test.*api',
        'test.*model',
        'test.*config',
      ],
      confidenceThreshold: 0.8,
    },
  };

  /**
   * Generate consistent analysis results using AI-powered detection
   */
  static async generateConsistentAnalysis(
    files: Array<{ filename: string; content: string; patch: string }>,
    aiResults: any,
    aiModel?: any,
  ): Promise<ConsistentAnalysisResult> {
    // Normalize AI results
    const normalizedResults = this.normalizeAIResults(aiResults);

    // Apply consistency rules
    const consistentResults = this.applyConsistencyRules(
      files,
      normalizedResults,
    );

    // Use AI-powered detection for potential breakages
    if (aiModel) {
      try {
        const aiBreakages = await this.detectPotentialBreakages(
          files,
          consistentResults.potentialBreakages,
          aiModel,
        );
        consistentResults.potentialBreakages = aiBreakages;
      } catch (error) {
        console.error('AI-powered detection failed:', error);
        // Continue with existing results
      }
    } else {
      // Use existing detection method
      consistentResults.potentialBreakages = this.detectPotentialBreakagesSync(
        files,
        consistentResults.potentialBreakages,
      );
    }

    // Validate and score consistency
    const consistencyScore = this.calculateConsistencyScore(consistentResults);

    // Generate reasoning
    const reasoning = this.generateReasoning(
      consistentResults,
      consistencyScore,
    );

    return {
      impactedFlows: consistentResults.impactedFlows,
      changedBehavior: consistentResults.changedBehavior,
      potentialBreakages: consistentResults.potentialBreakages,
      testCases: consistentResults.testCases,
      confidence: consistentResults.confidence,
      reasoning,
      consistencyScore,
    };
  }

  /**
   * Normalize AI results to consistent format
   */
  private static normalizeAIResults(aiResults: any): any {
    const normalized = {
      impactedFlows: [],
      changedBehavior: [],
      potentialBreakages: [],
      testCases: [],
      confidence: 0,
    };

    // Normalize impacted flows
    if (aiResults.impactedFlows) {
      normalized.impactedFlows = Array.isArray(aiResults.impactedFlows)
        ? aiResults.impactedFlows
        : [aiResults.impactedFlows];
    }

    // Normalize changed behavior
    if (aiResults.changedBehavior) {
      normalized.changedBehavior = Array.isArray(aiResults.changedBehavior)
        ? aiResults.changedBehavior
        : [aiResults.changedBehavior];
    }

    // Normalize potential breakages
    if (aiResults.potentialBreakages) {
      normalized.potentialBreakages = Array.isArray(
        aiResults.potentialBreakages,
      )
        ? aiResults.potentialBreakages
        : [aiResults.potentialBreakages];
    }

    // Normalize test cases
    if (aiResults.testCases) {
      normalized.testCases = Array.isArray(aiResults.testCases)
        ? aiResults.testCases
        : [aiResults.testCases];
    }

    // Normalize confidence
    if (aiResults.confidence) {
      normalized.confidence =
        typeof aiResults.confidence === 'number' ? aiResults.confidence : 0.5;
    }

    return normalized;
  }

  /**
   * Apply consistency rules to analysis results
   */
  private static applyConsistencyRules(
    files: Array<{ filename: string; content: string; patch: string }>,
    normalizedResults: any,
  ): any {
    const consistentResults = {
      impactedFlows: [],
      changedBehavior: [],
      potentialBreakages: [],
      testCases: [],
      confidence: 0,
    };

    // Apply flow detection rules
    consistentResults.impactedFlows = this.detectImpactedFlows(
      files,
      normalizedResults.impactedFlows,
    );

    // Apply behavior change rules
    consistentResults.changedBehavior = this.detectChangedBehavior(
      files,
      normalizedResults.changedBehavior,
    );

    // Apply breakage detection rules
    consistentResults.potentialBreakages = this.detectPotentialBreakagesSync(
      files,
      normalizedResults.potentialBreakages,
    );

    // Apply test case generation rules
    consistentResults.testCases = this.generateTestCases(
      files,
      normalizedResults.testCases,
    );

    // Calculate consistent confidence
    consistentResults.confidence =
      this.calculateConsistentConfidence(consistentResults);

    return consistentResults;
  }

  /**
   * Detect impacted flows consistently
   */
  private static detectImpactedFlows(
    files: any[],
    aiFlows: string[],
  ): string[] {
    const detectedFlows = [];

    // Analyze each file for flow patterns
    files.forEach((file) => {
      const content = file.content || '';
      const patch = file.patch || '';
      const patchString =
        typeof patch === 'string' ? patch : String(patch || '');

      // Check for flow keywords
      this.CONSISTENCY_RULES.flowDetection.keywords.forEach((keyword) => {
        if (content.includes(keyword) || patchString.includes(keyword)) {
          detectedFlows.push(`${file.filename}: ${keyword} flow detected`);
        }
      });

      // Check for flow patterns
      this.CONSISTENCY_RULES.flowDetection.patterns.forEach((pattern) => {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content) || regex.test(patchString)) {
          detectedFlows.push(`${file.filename}: ${pattern} pattern detected`);
        }
      });
    });

    // Merge with AI results and deduplicate
    const allFlows = [...detectedFlows, ...aiFlows];
    return [...new Set(allFlows)];
  }

  /**
   * Detect changed behavior consistently
   */
  private static detectChangedBehavior(
    files: any[],
    aiBehavior: string[],
  ): string[] {
    const detectedBehavior = [];

    // Analyze each file for behavior change patterns
    files.forEach((file) => {
      const content = file.content || '';
      const patch = file.patch || '';
      const patchString =
        typeof patch === 'string' ? patch : String(patch || '');

      // Check for behavior change keywords
      this.CONSISTENCY_RULES.behaviorChange.keywords.forEach((keyword) => {
        if (content.includes(keyword) || patchString.includes(keyword)) {
          detectedBehavior.push(
            `${file.filename}: ${keyword} behavior change detected`,
          );
        }
      });

      // Check for behavior change patterns
      this.CONSISTENCY_RULES.behaviorChange.patterns.forEach((pattern) => {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content) || regex.test(patchString)) {
          detectedBehavior.push(
            `${file.filename}: ${pattern} pattern detected`,
          );
        }
      });
    });

    // Merge with AI results and deduplicate
    const allBehavior = [...detectedBehavior, ...aiBehavior];
    return [...new Set(allBehavior)];
  }

  /**
   * Detect potential breakages consistently using AI-powered analysis
   */
  private static async detectPotentialBreakages(
    files: any[],
    aiBreakages: string[],
    aiModel?: any,
  ): Promise<string[]> {
    const detectedBreakages = [];

    // Analyze each file using AI-powered detection
    for (const file of files) {
      const content = file.content || '';
      const patch = file.patch || '';
      const patchString =
        typeof patch === 'string' ? patch : String(patch || '');

      try {
        // Use AI-powered detection if model is available
        if (aiModel) {
          const aiResult = await AIPoweredDetectionEngine.analyzeImpact(
            file.filename,
            content,
            patchString,
            aiModel,
          );

          // Add AI-powered breakage detection
          if (aiResult.willCatchBreakage) {
            detectedBreakages.push(
              `${file.filename}: ${aiResult.riskLevel.toUpperCase()} breakage risk - ${aiResult.reasoning} (AI Analysis)`,
            );
          }

          // Add business context information
          if (aiResult.aiAnalysis.businessContext) {
            detectedBreakages.push(
              `${file.filename}: Business context - ${aiResult.aiAnalysis.businessContext}`,
            );
          }
        } else {
          // Fallback to rule-based detection
          const impactResult = ImpactDetectionEngine.detectImpact(
            file.filename,
            content,
            patchString,
          );

          if (impactResult.willCatchBreakage) {
            detectedBreakages.push(
              `${file.filename}: ${impactResult.riskLevel.toUpperCase()} breakage risk - ${impactResult.reasoning}`,
            );
          }
        }
      } catch (error) {
        console.error('AI detection error:', error);

        // Fallback to rule-based detection
        const impactResult = ImpactDetectionEngine.detectImpact(
          file.filename,
          content,
          patchString,
        );

        if (impactResult.willCatchBreakage) {
          detectedBreakages.push(
            `${file.filename}: ${impactResult.riskLevel.toUpperCase()} breakage risk - ${impactResult.reasoning} (Fallback)`,
          );
        }
      }

      // Check for breakage keywords (fallback)
      this.CONSISTENCY_RULES.breakageDetection.keywords.forEach((keyword) => {
        if (content.includes(keyword) || patchString.includes(keyword)) {
          detectedBreakages.push(
            `${file.filename}: ${keyword} breakage risk detected`,
          );
        }
      });

      // Check for breakage patterns (fallback)
      this.CONSISTENCY_RULES.breakageDetection.patterns.forEach((pattern) => {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content) || regex.test(patchString)) {
          detectedBreakages.push(
            `${file.filename}: ${pattern} pattern detected`,
          );
        }
      });
    }

    // Merge with AI results and deduplicate
    const allBreakages = [...detectedBreakages, ...aiBreakages];
    return [...new Set(allBreakages)];
  }

  /**
   * Detect potential breakages consistently (synchronous version)
   */
  private static detectPotentialBreakagesSync(
    files: any[],
    aiBreakages: string[],
  ): string[] {
    const detectedBreakages = [];

    // Analyze each file for breakage patterns
    files.forEach((file) => {
      const content = file.content || '';
      const patch = file.patch || '';
      const patchString =
        typeof patch === 'string' ? patch : String(patch || '');

      // Use rule-based detection
      const impactResult = ImpactDetectionEngine.detectImpact(
        file.filename,
        content,
        patchString,
      );

      if (impactResult.willCatchBreakage) {
        detectedBreakages.push(
          `${file.filename}: ${impactResult.riskLevel.toUpperCase()} breakage risk - ${impactResult.reasoning}`,
        );
      }

      // Check for breakage keywords (fallback)
      this.CONSISTENCY_RULES.breakageDetection.keywords.forEach((keyword) => {
        if (content.includes(keyword) || patchString.includes(keyword)) {
          detectedBreakages.push(
            `${file.filename}: ${keyword} breakage risk detected`,
          );
        }
      });

      // Check for breakage patterns (fallback)
      this.CONSISTENCY_RULES.breakageDetection.patterns.forEach((pattern) => {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content) || regex.test(patchString)) {
          detectedBreakages.push(
            `${file.filename}: ${pattern} pattern detected`,
          );
        }
      });
    });

    // Merge with AI results and deduplicate
    const allBreakages = [...detectedBreakages, ...aiBreakages];
    return [...new Set(allBreakages)];
  }

  /**
   * Generate test cases consistently
   */
  private static generateTestCases(files: any[], aiTestCases: any[]): any[] {
    const generatedTestCases = [];

    // Generate test cases for each file
    files.forEach((file) => {
      const content = file.content || '';
      const patch = file.patch || '';
      const patchString =
        typeof patch === 'string' ? patch : String(patch || '');

      // Check for test case keywords
      this.CONSISTENCY_RULES.testCaseGeneration.keywords.forEach((keyword) => {
        if (content.includes(keyword) || patchString.includes(keyword)) {
          generatedTestCases.push({
            name: `${file.filename}: ${keyword} test case`,
            type: 'UNIT',
            priority: 'medium',
            description: `Test ${keyword} functionality in ${file.filename}`,
            willCatchBreakage: true,
            confidence: 0.8,
          });
        }
      });

      // Check for test case patterns
      this.CONSISTENCY_RULES.testCaseGeneration.patterns.forEach((pattern) => {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content) || regex.test(patchString)) {
          generatedTestCases.push({
            name: `${file.filename}: ${pattern} test case`,
            type: 'INTEGRATION',
            priority: 'high',
            description: `Test ${pattern} pattern in ${file.filename}`,
            willCatchBreakage: true,
            confidence: 0.9,
          });
        }
      });
    });

    // Merge with AI results and deduplicate
    const allTestCases = [...generatedTestCases, ...aiTestCases];
    return this.deduplicateTestCases(allTestCases);
  }

  /**
   * Deduplicate test cases
   */
  private static deduplicateTestCases(testCases: any[]): any[] {
    const seen = new Set();
    return testCases.filter((testCase) => {
      const key = `${testCase.name}-${testCase.type}-${testCase.priority}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Calculate consistent confidence score
   */
  private static calculateConsistentConfidence(results: any): number {
    let confidence = 0.5; // Base confidence

    // Flow detection confidence
    if (results.impactedFlows.length > 0) {
      confidence += 0.1;
    }

    // Behavior change confidence
    if (results.changedBehavior.length > 0) {
      confidence += 0.1;
    }

    // Breakage detection confidence
    if (results.potentialBreakages.length > 0) {
      confidence += 0.2;
    }

    // Test case generation confidence
    if (results.testCases.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Calculate consistency score
   */
  private static calculateConsistencyScore(results: any): number {
    let score = 0;

    // Check for consistent patterns
    if (results.impactedFlows.length > 0) score += 0.25;
    if (results.changedBehavior.length > 0) score += 0.25;
    if (results.potentialBreakages.length > 0) score += 0.25;
    if (results.testCases.length > 0) score += 0.25;

    return score;
  }

  /**
   * Generate reasoning for consistency
   */
  private static generateReasoning(
    results: any,
    consistencyScore: number,
  ): string {
    const reasons = [];

    if (results.impactedFlows.length > 0) {
      reasons.push(`Detected ${results.impactedFlows.length} impacted flows`);
    }

    if (results.changedBehavior.length > 0) {
      reasons.push(
        `Identified ${results.changedBehavior.length} behavior changes`,
      );
    }

    if (results.potentialBreakages.length > 0) {
      reasons.push(
        `Found ${results.potentialBreakages.length} potential breakages`,
      );
    }

    if (results.testCases.length > 0) {
      reasons.push(`Generated ${results.testCases.length} test cases`);
    }

    if (consistencyScore > 0.8) {
      reasons.push('High consistency score indicates reliable analysis');
    } else if (consistencyScore > 0.6) {
      reasons.push(
        'Moderate consistency score indicates mostly reliable analysis',
      );
    } else {
      reasons.push('Low consistency score indicates potential analysis issues');
    }

    return reasons.join('. ');
  }

  /**
   * Validate analysis results for consistency
   */
  static validateAnalysisConsistency(results: any): {
    isValid: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues = [];
    const recommendations = [];

    // Check for empty results
    if (!results.impactedFlows || results.impactedFlows.length === 0) {
      issues.push('No impacted flows detected');
      recommendations.push('Review file changes for flow dependencies');
    }

    if (!results.changedBehavior || results.changedBehavior.length === 0) {
      issues.push('No changed behavior detected');
      recommendations.push('Review file changes for behavior modifications');
    }

    if (
      !results.potentialBreakages ||
      results.potentialBreakages.length === 0
    ) {
      issues.push('No potential breakages detected');
      recommendations.push('Review file changes for breaking changes');
    }

    if (!results.testCases || results.testCases.length === 0) {
      issues.push('No test cases generated');
      recommendations.push('Review file changes for test scenarios');
    }

    // Check for confidence levels
    if (results.confidence < 0.5) {
      issues.push('Low confidence score');
      recommendations.push('Review analysis parameters and file changes');
    }

    return {
      isValid: issues.length === 0,
      issues,
      recommendations,
    };
  }
}
