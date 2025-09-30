/**
 * Analysis validation utilities for ensuring quality and consistency
 */

import { VALIDATION_RULES } from './prompt-templates';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  confidence: number;
}

export class AnalysisValidator {
  /**
   * Validate analysis result structure and content
   */
  static validateAnalysisResult(result: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidence = 1.0;

    // Check required fields
    for (const field of VALIDATION_RULES.requiredFields) {
      if (!result[field]) {
        errors.push(`Missing required field: ${field}`);
        confidence -= 0.2;
      }
    }

    // Validate impactedFlows
    if (result.impactedFlows && Array.isArray(result.impactedFlows)) {
      result.impactedFlows.forEach((flow: any, index: number) => {
        if (!flow.flowName) {
          errors.push(`ImpactedFlow[${index}] missing flowName`);
        }
        if (
          !flow.impactSeverity ||
          !['HIGH', 'MEDIUM', 'LOW'].includes(flow.impactSeverity)
        ) {
          warnings.push(`ImpactedFlow[${index}] has invalid impactSeverity`);
        }
        if (
          !flow.breakageStatus ||
          !['WILL_BREAK', 'MIGHT_BREAK', 'WILL_WORK'].includes(
            flow.breakageStatus,
          )
        ) {
          warnings.push(`ImpactedFlow[${index}] has invalid breakageStatus`);
        }
      });
    }

    // Validate changedBehavior
    if (result.changedBehavior && Array.isArray(result.changedBehavior)) {
      result.changedBehavior.forEach((behavior: any, index: number) => {
        if (!behavior.component) {
          errors.push(`ChangedBehavior[${index}] missing component`);
        }
        if (!behavior.file) {
          errors.push(`ChangedBehavior[${index}] missing file`);
        }
        if (
          !behavior.changeType ||
          ![
            'PARAMETER_ADDED',
            'PARAMETER_REMOVED',
            'PARAMETER_MODIFIED',
            'RETURN_TYPE_CHANGED',
            'FUNCTION_REMOVED',
          ].includes(behavior.changeType)
        ) {
          warnings.push(`ChangedBehavior[${index}] has invalid changeType`);
        }

        // Validate callsites
        if (behavior.callsites && Array.isArray(behavior.callsites)) {
          behavior.callsites.forEach((callsite: any, callsiteIndex: number) => {
            if (!callsite.file) {
              warnings.push(
                `ChangedBehavior[${index}].callsites[${callsiteIndex}] missing file`,
              );
            }
            if (
              !callsite.compatibilityStatus ||
              !['WILL_BREAK', 'MIGHT_BREAK', 'WILL_WORK'].includes(
                callsite.compatibilityStatus,
              )
            ) {
              warnings.push(
                `ChangedBehavior[${index}].callsites[${callsiteIndex}] has invalid compatibilityStatus`,
              );
            }
            if (
              !callsite.confidence ||
              !['HIGH', 'MEDIUM', 'LOW'].includes(callsite.confidence)
            ) {
              warnings.push(
                `ChangedBehavior[${index}].callsites[${callsiteIndex}] has invalid confidence`,
              );
            }
          });
        }
      });
    }

    // Validate potentialBreakages
    if (result.potentialBreakages && Array.isArray(result.potentialBreakages)) {
      result.potentialBreakages.forEach((breakage: any, index: number) => {
        if (!breakage.area) {
          errors.push(`PotentialBreakage[${index}] missing area`);
        }
        if (
          !breakage.breakageStatus ||
          !['WILL_BREAK', 'MIGHT_BREAK', 'WILL_WORK'].includes(
            breakage.breakageStatus,
          )
        ) {
          warnings.push(
            `PotentialBreakage[${index}] has invalid breakageStatus`,
          );
        }
        if (!breakage.evidence) {
          warnings.push(`PotentialBreakage[${index}] missing evidence`);
        }
      });
    }

    // Validate testCases
    if (result.testCases && Array.isArray(result.testCases)) {
      result.testCases.forEach((testCase: any, index: number) => {
        if (!testCase.testName) {
          errors.push(`TestCase[${index}] missing testName`);
        }
        if (
          !testCase.type ||
          !['UNIT', 'INTEGRATION', 'E2E', 'REGRESSION'].includes(testCase.type)
        ) {
          warnings.push(`TestCase[${index}] has invalid type`);
        }
        if (!testCase.steps || !Array.isArray(testCase.steps)) {
          warnings.push(`TestCase[${index}] missing or invalid steps`);
        }
      });
    }

    // Validate developerReport
    if (result.developerReport) {
      if (result.developerReport.executiveSummary) {
        const summary = result.developerReport.executiveSummary;
        if (
          !summary.riskLevel ||
          !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(summary.riskLevel)
        ) {
          warnings.push('ExecutiveSummary has invalid riskLevel');
        }
        if (
          !summary.deploymentRecommendation ||
          !['SAFE', 'REVIEW_REQUIRED', 'BLOCK'].includes(
            summary.deploymentRecommendation,
          )
        ) {
          warnings.push(
            'ExecutiveSummary has invalid deploymentRecommendation',
          );
        }
      }
    }

    // Calculate final confidence
    confidence = Math.max(0, confidence);

    // Adjust confidence based on evidence quality
    if (result.potentialBreakages) {
      const breakagesWithEvidence = result.potentialBreakages.filter(
        (b: any) => b.evidence && b.evidence.length > 10,
      );
      const evidenceRatio =
        breakagesWithEvidence.length / result.potentialBreakages.length;
      confidence *= 0.5 + evidenceRatio * 0.5;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Validate evidence quality
   */
  static validateEvidence(evidence: string): boolean {
    if (!evidence || evidence.length < 10) return false;

    // Check for specific code references
    const hasFileReference =
      /[a-zA-Z0-9_-]+\.(js|ts|jsx|tsx|py|java|go|php)/.test(evidence);
    const hasLineReference = /line\s*\d+|:\d+/.test(evidence);
    const hasCodeSnippet = /`[^`]+`|```[\s\S]*?```/.test(evidence);

    return hasFileReference || hasLineReference || hasCodeSnippet;
  }

  /**
   * Validate confidence scores
   */
  static validateConfidence(confidence: string): boolean {
    return ['HIGH', 'MEDIUM', 'LOW'].includes(confidence);
  }

  /**
   * Validate breakage status
   */
  static validateBreakageStatus(status: string): boolean {
    return ['WILL_BREAK', 'MIGHT_BREAK', 'WILL_WORK'].includes(status);
  }

  /**
   * Validate test case quality
   */
  static validateTestCase(testCase: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!testCase.testName) {
      errors.push('Missing testName');
    }
    if (
      !testCase.type ||
      !['UNIT', 'INTEGRATION', 'E2E', 'REGRESSION'].includes(testCase.type)
    ) {
      errors.push('Invalid test type');
    }
    if (
      !testCase.steps ||
      !Array.isArray(testCase.steps) ||
      testCase.steps.length === 0
    ) {
      errors.push('Missing or empty test steps');
    }
    if (!testCase.expectedResult) {
      warnings.push('Missing expected result');
    }
    if (!testCase.codeExample) {
      warnings.push('Missing code example');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      confidence: errors.length === 0 ? 0.9 : 0.5,
    };
  }

  /**
   * Cross-validate analysis between different AI models
   */
  static crossValidateResults(result1: any, result2: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let confidence = 1.0;

    // Compare breakage assessments
    if (result1.potentialBreakages && result2.potentialBreakages) {
      const breakages1 = result1.potentialBreakages.map(
        (b: any) => b.breakageStatus,
      );
      const breakages2 = result2.potentialBreakages.map(
        (b: any) => b.breakageStatus,
      );

      const agreement =
        breakages1.filter(
          (status: string, index: number) => breakages2[index] === status,
        ).length / Math.max(breakages1.length, breakages2.length);

      if (agreement < 0.7) {
        warnings.push(
          `Low agreement between AI models: ${Math.round(agreement * 100)}%`,
        );
        confidence *= 0.8;
      }
    }

    // Compare risk assessments
    if (
      result1.developerReport?.executiveSummary?.riskLevel &&
      result2.developerReport?.executiveSummary?.riskLevel
    ) {
      if (
        result1.developerReport.executiveSummary.riskLevel !==
        result2.developerReport.executiveSummary.riskLevel
      ) {
        warnings.push('Different risk level assessments between models');
        confidence *= 0.9;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
}
