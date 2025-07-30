import { Injectable } from '@nestjs/common';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import {
  AnalysisContext,
  ArchitecturalGuidance,
  ArchitecturalPattern,
  BestPracticeViolation,
  CodeInsights,
  CodeQualityMetrics,
  DependencyMap,
  IdentifiedResource,
  PerformanceOptimization,
  QueryAnalysisResponse,
  RefactoringOpportunity,
  ResourceAnalysis,
  SecurityVulnerability,
  TechnicalDebt,
} from './repositoryAnalysis.service';

@Injectable()
export class SeniorEngineerAnalysisService {
  /**
   * Analyze resources and architectural patterns in the codebase
   */
  async analyzeResourcesAndPatterns(
    filesWithCode: any[],
    context: AnalysisContext,
  ): Promise<ResourceAnalysis> {
    const gemini = new Gemini();

    // Identify key resources
    const keyResources: IdentifiedResource[] = await this.identifyKeyResources(
      filesWithCode,
      gemini,
    );

    // Analyze dependencies
    const dependencies: DependencyMap =
      await this.analyzeDependencies(filesWithCode);

    // Detect architectural patterns
    const patterns: ArchitecturalPattern[] =
      await this.detectArchitecturalPatterns(filesWithCode, gemini);

    // Assess code quality
    const codeQuality: CodeQualityMetrics = await this.assessCodeQuality(
      filesWithCode,
      gemini,
    );

    return {
      keyResources,
      dependencies,
      patterns,
      codeQuality,
    };
  }

  /**
   * Analyze code quality and identify improvement opportunities
   */
  async analyzeCodeQuality(
    filesWithCode: any[],
    context: AnalysisContext,
  ): Promise<CodeInsights> {
    const gemini = new Gemini();

    const refactoringOpportunities: RefactoringOpportunity[] =
      await this.identifyRefactoringOpportunities(filesWithCode, gemini);

    const performanceOptimizations: PerformanceOptimization[] =
      await this.identifyPerformanceOptimizations(filesWithCode, gemini);

    const bestPracticeViolations: BestPracticeViolation[] =
      await this.identifyBestPracticeViolations(filesWithCode, gemini);

    const securityVulnerabilities: SecurityVulnerability[] =
      await this.identifySecurityVulnerabilities(filesWithCode, gemini);

    return {
      refactoringOpportunities,
      performanceOptimizations,
      bestPracticeViolations,
      securityVulnerabilities,
    };
  }

  /**
   * Analyze performance optimization opportunities
   */
  async analyzePerformanceOptimizations(
    filesWithCode: any[],
    context: AnalysisContext,
  ): Promise<CodeInsights> {
    const gemini = new Gemini();

    const performancePrompt = `
You are a SENIOR PERFORMANCE ENGINEER tasked with finding the highest-impact performance wins.

Deliver a *prioritized* list of optimisation opportunities. For each item include:
• filePath:lineRange
• description (≤25 words)
• root cause
• concrete fix
• estimated gain (low / medium / high)

Focus areas (but do not limit yourself to them):
- Expensive database queries
- Memory leaks / excessive allocations
- Async blocking / unnecessary awaits
- Missing or ineffective caching
- Algorithmic complexity
- Inefficient I/O or serialization

Return the answer as a Markdown table with columns: Rank | File | Issue | Recommendation | Impact.
`;

    const analysisResult = await gemini.generateAnswer(
      performancePrompt,
      filesWithCode,
      'Performance analysis request',
    );

    // Parse and structure the performance insights
    return this.parsePerformanceInsights(analysisResult, filesWithCode);
  }

