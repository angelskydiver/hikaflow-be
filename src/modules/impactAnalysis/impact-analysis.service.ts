import { Injectable } from '@nestjs/common';
import { RepositoryProvider } from '@prisma/client';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CallsiteDetectorService,
  FunctionDefinition,
} from './callsite-detector.service';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { ImpactAnalysisLogger } from './impact-analysis.logger';
import { CodeBlockType } from './impact-analysis.types';
import { ImpactClassifierService } from './impact-classifier.service';
import {
  RemoteCodeMatch,
  RemoteCodeSearchService,
} from './remote-code-search.service';
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
  codeType: CodeBlockType;
}

export interface ImpactedCallsite {
  functionName: string;
  file: string;
  line: number;
  callCode: string;
  callType:
    | 'DIRECT'
    | 'METHOD'
    | 'CALLBACK'
    | 'IMPORTED'
    | 'DESTRUCTURED'
    | 'REMOTE_SEARCH';
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
    branchName?: string;
    provider?: 'GITHUB' | 'BITBUCKET';
    matchUrl?: string;
    detectionSource?: 'AST' | 'REMOTE_SEARCH';
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
    private readonly remoteCodeSearch: RemoteCodeSearchService,
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

      // Step 2: Build dependency map first (needed to find relevant files)
      simpleLogger.log('🔗 STEP 2: Building dependency map for repository');
      const dependencyMap =
        await this.dependencyAnalyzer.buildDependencyMap(repositoryId);
      simpleLogger.log('✅ Dependency map built', {
        totalFiles: Object.keys(dependencyMap.imports).length,
        totalExports: Object.keys(dependencyMap.exports).length,
      });

      logger.debug('analyzeImpact', 'Dependency map built');

      // Step 3: Search GitHub/Bitbucket API for all usages (using relevant files from dependency map)
      simpleLogger.log(
        '🔍 STEP 3: Searching repository for function/component usages via API (using dependency map)',
      );
      const remoteCallsitesMap = await this.searchRemoteCallsites(
        changedFunctions,
        repositoryId,
        prNumber,
        dependencyMap,
      );
      simpleLogger.log('✅ Remote API search complete', {
        totalRemoteCallsites: Array.from(remoteCallsitesMap.values()).flat()
          .length,
        functionsSearched: changedFunctions.length,
      });

      logger.debug('analyzeImpact', 'Remote API search complete', {
        functionsSearched: changedFunctions.length,
      });

