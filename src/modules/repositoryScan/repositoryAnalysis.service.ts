import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountCredentialsType } from '@prisma/client';
import axios from 'axios';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import { BillingService } from '../billing/billing.service';
import { CommentService } from '../comment/comment.service';
import { SeniorEngineerAnalysisService } from './seniorEngineerAnalysis.service';

export interface AnalysisContext {
  repositoryId: string;
  repositoryScanId: string;
  repository: any;
  documentedFiles: any[];
  accountCredentials: any;
  accountId: string;
}

export interface QueryAnalysisRequest {
  repositoryId: string;
  query: string;
  accountId: string;
  threadId?: string;
  analysisMode?:
    | 'standard'
    | 'senior'
    | 'code_review'
    | 'architecture'
    | 'release_analysis';
  includeTracing?: boolean;
  streamProgress?: (step: string, message: string, data?: any) => void;
  streamTextChunk?: (chunk: string) => void;
}

export interface QueryAnalysisResponse {
  answer: string;
  context: any[];
  summary?: string;
  threadId?: string;
  traceData?: AnalysisTrace;
  resourceAnalysis?: ResourceAnalysis;
  codeInsights?: CodeInsights;
  architecturalGuidance?: ArchitecturalGuidance;
  releaseAnalysis?: ReleaseAnalysis;
}

export interface AnalysisTrace {
  executionPath: string[];
  decisionPoints: DecisionPoint[];
  performanceMetrics: PerformanceMetrics;
  resourcesAnalyzed: string[];
  analysisDepth: number;
}

export interface DecisionPoint {
  step: string;
  reasoning: string;
  alternatives: string[];
  chosenPath: string;
  confidence: number;
}

export interface PerformanceMetrics {
  totalTime: number;
  aiCallsCount: number;
  filesAnalyzed: number;
  embeddingTime: number;
  analysisTime: number;
}

export interface ResourceAnalysis {
  keyResources: IdentifiedResource[];
  dependencies: DependencyMap;
  patterns: ArchitecturalPattern[];
  codeQuality: CodeQualityMetrics;
}

export interface IdentifiedResource {
  type:
    | 'controller'
    | 'service'
    | 'model'
    | 'utility'
    | 'config'
    | 'middleware';
  name: string;
  path: string;
  importance: number;
  relationships: string[];
  businessValue: string;
  technicalDebt?: TechnicalDebt;
}

export interface DependencyMap {
  directDependencies: string[];
  indirectDependencies: string[];
  circularDependencies: string[];
  unusedDependencies: string[];
}

export interface ArchitecturalPattern {
  pattern: string;
  confidence: number;
  evidence: string[];
  recommendations: string[];
}

export interface CodeQualityMetrics {
  complexity: number;
  maintainability: number;
  testCoverage: number;
  codeSmells: string[];
  securityIssues: string[];
}

export interface TechnicalDebt {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  estimatedEffort: string;
  impact: string;
}

export interface CodeInsights {
  refactoringOpportunities: RefactoringOpportunity[];
  performanceOptimizations: PerformanceOptimization[];
  bestPracticeViolations: BestPracticeViolation[];
  securityVulnerabilities: SecurityVulnerability[];
}

export interface RefactoringOpportunity {
  type: string;
  file: string;
  line?: number;
  description: string;
  suggestion: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
}

export interface PerformanceOptimization {
  category: string;
  description: string;
  currentIssue: string;
  solution: string;
  expectedImprovement: string;
}

export interface BestPracticeViolation {
  practice: string;
  violation: string;
  file: string;
  line?: number;
  correction: string;
}

export interface SecurityVulnerability {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  description: string;
  file: string;
  line?: number;
  mitigation: string;
}

export interface ArchitecturalGuidance {
  currentArchitecture: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: ArchitecturalRecommendation[];
  futureModuleGuidance: ModuleGuidance;
}

export interface ArchitecturalRecommendation {
  category: string;
  priority: 'low' | 'medium' | 'high';
  description: string;
  implementation: string;
  benefits: string[];
}

export interface ModuleGuidance {
  recommendedStructure: string;
  namingConventions: string[];
  integrationPatterns: string[];
  testingStrategy: string;
}

export interface PreviousMessage {
  question: string;
  summary: any;
  isDetailed: boolean;
  answer?: any; // Only present when isDetailed is true
}

export interface ReleaseAnalysis {
  commitsSummary: CommitSummary[];
  releaseHighlights: ReleaseHighlight[];
  contributorActivity: ContributorActivity[];
  impactAnalysis: ReleaseImpact;
  changeTimeline: ChangeTimelineEntry[];
}

export interface CommitSummary {
  commitId: string;
  commitMessage: string;
  committer: string;
  timestamp: Date;
  additions: number;
  deletions: number;
  filesChanged: number;
  summary: any;
  impact: 'low' | 'medium' | 'high';
}

export interface ReleaseHighlight {
  category: 'feature' | 'bugfix' | 'performance' | 'security' | 'refactor';
  description: string;
  commits: string[];
  impact: string;
  filesAffected: string[];
}

export interface ContributorActivity {
  committer: string;
  commitCount: number;
  linesAdded: number;
  linesRemoved: number;
  impactScore: number;
  keyContributions: string[];
}