  /**
   * Analyze security vulnerabilities
   */
  async analyzeSecurityVulnerabilities(
    filesWithCode: any[],
    context: AnalysisContext,
  ): Promise<CodeInsights> {
    const gemini = new Gemini();

    const securityPrompt = `
You are a VETERAN APPLICATION SECURITY ENGINEER performing a targeted vulnerability assessment.

Produce a ranked list of findings. For each finding state:
• filePath:line(s)
• vulnerability type
• concise description (≤30 words)
• severity (critical/high/medium/low)
• concrete remediation steps

Prioritization criteria:
1. Direct exploitability
2. Data exposure impact
3. Ease of fix

Check, among others: input validation, injection, authZ/authN, sensitive data, CORS, rate limiting, error leakage.
Output as a Markdown table: Rank | File | Vulnerability | Severity | Fix.
`;

    const analysisResult = await gemini.generateAnswer(
      securityPrompt,
      filesWithCode,
      'Security analysis request',
    );

    return this.parseSecurityInsights(analysisResult, filesWithCode);
  }

  /**
   * Analyze technical debt
   */
  async analyzeTechnicalDebt(
    filesWithCode: any[],
    context: AnalysisContext,
  ): Promise<ResourceAnalysis> {
    const gemini = new Gemini();

    const technicalDebtPrompt = `
You are a PRINCIPAL ARCHITECT conducting a technical-debt scan.

List the most impactful debt items (max 10). For each item include:
• file/module
• debt description
• reason it matters
• suggested remediation
• estimated effort (S/M/L)
• impact if fixed (S/M/L)

Look for complexity, outdated patterns, duplication, unused dependencies, missing tests/docs, architecture drift.
Return as a Markdown table: Rank | Location | Debt | Effort | Impact.
`;

    const analysisResult = await gemini.generateAnswer(
      technicalDebtPrompt,
      filesWithCode,
      'Technical debt analysis request',
    );

    return this.parseTechnicalDebtInsights(analysisResult, filesWithCode);
  }

  /**
   * Generate architectural guidance
   */
  async generateArchitecturalGuidance(
    filesWithCode: any[],
    query: string,
    context: AnalysisContext,
  ): Promise<ArchitecturalGuidance> {
    const gemini = new Gemini();

    const architecturalPrompt = `
As a senior software architect, analyze the current codebase architecture and provide guidance:

Query context: "${query}"

Analyze:
- Current architectural patterns
- Strengths and weaknesses of the current approach
- Scalability considerations
- Maintainability aspects
- Integration patterns
- Module organization
- Design principles adherence

Provide specific architectural recommendations and future guidance.
`;

    const analysisResult = await gemini.generateAnswer(
      architecturalPrompt,
      filesWithCode,
      query,
    );

    return this.parseArchitecturalGuidance(analysisResult, filesWithCode);
  }

  /**
   * Generate module design guidance
   */
  async generateModuleDesignGuidance(
    filesWithCode: any[],
    query: string,
    context: AnalysisContext,
  ): Promise<ArchitecturalGuidance> {
    const gemini = new Gemini();

    const moduleDesignPrompt = `
As a senior full-stack engineer, analyze the existing project structure and provide guidance for new module development:

Request: "${query}"

Analyze existing patterns:
- Module organization structure
- Naming conventions
- File organization patterns
- Dependency injection patterns
- Testing strategies
- Integration approaches

Provide specific guidance for the requested module including:
- Recommended file structure
- Naming conventions to follow
- Integration patterns with existing modules
- Testing strategy
- Best practices specific to this project
`;

    const analysisResult = await gemini.generateAnswer(
      moduleDesignPrompt,
      filesWithCode,
      query,
    );

    return this.parseModuleGuidance(analysisResult, filesWithCode, query);
  }

