import { Injectable } from '@nestjs/common';
import {
  BreakingChange,
  ChangedFunction,
  CompatibleChange,
  ImpactedCallsite,
  RiskAssessment,
  SignatureAnalysis,
} from './impact-analysis.service';

// Constants for fix time estimation (in minutes)
const FIX_TIME_ESTIMATES = {
  CRITICAL: 60, // 1 hour each
  HIGH: 30, // 30 minutes each
  MEDIUM: 15, // 15 minutes each
  LOW: 5, // 5 minutes each
} as const;

@Injectable()
export class ImpactClassifierService {
  /**
   * Classify changes as breaking or compatible
   */
  async classifyChanges(
    changedFunctions: ChangedFunction[],
    impactedCallsites: ImpactedCallsite[],
  ): Promise<{
    breakingChanges: BreakingChange[];
    compatibleChanges: CompatibleChange[];
  }> {
    const breakingChanges: BreakingChange[] = [];
    const compatibleChanges: CompatibleChange[] = [];

    for (const changedFunction of changedFunctions) {
      const functionCallsites = impactedCallsites.filter(
        (callsite) => callsite.functionName === changedFunction.name,
      );

      const classification = await this.classifyFunctionChange(
        changedFunction,
        functionCallsites,
      );

      if (classification.isBreaking) {
        breakingChanges.push(...classification.breakingChanges);
      } else {
        compatibleChanges.push(...classification.compatibleChanges);
      }
    }

    return { breakingChanges, compatibleChanges };
  }

  /**
   * Classify a single function change
   */
  private async classifyFunctionChange(
    changedFunction: ChangedFunction,
    callsites: ImpactedCallsite[],
  ): Promise<{
    isBreaking: boolean;
    breakingChanges: BreakingChange[];
    compatibleChanges: CompatibleChange[];
  }> {
    const breakingChanges: BreakingChange[] = [];
    const compatibleChanges: CompatibleChange[] = [];

    // Analyze function signature changes
    const signatureAnalysis = this.analyzeSignatureChange(changedFunction);

    if (signatureAnalysis.isBreaking) {
      // Create breaking changes for each affected callsite
      for (const callsite of callsites) {
        const breakingChange = this.createBreakingChangeFromCallsite(
          changedFunction,
          callsite,
          signatureAnalysis,
        );
        breakingChanges.push(breakingChange);
      }
    } else {
      // Create compatible change
      const compatibleChange = this.createCompatibleChange(
        changedFunction,
        callsites,
      );
      compatibleChanges.push(compatibleChange);
    }

    return {
      isBreaking: breakingChanges.length > 0,
      breakingChanges,
      compatibleChanges,
    };
  }

  /**
   * Analyze function signature changes
   */
  private analyzeSignatureChange(changedFunction: ChangedFunction): {
    isBreaking: boolean;
    changeType: string;
    addedParameters: string[];
    removedParameters: string[];
    modifiedParameters: string[];
    returnTypeChanged: boolean;
  } {
    const { previousSignature, newSignature, changeType } = changedFunction;

    if (changeType === 'ADDED') {
      return {
        isBreaking: false,
        changeType: 'ADDED',
        addedParameters: [],
        removedParameters: [],
        modifiedParameters: [],
        returnTypeChanged: false,
      };
    }

    if (changeType === 'REMOVED') {
      return {
        isBreaking: true,
        changeType: 'REMOVED',
        addedParameters: [],
        removedParameters: [],
        modifiedParameters: [],
        returnTypeChanged: false,
      };
    }

    if (changeType === 'MODIFIED' && previousSignature && newSignature) {
      return this.compareSignatures(previousSignature, newSignature);
    }

    return {
      isBreaking: false,
      changeType: 'UNKNOWN',
      addedParameters: [],
      removedParameters: [],
      modifiedParameters: [],
      returnTypeChanged: false,
    };
  }

