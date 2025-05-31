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
}

export interface QueryAnalysisResponse {
  answer: string;
  context: any[];
  summary?: string;
  threadId?: string;
}

@Injectable()
export class RepositoryAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commentService: CommentService,
    private readonly accountCredentialService: AccountCredentialService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Main entry point for repository analysis
   */
  async analyzeRepository(
    request: QueryAnalysisRequest,
  ): Promise<QueryAnalysisResponse> {
    try {
      console.log(`[analyzeRepository] Processing query: "${request.query}"`);

      // Validate and prepare analysis context
      const context = await this.prepareAnalysisContext(request);

      // Enhance query with thread context
      const enhancedQuery = await this.enhanceQueryWithContext(
        request.query,
        request.threadId,
      );

      // Categorize query type
      const gemini = new Gemini();
      const queryType = await gemini.categorizeQueryType(
        enhancedQuery,
        !!request.threadId,
      );
      console.log(`[analyzeRepository] Query categorized as: ${queryType}`);

      // Route to appropriate handler
      return await this.routeQueryToHandler(
        queryType,
        request.query,
        enhancedQuery,
        context,
        request.threadId,
      );
    } catch (error) {
      console.error('Error in analyzeRepository:', error);
      throw new BadRequestException(
        `Failed to analyze repository. ${error.message}`,
      );
    }
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
   * Handle follow-up questions with context from previous conversation
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
    // @ts-expect-error - previousMessages[0] is guaranteed to exist due to length check above
    const mostRecentAnswer = previousMessages[0]?.answer || '';
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

    return await this.createAssistanceResponse(
      query,
      queryResponse,
      context,
      threadId,
    );
  }

  /**
   * Handle user flow related queries
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

    return await this.createAssistanceResponse(
      query,
      queryResponse,
      context,
      threadId,
    );
  }

  /**
   * Handle function trace queries
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

    const gemini = new Gemini();
    const functionTracePrompt = this.buildFunctionTracePrompt(query, filePath);
    const queryResponse = await gemini.generateAnswer(
      functionTracePrompt,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createAssistanceResponse(
      query,
      queryResponse,
      context,
      threadId,
    );
  }

  /**
   * Handle project-level queries
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
    const gemini = new Gemini();
    const fileQuickInfo = tagBasedFiles.map((data) =>
      this.mapFileToQuickInfo(data),
    );
    const filteredFiles = await gemini.filterRelevantFiles(
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
    const queryResponse = await gemini.generateAnswer(
      query,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createAssistanceResponse(
      query,
      queryResponse,
      context,
      threadId,
    );
  }

  /**
   * Fallback semantic search handler
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

    const gemini = new Gemini();
    const embedding = await gemini.getEmbeddings(query);
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
    const queryResponse = await gemini.generateAnswer(
      query,
      filesWithCode,
      enhancedQuery,
    );

    return await this.createAssistanceResponse(
      query,
      queryResponse,
      context,
      threadId,
    );
  }

  // Helper methods

  private async getPreviousMessages(threadId: string) {
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
      ...recentMessages.map((q) => ({
        question: q.question,
        answer: q.answer as any,
        summary: q.summary,
        isDetailed: true,
      })),
      ...olderMessages.map((q) => ({
        question: q.question,
        summary: q.summary || (q.answer as any),
        isDetailed: false,
      })),
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
      sourceCode: res.data,
      functions: files[index].functions || [],
      imports: files[index].imports || [],
      exports: files[index].exports || [],
    }));
  }

  private mapFileToQuickInfo(data: any): any {
    const mappedData = this.mapDocumentFields(data);
    return {
      fileName: mappedData.fileName,
      filePath: mappedData.filePath,
      fileSummary: mappedData.summary,
      fileTags: mappedData.fileType,
      functions: data.functions || [],
      imports: data.imports || [],
      exports: data.exports || [],
    };
  }

  private buildFollowUpPrompt(query: string, previousMessages: any[]): string {
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

  // Helper methods implementation

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
        .map((r) => {
          if (r.status === 'fulfilled') {
            return r.value;
          } else {
            return null;
          }
        })
        .filter((r) => r !== null);
    } catch (error) {
      console.error('Error fetching source code:', error.message);
      // Return placeholder data on error to avoid breaking the flow
      return files.map(() => ({ data: 'Error fetching file content' }));
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
        queryResponse.output.response.usageMetadata.totalTokenCount,
      accountId: context.accountId,
      summary: responseSummary,
      threadId: validThreadId,
    };

    const assistedQuestions = await this.prisma.assistedQuestions.create({
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
}