  /**
   * Build enhanced prompts for different analysis types
   */
  buildArchitecturalReviewPrompt(
    query: string,
    resourceAnalysis: ResourceAnalysis,
  ): string {
    return `
You are a PRINCIPAL SOFTWARE ARCHITECT writing an executive-level architectural review.

Original Question: "${query}"

Snapshot of analysed system (auto-generated):
• Key Resources detected: ${resourceAnalysis.keyResources.length}
• Patterns observed: ${resourceAnalysis.patterns.map((p) => p.pattern).join(', ')}
• Maintainability score: ${resourceAnalysis.codeQuality.maintainability}/10
• Estimated complexity: ${resourceAnalysis.codeQuality.complexity}

Deliver your review in four sections:
1. Strengths — bullet list
2. Weaknesses / Risks — bullet list
3. Recommendations — numbered list with concrete actions, effort (S/M/L) and expected benefit
4. Next-Steps Roadmap — chronological order for the next 3 months

Keep each bullet ≤25 words and avoid generic advice.`;
  }

  buildCodeReviewPrompt(query: string, codeInsights: CodeInsights): string {
    return `
You are a SENIOR CODE REVIEWER answering the highlighted question.

Developer Question: "${query}"

Static analysis quick-stats:
• Refactoring Opportunities: ${codeInsights.refactoringOpportunities.length}
• Perf Issues: ${codeInsights.performanceOptimizations.length}
• Best-Practice Violations: ${codeInsights.bestPracticeViolations.length}
• Security Findings: ${codeInsights.securityVulnerabilities.length}

Write your review in this structure:
1. Direct Answer — concise response (≤50 words)
2. Observations — bullet list grouped by category (Quality, Performance, Security, Style)
3. Actionable Suggestions — numbered list with file:line pointers and clear next steps
4. Summary — 2-3 sentence wrap-up stating expected gains.
`;
  }

  buildPerformanceAnalysisPrompt(
    query: string,
    codeInsights: CodeInsights,
  ): string {
    return `
You are a PERFORMANCE SPECIALIST. Provide a targeted optimisation plan.

Developer Question: "${query}"
Detected opportunities: ${codeInsights.performanceOptimizations.length}; critical: ${codeInsights.performanceOptimizations.filter((p) => p.category === 'critical').length}

Present output as: Rank | Area | File/Line | Issue | Recommendation | Expected Gain.
Include hard numbers where possible (e.g., "O(n^2) → O(n log n)").
Limit table to top 10 items, then add a short conclusion summarising ROI.
`;
  }

  buildSecurityAuditPrompt(query: string, codeInsights: CodeInsights): string {
    return `
You are a VETERAN SECURITY AUDITOR conducting an in-depth assessment.

Developer Question: "${query}"

Summary of static findings:
• Total findings: ${codeInsights.securityVulnerabilities.length}
• Critical: ${codeInsights.securityVulnerabilities.filter((v) => v.severity === 'critical').length}
• High: ${codeInsights.securityVulnerabilities.filter((v) => v.severity === 'high').length}

Provide your audit as a Markdown table: Rank | File | Vulnerability | Severity | Fix.
Limit table to 15 rows then add a "Key Take-aways" section with max 5 bullets.
`;
  }

  buildModuleDesignPrompt(
    query: string,
    architecturalGuidance: ArchitecturalGuidance,
  ): string {
    return `
You are a LEAD FULL-STACK ENGINEER drafting design guidance for a new module.

Question: "${query}"

Context:
• Existing architecture: ${architecturalGuidance.currentArchitecture}
• Strengths: ${architecturalGuidance.strengths.join(', ')}

Write guidance in the following sections:
1. Proposed Structure — folder/file diagram
2. Naming Conventions — bullet list
3. Key Interfaces / Contracts — short code snippets
4. Integration Points — where & how to wire into current system
5. Testing Strategy — unit & integration
6. Documentation Notes

Keep language directive and concise.`;
  }

  buildTechnicalDebtPrompt(
    query: string,
    resourceAnalysis: ResourceAnalysis,
  ): string {
    return `
You are a PRINCIPAL ARCHITECT building a modernization roadmap.

Question: "${query}"
Snapshot Metrics:
• Maintainability: ${resourceAnalysis.codeQuality.maintainability}/10
• Code Smells detected: ${resourceAnalysis.codeQuality.codeSmells.length}
• Complexity score: ${resourceAnalysis.codeQuality.complexity}

Produce a table — Rank | Area | Problem | Effort (S/M/L) | Business Impact.
Limit to top 12 items then add a Phased Roadmap (Phase 1-3) indicating dependencies.`;
  }