  /**
   * Compare function signatures to detect breaking changes
   */
  private compareSignatures(
    previousSignature: string,
    newSignature: string,
  ): {
    isBreaking: boolean;
    changeType: string;
    addedParameters: string[];
    removedParameters: string[];
    modifiedParameters: string[];
    returnTypeChanged: boolean;
  } {
    try {
      const prevParams = this.extractParameters(previousSignature);
      const newParams = this.extractParameters(newSignature);
      const prevReturnType = this.extractReturnType(previousSignature);
      const newReturnType = this.extractReturnType(newSignature);

      const addedParameters = newParams.filter(
        (param) => !prevParams.includes(param),
      );
      const removedParameters = prevParams.filter(
        (param) => !newParams.includes(param),
      );
      const returnTypeChanged = prevReturnType !== newReturnType;

      const isBreaking =
        removedParameters.length > 0 ||
        addedParameters.some((param) => !this.isOptionalParameter(param)) ||
        returnTypeChanged;

      return {
        isBreaking,
        changeType: isBreaking ? 'BREAKING' : 'COMPATIBLE',
        addedParameters,
        removedParameters,
        modifiedParameters: [],
        returnTypeChanged,
      };
    } catch (error) {
      console.error('Error comparing signatures:', error);
      return {
        isBreaking: false,
        changeType: 'UNKNOWN',
        addedParameters: [],
        removedParameters: [],
        modifiedParameters: [],
        returnTypeChanged: false,
      };
    }
  }