      // Step 4: Find all callsites (combine local + remote)
      simpleLogger.log(
        '🎯 STEP 4: Finding impacted callsites (combining local AST + remote API results)',
      );
      const impactedCallsites = await this.findImpactedCallsites(
        changedFunctions,
        dependencyMap,
        repositoryId,
        prNumber,
        remoteCallsitesMap,
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

      // Step 5: Classify changes as breaking or compatible
      simpleLogger.log(
        '🔍 STEP 5: Classifying changes as breaking or compatible',
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

      // Step 6: Generate test recommendations
      simpleLogger.log('🧪 STEP 6: Generating test recommendations');
      const testRecommendations = await this.generateTestRecommendations(
        breakingChanges,
        compatibleChanges,
        changedFunctions,
      );
      simpleLogger.log('✅ Test recommendations generated', {
        count: testRecommendations.length,
      });

      // Step 7: Perform risk assessment
      simpleLogger.log('⚠️ STEP 7: Performing risk assessment');
      const riskAssessment = await this.performRiskAssessment(
        breakingChanges,
        compatibleChanges,
        impactedCallsites,
      );
      simpleLogger.log('✅ Risk assessment complete', {
        overallRisk: riskAssessment.overallRisk,
        riskFactors: riskAssessment.riskFactors,
      });

      // Step 8: Generate deployment recommendation
      simpleLogger.log('🚀 STEP 8: Generating deployment recommendation');
      const deploymentRecommendation = this.generateDeploymentRecommendation(
        riskAssessment,
        breakingChanges,
      );
      simpleLogger.log('✅ Deployment recommendation generated', {
        recommendation: deploymentRecommendation,
      });

      // Step 9: Generate summary
      simpleLogger.log('📝 STEP 9: Generating analysis summary');
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
          codeType: this.determineCodeType(func),
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

  private determineCodeType(func: FunctionDefinition): CodeBlockType {
    if (this.isLikelyComponent(func)) {
      return 'COMPONENT';
    }

    if (func.type === 'CLASS_METHOD' || func.type === 'METHOD') {
      return 'METHOD';
    }

    if (func.type === 'ARROW_FUNCTION') {
      return 'ARROW_FUNCTION';
    }

    return 'FUNCTION';
  }

  private isLikelyComponent(func: FunctionDefinition): boolean {
    const ext = path.extname(func.file || '').toLowerCase();
    if (!['.tsx', '.jsx'].includes(ext)) {
      return false;
    }

    return /^[A-Z]/.test(func.name || '');
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
   * Search GitHub/Bitbucket API for all usages of changed functions
   * Uses dependency map and FileDocumentation to find relevant files first
   * Then searches only in those relevant files for better performance
   */
  private async searchRemoteCallsites(
    changedFunctions: ChangedFunction[],
    repositoryId: string,
    prNumber: number,
    dependencyMap: any,
  ): Promise<Map<string, ImpactedCallsite[]>> {
    const remoteCallsitesMap = new Map<string, ImpactedCallsite[]>();

    for (const changedFunction of changedFunctions) {
      try {
        // Find relevant files using dependency map and FileDocumentation
        const relevantFiles = await this.findRelevantFilesForFunction(
          changedFunction,
          repositoryId,
          dependencyMap,
        );

        const remoteMatches =
          await this.remoteCodeSearch.searchFunctionReferences({
            repositoryId,
            functionName: changedFunction.name,
            filePath: changedFunction.file,
            prNumber,
            codeType: changedFunction.codeType,
            limit: 20, // Limit per function
            includeBaseBranch: true, // Search in both PR branch and base branch
            relevantFiles, // Pass relevant files to search only in those
          });

        // Convert remote matches to ImpactedCallsite format
        const remoteCallsites = remoteMatches.map((match) =>
          this.convertRemoteMatchToCallsite(match, changedFunction),
        );

        remoteCallsitesMap.set(changedFunction.name, remoteCallsites);
      } catch (error) {
        console.error(
          `Remote search failed for ${changedFunction.name}:`,
          error,
        );
        // Continue with other functions even if one fails
        remoteCallsitesMap.set(changedFunction.name, []);
      }
    }

    return remoteCallsitesMap;
  }

  /**
   * Find relevant files that might use the changed function
   * Uses dependency map and FileDocumentation to identify files that:
   * 1. Import from the changed file
   * 2. Import from the same directory
   * 3. Are in the same module
   * 4. Reference the function name in their imports
   */
  private async findRelevantFilesForFunction(
    changedFunction: ChangedFunction,
    repositoryId: string,
    dependencyMap: any,
  ): Promise<string[]> {
    const relevantFiles = new Set<string>();
    const changedFilePath = changedFunction.file;
    const changedFileDir = path.dirname(changedFilePath);

    try {
      // 1. Find files that import from the changed file (using dependency map)
      const filesThatImportChangedFile =
        dependencyMap.importedBy?.[changedFilePath] || [];
      filesThatImportChangedFile.forEach((file: string) =>
        relevantFiles.add(file),
      );

      // 2. Find files in the same directory (likely to import from each other)
      const allFiles = Object.keys(dependencyMap.imports || {});
      const filesInSameDir = allFiles.filter((file) => {
        const fileDir = path.dirname(file);
        return fileDir === changedFileDir && file !== changedFilePath;
      });
      filesInSameDir.forEach((file) => relevantFiles.add(file));

      // 3. Find files that import from the same directory
      const filesImportingFromDir = allFiles.filter((file) => {
        const imports = dependencyMap.imports?.[file] || [];
        return imports.some((importPath: string) => {
          const importDir = path.dirname(importPath);
          return importDir === changedFileDir;
        });
      });
      filesImportingFromDir.forEach((file) => relevantFiles.add(file));

      // 4. Use FileDocumentation to find files that import the function name
      const filesWithFunctionImport = await this.findFilesImportingFunction(
        changedFunction.name,
        repositoryId,
      );
      filesWithFunctionImport.forEach((file) => relevantFiles.add(file));

      // 5. Find files in the same module (based on directory structure)
      const modulePath = this.getModulePath(changedFilePath);
      const filesInSameModule = allFiles.filter((file) => {
        const fileModulePath = this.getModulePath(file);
        return fileModulePath === modulePath && file !== changedFilePath;
      });
      filesInSameModule.forEach((file) => relevantFiles.add(file));

      return Array.from(relevantFiles);
    } catch (error) {
      console.error(
        `Error finding relevant files for ${changedFunction.name}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Find files that import a specific function using FileDocumentation
   */
  private async findFilesImportingFunction(
    functionName: string,
    repositoryId: string,
  ): Promise<string[]> {
    try {
      // Get all file documentation for the repository
      const fileDocs = await this.prisma.fileDocumentation.findMany({
        where: { repositoryId },
        select: {
          fullPath: true,
          imports: true,
          functions: true,
        },
      });

      const relevantFiles: string[] = [];

      for (const fileDoc of fileDocs) {
        // Check if file imports the function
        const imports = (fileDoc.imports as string[]) || [];
        const hasFunctionImport = imports.some((imp) => {
          // Check if import contains the function name
          return (
            imp.includes(functionName) ||
            imp.includes(`{ ${functionName} }`) ||
            imp.includes(`{${functionName}}`)
          );
        });

        // Check if file has the function in its functions list (might be a re-export)
        const functions = (fileDoc.functions as any[]) || [];
        const hasFunction = functions.some(
          (func: any) => func.name === functionName,
        );

        if (hasFunctionImport || hasFunction) {
          relevantFiles.push(fileDoc.fullPath);
        }
      }

      return relevantFiles;
    } catch (error) {
      console.error(
        `Error finding files importing function ${functionName}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Get module path from file path (e.g., src/modules/user -> modules/user)
   */
  private getModulePath(filePath: string): string {
    const parts = filePath.split('/');
    // Find common module directories
    const moduleIndex = parts.findIndex(
      (part) =>
        part === 'modules' || part === 'components' || part === 'services',
    );
    if (moduleIndex >= 0) {
      return parts.slice(0, moduleIndex + 2).join('/');
    }
    // Fallback to first 2 directory levels
    return parts.slice(0, 2).join('/');
  }

  /**
   * Find all callsites that use the changed functions
   * Combines local AST-based detection with remote API search results
   */
  private async findImpactedCallsites(
    changedFunctions: ChangedFunction[],
    dependencyMap: any,
    repositoryId: string,
    prNumber: number,
    remoteCallsitesMap?: Map<string, ImpactedCallsite[]>,
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
            detectionSource: 'AST' as const,
          },
        }));

        impactedCallsites.push(...impactedCalls);

        // Use pre-fetched remote callsites (from Step 2) instead of fetching again
        const remoteCallsites =
          remoteCallsitesMap?.get(changedFunction.name) || [];
        impactedCallsites.push(...remoteCallsites);
      } catch (error) {
        console.error(
          `Error finding callsites for ${changedFunction.name}:`,
          error,
        );
      }
    }

    return this.deduplicateCallsites(impactedCallsites);
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

  private async fetchRemoteCallsites(
    changedFunction: ChangedFunction,
    repositoryId: string,
    prNumber: number,
  ): Promise<ImpactedCallsite[]> {
    try {
      const matches = await this.remoteCodeSearch.searchFunctionReferences({
        repositoryId,
        functionName: changedFunction.name,
        filePath: changedFunction.file,
        prNumber,
        codeType: changedFunction.codeType,
      });

      return matches.map((match) =>
        this.convertRemoteMatchToCallsite(match, changedFunction),
      );
    } catch (error) {
      console.error(
        `Remote code search failed for ${changedFunction.name}:`,
        error,
      );
      return [];
    }
  }

  private convertRemoteMatchToCallsite(
    match: RemoteCodeMatch,
    changedFunction: ChangedFunction,
  ): ImpactedCallsite {
    const isSameDirectory = this.pathsShareDirectory(
      match.filePath,
      changedFunction.file,
    );
    const isSameModule = this.pathsShareModule(
      match.filePath,
      changedFunction.file,
    );

    const provider =
      match.provider === RepositoryProvider.GITHUB ? 'GITHUB' : 'BITBUCKET';

    return {
      functionName: changedFunction.name,
      file: match.filePath,
      line: match.line,
      callCode: match.snippet,
      callType: 'REMOTE_SEARCH',
      compatibilityStatus:
        changedFunction.changeType === 'REMOVED' ? 'WILL_BREAK' : 'MIGHT_BREAK',
      breakageReason:
        changedFunction.changeType === 'REMOVED'
          ? 'Function removed but remote usage detected'
          : 'Potential downstream usage detected via remote search',
      requiredFix:
        changedFunction.changeType === 'REMOVED'
          ? 'Remove or replace usage in referenced file'
          : undefined,
      priority:
        changedFunction.impactScope === 'SYSTEM' ? 'HIGH' : ('MEDIUM' as const),
      estimatedFixTime:
        changedFunction.changeType === 'REMOVED' ? '30 minutes' : '15 minutes',
      context: {
        importPath: undefined,
        callFrequency: 'MODERATE',
        callContext: 'Remote repository usage',
        isInSameDirectory: isSameDirectory,
        isInSameModule: isSameModule,
        branchName: match.branch,
        provider,
        matchUrl: match.url,
        detectionSource: 'REMOTE_SEARCH' as const,
      },
    };
  }

  private deduplicateCallsites(
    callsites: ImpactedCallsite[],
  ): ImpactedCallsite[] {
    const seen = new Set<string>();
    const unique: ImpactedCallsite[] = [];

    for (const callsite of callsites) {
      const key = `${callsite.functionName}:${this.normalizePath(callsite.file)}:${callsite.line}:${callsite.callType}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(callsite);
    }

    return unique;
  }

  private pathsShareDirectory(pathA: string, pathB: string): boolean {
    return (
      path.dirname(this.normalizePath(pathA)) ===
      path.dirname(this.normalizePath(pathB))
    );
  }

  private pathsShareModule(pathA: string, pathB: string): boolean {
    const normalizedA = this.normalizePath(pathA).split('/');
    const normalizedB = this.normalizePath(pathB).split('/');

    while (normalizedA.length && normalizedB.length) {
      const segmentA = normalizedA.shift();
      const segmentB = normalizedB.shift();

      if (segmentA !== segmentB) {
        return false;
      }
    }

    return true;
  }

  private normalizePath(filePath: string): string {
    return path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
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