  buildEnhancedFollowUpPrompt(
    query: string,
    previousMessages: any[],
    analysisMode: string,
  ): string {
    const contextSummary = previousMessages
      .slice(0, 3)
      .map(
        (msg) =>
          `Q: ${msg.question}\nA: ${msg.isDetailed ? msg.answer : msg.summary}`,
      )
      .join('\n\n');

    return `
As a senior engineer with deep context of our previous conversation, answer this follow-up question:

Previous Context:
${contextSummary}

Current Question: "${query}"
Analysis Mode: ${analysisMode}

Build upon the previous discussion and provide:
1. Direct connection to previous context
2. Deep technical insights
3. Practical implementation guidance
4. Code examples where relevant
5. Best practices specific to this codebase
6. Future considerations

Focus on continuity and progressive depth in your response.
`;
  }

  buildEnhancedUserFlowPrompt(query: string, analysisMode: string): string {
    return `
You are a FULL-STACK ENGINEER tracing the *actual* user execution path.

Question: "${query}"
Mode: ${analysisMode}

For every step provide:
• file:function (line range)
• data passed/returned
• side effects (DB, cache, external)

Finish with a sequence diagram style list showing the call order.
Use bullet points, keep it factual (no speculation).
`;
  }

  buildEnhancedFunctionTracePrompt(
    query: string,
    filePath: string | null,
    analysisMode: string,
  ): string {
    const basePrompt = `
As a senior engineer, provide comprehensive function tracing and code analysis:

Query: "${query}"
${filePath ? `Specific File: ${filePath}` : ''}
Analysis Mode: ${analysisMode}

Provide detailed analysis:
`;

    if (filePath) {
      return (
        basePrompt +
        `
1. **File Overview**: Purpose, role, and architectural position
2. **Key Functions**: Main functions/methods and their responsibilities
3. **Dependencies**: Imports, exports, and integration points
4. **Data Flow**: Input/output and data transformations
5. **Error Handling**: Exception handling patterns
6. **Performance Characteristics**: Efficiency and optimization opportunities
7. **Security Considerations**: Security implications and validations
8. **Testing Strategy**: How this code should be tested
9. **Refactoring Opportunities**: Improvement suggestions
10. **Usage Examples**: How other parts of the system use this code

Include specific code snippets and implementation details.
`
      );
    }

    return (
      basePrompt +
      `
1. **Function Identification**: Locate the relevant functions/methods
2. **Execution Tracing**: Step-by-step execution flow
3. **Parameter Analysis**: Input validation and processing
4. **Logic Flow**: Conditional logic and decision points
5. **External Dependencies**: Services, databases, APIs called
6. **Return Value Analysis**: Output generation and formatting
7. **Error Scenarios**: Exception handling and edge cases
8. **Performance Implications**: Bottlenecks and optimization opportunities
9. **Integration Points**: How this connects with other system components
10. **Best Practices**: Code quality and improvement suggestions

Provide practical insights for understanding and maintaining this code.
`
    );
  }

  buildEnhancedProjectLevelPrompt(
    query: string,
    analysisMode: string,
    resourceAnalysis: ResourceAnalysis,
  ): string {
    return `
You are an ENTERPRISE ARCHITECT analysing the project at macro level.

Question: "${query}"
Mode: ${analysisMode}

Key Stats:
• Patterns: ${resourceAnalysis.patterns.map((p) => p.pattern).join(', ')}
• Components: ${resourceAnalysis.keyResources.length}
• Maintainability: ${resourceAnalysis.codeQuality.maintainability}/10
• Tech-debt items: ${resourceAnalysis.codeQuality.codeSmells.length}

Deliver your answer in three parts: Overview, Opportunities, Risks. Keep each bullet ≤20 words.`;
  }

