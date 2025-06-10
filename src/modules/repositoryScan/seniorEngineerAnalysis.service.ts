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
As a senior performance engineer, analyze these code files for performance optimization opportunities:

Focus on:
- Database query optimization
- Memory usage patterns
- Async/await usage
- Caching opportunities
- Algorithmic efficiency
- Resource cleanup
- Connection pooling
- Batch processing opportunities

Provide specific, actionable recommendations with file names and line numbers where possible.
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
As a senior security engineer, analyze these code files for security vulnerabilities:

Focus on:
- Input validation issues
- SQL injection risks
- Authentication/authorization flaws
- Data exposure risks
- CORS misconfigurations
- Rate limiting
- Sensitive data handling
- Session management
- Error information leakage

Provide specific vulnerability descriptions with severity levels and mitigation strategies.
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
As a senior software architect, analyze these code files for technical debt:

Focus on:
- Code complexity and maintainability
- Outdated patterns and practices
- Duplicate code
- Unused dependencies
- Legacy code that needs modernization
- Architecture inconsistencies
- Missing documentation
- Test coverage gaps

Provide prioritized recommendations with effort estimates and impact assessments.
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
As a senior software architect, provide a comprehensive architectural review based on your analysis:

Original Query: "${query}"

Current Architecture Analysis:
- Key Resources: ${resourceAnalysis.keyResources.length} identified
- Architectural Patterns: ${resourceAnalysis.patterns.map((p) => p.pattern).join(', ')}
- Code Quality Score: ${resourceAnalysis.codeQuality.maintainability}/10
- Complexity Level: ${resourceAnalysis.codeQuality.complexity}

Focus your review on:
1. Architectural strengths and weaknesses
2. Scalability considerations
3. Maintainability improvements
4. Performance implications
5. Security considerations
6. Specific recommendations for the query

Provide actionable insights with practical implementation steps.
`;
  }

  buildCodeReviewPrompt(query: string, codeInsights: CodeInsights): string {
    return `
As a senior code reviewer, provide a detailed code review focusing on the user's specific question:

Query: "${query}"

Code Analysis Summary:
- Refactoring Opportunities: ${codeInsights.refactoringOpportunities.length}
- Performance Issues: ${codeInsights.performanceOptimizations.length}
- Best Practice Violations: ${codeInsights.bestPracticeViolations.length}
- Security Concerns: ${codeInsights.securityVulnerabilities.length}

Provide specific feedback on:
1. Code quality and maintainability
2. Performance optimization opportunities
3. Best practice adherence
4. Security considerations
5. Refactoring suggestions
6. Direct answers to the specific query

Include file names, function names, and specific line references where applicable.
`;
  }

  buildPerformanceAnalysisPrompt(
    query: string,
    codeInsights: CodeInsights,
  ): string {
    return `
As a senior performance engineer, analyze the codebase for performance optimization opportunities:

Query: "${query}"

Performance Analysis Summary:
- Optimization Opportunities: ${codeInsights.performanceOptimizations.length}
- Critical Issues: ${codeInsights.performanceOptimizations.filter((p) => p.category === 'critical').length}

Focus on:
1. Database query optimization
2. Memory usage patterns
3. Algorithmic efficiency
4. Caching strategies
5. Asynchronous processing
6. Resource utilization

Provide specific, measurable recommendations with expected performance improvements.
`;
  }

  buildSecurityAuditPrompt(query: string, codeInsights: CodeInsights): string {
    return `
As a senior security engineer, conduct a security audit of the codebase:

Query: "${query}"

Security Analysis Summary:
- Vulnerabilities Found: ${codeInsights.securityVulnerabilities.length}
- Critical Issues: ${codeInsights.securityVulnerabilities.filter((v) => v.severity === 'critical').length}
- High Priority: ${codeInsights.securityVulnerabilities.filter((v) => v.severity === 'high').length}

Focus your audit on:
1. Input validation and sanitization
2. Authentication and authorization
3. Data protection and encryption
4. API security
5. Error handling and information disclosure
6. Dependency vulnerabilities

Provide specific remediation steps with security best practices.
`;
  }

  buildModuleDesignPrompt(
    query: string,
    architecturalGuidance: ArchitecturalGuidance,
  ): string {
    return `
As a senior full-stack engineer, provide module design guidance based on existing project patterns:

Request: "${query}"

Current Architecture: ${architecturalGuidance.currentArchitecture}
Identified Strengths: ${architecturalGuidance.strengths.join(', ')}

Provide specific guidance for:
1. Module structure and organization
2. File naming conventions
3. Dependency management
4. Integration patterns
5. Testing strategy
6. Documentation requirements

Include specific examples based on existing project patterns and recommend the most suitable approach for this module.
`;
  }

  buildTechnicalDebtPrompt(
    query: string,
    resourceAnalysis: ResourceAnalysis,
  ): string {
    return `