export interface ReleaseImpact {
  overallScope: 'minor' | 'major' | 'patch';
  criticalAreas: string[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendedActions: string[];
}

export interface ChangeTimelineEntry {
  date: Date;
  commits: string[];
  summary: string;
  contributor: string;
}

@Injectable()
export class RepositoryAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commentService: CommentService,
    private readonly accountCredentialService: AccountCredentialService,
    private readonly billingService: BillingService,
    private readonly seniorEngineerAnalysisService: SeniorEngineerAnalysisService,
  ) {}

  /**
   * Main entry point for repository analysis with senior engineer capabilities
   */
  async analyzeRepository(
    request: QueryAnalysisRequest,
  ): Promise<QueryAnalysisResponse> {
    const startTime = Date.now();
    const trace: AnalysisTrace = {
      executionPath: ['analyzeRepository'],
      decisionPoints: [],
      performanceMetrics: {
        totalTime: 0,
        aiCallsCount: 0,
        filesAnalyzed: 0,
        embeddingTime: 0,
        analysisTime: 0,
      },
      resourcesAnalyzed: [],
      analysisDepth: 0,
    };

    try {
      console.log(
        `[analyzeRepository] Processing query: "${request.query}" with mode: ${request.analysisMode || 'standard'}`,
      );

      // Validate and prepare analysis context
      const context = await this.prepareAnalysisContext(request);
      trace.executionPath.push('prepareAnalysisContext');

      // Enhance query with thread context
      const enhancedQuery = await this.enhanceQueryWithContext(
        request.query,
        request.threadId,
      );
      trace.executionPath.push('enhanceQueryWithContext');

      // Progress update for analysis
      if (request.streamProgress) {
        request.streamProgress(
          'processing',
          'Processing query with AI analysis...',
        );
      }

      // Categorize query type with enhanced AI analysis
      const gemini = new Gemini();
      const queryType = await this.categorizeQueryWithSeniorAnalysis(
        enhancedQuery,
        !!request.threadId,
        request.analysisMode || 'standard',
        gemini,
        trace,
      );
      trace.performanceMetrics.aiCallsCount++;

      // Progress update for analysis phase
      if (request.streamProgress) {
        request.streamProgress('analyzing', 'Analyzing codebase with AI...');
      }

      // Process based on query type
      let response: QueryAnalysisResponse;
      switch (queryType) {
        case 'performance':
          response = await this.handlePerformanceAnalysis(
            request.query,
            enhancedQuery,
            context,
            request.threadId,
            trace,
          );
          break;
        case 'release':
          response = await this.handleReleaseAnalysis(
            request.query,
            enhancedQuery,
            context,
            request.threadId,
            trace,
          );
          break;
        default:
          response = await this.routeQueryToEnhancedHandler(
            queryType,
            request.query,
            enhancedQuery,
            context,
            request.threadId,
            request.analysisMode || 'standard',
            trace,
            request.streamProgress,
            request.streamTextChunk,
          );
      }

      // Update trace metrics
      trace.performanceMetrics.totalTime = Date.now() - startTime;
      return response;
    } catch (error) {
      console.error(`[analyzeRepository] Error:`, error);
      throw error;
    }
  }

  /**
   * Enhanced query categorization with senior analysis capabilities
   */
  private async categorizeQueryWithSeniorAnalysis(
    enhancedQuery: string,
    hasThread: boolean,
    analysisMode: string,
    gemini: Gemini,
    trace: AnalysisTrace,
  ): Promise<string> {
    trace.executionPath.push('categorizeQueryWithSeniorAnalysis');

    const seniorPrompt = `
As a senior fullstack engineer, analyze this query and categorize it with deep technical understanding:

Query: "${enhancedQuery}"
Analysis Mode: ${analysisMode}
Has Thread Context: ${hasThread}

Consider these enhanced categories:
- ARCHITECTURAL_REVIEW: Questions about system architecture, design patterns, scalability
- CODE_REVIEW: Code quality, refactoring, best practices
- PERFORMANCE_ANALYSIS: Performance bottlenecks, optimization opportunities
- SECURITY_AUDIT: Security vulnerabilities, best practices
- MODULE_DESIGN: New feature/module design guidance
- TECHNICAL_DEBT: Legacy code analysis, modernization suggestions
- RELEASE_ANALYSIS: Questions about commits, releases, changes, contributors, recent updates
- FOLLOW_UP: Contextual follow-up questions
- USER_FLOW: User journey and business logic analysis
- FUNCTION_TRACE: Deep code tracing and debugging
- PROJECT_LEVEL: High-level project understanding

Return the most appropriate category that allows for the deepest technical analysis.
`;

    const category = await gemini.categorizeQueryType(seniorPrompt, hasThread);

    console.log(
      `[categorizeQueryWithSeniorAnalysis] Categorized as ${category}`,
    );
    trace.decisionPoints.push({
      step: 'query_categorization',
      reasoning: `Categorized as ${category} based on query content and analysis mode`,
      alternatives: [
        'FOLLOW_UP',
        'USER_FLOW',
        'FUNCTION_TRACE',
        'PROJECT_LEVEL',
        'RELEASE_ANALYSIS',
      ],
      chosenPath: category,
      confidence: 0.85,
    });

    console.log(
      `[categorizeQueryWithSeniorAnalysis] Categorized as ${category}`,
    );

    return category;
  }

  /**
   * Prepare analysis context with repository data and validation
   */
  private async prepareAnalysisContext(
    request: QueryAnalysisRequest,
  ): Promise<AnalysisContext> {
    // Get organization ID and validate permissions
    const repositoryBasic = await this.prisma.repository.findUnique({
      where: { id: request.repositoryId },
      select: { organizationId: true },
    });

    if (!repositoryBasic?.organizationId) {
      throw new NotFoundException('Repository or organization not found');
    }

    // Check billing limits
    const canAskResult = await this.billingService.canAskQuestion(
      repositoryBasic.organizationId,
    );
    if (!canAskResult.canAsk) {
      throw new BadRequestException(canAskResult.reason);
    }

    // Get repository details
    const repository = await this.prisma.repository.findUnique({
      where: { id: request.repositoryId },
      include: { repositorySettings: true },
    });

    if (!repository) {
      throw new Error(`Repository "${request.repositoryId}" not found.`);
    }

    const organizationAccount =
      await this.prisma.organizationAccounts.findFirst({
        where: { role: 'ADMIN', organizationId: repository.organizationId },
        include: { account: true },
      });
    request['accountId'] = organizationAccount.accountId;

    // Get account credentials
    const accountCredentials =
      await this.accountCredentialService.getAccountToken({
        accountId: request.accountId,
      });

    // Get latest repository scan
    const repositoryScan = await this.prisma.repositoryScan.findFirst({
      where: { repositoryId: request.repositoryId },
      orderBy: { createdAt: 'desc' },
    });

    if (!repositoryScan) {
      throw new Error('No repository scan found');
    }

    // Get documented files
    const documentedFiles = await this.prisma.fileDocumentation.findMany({
      where: { repositoryScanId: repositoryScan.id },
      include: { repository: true },
    });

    return {
      repositoryId: request.repositoryId,
      repositoryScanId: repositoryScan.id,
      repository,
      documentedFiles,
      accountCredentials,
      accountId: request.accountId,
    };
  }

  /**
   * Enhance query with thread context
   */
  private async enhanceQueryWithContext(
    query: string,
    threadId?: string,
  ): Promise<string> {
    let enhancedQuery = '';

    if (threadId) {
      const thread = await this.prisma.thread.findUnique({
        where: { id: threadId },
        include: { questions: true },
      });

      if (thread) {
        enhancedQuery += `\n\nPrevious Questions:\n`;
        thread.questions
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 10)
          .forEach((q, index) => {
            const answer =
              index < 4
                ? (q.answer as any)?.response
                : (q.answer as any)?.summary;
            enhancedQuery += `\n Question: ${q.question}\n Answer: ${answer} `;
          });
      }
    }

    enhancedQuery += `\n\nNew Question: ${query}`;
    return enhancedQuery;
  }

  /**
   * Route query to appropriate handler based on type
   */
  private async routeQueryToHandler(
    queryType: string,
    originalQuery: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
  ): Promise<QueryAnalysisResponse> {
    switch (queryType) {
      case 'FOLLOW_UP':
        return await this.handleFollowUpQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
        );
      case 'USER_FLOW':
        return await this.handleUserFlowQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
        );
      case 'FUNCTION_TRACE':
        return await this.handleFunctionTraceQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
        );
      case 'PROJECT_LEVEL':
        return await this.handleProjectLevelQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
        );
      default:
        return await this.handleSemanticSearchFallback(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
        );
    }
  }

  /**
   * Route query to appropriate enhanced handler with streaming support
   */
  private async routeQueryToEnhancedHandler(
    queryType: string,
    originalQuery: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    analysisMode: string = 'standard',
    trace?: AnalysisTrace,
    streamProgress?: (step: string, message: string, data?: any) => void,
    streamTextChunk?: (chunk: string) => void,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('routeQueryToEnhancedHandler');

    switch (queryType) {
      case 'architectural_review':
        return await this.handleArchitecturalReview(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          trace,
        );
      case 'code_review':
        return await this.handleCodeReview(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          trace,
        );
      case 'performance_analysis':
        return await this.handlePerformanceAnalysis(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          trace,
        );
      case 'security_audit':
        return await this.handleSecurityAudit(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          trace,
        );
      case 'module_design':
        return await this.handleModuleDesign(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          trace,
        );
      case 'technical_debt':
        return await this.handleTechnicalDebtAnalysis(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          trace,
        );
      case 'release_analysis':
        return await this.handleReleaseAnalysis(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          trace,
        );
      case 'follow_up':
        return await this.handleEnhancedFollowUpQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          analysisMode,
          trace,
        );
      case 'user_flow':
        return await this.handleEnhancedUserFlowQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          analysisMode,
          trace,
        );
      case 'function_trace':
        return await this.handleEnhancedFunctionTraceQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          analysisMode,
          trace,
        );
      case 'project_level':
      default:
        return await this.handleEnhancedProjectLevelQuery(
          originalQuery,
          enhancedQuery,
          context,
          threadId,
          analysisMode,
          trace,
          streamTextChunk,
        );
    }
  }

  /**
   * Handle architectural review queries with senior expertise
   */
  private async handleArchitecturalReview(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleArchitecturalReview');

    console.log(
      `[handleArchitecturalReview] Conducting architectural analysis`,
    );

    // Get comprehensive project files for architectural analysis
    const architecturalFiles = await this.findArchitecturalFiles(
      context.repositoryScanId,
    );
    const configFiles = await this.findConfigurationFiles(
      context.repositoryScanId,
    );
    const coreFiles = await this.findCoreApplicationFiles(
      context.repositoryScanId,
    );

    const allFiles = [...architecturalFiles, ...configFiles, ...coreFiles];
    trace?.resourcesAnalyzed.push(...allFiles.map((f) => f.fullPath));
    if (trace) {
      trace.performanceMetrics.filesAnalyzed = allFiles.length;
    }

    const filesWithCode = await this.fetchFilesWithCode(allFiles, context);

    // Analyze architecture patterns
    const resourceAnalysis =
      await this.seniorEngineerAnalysisService.analyzeResourcesAndPatterns(
        filesWithCode,
        context,
      );
    const architecturalGuidance =
      await this.seniorEngineerAnalysisService.generateArchitecturalGuidance(
        filesWithCode,
        query,
        context,
      );

    const gemini = new Gemini();
    const architecturalPrompt =
      this.seniorEngineerAnalysisService.buildArchitecturalReviewPrompt(
        query,
        resourceAnalysis,
      );

    const queryResponse = await gemini.generateAnswer(
      architecturalPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount++;
    }

    const response =
      await this.seniorEngineerAnalysisService.createEnhancedAssistanceResponse(
        query,
        queryResponse,
        context,
        threadId,
        {
          resourceAnalysis,
          architecturalGuidance,
        },
        this,
      );

    return response;
  }

  /**
   * Handle code review queries with detailed analysis
   */
  private async handleCodeReview(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleCodeReview');

    console.log(`[handleCodeReview] Conducting code review analysis`);

    // Find relevant files for code review
    const gemini = new Gemini();
    const embedding = await gemini.getEmbeddings(query);
    const vectorQuery = `[${embedding.join(',')}]`;

    const semanticResults = await this.performSemanticSearch(
      vectorQuery,
      context.repositoryScanId,
      8,
    );

    const relevantFiles = await this.prisma.fileDocumentation.findMany({
      where: { id: { in: semanticResults.map((r) => r.id) } },
    });

    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    // Perform code quality analysis
    const codeInsights =
      await this.seniorEngineerAnalysisService.analyzeCodeQuality(
        filesWithCode,
        context,
      );

    const codeReviewPrompt =
      this.seniorEngineerAnalysisService.buildCodeReviewPrompt(
        query,
        codeInsights,
      );
    const queryResponse = await gemini.generateAnswer(
      codeReviewPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount += 2;
    }

    const response =
      await this.seniorEngineerAnalysisService.createEnhancedAssistanceResponse(
        query,
        queryResponse,
        context,
        threadId,
        {
          codeInsights,
        },
        this,
      );

    return response;
  }

  /**
   * Handle performance analysis queries
   */
  private async handlePerformanceAnalysis(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handlePerformanceAnalysis');

    console.log(`[handlePerformanceAnalysis] Analyzing performance aspects`);

    // Find performance-critical files
    const performanceFiles = await this.findPerformanceCriticalFiles(
      context.repositoryScanId,
    );
    const filesWithCode = await this.fetchFilesWithCode(
      performanceFiles,
      context,
    );

    // Analyze performance optimizations
    const codeInsights =
      await this.seniorEngineerAnalysisService.analyzePerformanceOptimizations(
        filesWithCode,
        context,
      );

    const gemini = new Gemini();
    const performancePrompt =
      this.seniorEngineerAnalysisService.buildPerformanceAnalysisPrompt(
        query,
        codeInsights,
      );
    const queryResponse = await gemini.generateAnswer(
      performancePrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount++;
    }

    const response =
      await this.seniorEngineerAnalysisService.createEnhancedAssistanceResponse(
        query,
        queryResponse,
        context,
        threadId,
        { codeInsights },
        this,
      );

    return response;
  }

  /**
   * Handle security audit queries
   */
  private async handleSecurityAudit(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleSecurityAudit');

    console.log(`[handleSecurityAudit] Conducting security analysis`);

    // Find security-relevant files
    const securityFiles = await this.findSecurityRelevantFiles(
      context.repositoryScanId,
    );
    const filesWithCode = await this.fetchFilesWithCode(securityFiles, context);

    // Analyze security vulnerabilities
    const codeInsights =
      await this.seniorEngineerAnalysisService.analyzeSecurityVulnerabilities(
        filesWithCode,
        context,
      );

    const gemini = new Gemini();
    const securityPrompt =
      this.seniorEngineerAnalysisService.buildSecurityAuditPrompt(
        query,
        codeInsights,
      );
    const queryResponse = await gemini.generateAnswer(
      securityPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount++;
    }

    const response =
      await this.seniorEngineerAnalysisService.createEnhancedAssistanceResponse(
        query,
        queryResponse,
        context,
        threadId,
        { codeInsights },
        this,
      );

    return response;
  }

  /**
   * Handle module design guidance
   */
  private async handleModuleDesign(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleModuleDesign');

    console.log(`[handleModuleDesign] Providing module design guidance`);

    // Analyze existing project structure
    const projectFiles = await this.findProjectLevelFiles(
      context.repositoryScanId,
    );
    const filesWithCode = await this.fetchFilesWithCode(projectFiles, context);

    // Generate architectural guidance for new modules
    const architecturalGuidance =
      await this.seniorEngineerAnalysisService.generateModuleDesignGuidance(
        filesWithCode,
        query,
        context,
      );

    const gemini = new Gemini();
    const moduleDesignPrompt =
      this.seniorEngineerAnalysisService.buildModuleDesignPrompt(
        query,
        architecturalGuidance,
      );
    const queryResponse = await gemini.generateAnswer(
      moduleDesignPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount++;
    }

    const response =
      await this.seniorEngineerAnalysisService.createEnhancedAssistanceResponse(
        query,
        queryResponse,
        context,
        threadId,
        { architecturalGuidance },
        this,
      );

    return response;
  }

  /**
   * Handle technical debt analysis
   */
  private async handleTechnicalDebtAnalysis(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleTechnicalDebtAnalysis');

    console.log(`[handleTechnicalDebtAnalysis] Analyzing technical debt`);

    // Find files that might contain technical debt
    const allFiles = await this.findAllProjectFiles(context.repositoryScanId);

    // Use AI to filter files that likely contain technical debt
    const gemini = new Gemini();
    const fileQuickInfo = allFiles.map((data) => this.mapFileToQuickInfo(data));
    const filteredFiles = await gemini.filterRelevantFiles(
      `technical debt, legacy code, code smells, outdated patterns: ${query}`,
      fileQuickInfo,
    );

    const relevantFiles = allFiles.filter((data) => {
      const mappedData = this.mapDocumentFields(data);
      return filteredFiles.output.some(
        (file) => file.fileName === mappedData.fileName,
      );
    });

    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    // Analyze technical debt
    const resourceAnalysis =
      await this.seniorEngineerAnalysisService.analyzeTechnicalDebt(
        filesWithCode,
        context,
      );

    const technicalDebtPrompt =
      this.seniorEngineerAnalysisService.buildTechnicalDebtPrompt(
        query,
        resourceAnalysis,
      );
    const queryResponse = await gemini.generateAnswer(
      technicalDebtPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount += 2;
    }

    const response =
      await this.seniorEngineerAnalysisService.createEnhancedAssistanceResponse(
        query,
        queryResponse,
        context,
        threadId,
        { resourceAnalysis },
        this,
      );

    return response;
  }

  /**
   * Handle release analysis queries
   */
  private async handleReleaseAnalysis(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleReleaseAnalysis');

    try {
      // Get previous conversation context if this is a follow-up
      let previousContext = '';
      if (threadId) {
        const previousMessages = await this.getPreviousMessages(threadId);
        if (previousMessages.length > 0) {
          previousContext = previousMessages
            .map((msg) => {
              const answer = msg.isDetailed ? msg.answer : msg.summary;
              return `Q: ${msg.question}\nA: ${answer}`;
            })
            .join('\n\n');
        }
      }

      // Optimize commit fetching by adding specific fields selection
      const recentCommits = await this.prisma.commitSummary.findMany({
        where: {
          repositoryId: context.repository.repositoryId,
        },
        select: {
          commitMessage: true,
          committer: true,
          additions: true,
          deletions: true,
          totalFiles: true,
          createdAt: true,
          summary: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      if (recentCommits.length === 0) {
        return await this.handleEnhancedProjectLevelQuery(
          query,
          enhancedQuery,
          context,
          threadId,
          'standard',
          trace,
        );
      }

      // Only perform semantic search if explicitly needed or if it's a follow-up question
      let relevantCommits = recentCommits;
      const needsSemanticSearch =
        /specific|about|related to|regarding|concerning/i.test(query) ||
        (previousContext && /commit|change|update|fix|feature/i.test(query));

      if (needsSemanticSearch) {
        const gemini = new Gemini();
        try {
          // Include previous context in embedding if it exists
          const searchQuery = previousContext
            ? `${previousContext}\n\nFollow-up: ${query}`
            : query;

          const embedding = await gemini.getEmbeddings(searchQuery);
          const vectorQuery = `[${embedding.join(',')}]`;
          const semanticResults = await this.performCommitSemanticSearch(
            vectorQuery,
            context.repository.repositoryId,
            5,
          );
          if (semanticResults.length > 0) {
            relevantCommits = semanticResults;
          }
        } catch (error) {
          console.warn('Semantic search failed, using recent commits:', error);
        }
      }

      // Optimize file fetching
      const releaseFiles = await this.findReleaseFiles(
        context.repositoryScanId,
      );
      const filesWithCode = await this.fetchFilesWithCode(
        releaseFiles.slice(0, 5),
        context,
      );

      // Build prompt with context awareness
      const releasePrompt = `
${previousContext ? `Previous conversation:\n${previousContext}\n\nFollow-up question: "${query}"\n` : `New question: "${query}"\n`}

Analyze these ${relevantCommits.length} commits:

${relevantCommits
  .map(
    (
      commit,
    ) => `• ${commit.commitMessage.split('\n')[0]} (${commit.committer}) | +${commit.additions}/-${commit.deletions} in ${commit.totalFiles} files
`,
  )
  .join('')}

${
  previousContext
    ? 'Provide a focused answer to the follow-up question, using context from the previous conversation and these commits.'
    : `Provide a concise analysis focusing on:
1. Key changes and their impact
2. Main contributors
3. Most affected areas
4. Notable patterns`
}

Keep the response focused and practical.`;

      const gemini = new Gemini();
      const queryResponse = await gemini.generateAnswer(
        releasePrompt,
        filesWithCode,
        enhancedQuery,
      );

      if (trace) {
        trace.performanceMetrics.aiCallsCount++;
      }

      return await this.createEnhancedAssistanceResponse(
        query,
        queryResponse,
        context,
        this,
        threadId,
        null,
      );
    } catch (error) {
      console.error('Error in handleReleaseAnalysis:', error);
      return await this.handleEnhancedProjectLevelQuery(
        query,
        enhancedQuery,
        context,
        threadId,
        'standard',
        trace,
      );
    }
  }

  // Helper methods

  private async getPreviousMessages(
    threadId: string,
  ): Promise<PreviousMessage[]> {
    // Ensure threadId is valid before making database query
    if (!threadId || threadId === 'undefined' || threadId === 'null') {
      console.log(
        'Invalid threadId provided to getPreviousMessages:',
        threadId,
      );
      return [];
    }

    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        questions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!thread) {
      console.log(`Thread not found for ID: ${threadId}`);
      return [];
    }

    const recentMessages = thread.questions.slice(0, 5);
    const olderMessages = thread.questions.slice(5, 10);

    return [
      ...recentMessages.map(
        (q): PreviousMessage => ({
          question: q.question,
          answer: q.answer as any,
          summary: q.summary,
          isDetailed: true,
        }),
      ),
      ...olderMessages.map(
        (q): PreviousMessage => ({
          question: q.question,
          summary: q.summary || (q.answer as any),
          isDetailed: false,
        }),
      ),
    ];
  }

  private async performSemanticSearch(
    vectorQuery: string,
    repositoryScanId: string,
    limit: number,
  ) {
    return (await this.prisma.$queryRaw`
      SELECT id, name, "fullPath", summary 
      FROM "FileDocumentation" 
      WHERE "repositoryScanId" = ${repositoryScanId}
      ORDER BY "summaryEmbedding" <=> ${vectorQuery}::vector 
      LIMIT ${limit}
    `) as any[];
  }

  private async findUserFlowFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          {
            fileType: {
              hasSome: ['CONTROLLER', 'ROUTER', 'API', 'COMPONENT', 'SERVICE'],
            },
          },
          { fullPath: { contains: 'auth', mode: 'insensitive' } },
          { fullPath: { contains: 'user', mode: 'insensitive' } },
          { fullPath: { contains: 'login', mode: 'insensitive' } },
          { fullPath: { contains: 'signup', mode: 'insensitive' } },
          { fullPath: { contains: 'register', mode: 'insensitive' } },
          { fullPath: { contains: 'profile', mode: 'insensitive' } },
          { fullPath: { contains: 'account', mode: 'insensitive' } },
          { fullPath: { contains: 'route', mode: 'insensitive' } },
          { fullPath: { contains: 'flow', mode: 'insensitive' } },
          { name: { contains: 'auth', mode: 'insensitive' } },
          { name: { contains: 'user', mode: 'insensitive' } },
          { name: { contains: 'login', mode: 'insensitive' } },
          { name: { contains: 'signup', mode: 'insensitive' } },
          { name: { contains: 'register', mode: 'insensitive' } },
          { name: { contains: 'profile', mode: 'insensitive' } },
          { name: { contains: 'account', mode: 'insensitive' } },
          { name: { contains: 'route', mode: 'insensitive' } },
          { name: { contains: 'flow', mode: 'insensitive' } },
        ],
      },
    });
  }

  private async findEntryPointFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { name: { contains: 'main', mode: 'insensitive' } },
          { name: { contains: 'app', mode: 'insensitive' } },
          { name: { contains: 'index', mode: 'insensitive' } },
          { name: { contains: 'server', mode: 'insensitive' } },
        ],
      },
    });
  }

  private async findSpecificFile(filePath: string, repositoryScanId: string) {
    const exactFile = await this.prisma.fileDocumentation.findFirst({
      where: {
        repositoryScanId,
        OR: [
          { fullPath: filePath },
          { name: filePath },
          { fullPath: { contains: filePath, mode: 'insensitive' } },
          { name: { contains: filePath, mode: 'insensitive' } },
        ],
      },
    });

    return exactFile ? [exactFile] : [];
  }

  private async findRelatedFiles(
    relevantFiles: any[],
    repositoryScanId: string,
  ) {
    const importedFileNames = new Set<string>();
    const filesThatMightImport = new Set<string>();

    relevantFiles.forEach((file) => {
      if (Array.isArray(file.imports)) {
        file.imports.forEach((imp: string) => {
          const filename = imp.split('/').pop();
          if (filename) importedFileNames.add(filename);
        });
      }
      if (file.name) {
        filesThatMightImport.add(file.name);
      }
    });

    if (importedFileNames.size > 0 || filesThatMightImport.size > 0) {
      const relatedFiles = await this.prisma.fileDocumentation.findMany({
        where: {
          repositoryScanId,
          OR: [
            { name: { in: Array.from(importedFileNames) } },
            { imports: { hasSome: Array.from(filesThatMightImport) } },
          ],
        },
      });

      const existingIds = new Set(relevantFiles.map((f) => f.id));
      relatedFiles.forEach((file) => {
        if (!existingIds.has(file.id)) {
          relevantFiles.push(file);
        }
      });

      return relevantFiles.slice(0, 6);
    }

    return relevantFiles;
  }

  private async findProjectLevelFiles(repositoryScanId: string) {
    const relatedTags = [
      'PROJECT_SETUP',
      'SERVICE',
      'API',
      'CONTROLLER',
      'ROUTER',
      'MAIN',
      'INDEX',
      'APP',
      'SERVER',
      'DOCUMENTATION',
      'UTILITY',
      'MODEL',
      'SCHEMA',
      'CONFIG',
    ];

    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        fileType: { hasSome: relatedTags },
      },
    });
  }

  private async findSchemaModelFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { name: { contains: 'schema', mode: 'insensitive' } },
          { name: { contains: 'model', mode: 'insensitive' } },
          { name: { contains: 'entity', mode: 'insensitive' } },
          { name: { contains: 'prisma', mode: 'insensitive' } },
          { fullPath: { contains: 'schema', mode: 'insensitive' } },
          { fullPath: { contains: 'model', mode: 'insensitive' } },
          { fullPath: { contains: 'entity', mode: 'insensitive' } },
          { fullPath: { contains: 'types', mode: 'insensitive' } },
          { fullPath: { contains: 'db', mode: 'insensitive' } },
          { fullPath: { contains: 'database', mode: 'insensitive' } },
          { fullPath: { contains: 'prisma', mode: 'insensitive' } },
        ],
      },
    });
  }

  private async findEssentialProjectFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { name: { equals: 'README.md', mode: 'insensitive' } },
          { name: { equals: 'package.json', mode: 'insensitive' } },
          { name: { equals: 'schema.prisma', mode: 'insensitive' } },
          { name: { equals: 'tsconfig.json', mode: 'insensitive' } },
          { fullPath: { endsWith: 'README.md', mode: 'insensitive' } },
        ],
      },
    });
  }

  private async fetchFilesWithCode(files: any[], context: AnalysisContext) {
    const sourceCodeResponses = await this.fetchSourceCodeForFiles(
      files,
      context.documentedFiles,
      context.accountCredentials,
    );

    return sourceCodeResponses.map((res, index) => ({
      summary: files[index].summary,
      fileName: files[index].name,
      sourceCode: this.normalizeSourceCode(res?.data),
      functions: files[index].functions || [],
      imports: files[index].imports || [],
      exports: files[index].exports || [],
    }));
  }

  /**
   * Normalize sourceCode to ensure it's always a string
   */
  private normalizeSourceCode(data: any): string {
    if (typeof data === 'string') {
      return data;
    }

    if (data === null || data === undefined) {
      return 'Error: File content not available';
    }

    if (typeof data === 'object') {
      try {
        return JSON.stringify(data, null, 2);
      } catch {
        return 'Error: Unable to parse file content';
      }
    }

    return String(data);
  }

  private mapFileToQuickInfo(data: any): any {
    // Map document fields based on the data structure
    return {
      fileName: data.name || '',
      filePath: data.fullPath || '',
      summary: data.summary || '',
      fileType: data.fileType || [],
    };
  }

  private buildFollowUpPrompt(
    query: string,
    previousMessages: PreviousMessage[],
  ): string {
    return `Based on the previous conversation context and the new question, analyze the code to explain: ${query}

Previous conversation context:
${previousMessages
  .map((msg) => {
    if (msg.isDetailed) {
      return `Q: ${msg.question}\nA: ${msg.answer}\n`;
    } else {
      return `Q: ${msg.question}\nSummary: ${msg.summary}\n`;
    }
  })
  .join('\n')}

Focus on connecting the new question to the previous context while analyzing the actual code implementation.`;
  }

  private buildUserFlowPrompt(query: string): string {
    return `Analyze the actual code implementation to explain exactly how ${query.replace(/\?/g, '')} - not what should happen theoretically, but what DOES happen based on the code. Follow the execution path through the files, identify the exact functions called, database operations performed, and any conditional logic followed. Include file names, line numbers, function names, and show the precise sequence of operations. DO NOT speculate about what "would" happen - analyze what DOES happen based on the actual code in these files.`;
  }

  private buildFunctionTracePrompt(query: string, filePath?: string): string {
    if (filePath) {
      return `
You are explaining a specific file in this codebase. Answer directly and practically.

Provide a clear explanation of ${filePath} including:
1. The file's purpose and role 
2. Key functions/classes/components and what they do
3. Direct dependencies (imports and files that import it)
4. How the code is used in the application

Include only the most important code snippets that help explain the file's functionality.
Don't list every import/export or mention "context provided" - focus on practical explanation.

Make your answer immediately useful to a developer trying to understand this file.
`;
    }

    const isApiQuery =
      query.toLowerCase().includes('api') ||
      query.toLowerCase().includes('endpoint') ||
      query.toLowerCase().includes('route');

    if (isApiQuery) {
      return `
You are answering a question about an API endpoint. Answer directly and practically.

The question is: "${query}"

Trace the complete API implementation showing:
1. The controller endpoint (route, HTTP method, handler)
2. The service methods it calls
3. Database operations or external service calls
4. The complete request-to-response flow

Include specific file names, function names, and important code snippets.
Don't list every import/export or mention "context provided" - focus on the actual code flow.

Your answer should help the developer understand exactly how this endpoint works.
`;
    }

    return `
You are answering a coding question. Answer directly and practically.

The question is: "${query}"

Focus on providing a clear, helpful explanation that directly addresses this question.
1. Explain the relevant code and how it works
2. Show specific examples from the codebase
3. Identify the key files and functions involved
4. Trace execution flow where relevant

Include specific file names, function names, and important code snippets.
Don't list every import/export or mention "context provided" - focus on practical explanation.

Your answer should be immediately useful to someone trying to understand this code.
`;
  }

  /**
   * Helper methods implementation
   */

  /**
   * Enhanced wrapper for createAssistanceResponse
   */
  private async createEnhancedAssistanceResponse(
    query: string,
    queryResponse: any,
    context: AnalysisContext,
    mainService: RepositoryAnalysisService,
    threadId?: string,
    analysisData?: any,
  ): Promise<QueryAnalysisResponse> {
    const baseResponse = await this.createAssistanceResponse(
      query,
      queryResponse,
      context,
      threadId,
    );

    // Add enhanced analysis data if provided
    if (analysisData) {
      return {
        ...baseResponse,
        resourceAnalysis: analysisData.resourceAnalysis,
        codeInsights: analysisData.codeInsights,
        architecturalGuidance: analysisData.architecturalGuidance,
        releaseAnalysis: analysisData.releaseAnalysis,
      };
    }

    return baseResponse;
  }

  private async fetchSourceCodeForFiles(
    files: any[],
    documentedFile: any[],
    accountCredentials: any,
    pathField: string = 'fullPath',
  ) {
    let sourceCodeMapping;

    if (
      accountCredentials.accountType === AccountCredentialsType.GITHUB_TOKEN
    ) {
      sourceCodeMapping = files.map((data) => {
        const mappedData = this.mapDocumentFields(data);
        const filePath = data[pathField] || mappedData.filePath;
        return axios.get(
          `https://raw.githubusercontent.com/${documentedFile[0].repository.owner}/${documentedFile[0].repository.name}/${documentedFile[0].repository.baseBranch}/${filePath}`,
          {
            headers: {
              Authorization: `Bearer ${accountCredentials.decryptedToken}`,
            },
          },
        );
      });
    } else {
      sourceCodeMapping = files.map((data) => {
        const mappedData = this.mapDocumentFields(data);
        const filePath = data[pathField] || mappedData.filePath;
        const payload = {
          workspace: accountCredentials.payload.workspace.replace(' ', '-'),
          repo: documentedFile[0].repository.name.replace(' ', '-'),
          branch: documentedFile[0].repository.baseBranch.replace(' ', '-'),
          token: accountCredentials.decryptedToken,
        };
        return axios.get(
          `https://api.bitbucket.org/2.0/repositories/${payload.workspace}/${payload.repo}/src/${payload.branch}/${filePath}`,
          {
            headers: {
              Authorization: `${accountCredentials.decryptedToken}`,
            },
          },
        );
      });
    }

    try {
      const results = await Promise.allSettled(sourceCodeMapping);
      return results
        .map((r, index) => {
          if (r.status === 'fulfilled') {
            return r.value;
          } else {
            console.error(
              `Error fetching file ${files[index]?.name || 'unknown'}:`,
              r.reason,
            );
            // Return a mock response with error message
            return {
              data: `Error fetching file content: ${r.reason?.message || 'Unknown error'}`,
            };
          }
        })
        .filter((r) => r !== null);
    } catch (error) {
      console.error('Error fetching source code:', error.message);
      // Return placeholder data on error to avoid breaking the flow
      return files.map((file) => ({
        data: `Error fetching file content for ${file?.name || 'unknown file'}`,
      }));
    }
  }

  private mapDocumentFields(data: any): any {
    // Map document fields based on the data structure
    return {
      fileName: data.name || '',
      filePath: data.fullPath || '',
      summary: data.summary || '',
      fileType: data.fileType || [],
    };
  }

  private async createAssistanceResponse(
    query: string,
    queryResponse: any,
    context: AnalysisContext,
    threadId?: string,
  ): Promise<QueryAnalysisResponse> {
    // Improve response formatting by removing common patterns that sound robotic
    let responseText = queryResponse?.output;

    if (responseText && typeof responseText === 'string') {
      // Remove phrases that make the response sound templated
      responseText = responseText
        .replace(/based on the provided code/gi, '')
        .replace(/the provided code shows/gi, '')
        .replace(/looking at the code/gi, '')
        .replace(/in this codebase/gi, '')
        .replace(/based on the code snippets provided/gi, '')
        .replace(/in the provided code/gi, '')
        .replace(/from the code analysis/gi, '')
        .replace(/according to the codebase/gi, '')
        .replace(/analyzing the code/gi, '')
        .replace(/after reviewing the code/gi, '')
        .replace(/examining the code/gi, '')
        .replace(/the code implements/gi, '')
        .replace(/the implementation shows/gi, '')
        .replace(/as implemented in the code/gi, '')
        .replace(/the source code demonstrates/gi, '')
        .replace(/based on the implementation/gi, '')
        .replace(/looking at the implementation/gi, '')
        .replace(/the current implementation/gi, '')
        .replace(/reviewing the implementation/gi, '')
        .replace(/examining the implementation/gi, '')
        .replace(/analyzing the implementation/gi, '')
        .replace(/as shown in the implementation/gi, '')
        .replace(/the code base/gi, '')
        .replace(/in the source code/gi, '')
        .replace(/from the source code/gi, '')
        .replace(/based on the source/gi, '')
        .replace(/looking at the source/gi, '')
        .replace(/the source shows/gi, '')
        .replace(/as shown in the source/gi, '')
        .trim();

      // Set the improved response
      queryResponse.output = responseText;
    }

    // Only create a new thread if threadId is not provided or invalid
    let validThreadId = threadId;
    if (!threadId || threadId === 'undefined' || threadId === 'null') {
      const thread = await this.prisma.thread.create({
        data: {
          title: query,
          repositoryId: context.repositoryId,
        },
      });
      validThreadId = thread.id;
      console.log(`Created new thread with ID: ${validThreadId}`);
    }

    const gemini = new Gemini();
    const responseSummary = await gemini.generateSummary(
      queryResponse.output.response.candidates[0].content.parts[0].text,
    );

    const assistedQuestionPayload = {
      question: query,
      answer: {
        response:
          queryResponse.output.response.candidates[0].content.parts[0].text,
        filteredFiles: queryResponse.filesReferenced.map((data) => ({
          name: data.fileName,
          content:
            typeof data.sourceCode === 'string'
              ? data.sourceCode
              : JSON.stringify(data.sourceCode, null, 2),
        })),
      },
      repositoryId: context.repositoryId,
      scanId: context.repositoryScanId,
      tokenUtilized:
        queryResponse.output.response.usageMetadata?.totalTokenCount || 0,
      accountId: context.accountId,
      summary: responseSummary,
      threadId: validThreadId,
    };

    await this.prisma.assistedQuestions.create({
      data: assistedQuestionPayload,
    });

    // Track usage with quota
    try {
      await this.billingService.trackUsageWithQuota({
        organizationId: context.repository.organizationId,
        repositoryId: context.repositoryId,
        type: 'ASSISTANT_QUESTION',
        description: `Question: ${query.substring(0, 50)}${query.length > 50 ? '...' : ''}`,
      });
    } catch (logError) {
      console.error('Error logging question usage:', logError);
    }

    // Format the response to be direct and concise
    let formattedResponse =
      queryResponse.output.response.candidates[0].content.parts[0].text;

    // Remove all common academic/analytical prefixes
    formattedResponse = formattedResponse
      .replace(
        /^(Based on |Looking at |From |According to |In |The |After analyzing |From the |Upon examining |As shown in |When looking at |Analysis of |Reviewing |Based on analysis of )(the |these |your |this |those )?(provided |available |given |present |analyzed |examined |supplied )?(code|files|source|codebase|implementation|source code|file structure|components|modules)/i,
        '',
      )
      .trim();

    // Also remove phrases about imports/exports/dependencies analysis
    formattedResponse = formattedResponse
      .replace(
        /^(Here's |This is |I've prepared |Following is |Below is |The following is )?(a |an |my |the )?(analysis|breakdown|overview|exploration|examination|look|summary) of (the |these |your |this |those )?(imports|exports|dependencies|file relationships|connections|module relationships)/i,
        '',
      )
      .trim();

    // Clean up any punctuation or spaces left at the beginning
    formattedResponse = formattedResponse.replace(/^[,:\s]+/, '').trim();

    // If response starts with lowercase letter after cleaning, capitalize it
    if (/^[a-z]/.test(formattedResponse)) {
      formattedResponse =
        formattedResponse.charAt(0).toUpperCase() + formattedResponse.slice(1);
    }

    return {
      answer: formattedResponse,
      context: queryResponse.filesReferenced.map((data) => ({
        name: data.fileName,
        content:
          typeof data.sourceCode === 'string'
            ? data.sourceCode
            : JSON.stringify(data.sourceCode, null, 2),
      })),
      summary: responseSummary,
      threadId: validThreadId,
    };
  }

  /**
   * Original follow-up query handler (maintained for compatibility)
   */
  private async handleFollowUpQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
  ): Promise<QueryAnalysisResponse> {
    console.log(`[handleFollowUpQuery] Processing follow-up question`);

    if (!threadId) {
      console.log('No threadId provided, falling back to PROJECT_LEVEL');
      return await this.handleProjectLevelQuery(query, enhancedQuery, context);
    }

    const previousMessages = await this.getPreviousMessages(threadId);
    if (previousMessages.length === 0) {
      console.log('No previous messages found, falling back to PROJECT_LEVEL');
      return await this.handleProjectLevelQuery(query, enhancedQuery, context);
    }

    // Get relevant files based on combined context
    const gemini = new Gemini();
    const mostRecentAnswer =
      previousMessages[0]?.isDetailed && previousMessages[0]?.answer
        ? previousMessages[0].answer
        : previousMessages[0]?.summary || '';
    const followUpEmbedding = await gemini.getEmbeddings(
      mostRecentAnswer + ' ' + query,
    );
    const followUpVectorQuery = `[${followUpEmbedding.join(',')}]`;

    const semanticSearchResults = await this.performSemanticSearch(
      followUpVectorQuery,
      context.repositoryScanId,
      5,
    );

    if (semanticSearchResults.length === 0) {
      return {
        answer: "I couldn't find relevant context for your follow-up question.",
        context: [],
      };
    }

    const relevantFiles = await this.prisma.fileDocumentation.findMany({
      where: { id: { in: semanticSearchResults.map((r) => r.id) } },
    });

    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    const followUpPrompt = this.buildFollowUpPrompt(query, previousMessages);
    const queryResponse = await gemini.generateAnswer(
      followUpPrompt,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      null,
    );
  }

  /**
   * Enhanced follow-up query handler with senior analysis
   */
  private async handleEnhancedFollowUpQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    analysisMode: string = 'standard',
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleEnhancedFollowUpQuery');

    if (!threadId) {
      return await this.handleEnhancedProjectLevelQuery(
        query,
        enhancedQuery,
        context,
        threadId,
        analysisMode,
        trace,
      );
    }

    const previousMessages = await this.getPreviousMessages(threadId);
    if (previousMessages.length === 0) {
      return await this.handleEnhancedProjectLevelQuery(
        query,
        enhancedQuery,
        context,
        threadId,
        analysisMode,
        trace,
      );
    }

    const gemini = new Gemini();
    const mostRecentAnswer =
      previousMessages[0]?.isDetailed && previousMessages[0]?.answer
        ? previousMessages[0].answer
        : previousMessages[0]?.summary || '';
    const followUpEmbedding = await gemini.getEmbeddings(
      mostRecentAnswer + ' ' + query,
    );
    const followUpVectorQuery = `[${followUpEmbedding.join(',')}]`;

    const semanticSearchResults = await this.performSemanticSearch(
      followUpVectorQuery,
      context.repositoryScanId,
      8,
    );

    const relevantFiles = await this.prisma.fileDocumentation.findMany({
      where: { id: { in: semanticSearchResults.map((r) => r.id) } },
    });

    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    // Perform enhanced analysis
    const resourceAnalysis =
      await this.seniorEngineerAnalysisService.analyzeResourcesAndPatterns(
        filesWithCode,
        context,
      );
    const codeInsights =
      await this.seniorEngineerAnalysisService.analyzeCodeQuality(
        filesWithCode,
        context,
      );

    const followUpPrompt =
      this.seniorEngineerAnalysisService.buildEnhancedFollowUpPrompt(
        query,
        previousMessages,
        analysisMode,
      );
    const queryResponse = await gemini.generateAnswer(
      followUpPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount += 2;
    }

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      { resourceAnalysis, codeInsights },
    );
  }

  /**
   * Original user flow query handler (maintained for compatibility)
   */
  private async handleUserFlowQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
  ): Promise<QueryAnalysisResponse> {
    console.log(`[handleUserFlowQuery] Processing user flow question`);

    // Find user flow related files
    const userFlowFiles = await this.findUserFlowFiles(
      context.repositoryScanId,
    );
    const entryPointFiles = await this.findEntryPointFiles(
      context.repositoryScanId,
    );

    let relevantFiles = [...userFlowFiles, ...entryPointFiles];
    console.log(
      'Found user flow files:',
      relevantFiles.map((f) => ({ name: f.name, fullPath: f.fullPath })),
    );

    // Filter relevant files using AI
    const gemini = new Gemini();
    const fileQuickInfo = relevantFiles.map((data) =>
      this.mapFileToQuickInfo(data),
    );
    const filteredFiles = await gemini.filterRelevantFiles(
      enhancedQuery,
      fileQuickInfo,
    );

    relevantFiles = relevantFiles.filter((data) => {
      const mappedData = this.mapDocumentFields(data);
      return filteredFiles.output.some(
        (file) => file.fileName === mappedData.fileName,
      );
    });

    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    const userFlowPrompt = this.buildUserFlowPrompt(query);
    const queryResponse = await gemini.generateAnswer(
      userFlowPrompt,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      null,
    );
  }

  /**
   * Enhanced user flow query handler
   */
  private async handleEnhancedUserFlowQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    analysisMode: string = 'standard',
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleEnhancedUserFlowQuery');

    const userFlowFiles = await this.findUserFlowFiles(
      context.repositoryScanId,
    );
    const entryPointFiles = await this.findEntryPointFiles(
      context.repositoryScanId,
    );
    let relevantFiles = [...userFlowFiles, ...entryPointFiles];

    const geminiFlow = new Gemini();
    const fileQuickInfo = relevantFiles.map((data) =>
      this.mapFileToQuickInfo(data),
    );
    const filteredFiles = await geminiFlow.filterRelevantFiles(
      enhancedQuery,
      fileQuickInfo,
    );

    relevantFiles = relevantFiles.filter((data) => {
      const mappedData = this.mapDocumentFields(data);
      return filteredFiles.output.some(
        (file) => file.fileName === mappedData.fileName,
      );
    });

    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    // Enhanced analysis
    const resourceAnalysis =
      await this.seniorEngineerAnalysisService.analyzeResourcesAndPatterns(
        filesWithCode,
        context,
      );
    const architecturalGuidance =
      await this.seniorEngineerAnalysisService.generateArchitecturalGuidance(
        filesWithCode,
        query,
        context,
      );

    const userFlowPrompt =
      this.seniorEngineerAnalysisService.buildEnhancedUserFlowPrompt(
        query,
        analysisMode,
      );
    const queryResponse = await geminiFlow.generateAnswer(
      userFlowPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount += 2;
    }

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      { resourceAnalysis, architecturalGuidance },
    );
  }

  /**
   * Original function trace query handler (maintained for compatibility)
   */
  private async handleFunctionTraceQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
  ): Promise<QueryAnalysisResponse> {
    console.log(
      `[handleFunctionTraceQuery] Processing function trace question`,
    );

    // Check for specific file path in query
    const filePathMatch = query.match(
      /explain\s+(\S+\.[a-z]+)|\bfile\s+(\S+\.[a-z]+)/i,
    );
    const filePath = filePathMatch
      ? filePathMatch[1] || filePathMatch[2]
      : null;

    let relevantFiles = [];

    if (filePath) {
      console.log(`Looking for specific file: ${filePath}`);
      relevantFiles = await this.findSpecificFile(
        filePath,
        context.repositoryScanId,
      );
    }

    // If no specific file found, use semantic search
    if (relevantFiles.length === 0) {
      const gemini = new Gemini();
      const embedding = await gemini.getEmbeddings(query);
      const vectorQuery = `[${embedding.join(',')}]`;

      const semanticResults = await this.performSemanticSearch(
        vectorQuery,
        context.repositoryScanId,
        5,
      );

      if (semanticResults.length > 0) {
        relevantFiles = await this.prisma.fileDocumentation.findMany({
          where: { id: { in: semanticResults.map((r) => r.id) } },
        });
      }
    }

    if (relevantFiles.length === 0) {
      return {
        answer:
          "I couldn't find relevant files to answer your question about this code.",
        context: [],
      };
    }

    // Find related files (imports/exports)
    relevantFiles = await this.findRelatedFiles(
      relevantFiles,
      context.repositoryScanId,
    );

    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    const geminiTrace = new Gemini();
    const functionTracePrompt = this.buildFunctionTracePrompt(query, filePath);
    const queryResponse = await geminiTrace.generateAnswer(
      functionTracePrompt,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      null,
    );
  }

  /**
   * Enhanced function trace query handler
   */
  private async handleEnhancedFunctionTraceQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    analysisMode: string = 'standard',
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleEnhancedFunctionTraceQuery');

    const filePathMatch = query.match(
      /explain\s+(\S+\.[a-z]+)|\bfile\s+(\S+\.[a-z]+)/i,
    );
    const filePath = filePathMatch
      ? filePathMatch[1] || filePathMatch[2]
      : null;
    let relevantFiles = [];

    if (filePath) {
      relevantFiles = await this.findSpecificFile(
        filePath,
        context.repositoryScanId,
      );
    }

    if (relevantFiles.length === 0) {
      const geminiEnhanced = new Gemini();
      const embedding = await geminiEnhanced.getEmbeddings(query);
      const vectorQuery = `[${embedding.join(',')}]`;
      const semanticResults = await this.performSemanticSearch(
        vectorQuery,
        context.repositoryScanId,
        8,
      );

      if (semanticResults.length > 0) {
        relevantFiles = await this.prisma.fileDocumentation.findMany({
          where: { id: { in: semanticResults.map((r) => r.id) } },
        });
      }
    }

    relevantFiles = await this.findRelatedFiles(
      relevantFiles,
      context.repositoryScanId,
    );
    const filesWithCode = await this.fetchFilesWithCode(relevantFiles, context);

    // Enhanced analysis
    const codeInsights =
      await this.seniorEngineerAnalysisService.analyzeCodeQuality(
        filesWithCode,
        context,
      );
    const resourceAnalysis =
      await this.seniorEngineerAnalysisService.analyzeResourcesAndPatterns(
        filesWithCode,
        context,
      );

    const geminiEnhanced = new Gemini();
    const functionTracePrompt =
      this.seniorEngineerAnalysisService.buildEnhancedFunctionTracePrompt(
        query,
        filePath,
        analysisMode,
      );
    const queryResponse = await geminiEnhanced.generateAnswer(
      functionTracePrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount += 2;
    }

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      { codeInsights, resourceAnalysis },
    );
  }

  /**
   * Original project level query handler (maintained for compatibility)
   */
  private async handleProjectLevelQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
  ): Promise<QueryAnalysisResponse> {
    console.log(`[handleProjectLevelQuery] Processing project level question`);

    const isSchemaModelQuestion =
      /schema|model|database|db|table|entity|field|column|type|relation|prisma/i.test(
        query,
      );

    let tagBasedFiles = await this.findProjectLevelFiles(
      context.repositoryScanId,
    );

    if (isSchemaModelQuestion) {
      const schemaFiles = await this.findSchemaModelFiles(
        context.repositoryScanId,
      );
      tagBasedFiles = [...schemaFiles, ...tagBasedFiles];
      // Remove duplicates
      tagBasedFiles = Array.from(
        new Map(tagBasedFiles.map((file) => [file.id, file])).values(),
      );
    }

    if (tagBasedFiles.length === 0) {
      return {
        answer:
          "I couldn't find relevant project files to answer your question.",
        context: [],
      };
    }

    // Filter relevant files using AI
    const geminiProject = new Gemini();
    const fileQuickInfo = tagBasedFiles.map((data) =>
      this.mapFileToQuickInfo(data),
    );
    const filteredFiles = await geminiProject.filterRelevantFiles(
      enhancedQuery,
      fileQuickInfo,
    );

    tagBasedFiles = tagBasedFiles.filter((data) => {
      const mappedData = this.mapDocumentFields(data);
      return filteredFiles.output.some(
        (file) => file.fileName === mappedData.fileName,
      );
    });

    // Add essential files
    const essentialFiles = await this.findEssentialProjectFiles(
      context.repositoryScanId,
    );
    const existingIds = new Set(tagBasedFiles.map((file) => file.id));
    const newEssentialFiles = essentialFiles.filter(
      (file) => !existingIds.has(file.id),
    );
    tagBasedFiles = [...tagBasedFiles, ...newEssentialFiles];

    const filesWithCode = await this.fetchFilesWithCode(tagBasedFiles, context);
    const queryResponse = await geminiProject.generateAnswer(
      query,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      null,
    );
  }

  /**
   * Enhanced project level query handler with streaming support
   */
  private async handleEnhancedProjectLevelQuery(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    analysisMode: string = 'standard',
    trace?: AnalysisTrace,
    streamTextChunk?: (chunk: string) => void,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleEnhancedProjectLevelQuery');

    const isSchemaModelQuestion =
      /schema|model|database|db|table|entity|field|column|type|relation|prisma/i.test(
        query,
      );
    let tagBasedFiles = await this.findProjectLevelFiles(
      context.repositoryScanId,
    );

    if (isSchemaModelQuestion) {
      const schemaFiles = await this.findSchemaModelFiles(
        context.repositoryScanId,
      );
      tagBasedFiles = [...schemaFiles, ...tagBasedFiles];
      tagBasedFiles = Array.from(
        new Map(tagBasedFiles.map((file) => [file.id, file])).values(),
      );
    }

    const geminiProjectEnhanced = new Gemini();
    const fileQuickInfo = tagBasedFiles.map((data) =>
      this.mapFileToQuickInfo(data),
    );
    const filteredFiles = await geminiProjectEnhanced.filterRelevantFiles(
      enhancedQuery,
      fileQuickInfo,
    );

    tagBasedFiles = tagBasedFiles.filter((data) => {
      const mappedData = this.mapDocumentFields(data);
      return filteredFiles.output.some(
        (file) => file.fileName === mappedData.fileName,
      );
    });

    const essentialFiles = await this.findEssentialProjectFiles(
      context.repositoryScanId,
    );
    const existingIds = new Set(tagBasedFiles.map((file) => file.id));
    const newEssentialFiles = essentialFiles.filter(
      (file) => !existingIds.has(file.id),
    );
    tagBasedFiles = [...tagBasedFiles, ...newEssentialFiles];

    const filesWithCode = await this.fetchFilesWithCode(tagBasedFiles, context);

    // Enhanced analysis
    const resourceAnalysis =
      await this.seniorEngineerAnalysisService.analyzeResourcesAndPatterns(
        filesWithCode,
        context,
      );
    const architecturalGuidance =
      await this.seniorEngineerAnalysisService.generateArchitecturalGuidance(
        filesWithCode,
        query,
        context,
      );
    const codeInsights =
      await this.seniorEngineerAnalysisService.analyzeCodeQuality(
        filesWithCode,
        context,
      );

    const enhancedPrompt =
      this.seniorEngineerAnalysisService.buildEnhancedProjectLevelPrompt(
        query,
        analysisMode,
        resourceAnalysis,
      );
    
    // Use streaming generation if streamTextChunk is provided
    const queryResponse = streamTextChunk 
      ? await geminiProjectEnhanced.generateAnswerStream(
          enhancedPrompt,
          filesWithCode,
          enhancedQuery,
          streamTextChunk,
        )
      : await geminiProjectEnhanced.generateAnswer(
          enhancedPrompt,
          filesWithCode,
          enhancedQuery,
        );
    
    if (trace) {
      trace.performanceMetrics.aiCallsCount += 2;
    }

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      { resourceAnalysis, architecturalGuidance, codeInsights },
    );
  }

  /**
   * Original semantic search fallback (maintained for compatibility)
   */
  private async handleSemanticSearchFallback(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
  ): Promise<QueryAnalysisResponse> {
    console.log(
      `[handleSemanticSearchFallback] Using semantic search fallback`,
    );

    const geminiSemantic = new Gemini();
    const embedding = await geminiSemantic.getEmbeddings(query);
    const vectorQuery = `[${embedding.join(',')}]`;

    const semanticResults = await this.performSemanticSearch(
      vectorQuery,
      context.repositoryScanId,
      5,
    );

    if (semanticResults.length === 0) {
      return {
        answer:
          "I couldn't find relevant information to answer your question. The repository may not have been fully scanned or indexed yet.",
        context: [],
      };
    }

    const topFiles = await this.prisma.fileDocumentation.findMany({
      where: { id: { in: semanticResults.map((file) => file.id) } },
    });

    const filesWithCode = await this.fetchFilesWithCode(topFiles, context);
    const queryResponse = await geminiSemantic.generateAnswer(
      query,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      null,
    );
  }

  /**
   * Enhanced semantic search fallback
   */
  private async handleEnhancedSemanticSearchFallback(
    query: string,
    enhancedQuery: string,
    context: AnalysisContext,
    threadId?: string,
    analysisMode: string = 'standard',
    trace?: AnalysisTrace,
  ): Promise<QueryAnalysisResponse> {
    trace?.executionPath.push('handleEnhancedSemanticSearchFallback');

    const geminiSemanticEnhanced = new Gemini();
    const embedding = await geminiSemanticEnhanced.getEmbeddings(query);
    const vectorQuery = `[${embedding.join(',')}]`;

    const semanticResults = await this.performSemanticSearch(
      vectorQuery,
      context.repositoryScanId,
      8,
    );

    if (semanticResults.length === 0) {
      return {
        answer:
          "I couldn't find relevant information to answer your question. The repository may not have been fully scanned or indexed yet.",
        context: [],
      };
    }

    const topFiles = await this.prisma.fileDocumentation.findMany({
      where: { id: { in: semanticResults.map((file) => file.id) } },
    });

    const filesWithCode = await this.fetchFilesWithCode(topFiles, context);

    // Enhanced analysis
    const resourceAnalysis =
      await this.seniorEngineerAnalysisService.analyzeResourcesAndPatterns(
        filesWithCode,
        context,
      );
    const codeInsights =
      await this.seniorEngineerAnalysisService.analyzeCodeQuality(
        filesWithCode,
        context,
      );

    const enhancedPrompt =
      this.seniorEngineerAnalysisService.buildEnhancedSemanticPrompt(
        query,
        analysisMode,
      );
    const queryResponse = await geminiSemanticEnhanced.generateAnswer(
      enhancedPrompt,
      filesWithCode,
      enhancedQuery,
    );
    if (trace) {
      trace.performanceMetrics.aiCallsCount += 2;
    }

    return await this.createEnhancedAssistanceResponse(
      query,
      queryResponse,
      context,
      this,
      threadId,
      // { resourceAnalysis, codeInsights },
    );
  }

  // Enhanced analysis methods

  /**
   * Find architectural files in the repository
   */
  private async findArchitecturalFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          {
            fileType: {
              hasSome: ['CONTROLLER', 'SERVICE', 'ROUTER', 'MIDDLEWARE'],
            },
          },
          { fullPath: { contains: 'src/modules', mode: 'insensitive' } },
          { fullPath: { contains: 'src/common', mode: 'insensitive' } },
          { fullPath: { contains: 'src/core', mode: 'insensitive' } },
          { name: { endsWith: '.module.ts' } },
          { name: { endsWith: '.controller.ts' } },
          { name: { endsWith: '.service.ts' } },
        ],
      },
    });
  }

  /**
   * Find configuration files
   */
  private async findConfigurationFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { name: { contains: 'config', mode: 'insensitive' } },
          { name: { endsWith: '.config.ts' } },
          { name: { endsWith: '.config.js' } },
          { name: { equals: 'package.json' } },
          { name: { equals: 'tsconfig.json' } },
          { name: { equals: '.env.example' } },
          { name: { equals: 'docker-compose.yml' } },
          { name: { equals: 'Dockerfile' } },
        ],
      },
    });
  }

  /**
   * Find core application files
   */
  private async findCoreApplicationFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { name: { equals: 'main.ts' } },
          { name: { equals: 'app.ts' } },
          { name: { equals: 'app.module.ts' } },
          { name: { equals: 'index.ts' } },
          { name: { contains: 'bootstrap', mode: 'insensitive' } },
        ],
      },
    });
  }

  /**
   * Find all project files
   */
  private async findAllProjectFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: { repositoryScanId },
    });
  }

  /**
   * Find performance-critical files
   */
  private async findPerformanceCriticalFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { fileType: { hasSome: ['SERVICE', 'CONTROLLER', 'API'] } },
          { fullPath: { contains: 'database', mode: 'insensitive' } },
          { fullPath: { contains: 'query', mode: 'insensitive' } },
          { fullPath: { contains: 'cache', mode: 'insensitive' } },
          { name: { contains: 'performance', mode: 'insensitive' } },
          { name: { contains: 'optimization', mode: 'insensitive' } },
        ],
      },
    });
  }

  /**
   * Find security-relevant files
   */
  private async findSecurityRelevantFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { fullPath: { contains: 'auth', mode: 'insensitive' } },
          { fullPath: { contains: 'security', mode: 'insensitive' } },
          { fullPath: { contains: 'validation', mode: 'insensitive' } },
          { fullPath: { contains: 'guard', mode: 'insensitive' } },
          { name: { contains: 'auth', mode: 'insensitive' } },
          { name: { contains: 'security', mode: 'insensitive' } },
          { name: { contains: 'jwt', mode: 'insensitive' } },
          { name: { contains: 'crypto', mode: 'insensitive' } },
        ],
      },
    });
  }

  /**
   * Find release-relevant files based on query context
   */
  private async findReleaseFiles(repositoryScanId: string) {
    return await this.prisma.fileDocumentation.findMany({
      where: {
        repositoryScanId,
        OR: [
          { name: { contains: 'CHANGELOG', mode: 'insensitive' } },
          { name: { contains: 'RELEASE', mode: 'insensitive' } },
          { name: { contains: 'VERSION', mode: 'insensitive' } },
          { name: { equals: 'package.json' } },
          { name: { contains: 'readme', mode: 'insensitive' } },
          { fileType: { hasSome: ['CONTROLLER', 'SERVICE', 'API'] } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
  }

  /**
   * Analyze release highlights from commits
   */
  private async analyzeReleaseHighlights(
    filesWithCode: any[],
    context: AnalysisContext,
  ) {
    // Get recent commits for release analysis
    const recentCommits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId: context.repositoryId,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return recentCommits.map((commit) => ({
      commitId: commit.commitId,
      commitMessage: commit.commitMessage,
      committer: commit.committer,
      additions: commit.additions,
      deletions: commit.deletions,
      totalFiles: commit.totalFiles,
      summary: commit.summary,
      timestamp: commit.createdAt,
    }));
  }

  /**
   * Generate release summary analysis
   */
  private async generateReleaseSummary(
    filesWithCode: any[],
    context: AnalysisContext,
  ) {
    const recentCommits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId: context.repositoryId,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Analyze contributor activity
    const contributorStats = recentCommits.reduce((acc: any, commit) => {
      if (!acc[commit.committer]) {
        acc[commit.committer] = {
          commitCount: 0,
          linesAdded: 0,
          linesRemoved: 0,
          commits: [],
        };
      }
      acc[commit.committer].commitCount++;
      acc[commit.committer].linesAdded += commit.additions;
      acc[commit.committer].linesRemoved += commit.deletions;
      acc[commit.committer].commits.push(commit.commitId);
      return acc;
    }, {});

    return {
      totalCommits: recentCommits.length,
      contributors: Object.keys(contributorStats).length,
      contributorStats,
      timespan:
        recentCommits.length > 0
          ? {
              from: recentCommits[recentCommits.length - 1].createdAt,
              to: recentCommits[0].createdAt,
            }
          : null,
    };
  }

  /**
   * Perform semantic search on commits
   */
  private async performCommitSemanticSearch(
    vectorQuery: string,
    repositoryId: string,
    limit: number,
  ) {
    return (await this.prisma.$queryRaw`
      SELECT id, "commitId", "commitMessage", committer, summary, "createdAt"
      FROM "commitSummary" 
      WHERE "repositoryId" = ${repositoryId}
      AND "commitSummaryEmbedding" IS NOT NULL
      ORDER BY "commitSummaryEmbedding" <=> ${vectorQuery}::vector 
      LIMIT ${limit}
    `) as any[];
  }
}