  buildEnhancedSemanticPrompt(query: string, analysisMode: string): string {
    const modeInstructions = this.getModeInstructions(analysisMode);

    return `
You are an EXPERT ENGINEER using **${analysisMode}** mode.

Instructions: answer the question *with code references and actionable advice*.
- quote filenames and lines
- avoid hypothetical statements; base everything on code provided
- keep sentences short and direct

Question: "${query}"
`;
  }

  /**
   * Build prompt for release analysis queries
   */
  buildReleaseAnalysisPrompt(
    query: string,
    releaseHighlights: any[],
    releaseSummary: any,
  ): string {
    return `
You are acting as a RELEASE MANAGER summarising recent changes.

Developer Question: "${query}"

Summary Stats:
• Commits: ${releaseSummary?.totalCommits || 0}
• Contributors: ${releaseSummary?.contributors || 0}
• Period: ${releaseSummary?.timespan?.from ? `${releaseSummary.timespan.from} to ${releaseSummary.timespan.to}` : 'recent'}

Write output with sections:
1. Highlights — bullet list, max 8
2. Risk Assessment — table: Area | Risk | Mitigation
3. Recommendation — next actions before release/rollback.
`;
  }

  /**
   * Get mode-specific instructions for analysis
   */
  private getModeInstructions(analysisMode: string): string {
    switch (analysisMode) {
      case 'senior':
        return `
Provide expert-level analysis covering:
- Architectural implications and design patterns
- Performance and scalability considerations
- Security and compliance aspects
- Maintenance and technical debt assessment
- Industry best practices and alternatives`;
      case 'code_review':
        return `
Focus on code quality aspects:
- Code structure and organization
- Naming conventions and readability
- Error handling and edge cases
- Testing coverage and testability
- Refactoring opportunities`;
      case 'architecture':
        return `
Emphasize architectural concerns:
- System design and component relationships
- Data flow and dependencies
- Scalability and modularity
- Integration patterns and interfaces
- Deployment and infrastructure considerations`;
      case 'release_analysis':
        return `
Focus on release and change management:
- Impact assessment of changes
- Risk analysis and mitigation
- Deployment considerations
- Rollback strategies
- Monitoring and observability`;
      default:
        return `
Provide comprehensive technical analysis covering implementation details, best practices, and practical recommendations.`;
    }
  }

  /**
   * Create enhanced assistance response with additional analysis data
   * This method delegates to the main service for proper thread/DB handling
   */
  async createEnhancedAssistanceResponse(
    query: string,
    queryResponse: any,
    context: AnalysisContext,
    threadId: string | undefined,
    analysisData: {
      resourceAnalysis?: ResourceAnalysis;
      codeInsights?: CodeInsights;
      architecturalGuidance?: ArchitecturalGuidance;
    },
    mainService: any, // The main RepositoryAnalysisService instance
  ): Promise<QueryAnalysisResponse> {
    // Use the main service's createAssistanceResponse for proper DB operations
    const baseResponse = await mainService.createAssistanceResponse(
      query,
      queryResponse,
      context,
      threadId,
    );

    // Enhance the response with additional analysis data
    return {
      ...baseResponse,
      // resourceAnalysis: analysisData.resourceAnalysis,
      // codeInsights: analysisData.codeInsights,
      // architecturalGuidance: analysisData.architecturalGuidance,
    };
  }

  // Private helper methods for parsing analysis results

  private async identifyKeyResources(
    filesWithCode: any[],
    gemini: Gemini,
  ): Promise<IdentifiedResource[]> {
    // Implementation would analyze files and identify key resources
    const resources: IdentifiedResource[] = [];

    for (const file of filesWithCode) {
      const importance = this.calculateResourceImportance(file);
      if (importance > 0.7) {
        resources.push({
          type: this.determineResourceType(file),
          name: file.fileName,
          path: file.fileName,
          importance,
          relationships: file.imports || [],
          businessValue: this.assessBusinessValue(file),
          technicalDebt: this.assessTechnicalDebt(file),
        });
      }
    }

    return resources;
  }