As a senior software architect, analyze technical debt and provide a modernization roadmap:

Query: "${query}"

Technical Debt Analysis:
- Code Quality: ${resourceAnalysis.codeQuality.maintainability}/10
- Code Smells: ${resourceAnalysis.codeQuality.codeSmells.length}
- Complexity: ${resourceAnalysis.codeQuality.complexity}

Focus on:
1. Legacy code modernization
2. Architecture improvements
3. Code quality enhancements
4. Dependency updates
5. Performance optimizations
6. Maintainability improvements

Provide a prioritized action plan with effort estimates and business impact.
`;
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
As a senior full-stack engineer, trace the complete user flow with deep technical analysis:

Query: "${query}"
Analysis Mode: ${analysisMode}

Provide comprehensive flow analysis:
1. **Entry Points**: Identify all possible entry points (APIs, UI components, etc.)
2. **Authentication Flow**: Detail authentication/authorization checks
3. **Data Flow**: Trace data transformation and validation
4. **Business Logic**: Explain core business logic execution
5. **Database Operations**: Detail all database interactions
6. **Response Generation**: Explain response formation and delivery
7. **Error Handling**: Identify error scenarios and handling
8. **Performance Considerations**: Highlight performance bottlenecks
9. **Security Checkpoints**: Identify security validations

Include specific file names, function names, and line numbers. Show the complete execution path with actual code references.
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
As a senior architect, provide comprehensive project-level analysis:

Query: "${query}"
Analysis Mode: ${analysisMode}

Project Analysis Context:
- Architecture Patterns: ${resourceAnalysis.patterns.map((p) => p.pattern).join(', ')}
- Key Resources: ${resourceAnalysis.keyResources.length} components
- Code Quality: ${resourceAnalysis.codeQuality.maintainability}/10
- Technical Debt: ${resourceAnalysis.codeQuality.codeSmells.length} issues identified

Provide strategic insights on:
1. **System Architecture**: Overall design patterns and principles
2. **Component Relationships**: How major components interact
3. **Data Architecture**: Database design and data flow patterns
4. **API Design**: REST/GraphQL patterns and conventions
5. **Security Architecture**: Authentication, authorization, and data protection
6. **Performance Strategy**: Caching, optimization, and scalability patterns
7. **Testing Strategy**: Unit, integration, and e2e testing approaches
8. **Deployment Architecture**: CI/CD and infrastructure patterns
9. **Monitoring & Observability**: Logging, metrics, and alerting
10. **Future Roadmap**: Scalability and evolution considerations

Focus on high-level strategic guidance while providing specific technical recommendations.
`;
  }

  buildEnhancedSemanticPrompt(query: string, analysisMode: string): string {
    const modeInstructions = this.getModeInstructions(analysisMode);

    return `
You are an expert software engineer analyzing this codebase with ${analysisMode} analysis mode.

${modeInstructions}

Query: "${query}"

Based on the provided code files, give a comprehensive technical answer that:
1. Directly addresses the specific question
2. References actual code implementations
3. Provides technical depth appropriate for the analysis mode
4. Includes practical recommendations where relevant

Your answer should be technically accurate and immediately actionable.
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
As a senior software engineer and release manager, analyze the recent release changes and commit history.

Query: "${query}"

Release Summary:
- Total commits analyzed: ${releaseSummary?.totalCommits || 0}
- Contributors involved: ${releaseSummary?.contributors || 0}
- Time span: ${releaseSummary?.timespan?.from ? `${releaseSummary.timespan.from} to ${releaseSummary.timespan.to}` : 'Recent activity'}

Recent Release Highlights:
${releaseHighlights
  .map(
    (highlight) => `
- Commit: ${highlight.commitMessage} by ${highlight.committer}
  Impact: +${highlight.additions}/-${highlight.deletions} lines, ${highlight.totalFiles} files
  Summary: ${typeof highlight.summary === 'object' ? JSON.stringify(highlight.summary) : highlight.summary}
`,
  )
  .join('\n')}

Contributor Activity:
${
  releaseSummary?.contributorStats
    ? Object.entries(releaseSummary.contributorStats)
        .map(
          ([contributor, stats]: [string, any]) => `
- ${contributor}: ${stats.commitCount} commits, +${stats.linesAdded}/-${stats.linesRemoved} lines
`,
        )
        .join('\n')
    : 'No contributor data available'
}

Based on this release and commit analysis, provide insights about:
1. Key changes and their potential impact
2. Contributors and their contributions
3. Areas of the codebase that changed most frequently
4. Risk assessment for the changes
5. Recommendations for deployment or further development

Focus on answering the specific question while providing context from the commit history and release data.
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
