import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CallsiteDetectorService } from './callsite-detector.service';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { ImpactAnalysisLogger } from './impact-analysis.logger';
import { ImpactClassifierService } from './impact-classifier.service';
import { SimpleLogger } from './simple-logger';

export interface EnhancedImpactAnalysis {
  summary: string;
  changedFunctions: ChangedFunction[];
  impactedCallsites: ImpactedCallsite[];
  breakingChanges: BreakingChange[];
  compatibleChanges: CompatibleChange[];
  testRecommendations: TestRecommendation[];
  riskAssessment: RiskAssessment;
  deploymentRecommendation: 'SAFE' | 'REVIEW_REQUIRED' | 'BLOCK';
}

export interface ChangedFunction {
  name: string;
  file: string;
  line: number;
  changeType: 'ADDED' | 'MODIFIED' | 'REMOVED';
  previousSignature?: string;
  newSignature?: string;
  impactScope: 'LOCAL' | 'MODULE' | 'SYSTEM';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ImpactedCallsite {
  functionName: string;
  file: string;
  line: number;
  callCode: string;
  callType: 'DIRECT' | 'METHOD' | 'CALLBACK' | 'IMPORTED' | 'DESTRUCTURED';
  compatibilityStatus: 'WILL_BREAK' | 'MIGHT_BREAK' | 'WILL_WORK';
  breakageReason?: string;
  requiredFix?: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedFixTime: string;
  context: {
    importPath?: string;
    callFrequency: 'FREQUENT' | 'MODERATE' | 'RARE';
    callContext: string;
    isInSameDirectory: boolean;
    isInSameModule: boolean;
  };
}

export interface BreakingChange {
  id: string;
  functionName: string;
  file: string;
  line: number;
  description: string;
  evidence: string;
  failureCondition: string;
  impactScope: 'LOCAL' | 'MODULE' | 'SYSTEM';
  mitigation: string;
  relatedCallsites: string[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CompatibleChange {
  id: string;
  functionName: string;
  file: string;
  line: number;
  description: string;
  compatibilityReason: string;
  potentialRisks: string[];
  monitoringRecommendations: string[];
}

export interface TestRecommendation {
  id: string;
  testName: string;
  type: 'UNIT' | 'INTEGRATION' | 'E2E' | 'REGRESSION';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  scenario: string;
  codeExample: string;
  willCatchBreakage: boolean;
  estimatedTime: string;
  framework: string;
}

export interface RiskAssessment {
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskFactors: string[];
  mitigationStrategies: string[];
  estimatedFixTime: string;
  deploymentReadiness: number; // 0-100
}

export interface ChangedFile {
  filename: string;
  status: string;
  content?: string;
  previousContent?: string;
}

export interface SignatureAnalysis {
  isBreaking: boolean;
  changeType: string;
  addedParameters: string[];
  removedParameters: string[];
  modifiedParameters: string[];
  returnTypeChanged: boolean;
}

@Injectable()
export class ImpactAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly callsiteDetector: CallsiteDetectorService,
    private readonly dependencyAnalyzer: DependencyAnalyzerService,
    private readonly impactClassifier: ImpactClassifierService,
  ) {}