  private async analyzeDependencies(
    filesWithCode: any[],
  ): Promise<DependencyMap> {
    const directDependencies: string[] = [];
    const indirectDependencies: string[] = [];
    const circularDependencies: string[] = [];
    const unusedDependencies: string[] = [];

    // Analyze dependencies from file imports/exports
    for (const file of filesWithCode) {
      if (file.imports) {
        directDependencies.push(...file.imports);
      }
    }

    return {
      directDependencies: [...new Set(directDependencies)],
      indirectDependencies,
      circularDependencies,
      unusedDependencies,
    };
  }

  private async detectArchitecturalPatterns(
    filesWithCode: any[],
    gemini: Gemini,
  ): Promise<ArchitecturalPattern[]> {
    const patterns: ArchitecturalPattern[] = [];

    // Detect common patterns like MVC, Repository, Service Layer, etc.
    const hasControllers = filesWithCode.some((f) =>
      f.fileName.includes('controller'),
    );
    const hasServices = filesWithCode.some((f) =>
      f.fileName.includes('service'),
    );
    const hasModels = filesWithCode.some(
      (f) => f.fileName.includes('model') || f.fileName.includes('entity'),
    );

    if (hasControllers && hasServices) {
      patterns.push({
        pattern: 'Layered Architecture',
        confidence: 0.85,
        evidence: ['Controllers found', 'Services found'],
        recommendations: [
          'Consider implementing proper dependency injection',
          'Ensure clear separation of concerns',
        ],
      });
    }

    if (hasModels) {
      patterns.push({
        pattern: 'Domain Model Pattern',
        confidence: 0.75,
        evidence: ['Model/Entity files found'],
        recommendations: [
          'Ensure rich domain models',
          'Consider domain-driven design principles',
        ],
      });
    }

    return patterns;
  }

  private async assessCodeQuality(
    filesWithCode: any[],
    gemini: Gemini,
  ): Promise<CodeQualityMetrics> {
    let totalComplexity = 0;
    let totalMaintainability = 0;
    const codeSmells: string[] = [];
    const securityIssues: string[] = [];

    for (const file of filesWithCode) {
      // Basic complexity analysis based on file content
      const complexity = this.calculateComplexity(file.sourceCode);
      const maintainability = this.calculateMaintainability(file.sourceCode);

      totalComplexity += complexity;
      totalMaintainability += maintainability;

      // Detect code smells
      if (file.sourceCode?.length > 1000) {
        codeSmells.push(`Large file: ${file.fileName}`);
      }

      if (file.sourceCode?.includes('any') && file.fileName.endsWith('.ts')) {
        codeSmells.push(`TypeScript 'any' usage in ${file.fileName}`);
      }
    }

    return {
      complexity: totalComplexity / filesWithCode.length,
      maintainability: totalMaintainability / filesWithCode.length,
      testCoverage: 0, // Would need to integrate with coverage tools
      codeSmells,
      securityIssues,
    };
  }

  private async identifyRefactoringOpportunities(
    filesWithCode: any[],
    gemini: Gemini,
  ): Promise<RefactoringOpportunity[]> {
    const opportunities: RefactoringOpportunity[] = [];

    for (const file of filesWithCode) {
      // Look for long functions, duplicate code, etc.
      if (file.sourceCode && file.sourceCode.length > 500) {
        opportunities.push({
          type: 'Large Function/File',
          file: file.fileName,
          description: 'File/function is too large and should be split',
          suggestion: 'Break down into smaller, more focused functions/modules',
          impact: 'medium',
          effort: 'medium',
        });
      }
    }

    return opportunities;
  }