  /**
   * Extract parameters from function signature
   */
  private extractParameters(signature: string): string[] {
    try {
      // Simple regex to extract parameters from function signature
      const paramMatch = signature.match(/\(([^)]*)\)/);
      if (!paramMatch) return [];

      const paramsString = paramMatch[1];
      if (!paramsString.trim()) return [];

      return paramsString
        .split(',')
        .map((param) => param.trim())
        .filter((param) => param.length > 0);
    } catch (error) {
      console.error('Error extracting parameters:', error);
      return [];
    }
  }

  /**
   * Extract return type from function signature
   */
  private extractReturnType(signature: string): string | null {
    try {
      const returnTypeMatch = signature.match(/\)\s*:\s*([^{=]+)/);
      return returnTypeMatch ? returnTypeMatch[1].trim() : null;
    } catch (error) {
      console.error('Error extracting return type:', error);
      return null;
    }
  }

  /**
   * Check if parameter is optional
   */
  private isOptionalParameter(param: string): boolean {
    return param.includes('?') || param.includes('=');
  }

  /**
   * Create breaking change from callsite
   */
  private createBreakingChangeFromCallsite(
    changedFunction: ChangedFunction,
    callsite: ImpactedCallsite,
    signatureAnalysis: SignatureAnalysis,
  ): BreakingChange {
    const severity = this.determineSeverity(
      changedFunction,
      callsite,
      signatureAnalysis,
    );
    const description = this.generateBreakingChangeDescription(
      changedFunction,
      signatureAnalysis,
    );
    const evidence = this.generateEvidence(changedFunction, callsite);
    const failureCondition = this.generateFailureCondition(
      changedFunction,
      callsite,
    );
    const mitigation = this.generateMitigation(
      changedFunction,
      callsite,
      signatureAnalysis,
    );

    return {
      id: `breaking-${changedFunction.name}-${callsite.file}-${callsite.line}`,
      functionName: changedFunction.name,
      file: callsite.file,
      line: callsite.line,
      description,
      evidence,
      failureCondition,
      impactScope: this.determineImpactScope(changedFunction, callsite),
      mitigation,
      relatedCallsites: [callsite.file],
      severity,
    };
  }

  /**
   * Create compatible change
   */
  private createCompatibleChange(
    changedFunction: ChangedFunction,
    callsites: ImpactedCallsite[],
  ): CompatibleChange {
    const description =
      this.generateCompatibleChangeDescription(changedFunction);
    const compatibilityReason =
      this.generateCompatibilityReason(changedFunction);
    const potentialRisks = this.identifyPotentialRisks(
      changedFunction,
      callsites,
    );
    const monitoringRecommendations =
      this.generateMonitoringRecommendations(changedFunction);

    return {
      id: `compatible-${changedFunction.name}-${Date.now()}`,
      functionName: changedFunction.name,
      file: changedFunction.file,
      line: changedFunction.line,
      description,
      compatibilityReason,
      potentialRisks,
      monitoringRecommendations,
    };
  }

  /**
   * Determine severity of breaking change
   */
  private determineSeverity(
    changedFunction: ChangedFunction,
    callsite: ImpactedCallsite,
    signatureAnalysis: any,
  ): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    // Critical: Function removed or critical parameters removed
    if (
      changedFunction.changeType === 'REMOVED' ||
      signatureAnalysis.removedParameters.length > 0
    ) {
      return 'CRITICAL';
    }

    // High: Required parameters added or return type changed
    if (
      signatureAnalysis.addedParameters.some(
        (param: string) => !this.isOptionalParameter(param),
      ) ||
      signatureAnalysis.returnTypeChanged
    ) {
      return 'HIGH';
    }

    // Medium: Optional parameters added or behavior changes
    if (
      signatureAnalysis.addedParameters.length > 0 ||
      changedFunction.impactScope === 'SYSTEM'
    ) {
      return 'MEDIUM';
    }

    // Low: Minor changes
    return 'LOW';
  }

  /**
   * Determine impact scope
   */
  private determineImpactScope(
    changedFunction: ChangedFunction,
    callsite: ImpactedCallsite,
  ): 'LOCAL' | 'MODULE' | 'SYSTEM' {
    if (callsite.context.isInSameDirectory) {
      return 'LOCAL';
    }

    if (callsite.context.isInSameModule) {
      return 'MODULE';
    }

    return 'SYSTEM';
  }

  /**
   * Generate breaking change description
   */
  private generateBreakingChangeDescription(
    changedFunction: ChangedFunction,
    signatureAnalysis: any,
  ): string {
    if (changedFunction.changeType === 'REMOVED') {
      return `Function '${changedFunction.name}' has been removed`;
    }

    if (signatureAnalysis.removedParameters.length > 0) {
      return `Function '${changedFunction.name}' has removed required parameters: ${signatureAnalysis.removedParameters.join(', ')}`;
    }

    if (signatureAnalysis.addedParameters.length > 0) {
      return `Function '${changedFunction.name}' has added required parameters: ${signatureAnalysis.addedParameters.join(', ')}`;
    }

    if (signatureAnalysis.returnTypeChanged) {
      return `Function '${changedFunction.name}' has changed return type`;
    }

    return `Function '${changedFunction.name}' has breaking changes`;
  }

  /**
   * Generate evidence for breaking change
   */
  private generateEvidence(
    changedFunction: ChangedFunction,
    callsite: ImpactedCallsite,
  ): string {
    return `Function '${changedFunction.name}' called at ${callsite.file}:${callsite.line} will break due to signature changes`;
  }

  /**
   * Generate failure condition
   */
  private generateFailureCondition(
    changedFunction: ChangedFunction,
    callsite: ImpactedCallsite,
  ): string {
    return `Calling '${changedFunction.name}' with current parameters will result in runtime error`;
  }

  /**
   * Generate mitigation
   */
  private generateMitigation(
    changedFunction: ChangedFunction,
    callsite: ImpactedCallsite,
    signatureAnalysis: any,
  ): string {
    if (signatureAnalysis.removedParameters.length > 0) {
      return `Remove parameters: ${signatureAnalysis.removedParameters.join(', ')}`;
    }

    if (signatureAnalysis.addedParameters.length > 0) {
      return `Add required parameters: ${signatureAnalysis.addedParameters.join(', ')}`;
    }

    return `Update function call to match new signature`;
  }

  /**
   * Generate compatible change description
   */
  private generateCompatibleChangeDescription(
    changedFunction: ChangedFunction,
  ): string {
    return `Function '${changedFunction.name}' has been modified but remains backward compatible`;
  }

  /**
   * Generate compatibility reason
   */
  private generateCompatibilityReason(
    changedFunction: ChangedFunction,
  ): string {
    return `Changes to '${changedFunction.name}' do not affect existing function calls`;
  }

  /**
   * Identify potential risks
   */
  private identifyPotentialRisks(
    changedFunction: ChangedFunction,
    callsites: ImpactedCallsite[],
  ): string[] {
    const risks: string[] = [];

    if (changedFunction.impactScope === 'SYSTEM') {
      risks.push('System-wide impact if behavior changes');
    }

    if (callsites.length > 10) {
      risks.push('High usage - monitor for performance impact');
    }

    if (changedFunction.confidence === 'LOW') {
      risks.push(
        'Low confidence in change analysis - manual review recommended',
      );
    }

    return risks;
  }

  /**
   * Generate monitoring recommendations
   */
  private generateMonitoringRecommendations(
    changedFunction: ChangedFunction,
  ): string[] {
    const recommendations: string[] = [];

    if (changedFunction.impactScope === 'SYSTEM') {
      recommendations.push('Monitor system performance after deployment');
    }

    if (changedFunction.confidence === 'LOW') {
      recommendations.push('Set up alerts for unexpected behavior');
    }

    recommendations.push('Monitor error rates for affected components');

    return recommendations;
  }

  /**
   * Perform comprehensive risk assessment
   */
  async performRiskAssessment(
    breakingChanges: BreakingChange[],
    compatibleChanges: CompatibleChange[],
    impactedCallsites: ImpactedCallsite[],
  ): Promise<RiskAssessment> {
    const criticalBreaking = breakingChanges.filter(
      (c) => c.severity === 'CRITICAL',
    ).length;
    const highBreaking = breakingChanges.filter(
      (c) => c.severity === 'HIGH',
    ).length;
    const mediumBreaking = breakingChanges.filter(
      (c) => c.severity === 'MEDIUM',
    ).length;
    const lowBreaking = breakingChanges.filter(
      (c) => c.severity === 'LOW',
    ).length;

    const totalBreaking = breakingChanges.length;
    const totalCallsites = impactedCallsites.length;
    const systemImpact = breakingChanges.filter(
      (c) => c.impactScope === 'SYSTEM',
    ).length;

    // Calculate overall risk
    let overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';

    if (criticalBreaking > 0) {
      overallRisk = 'CRITICAL';
    } else if (highBreaking > 2 || systemImpact > 0) {
      overallRisk = 'HIGH';
    } else if (highBreaking > 0 || mediumBreaking > 3) {
      overallRisk = 'MEDIUM';
    }

    // Generate risk factors
    const riskFactors: string[] = [];
    if (criticalBreaking > 0)
      riskFactors.push(`${criticalBreaking} critical breaking changes`);
    if (highBreaking > 0)
      riskFactors.push(`${highBreaking} high severity breaking changes`);
    if (systemImpact > 0)
      riskFactors.push(`${systemImpact} system-wide impacts`);
    if (totalCallsites > 20)
      riskFactors.push(`High number of affected callsites (${totalCallsites})`);

    // Generate mitigation strategies
    const mitigationStrategies: string[] = [];
    if (criticalBreaking > 0)
      mitigationStrategies.push(
        'Fix all critical breaking changes before deployment',
      );
    if (highBreaking > 0)
      mitigationStrategies.push('Review and fix high severity changes');
    if (systemImpact > 0)
      mitigationStrategies.push('Implement gradual rollout for system changes');
    mitigationStrategies.push('Add comprehensive tests for changed functions');
    mitigationStrategies.push('Monitor system after deployment');

    // Calculate deployment readiness (0-100)
    let deploymentReadiness = 100;
    deploymentReadiness -= criticalBreaking * 30;
    deploymentReadiness -= highBreaking * 15;
    deploymentReadiness -= mediumBreaking * 5;
    deploymentReadiness -= systemImpact * 20;
    deploymentReadiness = Math.max(0, deploymentReadiness);

    // Estimate fix time
    const estimatedFixTime = this.estimateFixTime(
      breakingChanges,
      compatibleChanges,
    );

    return {
      overallRisk,
      riskFactors,
      mitigationStrategies,
      estimatedFixTime,
      deploymentReadiness,
    };
  }

  /**
   * Estimate fix time based on changes
   */
  private estimateFixTime(
    breakingChanges: BreakingChange[],
    compatibleChanges: CompatibleChange[],
  ): string {
    const criticalTime =
      breakingChanges.filter((c) => c.severity === 'CRITICAL').length *
      FIX_TIME_ESTIMATES.CRITICAL;
    const highTime =
      breakingChanges.filter((c) => c.severity === 'HIGH').length *
      FIX_TIME_ESTIMATES.HIGH;
    const mediumTime =
      breakingChanges.filter((c) => c.severity === 'MEDIUM').length *
      FIX_TIME_ESTIMATES.MEDIUM;
    const lowTime =
      breakingChanges.filter((c) => c.severity === 'LOW').length *
      FIX_TIME_ESTIMATES.LOW;

    const totalMinutes = criticalTime + highTime + mediumTime + lowTime;

    if (totalMinutes < 60) {
      return `${totalMinutes} minutes`;
    } else if (totalMinutes < 480) {
      const hours = Math.ceil(totalMinutes / 60);
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      const days = Math.ceil(totalMinutes / 480);
      return `${days} day${days > 1 ? 's' : ''}`;
    }
  }
}