  /**
   * Perform enhanced impact analysis on changed files from PR
   */
  async analyzeImpact(
    repositoryId: string,
    prNumber: number,
    changedFiles: ChangedFile[],
    organizationId: string,
  ): Promise<EnhancedImpactAnalysis> {
    const simpleLogger = SimpleLogger.getInstance();
    simpleLogger.clear(); // Start fresh for each analysis

    try {
      const logger = ImpactAnalysisLogger.getInstance();
      simpleLogger.log('🚀 STARTING ENHANCED IMPACT ANALYSIS', {
        repositoryId,
        prNumber,
        changedFilesCount: changedFiles.length,
        changedFiles: changedFiles.map((f) => ({
          filename: f.filename,
          status: f.status,
        })),
      });

      logger.info('analyzeImpact', 'Starting enhanced impact analysis', {
        repositoryId,
        prNumber,
        files: changedFiles.length,
      });

      // Step 1: Extract and analyze changed functions
      simpleLogger.log('📋 STEP 1: Extracting changed functions from files');
      const changedFunctions = await this.extractChangedFunctions(changedFiles);
      simpleLogger.log('✅ Changed functions extracted', {
        count: changedFunctions.length,
        functions: changedFunctions.map((f) => ({
          name: f.name,
          file: f.file,
          changeType: f.changeType,
        })),
      });

      logger.debug('analyzeImpact', 'Changed functions extracted', {
        count: changedFunctions.length,
      });

      // Step 2: Build dependency map for the repository
      simpleLogger.log('🔗 STEP 2: Building dependency map for repository');
      const dependencyMap =
        await this.dependencyAnalyzer.buildDependencyMap(repositoryId);
      simpleLogger.log('✅ Dependency map built', {
        totalFiles: Object.keys(dependencyMap.imports).length,
        totalExports: Object.keys(dependencyMap.exports).length,
      });

      logger.debug('analyzeImpact', 'Dependency map built');

      // Step 3: Find all callsites for changed functions
      simpleLogger.log(
        '🎯 STEP 3: Finding impacted callsites for each changed function',
      );
      const impactedCallsites = await this.findImpactedCallsites(
        changedFunctions,
        dependencyMap,
        repositoryId,
      );
      simpleLogger.log('✅ Impacted callsites found', {
        count: impactedCallsites.length,
        callsites: impactedCallsites.map((c) => ({
          functionName: c.functionName,
          file: c.file,
          line: c.line,
          callType: c.callType,
          compatibilityStatus: c.compatibilityStatus,
        })),
      });

      logger.debug('analyzeImpact', 'Impacted callsites found', {
        count: impactedCallsites.length,
      });

      // Step 4: Classify changes as breaking or compatible
      simpleLogger.log(
        '🔍 STEP 4: Classifying changes as breaking or compatible',
      );
      const { breakingChanges, compatibleChanges } = await this.classifyChanges(
        changedFunctions,
        impactedCallsites,
      );
      simpleLogger.log('✅ Classification complete', {
        breakingChanges: breakingChanges.length,
        compatibleChanges: compatibleChanges.length,
        breakingDetails: breakingChanges.map((b) => ({
          functionName: b.functionName,
          description: b.description,
          severity: b.severity,
        })),
      });

      logger.info('analyzeImpact', 'Classification complete', {
        breaking: breakingChanges.length,
        compatible: compatibleChanges.length,
      });

      // Step 5: Generate test recommendations
      simpleLogger.log('🧪 STEP 5: Generating test recommendations');
      const testRecommendations = await this.generateTestRecommendations(
        breakingChanges,
        compatibleChanges,
        changedFunctions,
      );
      simpleLogger.log('✅ Test recommendations generated', {
        count: testRecommendations.length,
      });

      // Step 6: Perform risk assessment
      simpleLogger.log('⚠️ STEP 6: Performing risk assessment');
      const riskAssessment = await this.performRiskAssessment(
        breakingChanges,
        compatibleChanges,
        impactedCallsites,
      );
      simpleLogger.log('✅ Risk assessment complete', {
        overallRisk: riskAssessment.overallRisk,
        riskFactors: riskAssessment.riskFactors,
      });

      // Step 7: Generate deployment recommendation
      simpleLogger.log('🚀 STEP 7: Generating deployment recommendation');
      const deploymentRecommendation = this.generateDeploymentRecommendation(
        riskAssessment,
        breakingChanges,
      );
      simpleLogger.log('✅ Deployment recommendation generated', {
        recommendation: deploymentRecommendation,
      });

      // Step 8: Generate summary
      simpleLogger.log('📝 STEP 8: Generating analysis summary');
      const summary = this.generateSummary(
        changedFunctions,
        breakingChanges,
        compatibleChanges,
        riskAssessment,
      );
      simpleLogger.log('✅ Summary generated', { summary });

      const analysis: EnhancedImpactAnalysis = {
        summary,
        changedFunctions,
        impactedCallsites,
        breakingChanges,
        compatibleChanges,
        testRecommendations,
        riskAssessment,
        deploymentRecommendation,
      };

      // Store analysis in database
      simpleLogger.log('💾 Storing analysis in database', {
        repositoryId,
        prNumber,
        organizationId,
      });
      await this.storeAnalysis(
        repositoryId,
        prNumber,
        analysis,
        organizationId,
      );
      simpleLogger.log('✅ Analysis stored successfully');

      simpleLogger.log('🎉 ENHANCED IMPACT ANALYSIS COMPLETED SUCCESSFULLY', {
        repositoryId,
        prNumber,
        totalChangedFunctions: changedFunctions.length,
        totalImpactedCallsites: impactedCallsites.length,
        totalBreakingChanges: breakingChanges.length,
        totalCompatibleChanges: compatibleChanges.length,
        deploymentRecommendation,
      });

      logger.info(
        'analyzeImpact',
        'Enhanced impact analysis completed successfully',
        { repositoryId, prNumber },
      );
      return analysis;
    } catch (error) {
      const logger = ImpactAnalysisLogger.getInstance();
      simpleLogger.log('❌ ERROR IN ENHANCED IMPACT ANALYSIS', {
        error: String(error),
        stack: error.stack,
      });

      logger.error('analyzeImpact', 'Error in enhanced impact analysis', {
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Extract changed functions from file diffs
   */
  private async extractChangedFunctions(
    changedFiles: any[],
  ): Promise<ChangedFunction[]> {
    const changedFunctions: ChangedFunction[] = [];

    for (const file of changedFiles) {
      try {
        const functions =
          await this.callsiteDetector.extractFunctionsFromFile(file);

        // Convert FunctionDefinition to ChangedFunction
        const changedFuncs = functions.map((func) => ({
          name: func.name,
          file: func.file,
          line: func.line,
          changeType: 'MODIFIED' as const, // Default assumption
          previousSignature: func.signature,
          newSignature: func.signature,
          impactScope: this.determineImpactScope(func),
          confidence: this.determineConfidence(func),
        }));

        changedFunctions.push(...changedFuncs);
      } catch (error) {
        console.error(
          `Error extracting functions from ${file.filename}:`,
          error,
        );
      }
    }

    return changedFunctions;
  }

  /**
   * Determine impact scope based on function properties
   */
  private determineImpactScope(func: any): 'LOCAL' | 'MODULE' | 'SYSTEM' {
    if (func.isExported) {
      return 'SYSTEM';
    }
    return 'LOCAL';
  }

  /**
   * Determine confidence based on function properties
   */
  private determineConfidence(func: any): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (func.returnType && func.parameters?.length > 0) {
      return 'HIGH';
    }
    if (func.parameters?.length > 0) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  /**
   * Find all callsites that use the changed functions
   */
  private async findImpactedCallsites(
    changedFunctions: ChangedFunction[],
    dependencyMap: any,
    repositoryId: string,
  ): Promise<ImpactedCallsite[]> {
    const impactedCallsites: ImpactedCallsite[] = [];

    for (const changedFunction of changedFunctions) {
      try {
        const callsites = await this.callsiteDetector.findCallsites(
          changedFunction.name,
          changedFunction.file,
          dependencyMap,
          repositoryId,
        );

        // Convert CallsiteInfo to ImpactedCallsite
        const impactedCalls = callsites.map((callsite) => ({
          functionName: callsite.functionName,
          file: callsite.file,
          line: callsite.line,
          callCode: callsite.callCode,
          callType: callsite.callType,
          compatibilityStatus: this.determineCompatibilityStatus(
            callsite,
            changedFunction,
          ),
          breakageReason: this.determineBreakageReason(
            callsite,
            changedFunction,
          ),
          requiredFix: this.determineRequiredFix(callsite, changedFunction),
          priority: this.determinePriority(callsite, changedFunction),
          estimatedFixTime: this.estimateFixTime(callsite, changedFunction),
          context: {
            importPath: callsite.context.importPath,
            callFrequency: callsite.context.callFrequency,
            callContext: callsite.context.callContext,
            isInSameDirectory: callsite.context.isInSameDirectory,
            isInSameModule: callsite.context.isInSameModule,
          },
        }));

        impactedCallsites.push(...impactedCalls);
      } catch (error) {
        console.error(
          `Error finding callsites for ${changedFunction.name}:`,
          error,
        );
      }
    }

    return impactedCallsites;
  }

  /**
   * Determine compatibility status based on callsite and function
   */
  private determineCompatibilityStatus(
    callsite: any,
    changedFunction: ChangedFunction,
  ): 'WILL_BREAK' | 'MIGHT_BREAK' | 'WILL_WORK' {
    if (changedFunction.changeType === 'REMOVED') {
      return 'WILL_BREAK';
    }
    if (changedFunction.changeType === 'ADDED') {
      return 'WILL_WORK';
    }
    // For MODIFIED, assume it will work unless we detect breaking changes
    return 'WILL_WORK';
  }

  /**
   * Determine breakage reason
   */
  private determineBreakageReason(
    callsite: any,
    changedFunction: ChangedFunction,
  ): string | undefined {
    if (changedFunction.changeType === 'REMOVED') {
      return 'Function has been removed';
    }
    return undefined;
  }

  /**
   * Determine required fix
   */
  private determineRequiredFix(
    callsite: any,
    changedFunction: ChangedFunction,
  ): string | undefined {
    if (changedFunction.changeType === 'REMOVED') {
      return 'Replace with alternative function or remove call';
    }
    return undefined;
  }

  /**
   * Determine priority
   */
  private determinePriority(
    callsite: any,
    changedFunction: ChangedFunction,
  ): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    if (changedFunction.changeType === 'REMOVED') {
      return 'CRITICAL';
    }
    if (changedFunction.impactScope === 'SYSTEM') {
      return 'HIGH';
    }
    return 'MEDIUM';
  }

  /**
   * Estimate fix time
   */
  private estimateFixTime(
    callsite: any,
    changedFunction: ChangedFunction,
  ): string {
    if (changedFunction.changeType === 'REMOVED') {
      return '30 minutes';
    }
    if (changedFunction.impactScope === 'SYSTEM') {
      return '15 minutes';
    }
    return '5 minutes';
  }

  /**
   * Classify changes as breaking or compatible
   */
  private async classifyChanges(
    changedFunctions: ChangedFunction[],
    impactedCallsites: ImpactedCallsite[],
  ): Promise<{
    breakingChanges: BreakingChange[];
    compatibleChanges: CompatibleChange[];
  }> {
    return await this.impactClassifier.classifyChanges(
      changedFunctions,
      impactedCallsites,
    );
  }

  /**
   * Generate test recommendations based on changes
   */
  private async generateTestRecommendations(
    breakingChanges: BreakingChange[],
    compatibleChanges: CompatibleChange[],
    changedFunctions: ChangedFunction[],
  ): Promise<TestRecommendation[]> {
    const recommendations: TestRecommendation[] = [];

    // Generate tests for breaking changes
    for (const breakingChange of breakingChanges) {
      const test = await this.generateTestForBreakingChange(breakingChange);
      if (test) {
        recommendations.push(test);
      }
    }

    // Generate tests for critical functions
    for (const changedFunction of changedFunctions) {
      if (
        changedFunction.impactScope === 'SYSTEM' ||
        changedFunction.confidence === 'HIGH'
      ) {
        const test =
          await this.generateTestForCriticalFunction(changedFunction);
        if (test) {
          recommendations.push(test);
        }
      }
    }

    return recommendations;
  }

  /**
   * Perform comprehensive risk assessment
   */
  private async performRiskAssessment(
    breakingChanges: BreakingChange[],
    compatibleChanges: CompatibleChange[],
    impactedCallsites: ImpactedCallsite[],
  ): Promise<RiskAssessment> {
    return await this.impactClassifier.performRiskAssessment(
      breakingChanges,
      compatibleChanges,
      impactedCallsites,
    );
  }

  /**
   * Generate deployment recommendation
   */
  private generateDeploymentRecommendation(
    riskAssessment: RiskAssessment,
    breakingChanges: BreakingChange[],
  ): 'SAFE' | 'REVIEW_REQUIRED' | 'BLOCK' {
    if (breakingChanges.some((change) => change.severity === 'CRITICAL')) {
      return 'BLOCK';
    }

    if (
      riskAssessment.overallRisk === 'HIGH' ||
      riskAssessment.overallRisk === 'CRITICAL'
    ) {
      return 'REVIEW_REQUIRED';
    }

    if (breakingChanges.some((change) => change.severity === 'HIGH')) {
      return 'REVIEW_REQUIRED';
    }

    return 'SAFE';
  }

  /**
   * Generate analysis summary
   */
  private generateSummary(
    changedFunctions: ChangedFunction[],
    breakingChanges: BreakingChange[],
    compatibleChanges: CompatibleChange[],
    riskAssessment: RiskAssessment,
  ): string {
    const totalChanges = changedFunctions.length;
    const breakingCount = breakingChanges.length;
    const compatibleCount = compatibleChanges.length;
    const criticalBreaking = breakingChanges.filter(
      (c) => c.severity === 'CRITICAL',
    ).length;

    return `Analysis of ${totalChanges} changed functions: ${breakingCount} breaking changes (${criticalBreaking} critical), ${compatibleCount} compatible changes. Overall risk: ${riskAssessment.overallRisk}. ${riskAssessment.estimatedFixTime} estimated fix time.`;
  }

  /**
   * Store analysis results in database using existing RegressionReport table
   */
  private async storeAnalysis(
    repositoryId: string,
    prNumber: number,
    analysis: EnhancedImpactAnalysis,
    organizationId: string,
  ): Promise<void> {
    try {
      // Check if organizationId is valid
      if (!organizationId) {
        console.warn('No organizationId provided, skipping database storage');
        return;
      }

      // Verify organization exists
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });

      if (!organization) {
        console.warn(
          `Organization with ID ${organizationId} not found, skipping database storage`,
        );
        return;
      }

      //   await this.prisma.regressionReport.create({
      //     data: {
      //       repositoryId,
      //       prNumber,
      //       status: analysis.deploymentRecommendation,
      //       summary: analysis.summary,
      //       impactedFlows: JSON.parse(JSON.stringify(analysis.impactedCallsites)),
      //       changedBehavior: JSON.parse(
      //         JSON.stringify(analysis.changedFunctions),
      //       ),
      //       potentialBreakages: JSON.parse(
      //         JSON.stringify(analysis.breakingChanges),
      //       ),
      //       testCases: JSON.parse(JSON.stringify(analysis.testRecommendations)),
      //       organizationId,
      //     },
      //   });
    } catch (error) {
      console.error('Error storing analysis in database:', error);
      // Don't throw error to prevent breaking the main flow
      // Just log the error and continue
    }
  }

  /**
   * Generate test for breaking change
   */
  private async generateTestForBreakingChange(
    breakingChange: BreakingChange,
  ): Promise<TestRecommendation | null> {
    // Implementation for generating specific test for breaking change
    return {
      id: `test-${breakingChange.id}`,
      testName: `Test ${breakingChange.functionName} breaking change`,
      type: 'REGRESSION',
      priority: breakingChange.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
      scenario: `Verify that ${breakingChange.description} is handled correctly`,
      codeExample: `// Test implementation for ${breakingChange.functionName}`,
      willCatchBreakage: true,
      estimatedTime: '15 minutes',
      framework: 'Jest',
    };
  }

  /**
   * Generate test for critical function
   */
  private async generateTestForCriticalFunction(
    changedFunction: ChangedFunction,
  ): Promise<TestRecommendation | null> {
    return {
      id: `test-${changedFunction.name}-${Date.now()}`,
      testName: `Test ${changedFunction.name} critical function`,
      type: 'UNIT',
      priority: 'HIGH',
      scenario: `Verify ${changedFunction.name} behavior after changes`,
      codeExample: `// Test implementation for ${changedFunction.name}`,
      willCatchBreakage: true,
      estimatedTime: '10 minutes',
      framework: 'Jest',
    };
  }
}