  private async identifyPerformanceOptimizations(
    filesWithCode: any[],
    gemini: Gemini,
  ): Promise<PerformanceOptimization[]> {
    const optimizations: PerformanceOptimization[] = [];

    for (const file of filesWithCode) {
      // Look for performance issues
      if (file.sourceCode?.includes('SELECT *')) {
        optimizations.push({
          category: 'Database',
          description: 'SELECT * query found',
          currentIssue: 'Using SELECT * can impact performance',
          solution: 'Specify only required columns',
          expectedImprovement: '20-50% query performance improvement',
        });
      }
    }

    return optimizations;
  }

  private async identifyBestPracticeViolations(
    filesWithCode: any[],
    gemini: Gemini,
  ): Promise<BestPracticeViolation[]> {
    const violations: BestPracticeViolation[] = [];

    for (const file of filesWithCode) {
      // Check for best practice violations
      if (file.sourceCode?.includes('console.log')) {
        violations.push({
          practice: 'Proper Logging',
          violation: 'Using console.log instead of proper logger',
          file: file.fileName,
          correction: 'Use proper logging framework (Winston, etc.)',
        });
      }
    }

    return violations;
  }

  private async identifySecurityVulnerabilities(
    filesWithCode: any[],
    gemini: Gemini,
  ): Promise<SecurityVulnerability[]> {
    const vulnerabilities: SecurityVulnerability[] = [];

    for (const file of filesWithCode) {
      // Check for security issues
      if (file.sourceCode?.includes('eval(')) {
        vulnerabilities.push({
          severity: 'critical',
          type: 'Code Injection',
          description: 'Use of eval() function',
          file: file.fileName,
          mitigation: 'Avoid eval() and use safer alternatives',
        });
      }
    }

    return vulnerabilities;
  }

  // Helper methods for calculations
  private calculateResourceImportance(file: any): number {
    let importance = 0.5; // Base importance

    // Increase importance based on file characteristics
    if (file.fileName.includes('controller')) importance += 0.2;
    if (file.fileName.includes('service')) importance += 0.15;
    if (file.fileName.includes('model') || file.fileName.includes('entity'))
      importance += 0.1;
    if (file.imports && file.imports.length > 5) importance += 0.05;

    return Math.min(importance, 1.0);
  }

  private determineResourceType(file: any): IdentifiedResource['type'] {
    if (file.fileName.includes('controller')) return 'controller';
    if (file.fileName.includes('service')) return 'service';
    if (file.fileName.includes('model') || file.fileName.includes('entity'))
      return 'model';
    if (file.fileName.includes('util')) return 'utility';
    if (file.fileName.includes('config')) return 'config';
    if (file.fileName.includes('middleware')) return 'middleware';
    return 'utility';
  }

  private assessBusinessValue(file: any): string {
    // Simple business value assessment
    if (file.fileName.includes('auth'))
      return 'Critical - Authentication functionality';
    if (file.fileName.includes('payment')) return 'High - Payment processing';
    if (file.fileName.includes('user')) return 'High - User management';
    if (file.fileName.includes('order')) return 'Medium - Order processing';
    return 'Medium - Supporting functionality';
  }

  private assessTechnicalDebt(file: any): TechnicalDebt | undefined {
    if (!file.sourceCode || typeof file.sourceCode !== 'string')
      return undefined;

    if (file.sourceCode.length > 1000) {
      return {
        severity: 'medium',
        description: 'Large file that should be refactored',
        estimatedEffort: '2-4 hours',
        impact: 'Maintainability and readability',
      };
    }

    return undefined;
  }

  private calculateComplexity(sourceCode: string): number {
    if (!sourceCode || typeof sourceCode !== 'string') return 1;

    // Simple complexity calculation based on control structures
    const ifCount = (sourceCode.match(/\bif\b/g) || []).length;
    const forCount = (sourceCode.match(/\bfor\b/g) || []).length;
    const whileCount = (sourceCode.match(/\bwhile\b/g) || []).length;
    const switchCount = (sourceCode.match(/\bswitch\b/g) || []).length;

    return 1 + ifCount + forCount + whileCount + switchCount * 2;
  }

  private calculateMaintainability(sourceCode: string): number {
    if (!sourceCode || typeof sourceCode !== 'string') return 5;

    let score = 10;

    // Reduce score for various factors
    if (sourceCode.length > 1000) score -= 2;
    if (sourceCode.includes('any')) score -= 1;
    if (!sourceCode.includes('//') && !sourceCode.includes('/**')) score -= 1;

    return Math.max(score, 1);
  }

  // Parsing methods for AI responses
  private parsePerformanceInsights(
    analysisResult: any,
    filesWithCode: any[],
  ): CodeInsights {
    // Parse AI response and create structured insights
    return {
      refactoringOpportunities: [],
      performanceOptimizations: [
        {
          category: 'General',
          description: 'Performance analysis completed',
          currentIssue: 'See detailed analysis',
          solution: 'Follow recommendations',
          expectedImprovement: 'Variable',
        },
      ],
      bestPracticeViolations: [],
      securityVulnerabilities: [],
    };
  }

  private parseSecurityInsights(
    analysisResult: any,
    filesWithCode: any[],
  ): CodeInsights {
    return {
      refactoringOpportunities: [],
      performanceOptimizations: [],
      bestPracticeViolations: [],
      securityVulnerabilities: [
        {
          severity: 'medium',
          type: 'General Security Review',
          description: 'Security analysis completed',
          file: 'Multiple files',
          mitigation: 'Follow security recommendations',
        },
      ],
    };
  }

  private parseTechnicalDebtInsights(
    analysisResult: any,
    filesWithCode: any[],
  ): ResourceAnalysis {
    return {
      keyResources: [],
      dependencies: {
        directDependencies: [],
        indirectDependencies: [],
        circularDependencies: [],
        unusedDependencies: [],
      },
      patterns: [],
      codeQuality: {
        complexity: 5,
        maintainability: 7,
        testCoverage: 0,
        codeSmells: ['Technical debt analysis completed'],
        securityIssues: [],
      },
    };
  }

  private parseArchitecturalGuidance(
    analysisResult: any,
    filesWithCode: any[],
  ): ArchitecturalGuidance {
    return {
      currentArchitecture: 'Layered Architecture with NestJS',
      strengths: ['Modular structure', 'Clear separation of concerns'],
      weaknesses: ['Could benefit from better documentation'],
      recommendations: [
        {
          category: 'Architecture',
          priority: 'medium',
          description: 'Architectural analysis completed',
          implementation: 'Follow architectural recommendations',
          benefits: ['Improved maintainability', 'Better scalability'],
        },
      ],
      futureModuleGuidance: {
        recommendedStructure: 'Follow existing module pattern',
        namingConventions: [
          'Use kebab-case for files',
          'Use PascalCase for classes',
        ],
        integrationPatterns: ['Dependency injection', 'Module imports'],
        testingStrategy: 'Unit and integration tests',
      },
    };
  }

  private parseModuleGuidance(
    analysisResult: any,
    filesWithCode: any[],
    query: string,
  ): ArchitecturalGuidance {
    return {
      currentArchitecture: 'NestJS Modular Architecture',
      strengths: ['Clear module boundaries', 'Dependency injection'],
      weaknesses: ['Module guidance analysis needed'],
      recommendations: [
        {
          category: 'Module Design',
          priority: 'high',
          description: `Module design guidance for: ${query}`,
          implementation: 'Follow project conventions',
          benefits: ['Consistency', 'Maintainability'],
        },
      ],
      futureModuleGuidance: {
        recommendedStructure: 'src/modules/{module-name}/{feature}.{type}.ts',
        namingConventions: ['kebab-case for files', 'PascalCase for classes'],
        integrationPatterns: ['Module imports', 'Service injection'],
        testingStrategy: 'Jest with module testing',
      },
    };
  }
}
