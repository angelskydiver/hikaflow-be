import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountCredentialsType,
  CommentType,
  ScanStatus,
} from '@prisma/client';
import axios from 'axios';
import {
  fetchFileExtension,
  ignoredExtensionsForFileScan,
} from 'src/config/constants/unnecessary.files.constant';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import { filterHighPriorityComments } from 'src/config/helpers/comment.helper';
import {
  bitbucketRepositoryAccess,
  bitbucketRepositoryStructure,
} from 'src/config/helpers/repositories/bitbucket.helper';
import {
  fetchFileByUrl,
  githubRepositoryAccess,
  githubRepositoryStructure,
} from 'src/config/helpers/repositories/github.helper';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  queueChangedFilesScan,
  queueOnDemandFileScan,
  repositoryScanQueue,
} from 'src/queue/repository.scan.queue';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import { BillingService } from '../billing/billing.service';
import { CommentService } from '../comment/comment.service';

@Injectable()
export class RepositoryScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly _commentService: CommentService,
    private readonly accountCredentialService: AccountCredentialService,
    private readonly _billingService: BillingService,
    private readonly _mailService: MailService,
  ) {}

  /**
   * Queues a repository scan job.
   */
  async queueRepositoryScan(repositoryId: string, accountId: string) {
    try {
      const repository = await this.prisma.repository.findFirst({
        where: { id: repositoryId },
      });

      if (!repository)
        throw new Error(`Repository "${repositoryId}" not found.`);

      // Check for existing scan
      const existingScan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId: repository.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Create a new scan if needed, or use existing
      let repositoryScan;
      if (existingScan) {
        // Update existing scan to PENDING status
        repositoryScan = await this.prisma.repositoryScan.update({
          where: { id: existingScan.id },
          data: {
            status: ScanStatus.PENDING,
            logs: `${existingScan.logs || ''}\n${new Date().toISOString()} - Scan requeued`,
          },
        });
        console.log(`Using existing scan ID: ${repositoryScan.id}`);
      } else {
        // Create new scan
        repositoryScan = await this.prisma.repositoryScan.create({
          data: {
            repositoryId: repository.id,
            accountId,
            status: ScanStatus.PENDING,
          },
        });
        console.log(`Created new scan ID: ${repositoryScan.id}`);
      }

      // Add job to BullMQ queue
      await repositoryScanQueue.add('scan-repo', {
        repositoryName: repository.name,
        accountId,
        repositoryScanId: repositoryScan.id,
      });

      return {
        message: 'Scan added to queue',
        repositoryScanId: repositoryScan.id,
      };
    } catch (error) {
      console.error('❌ Error in queueRepositoryScan:', error);
      throw new Error('Failed to enqueue repository scan.');
    }
  }

  /**
   * Scans repositories without adding them to a queue.
   */
  async scanRepositoriesDirect(
    repositoryName: string,
    accountId: string,
    repositoryScanId: string,
  ) {
    try {
      const repository = await this.prisma.repository.findFirst({
        where: { name: repositoryName },
        include: {
          repositorySettings: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!repository)
        throw new Error(`Repository "${repositoryName}" not found.`);

      let repositoryStructure;
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });
      if (
        accountCredentials.accountType === AccountCredentialsType.GITHUB_TOKEN
      ) {
        // Fetch repository structure (files & folders)
        repositoryStructure = await githubRepositoryAccess({
          owner: repository.owner,
          repo: repository.name,
          branch: repository.baseBranch,
          token: accountCredentials.decryptedToken,
        });
      } else {
        repositoryStructure = await bitbucketRepositoryAccess({
          workspace: accountCredentials.payload.workspace.replace(' ', '-'),
          repo: repository.name.replace(' ', '-'),
          branch: repository.baseBranch.replace(' ', '-'),
          token: accountCredentials.decryptedToken,
        });
      }

      await this.prisma.repositoryScan.update({
        where: { id: repositoryScanId },
        data: {
          totalFiles: repositoryStructure.length,
        },
      });

      // Process files in batches with better error handling
      let analyzedFiles = [];
      try {
        analyzedFiles = await this._processInBatches(
          repositoryStructure,
          25, // Batch size
          async (data) => {
            try {
              return await this.analyzeFiles(
                data,
                accountCredentials.decryptedToken,
                repository.id,
                repositoryScanId,
                repository,
              );
            } catch (fileError) {
              console.error(
                `Error analyzing file ${data.filePath}:`,
                fileError,
              );
              // Return null for failed files, they'll be filtered out later
              return null;
            }
          },
        );
      } catch (batchError) {
        console.error('Error processing file batches:', batchError);
        // Continue to embedding even if batch processing fails
      }

      // Filter out null values (failed files)
      analyzedFiles = analyzedFiles.filter((file) => file !== null);

      // Always proceed to embedding regardless of previous errors
      console.log('Beginning embedding process...');
      try {
        await this.embedRepositoryById(repositoryScanId);
        console.log('Embedding completed successfully');
      } catch (embeddingError) {
        console.error('Error during embedding process:', embeddingError);
        // Don't throw here, continue to update the scan status
      }

      // Get scan results for email notification
      const scan = await this.prisma.repositoryScan.findUnique({
        where: { id: repositoryScanId },
        include: {
          account: {
            include: {
              user: true,
            },
          },
        },
      });

      // Update scan status as COMPLETED
      await this.prisma.repositoryScan.update({
        where: { id: repositoryScanId },
        data: {
          totalFilesScanned: analyzedFiles.length,
          status: ScanStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      if (!scan.account.user.sendEmail) {
        return analyzedFiles;
      }

      // Send simple email notification
      await this._mailService.repositoryScanCompleteNotification({
        email: scan.account.user.email,
        adminName: scan.account.user.firstName,
        repositoryName: repository.name,
        reportUrl: `${process.env.HIKAFLOW_PORTAL_URL}/repository/${repository.id}/${repository.organizationId}`,
      });

      return analyzedFiles;
    } catch (error) {
      console.error('❌ Error in scanRepositoriesDirect:', error);
      throw new Error('Failed to scan repositories.');
    }
  }

  /**
   * Analyzes individual files from the repository.
   * @param fileChanges The file to analyze
   * @param token Authentication token
   * @param repositoryId Repository ID
   * @param repositoryScanId Repository scan ID
   * @param repository Repository object
   * @returns Analysis result
   */
  async analyzeFiles(
    fileChanges,
    token: string,
    repositoryId: string,
    repositoryScanId: string,
    repository: any,
  ) {
    try {
      const deepseekAI = new DeepSeek();
      let fileContent = await fetchFileByUrl(fileChanges.filePath, token);
      let lines;
      if (typeof fileContent !== 'string') {
        fileContent = JSON.stringify(fileContent);
      }
      try {
        lines = fileContent.toString().split('\n');
      } catch (parseError) {
        console.error(
          '❌ **fileContent**: ',
          typeof fileContent,
          fileChanges.filePath,
          fileContent,
        );
      }

      const analysisResult = await deepseekAI.analyzeFile({
        ...fileChanges,
        content: fileContent,
      });

      // First check if this file already exists in the database
      const existingDoc = await this.prisma.fileDocumentation.findFirst({
        where: {
          repositoryId,
          fullPath: fileChanges.fileRelativePath,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Extract file extension and name
      const fileName =
        fileChanges.name || fileChanges.fileRelativePath.split('/').pop();
      const fileExtension = fileName.includes('.')
        ? fileName.substring(fileName.lastIndexOf('.'))
        : '';

      // Determine file type based on analysis tags
      const fileTypeStr = analysisResult.tags?.[0] || 'UNKNOWN';

      // Map file type string to enum
      const docType = this.mapFileTypeToDocumentationType(fileTypeStr);

      if (existingDoc) {
        // If the file exists, update it with new information
        console.log(
          `Updating existing documentation for ${fileChanges.fileRelativePath}`,
        );

        try {
          // First attempt to update using the original field names that match the DB schema
          await this.prisma.fileDocumentation.update({
            where: { id: existingDoc.id },
            data: {
              name: fileName,
              fullPath: fileChanges.fileRelativePath,
              imports: analysisResult.relations?.imports || [],
              exports: analysisResult.relations?.exports || [],
              functions: analysisResult.functions || [],
              classes: analysisResult.classes || [],
              components: analysisResult.components || [],
              fileType: analysisResult.tags || [fileTypeStr],
              summary: analysisResult.summary || '',
            },
          });
        } catch (error) {
          console.error(`Error updating file documentation: ${error.message}`);
          // Fall back to using the model field names
          await this.prisma.fileDocumentation.update({
            where: { id: existingDoc.id },
            data: {
              name: fileName,
              fullPath: fileChanges.fileRelativePath,
              imports: analysisResult.relations?.imports || [],
              exports: analysisResult.relations?.exports || [],
              functions: analysisResult.functions || [],
              classes: analysisResult.classes || [],
              components: analysisResult.components || [],
              fileType: analysisResult.tags || [fileTypeStr],
              summary: analysisResult.summary || '',
            },
          });
        }
      } else {
        // If the file doesn't exist, create a new record
        console.log(
          `Creating new documentation for ${fileChanges.fileRelativePath}`,
        );

        try {
          await this.prisma.fileDocumentation.create({
            data: {
              name: fileName,
              fullPath: fileChanges.fileRelativePath,
              imports: analysisResult.relations?.imports || [],
              exports: analysisResult.relations?.exports || [],
              functions: analysisResult.functions || [],
              classes: analysisResult.classes || [],
              components: analysisResult.components || [],
              fileType: analysisResult.tags || [fileTypeStr],
              summary: analysisResult.summary || '',
              repositoryId,
              repositoryScanId,
            },
          });
        } catch (error) {
          console.error(`Error creating file documentation: ${error.message}`);
          // Fall back to using the model field names
          await this.prisma.fileDocumentation.create({
            data: {
              name: fileName,
              fullPath: fileChanges.fileRelativePath,
              imports: analysisResult.relations?.imports || [],
              exports: analysisResult.relations?.exports || [],
              functions: analysisResult.functions || [],
              classes: analysisResult.classes || [],
              components: analysisResult.components || [],
              fileType: analysisResult.tags || [fileTypeStr],
              summary: analysisResult.summary || '',
              repositoryId,
              repositoryScanId,
            },
          });
        }
      }

      // Continue with code issue analysis
      const withLineNumbers = lines
        .map((line, index) => `${index + 1}: ${line}`)
        .join('\n');

      let { codeIssues } = await deepseekAI.deepAnalyzeCodeFilesForIssues(
        { file: fileChanges.name, content: withLineNumbers },
        repository.repositorySettings,
      );

      codeIssues = (
        await deepseekAI.deepAnalyzeCodeFilesForIssuesReliability(codeIssues)
      )?.codeIssues;

      const filteredIssues = filterHighPriorityComments(
        codeIssues.filter((data) => data.content !== ''),
      );

      // Create comments for issues
      const createCommentsMapping = filteredIssues
        .map((data) => {
          const payload = {
            repositoryId: repository.repositoryId,
            content: data.content,
            line: parseInt(data.line),
            file: data.file,
            issue: data.issue,
            issueCategory: data.category,
            severity: data.priority,
            reason: data.reason,
            type: CommentType.ISSUE,
          };

          return this._commentService.createComment(payload);
        })
        .filter((comment) => comment !== undefined);

      await Promise.all(createCommentsMapping);
      return analysisResult;
    } catch (error) {
      console.error('❌ Error in analyzeFiles:', error);
      // Log detailed error but don't throw - return null to indicate failure
      // This allows the scan process to continue with other files
      console.error(
        `Failed to analyze file: ${fileChanges.filePath || 'unknown file'} - ${error.message}`,
      );

      // Log error to repository scan record
      try {
        // Get existing scan to append to logs rather than overwrite
        const scan = await this.prisma.repositoryScan.findUnique({
          where: { id: repositoryScanId },
          select: { logs: true },
        });

        const existingLogs = scan?.logs || '';
        const newLogEntry = `${new Date().toISOString()} - Error analyzing file ${fileChanges.filePath || 'unknown file'}: ${error.message}\n`;

        await this.prisma.repositoryScan.update({
          where: { id: repositoryScanId },
          data: {
            logs: existingLogs + newLogEntry,
          },
        });
      } catch (logError) {
        console.error('Failed to update scan logs:', logError);
      }

      return null; // Return null instead of throwing to allow other files to be processed
    }
  }

  /**
   * Maps a file type string to the FileDocumentationType enum
   * @param fileType File type string from analysis
   * @returns FileDocumentationType enum value
   */
  private mapFileTypeToDocumentationType(
    fileType: string,
  ):
    | 'COMPONENT'
    | 'UTILITY'
    | 'CONFIG'
    | 'CONTENT'
    | 'DOCUMENTATION'
    | 'TEST'
    | 'UNKNOWN' {
    // Convert the file type to appropriate DocumentationType
    switch (fileType.toUpperCase()) {
      case 'COMPONENT':
        return 'COMPONENT';
      case 'UTILITY':
      case 'UTILS':
        return 'UTILITY';
      case 'CONFIG':
      case 'CONFIGURATION':
        return 'CONFIG';
      case 'CONTENT':
      case 'TEXT':
        return 'CONTENT';
      case 'DOCUMENTATION':
      case 'DOC':
      case 'DOCS':
        return 'DOCUMENTATION';
      case 'TEST':
      case 'TESTS':
      case 'TESTING':
        return 'TEST';
      default:
        return 'UNKNOWN';
    }
  }

  async fetchFileStructure(repositoryId: string, accountId: string) {
    try {
      const { decryptedToken, payload, accountType } =
        await this.accountCredentialService.getAccountToken({ accountId });
      const scan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId,
        },
        include: {
          repository: true,
        },
      });

      const fetchRepositoryStructuredPayload = {
        owner: scan.repository.owner,
        repo: scan.repository.name,
        branch: scan.repository.baseBranch,
        token: decryptedToken,
      };

      if (accountType == AccountCredentialsType.GITHUB_TOKEN)
        return await githubRepositoryStructure(
          fetchRepositoryStructuredPayload,
        );
      else
        return await bitbucketRepositoryStructure({
          workspace: payload.workspace,
          repo: scan.repository.name,
          branch: scan.repository.baseBranch,
          token: decryptedToken,
        });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async fetchFileSummary(data: {
    repositoryId: string;
    path: string;
    accountId?: string;
  }) {
    try {
      const fileDocumentation = await this.prisma.fileDocumentation.findFirst({
        where: {
          repositoryId: data.repositoryId,
          fullPath: data.path,
        },
        include: {
          repository: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // If file documentation is not found and accountId is provided, try on-demand scanning
      if (
        !fileDocumentation &&
        data.accountId &&
        !ignoredExtensionsForFileScan.includes(fetchFileExtension(data.path))
      ) {
        try {
          console.log(
            `Documentation not found for ${data.path}, attempting on-demand scan...`,
          );

          // Try to scan the file on-demand
          return await this.scanOnDemand(
            data.repositoryId,
            data.path,
            data.accountId,
          );
        } catch (scanError) {
          console.error(`On-demand scan failed for ${data.path}:`, scanError);
          throw new NotFoundException(
            `File not found or could not be scanned: ${data.path}`,
          );
        }
      }

      if (!fileDocumentation) {
        throw new NotFoundException('File not found');
      }

      return fileDocumentation;
    } catch (error) {
      console.error('Error fetching file summary:', error);
      throw error;
    }
  }

  async fetchScanStatus(repositoryId: string) {
    try {
      const scan = await this.prisma.repositoryScan.findFirst({
        where: { repositoryId },
        include: {
          repository: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!scan) {
        throw new NotFoundException('Scan not found');
      }

      const totalFilesScanned = await this.prisma.fileDocumentation.count({
        where: { repositoryScanId: scan.id },
      });

      if (!scan) {
        throw new NotFoundException('Scan not found');
      }

      return {
        status: scan.status,
        totalFiles: scan.totalFiles,
        totalFilesScanned: totalFilesScanned,
        remainingFiles: scan.totalFiles - totalFilesScanned,
      };
    } catch (error) {
      console.error('Error fetching scan status:', error);
      throw error;
    }
  }

  private async _processInBatches(
    items: any[],
    batchSize: number,
    processFn: (item: any) => Promise<any>,
  ) {
    console.log(`Processing ${items.length} items in batches of ${batchSize}`);
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      console.log(`current batch: ${i} - ${i + batchSize}`);
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(processFn));
      results.push(...batchResults.filter(Boolean));
    }
    return results;
  }

  async embedRepositoryById(scanId: string) {
    try {
      const repositoryScans = await this.prisma.fileDocumentation.findMany({
        where: {
          repositoryScanId: scanId,
        },
      });

      const gemini = new Gemini();

      const batchSize = 10;
      for (let i = 0; i < repositoryScans.length; i += batchSize) {
        const batch = repositoryScans.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (scan) => {
            if (!scan.summary) return;

            try {
              // Convert the summary string to embeddings - ensure it's a string
              const embedding = await gemini.getEmbeddings(
                typeof scan.summary === 'string'
                  ? scan.summary
                  : String(scan.summary),
              );

              // Store embeddings as JSON
              await this.prisma.$executeRaw`
                UPDATE "FileDocumentation"
                SET "summaryEmbedding" = ${embedding}::vector
                WHERE id = ${scan.id}
              `;
            } catch (embedError) {
              console.error('Error creating embedding:', embedError);
            }
          }),
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error embedding repository:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Analyzes repository to answer user questions.
   */
  async testAnalyzeAssistance(
    repositoryId: string,
    query: string,
    accountId: string,
  ) {
    try {
      console.log(`[testAnalyzeAssistance] Processing query: "${query}"`);
      // Get the organization ID for the repository
      const repositoryBasic = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
        select: { organizationId: true },
      });

      if (!repositoryBasic || !repositoryBasic.organizationId) {
        throw new NotFoundException('Repository or organization not found');
      }

      // Check if this trial account can ask more questions today
      const canAskResult = await this._billingService.canAskQuestion(
        repositoryBasic.organizationId,
      );
      if (!canAskResult.canAsk) {
        throw new BadRequestException(canAskResult.reason);
      }

      const repository = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
        include: {
          repositorySettings: true,
        },
      });

      if (!repository)
        throw new Error(`Repository "${repositoryId}" not found.`);

      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

      const repositoryScan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId: repositoryId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const repositoryScanId = repositoryScan.id;

      const documentedFile = await this.prisma.fileDocumentation.findMany({
        where: {
          repositoryScanId: repositoryScanId,
        },
        include: {
          repository: true,
        },
      });

      const uniqueTags = await this.prisma.$queryRawUnsafe<{ tag: string }[]>(
        `
        SELECT DISTINCT unnest("fileType") AS tag
        FROM "FileDocumentation"
        WHERE "repositoryScanId" = $1
      `,
        repositoryScanId,
      );

      const gemini = new Gemini();

      // Use Gemini to categorize the query type instead of regex patterns
      const queryType = await gemini.categorizeQueryType(query);
      console.log(`[testAnalyzeAssistance] Query categorized as: ${queryType}`);

      const embedding = await gemini.getEmbeddings(query);
      const vectorQuery = `[${embedding.join(',')}]`;

      // Extract function names if needed for FUNCTION_TRACE queries
      let functionNames = [];
      if (queryType === 'FUNCTION_TRACE') {
        // Simple extraction of potential function names
        const functionMatches = query.match(
          /["']([^"']+)["']|\b(\w+)\b(?=\s*function|\s*method|\s*api|\s*endpoint|\s*call)|\bget\s+(\w+)|\bfetch\s+(\w+)|\baccess\s+(\w+)|\bretrieve\s+(\w+)|\buse\s+(\w+)|\bcall\s+(\w+)|\bimport\s+(\w+)/gi,
        );

        if (functionMatches) {
          functionNames = functionMatches.map((match) =>
            match
              .replace(/["']/g, '')
              .replace(/\s*(function|method|api|endpoint|call)$/i, '')
              .trim(),
          );
        }
      }

      // Handle different query types based on AI categorization
      if (queryType === 'USER_FLOW') {
        console.log(`[testAnalyzeAssistance] Handling as USER FLOW question`);
        // For user flow questions, prioritize controllers, routes, auth files, and UI components
        const userFlowFiles = await this.prisma.fileDocumentation.findMany({
          where: {
            repositoryScanId,
            OR: [
              {
                fileType: {
                  hasSome: [
                    'CONTROLLER',
                    'ROUTER',
                    'API',
                    'COMPONENT',
                    'SERVICE',
                  ],
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

        // Look for main app file and entry points
        const entryPointFiles = await this.prisma.fileDocumentation.findMany({
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

        // Combine relevant files but limit to a reasonable number
        let relevantFiles = [...userFlowFiles, ...entryPointFiles];

        console.log(
          'relevantFiles',
          relevantFiles.map((data) => ({
            name: data.name,
            fullPath: data.fullPath,
          })),
        );

        // Get file content and prepare data for AI
        const fileQuickInfo = relevantFiles.map((data) => {
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
        });

        // Use gemini to filter the most relevant files
        const filteredFiles = await gemini.filterRelevantFiles(
          query,
          fileQuickInfo,
        );

        console.log('filteredFiles', filteredFiles.output);

        // Keep only the filtered files
        relevantFiles = relevantFiles.filter((data) => {
          const mappedData = this.mapDocumentFields(data);
          return filteredFiles.output.some(
            (file) => file.fileName === mappedData.fileName,
          );
        });

        // Fetch file contents
        const sourceCodeResponses = await this._fetchSourceCodeForFiles(
          relevantFiles,
          documentedFile,
          accountCredentials,
        );

        const filesWithCode = sourceCodeResponses.map((res, index) => ({
          summary: relevantFiles[index].summary,
          fileName: relevantFiles[index].name,
          sourceCode: res.data,
          functions: relevantFiles[index].functions || [],
          imports: relevantFiles[index].imports || [],
          exports: relevantFiles[index].exports || [],
        }));

        // Generate answer focused on user flow - with emphasis on actual implementation analysis
        const queryResponse = await gemini.generateAnswer(
          `Analyze the actual code implementation to explain exactly how ${query.replace(/\?/g, '')} - not what should happen theoretically, but what DOES happen based on the code. Follow the execution path through the files, identify the exact functions called, database operations performed, and any conditional logic followed. Include file names, line numbers, function names, and show the precise sequence of operations. DO NOT speculate about what "would" happen - analyze what DOES happen based on the actual code in these files.`,
          filesWithCode,
        );

        return await this._createAssistanceResponse(
          query,
          queryResponse,
          repositoryId,
          repositoryScanId,
          accountId,
          repository,
        );
      } else if (queryType === 'FUNCTION_TRACE') {
        console.log(
          `[testAnalyzeAssistance] Handling as FUNCTION TRACE question`,
        );

        // Check if query is directly asking about a specific file
        const filePathMatch = query.match(
          /explain\s+(\S+\.[a-z]+)|\bfile\s+(\S+\.[a-z]+)/i,
        );
        const filePath = filePathMatch
          ? filePathMatch[1] || filePathMatch[2]
          : null;

        console.log('filePath: ', filePath);

        // Detect API-related queries for better context
        const isApiQuery =
          query.toLowerCase().includes('api') ||
          query.toLowerCase().includes('endpoint') ||
          query.toLowerCase().includes('route');

        let relevantFiles = [];

        // 1. PRIORITY: If asking about a specific file, find it directly
        if (filePath) {
          console.log(`Looking for specific file: ${filePath}`);

          // Try exact match first
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

          if (exactFile) {
            relevantFiles = [exactFile];
          }
        }

        // 2. If no specific file found or requested, use semantic search
        if (relevantFiles.length === 0) {
          console.log(`Using semantic search to find relevant files`);

          // Perform semantic search to find the most relevant files
          const semanticSearchResults = (await this.prisma.$queryRaw`
            SELECT id, name, "fullPath", summary 
            FROM "FileDocumentation" 
            WHERE "repositoryScanId" = ${repositoryScanId}
            ORDER BY "summaryEmbedding" <=> ${vectorQuery}::vector 
            LIMIT 5
          `) as any[];

          console.log(
            'semanticSearchResults: ',
            semanticSearchResults.map((result) => ({
              name: result.name,
              fullPath: result.fullPath,
            })),
          );

          if (semanticSearchResults.length > 0) {
            // Get full documentation for semantic search results
            relevantFiles = await this.prisma.fileDocumentation.findMany({
              where: {
                id: {
                  in: semanticSearchResults.map((result) => result.id),
                },
              },
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

        // 3. Find ONE LEVEL of imported/exported files for better context
        console.log(`Finding imported and exported files (one level)`);

        // Collect file names from imports and exports
        const importedFileNames = new Set<string>();
        const filesThatMightImport = new Set<string>();

        console.log(
          'relevantFiles: ',
          relevantFiles.map((data) => ({ name: data.name })),
        );

        relevantFiles.forEach((file) => {
          // Track imports this file has
          if (Array.isArray(file.imports)) {
            file.imports.forEach((imp) => {
              if (typeof imp === 'string') {
                const filename = imp.split('/').pop();
                if (filename) importedFileNames.add(filename);
              }
            });
          }

          // Track files that might import this file
          if (file.name) {
            filesThatMightImport.add(file.name);
          }
        });

        console.log('importedFileNames: ', importedFileNames);
        console.log('filesThatMightImport: ', filesThatMightImport);

        // Find files that this imports or that import this
        if (importedFileNames.size > 0 || filesThatMightImport.size > 0) {
          console.log(
            `ppp: `,
            JSON.stringify(
              {
                repositoryScanId,
                OR: [
                  // Files that are imported by our relevant files
                  { name: { in: Array.from(importedFileNames) } },
                  // Files that import our relevant files
                  {
                    imports: {
                      hasSome: Array.from(filesThatMightImport),
                    },
                  },
                ],
              },
              null,
              2,
            ),
          );
          const relatedFiles = await this.prisma.fileDocumentation.findMany({
            where: {
              repositoryScanId,
              OR: [
                // Files that are imported by our relevant files
                { name: { in: Array.from(importedFileNames) } },
                // Files that import our relevant files
                {
                  imports: {
                    hasSome: Array.from(filesThatMightImport),
                  },
                },
              ],
            },
          });

          console.log('relatedFiles: ', relatedFiles);

          // Add related files without duplicates
          const existingIds = new Set(relevantFiles.map((f) => f.id));
          relatedFiles.forEach((file) => {
            if (!existingIds.has(file.id)) {
              relevantFiles.push(file);
            }
          });

          console.log(
            'relevantFiles after: ',
            relevantFiles.map((file) => file.name),
          );
          // Limit to a reasonable number of files
          relevantFiles = relevantFiles.slice(0, 6);
        }

        console.log(
          'Found relevant files:',
          relevantFiles.map((file) => file.name),
        );

        // 4. Get file content for all files
        const sourceCodeResponses = await this._fetchSourceCodeForFiles(
          relevantFiles,
          documentedFile,
          accountCredentials,
        );

        const filesWithCode = sourceCodeResponses.map((res, index) => ({
          summary: relevantFiles[index].summary,
          fileName: relevantFiles[index].name,
          sourceCode: res.data,
          functions: relevantFiles[index].functions || [],
          imports: relevantFiles[index].imports || [],
          exports: relevantFiles[index].exports || [],
        }));

        // 5. Generate the appropriate prompt based on query type
        let functionSpecificPrompt;

        if (filePath) {
          // Explaining a specific file
          functionSpecificPrompt = `
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
        } else if (isApiQuery) {
          // API/endpoint question
          functionSpecificPrompt = `
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
        } else {
          // General code question
          functionSpecificPrompt = `
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

        // 6. Generate the answer using the enhanced prompt
        const queryResponse = await gemini.generateAnswer(
          functionSpecificPrompt,
          filesWithCode,
        );

        return await this._createAssistanceResponse(
          query,
          queryResponse,
          repositoryId,
          repositoryScanId,
          accountId,
          repository,
        );
      } else {
        // PROJECT_LEVEL (default case)
        console.log(
          `[testAnalyzeAssistance] Handling as PROJECT LEVEL question`,
        );
        // Enhanced project-level question handling
        // Check if this is a schema/model specific question
        const isSchemaModelQuestion =
          /schema|model|database|db|table|entity|field|column|type|relation|prisma/i.test(
            query,
          );
        console.log(
          `[testAnalyzeAssistance] Schema/model detection: ${isSchemaModelQuestion}`,
        );

        // Define broader set of tags for project-level understanding
        const projectContext = {
          output: {
            context: 'User is asking about project purpose or domain',
            tag: 'CONFIG',
            relatedTags: [
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
            ],
          },
        };

        // Start with getting important project structure files
        let tagBasedFiles = await this.prisma.fileDocumentation.findMany({
          where: {
            repositoryScanId,
            fileType: {
              hasSome: [
                ...projectContext.output.relatedTags,
                projectContext.output.tag,
              ],
            },
          },
        });

        // If this is a schema/model question, specially prioritize schema files
        if (isSchemaModelQuestion) {
          const schemaModelFiles = await this.prisma.fileDocumentation.findMany(
            {
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
                ] as any[],
              },
            },
          );

          // Prioritize schema files by adding them first
          tagBasedFiles = [...schemaModelFiles, ...tagBasedFiles];
          // Remove duplicates
          tagBasedFiles = Array.from(
            new Map(tagBasedFiles.map((file) => [file.id, file])).values(),
          );
        }

        // Rest of the PROJECT_LEVEL implementation remains the same...
        // ... existing code ...

        if (tagBasedFiles.length > 0) {
          // Process files based on tags and map fields correctly
          const fileQuickInfo = tagBasedFiles.map((data) => {
            const mappedData = this.mapDocumentFields(data);
            return {
              fileName: mappedData.fileName,
              filePath: mappedData.filePath,
              fileSummary: mappedData.summary,
              fileTags: mappedData.fileType,
            };
          });

          const filteredFiles = await gemini.filterRelevantFiles(
            query,
            fileQuickInfo,
          );

          tagBasedFiles = tagBasedFiles.filter((data) => {
            const mappedData = this.mapDocumentFields(data);
            return filteredFiles.output.some(
              (file) => file.fileName === mappedData.fileName,
            );
          });

          // Get essential project-definition files regardless of filtering
          const essentialFiles = await this.prisma.fileDocumentation.findMany({
            where: {
              repositoryScanId,
              OR: [
                { name: { equals: 'README.md', mode: 'insensitive' } },
                { name: { equals: 'package.json', mode: 'insensitive' } },
                { name: { equals: 'schema.prisma', mode: 'insensitive' } },
                { name: { equals: 'tsconfig.json', mode: 'insensitive' } },
                { fullPath: { endsWith: 'README.md', mode: 'insensitive' } },
              ] as any[],
            },
          });

          // Add essential files to the result set if they exist and aren't already included
          if (essentialFiles.length > 0) {
            const existingIds = new Set(tagBasedFiles.map((file) => file.id));
            const newEssentialFiles = essentialFiles.filter(
              (file) => !existingIds.has(file.id),
            );
            tagBasedFiles = [...tagBasedFiles, ...newEssentialFiles];
          }

          // Get source code for the files
          const sourceCodeResponses = await this._fetchSourceCodeForFiles(
            tagBasedFiles,
            documentedFile,
            accountCredentials,
          );

          const filesWithCode = sourceCodeResponses.map((res, index) => ({
            summary: tagBasedFiles[index].summary,
            fileName: tagBasedFiles[index].name,
            sourceCode: res.data,
          }));

          const queryResponse = await gemini.generateAnswer(
            query,
            filesWithCode,
          );

          return await this._createAssistanceResponse(
            query,
            queryResponse,
            repositoryId,
            repositoryScanId,
            accountId,
            repository,
          );
        }
      }

      // Fallback semantic search if no specific handling worked
      console.log(
        `[testAnalyzeAssistance] Falling back to semantic search for query`,
      );

      // Perform semantic search directly
      const relevantFilesByEmbedding = (await this.prisma.$queryRaw`
        SELECT id, name, "fullPath", summary 
        FROM "FileDocumentation" 
        WHERE "repositoryScanId" = ${repositoryScanId}
        ORDER BY "summaryEmbedding" <=> ${vectorQuery}::vector 
        LIMIT 5
      `) as any[];

      if (relevantFilesByEmbedding.length === 0) {
        return {
          answer:
            "I couldn't find relevant information to answer your question. The repository may not have been fully scanned or indexed yet.",
          context: [],
        };
      }

      // Get complete file data for the top results
      const topFiles = await this.prisma.fileDocumentation.findMany({
        where: {
          id: {
            in: relevantFilesByEmbedding.map((file: any) => file.id),
          },
        },
      });

      // Get file content for the top files
      const sourceCodeResponses = await this._fetchSourceCodeForFiles(
        topFiles,
        documentedFile,
        accountCredentials,
      );

      const filesWithCode = sourceCodeResponses.map((res, index) => ({
        summary: topFiles[index].summary,
        fileName: topFiles[index].name,
        sourceCode: res.data,
      }));

      const queryResponse = await gemini.generateAnswer(query, filesWithCode);

      return await this._createAssistanceResponse(
        query,
        queryResponse,
        repositoryId,
        repositoryScanId,
        accountId,
        repository,
      );
    } catch (error) {
      console.error('Error in testAnalyzeAssistance:', error);
      throw new BadRequestException(
        `Failed to analyze repository assistance. ${error.message}`,
      );
    }
  }

  /**
   * Helper method to fetch source code for files
   */
  private async _fetchSourceCodeForFiles(
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
      return await Promise.all(sourceCodeMapping);
    } catch (error) {
      console.error('Error fetching source code:', error.message);
      // Return placeholder data on error to avoid breaking the flow
      return files.map(() => ({ data: 'Error fetching file content' }));
    }
  }

  /**
   * Helper method to create and record an assistance response
   */
  private async _createAssistanceResponse(
    query: string,
    queryResponse: any,
    repositoryId: string,
    repositoryScanId: string,
    accountId: string,
    repository: any,
  ) {
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
        .trim();

      // Set the improved response
      queryResponse.output = responseText;
    }

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
      repositoryId: repositoryId,
      scanId: repositoryScanId,
      tokenUtilized:
        queryResponse.output.response.usageMetadata.totalTokenCount,
      accountId,
    };

    const assistedQuestions = await this.prisma.assistedQuestions.create({
      data: assistedQuestionPayload,
    });

    // Track usage with quota
    try {
      await this._billingService.trackUsageWithQuota({
        organizationId: repository.organizationId,
        repositoryId,
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
      id: assistedQuestions.id,
      response: formattedResponse,
      filteredFiles: queryResponse.filesReferenced.map((data) => ({
        name: data.fileName,
        content:
          typeof data.sourceCode === 'string'
            ? data.sourceCode
            : JSON.stringify(data.sourceCode, null, 2),
      })),
    };
  }

  async fetchedSavedQuestions(repositoryId: string) {
    try {
      const repository = await this.prisma.repository.findUnique({
        where: {
          id: repositoryId,
        },
      });

      if (!repository) throw new BadRequestException();

      const questions = await this.prisma.assistedQuestions.findMany({
        where: {
          repositoryId,
          // saved: true,
        },
      });

      return questions
        .map((question: any) => ({
          id: question.id,
          question: question.question,
          answer: question.answer.response,
          relatedFiles: question.answer.filteredFiles,
          timestamp: question.createdAt,
          isStarred: question.saved,
        }))
        .filter((data) => data.relatedFiles.length);
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async markQuestionSaved(questionId: string) {
    try {
      const question = await this.prisma.assistedQuestions.findUnique({
        where: {
          id: questionId,
        },
      });
      if (!question) throw new NotFoundException('question not found');
      await this.prisma.assistedQuestions.update({
        where: {
          id: questionId,
        },
        data: {
          saved: !question.saved,
        },
      });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Enhanced version of analyzeRegressionImpact that improves import checking
   * @param repositoryId Repository ID
   * @param prNumber PR number
   * @param changedFiles Array of changed file paths with their content
   * @param accountId User account ID
   */
  async analyzeRegressionImpactEnhanced(
    repositoryId: string,
    prNumber: number,
    changedFiles: {
      filename: string;
      patch: string;
      previousContent?: string;
      currentContent?: string;
    }[],
    accountId: string,
  ) {
    try {
      console.log(
        `Analyzing regression impact for PR #${prNumber} with ${changedFiles.length} files`,
      );

      const repository = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
        include: {
          repositorySettings: true,
        },
      });

      if (!repository) {
        throw new Error(`Repository not found with ID ${repositoryId}`);
      }

      // Fetch documentation for context information
      const repositoryScan = await this.prisma.repositoryScan.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
      });

      if (!repositoryScan) {
        console.warn(`No repository scan found for repository ${repositoryId}`);
      }

      // Get file documentation for additional context
      let fileDocumentation = [];
      if (repositoryScan) {
        fileDocumentation = await this.prisma.fileDocumentation.findMany({
          where: {
            repositoryScanId: repositoryScan.id,
            fullPath: {
              in: changedFiles.map((file) => file.filename),
            },
          },
        });
      }

      // Enable API access with account credentials
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

      // Build dependency graph for understanding file relationships
      const dependencyMap = this._buildDependencyGraph(fileDocumentation);

      // Fetch the latest commit from the PR and its parent to get proper "before" and "after" versions
      let latestCommitSha = 'HEAD';
      let parentCommitSha = repository.baseBranch;

      try {
        // Get the latest commit from the PR
        const commitInfo = await this._fetchPrCommitInfo(
          repository,
          prNumber,
          accountCredentials,
        );

        if (commitInfo) {
          latestCommitSha = commitInfo.latestCommitSha;
          parentCommitSha = commitInfo.parentCommitSha;
          console.log(
            `Using commits for comparison: latest=${latestCommitSha}, parent=${parentCommitSha}`,
          );
        } else {
          console.log(
            'Could not determine commit information, using HEAD and baseBranch as fallback',
          );
          parentCommitSha = repository.baseBranch;
        }
      } catch (error) {
        console.error('Error fetching PR commit information:', error);
        console.log('Using HEAD and baseBranch as fallback');
        parentCommitSha = repository.baseBranch;
      }

      // Add this after line ~1691 where commitInfo is retrieved
      if (
        accountCredentials.accountType !== AccountCredentialsType.GITHUB_TOKEN
      ) {
        // For Bitbucket, swap the values since they're reversed
        const temp = latestCommitSha;
        latestCommitSha = parentCommitSha;
        parentCommitSha = temp;
        console.log(
          `[Bitbucket] Swapped commit SHAs - now using latest=${latestCommitSha}, parent=${parentCommitSha}`,
        );
      }

      // Create a map of file documentation for quick lookup
      const fileDocMap = {};
      fileDocumentation.forEach((doc) => {
        if (doc && doc.fullPath) {
          fileDocMap[doc.fullPath] = doc;
        }
      });

      // Prepare enhanced file data with content and metadata
      const enhancedChangedFiles = await Promise.all(
        changedFiles.map(async (file) => {
          // Skip if file is missing name
          if (!file.filename) {
            console.warn('Skipping file with missing filename');
            return null;
          }

          // Prepare file content and metadata
          const enhancedFile = {
            filename: file.filename,
            patch: file.patch || '',
            documentation: fileDocMap[file.filename] || null,
            functions: fileDocMap[file.filename]?.functions || [],
            imports: fileDocMap[file.filename]?.imports || [],
            exports: fileDocMap[file.filename]?.exports || [],
            impactedBy: dependencyMap.impactedBy[file.filename] || [],
            impacts: dependencyMap.impacts[file.filename] || [],
            previousContent: file.previousContent || '',
            currentContent: file.currentContent || '',
          };

          // If content isn't already provided, fetch it from the repository
          if (!enhancedFile.previousContent) {
            try {
              enhancedFile.previousContent = await this._fetchFileContent(
                repository,
                file.filename,
                parentCommitSha, // Changed from latestCommitSha
                accountCredentials,
              );
            } catch (error) {
              console.error(
                `Error fetching previous content for ${file.filename}:`,
                error.message,
              );
            }
          }

          if (!enhancedFile.currentContent) {
            try {
              enhancedFile.currentContent = await this._fetchFileContent(
                repository,
                file.filename,
                latestCommitSha, // Changed from parentCommitSha
                accountCredentials,
              );
            } catch (error) {
              console.error(
                `Error fetching current content for ${file.filename}:`,
                error.message,
              );
            }
          }

          // Extract function definitions to understand what changed
          enhancedFile.functions = this._extractFunctions(
            enhancedFile.currentContent || '',
          );

          return enhancedFile;
        }),
      );

      // Filter out null entries
      const filteredFiles = enhancedChangedFiles.filter(Boolean);

      // Identify affected flows based on dependencies
      const affectedFlows = await this._identifyAffectedFlows(
        filteredFiles,
        fileDocumentation,
        dependencyMap,
      );

      // Analyze variable usage to detect undefined variables
      // const variableAnalysis = filteredFiles.map((file) => {
      //   const fileExtension = file.filename.split('.').pop()?.toLowerCase();
      //   const language = this._detectLanguage(file.currentContent || '');
      //   const variableUsage = this._analyzeVariableUsage(
      //     file.currentContent || '',
      //   );
      //   const docType = this.mapFileTypeToDocumentationType(
      //     file.filename.split('.').pop() || '',
      //   );

      //   return {
      //     filename: file.filename,
      //     language,
      //     variables: {
      //       defined: Array.from(variableUsage.defined),
      //       used: Array.from(variableUsage.used),
      //     },
      //   };
      // });

      // // Analyze dependencies across files to find potential breakages
      // const affectedDependencies = this._analyzeAffectedDependencies(
      //   filteredFiles,
      //   filteredFiles.map((f) => f.filename),
      //   dependencyMap,
      // );

      // Use DeepSeek AI for regression analysis
      const deepseekAI = new DeepSeek();
      const geminiAI = new Gemini(); // Gemini as potential fallback

      console.log(
        `Performing regression analysis on ${filteredFiles.length} files`,
      );

      let regressionAnalysis = null;
      try {
        regressionAnalysis = await deepseekAI.analyzeRegressionImpact(
          filteredFiles.map((file) => ({
            filename: file.filename,
            patch: file.patch,
            previousContent: file.previousContent || '',
            currentContent: file.currentContent || '',
            functions: file.functions || [],
            imports: file.imports || [],
            exports: file.exports || [],
            impactedBy: file.impactedBy || [],
            impacts: file.impacts || [],
            affectedFlows: affectedFlows.fileFlowMap[file.filename] || [],
          })),
        );
      } catch (error) {
        console.error('Error with DeepSeek analysis:', error);
        // Handle error, potentially implement fallback to Gemini here
      }

      // Create a report in the database
      const regressionTestingReport = await this.prisma.regressionReport.create(
        {
          data: {
            repositoryId,
            prNumber,
            status: 'COMPLETED',
            summary: regressionAnalysis?.summary || 'Analysis failed',
            impactedFlows: regressionAnalysis?.impactedFlows || [],
            testCases: regressionAnalysis?.testCases || [],
            potentialBreakages: regressionAnalysis?.potentialBreakages || [],
            changedBehavior: regressionAnalysis?.changedBehavior || [],
            organizationId: repository.organizationId,
          },
        },
      );

      return {
        reportId: regressionTestingReport.id,
        ...regressionAnalysis,
      };
    } catch (error) {
      console.error('Error in analyzeRegressionImpactEnhanced:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Analyzes the impact of changes on business flows
   * @param affectedFlows Flow information from _identifyAffectedFlows
   * @param variableAnalysis Variable usage analysis
   * @param enhancedChangedFiles Files with their content and metadata
   * @returns Detailed flow impact analysis
   */
  private _analyzeFlowImpact(
    affectedFlows: any,
    variableAnalysis: any[],
    enhancedChangedFiles: any[],
  ) {
    // Group files by flow
    const flowFiles: Record<string, Set<string>> = {};

    // Initialize with flows from affectedFlows
    if (affectedFlows.fileFlowMap) {
      Object.entries(affectedFlows.fileFlowMap).forEach(
        ([filename, flows]: [string, string[]]) => {
          if (Array.isArray(flows)) {
            flows.forEach((flow) => {
              if (!flowFiles[flow]) {
                flowFiles[flow] = new Set<string>();
              }
              flowFiles[flow].add(filename);
            });
          }
        },
      );
    }

    // Calculate risk for each flow based on variable analysis
    const flowRisks: Record<string, any> = {};
    const detailedFlowImpacts: Record<string, any> = {};

    Object.entries(flowFiles).forEach(
      ([flow, filesSet]: [string, Set<string>]) => {
        const flowFilesList = Array.from(filesSet);

        // Get variable analysis for files in this flow
        const flowVariableAnalysis = variableAnalysis.filter((analysis) =>
          flowFilesList.includes(analysis.filename),
        );

        // Calculate risk metrics for this flow
        const missingVariablesCount = flowVariableAnalysis.reduce(
          (sum, analysis) => sum + analysis.missingVariables.length,
          0,
        );

        const importsWithoutExportsCount = flowVariableAnalysis.reduce(
          (sum, analysis) => sum + analysis.importsWithoutExports.length,
          0,
        );

        // Determine overall risk level for this flow
        let riskLevel = 'LOW';
        if (missingVariablesCount > 0) {
          riskLevel = 'HIGH';
        } else if (importsWithoutExportsCount > 0) {
          riskLevel = 'MEDIUM';
        }

        // Find modified functions affecting this flow
        const modifiedFunctions = [];
        enhancedChangedFiles.forEach((file) => {
          if (flowFilesList.includes(file.filename) && file.functions) {
            // We only care about changed files with functions
            const funcs = file.functions.map((fn) => ({
              name: fn.name,
              filename: file.filename,
            }));
            modifiedFunctions.push(...funcs);
          }
        });

        // Get details of test cases needed for this flow
        const testRequirements = this._generateTestRequirements(
          flow,
          flowFilesList,
          flowVariableAnalysis,
          modifiedFunctions,
        );

        flowRisks[flow] = {
          riskLevel,
          affectedFiles: flowFilesList.length,
          missingVariablesCount,
          importsWithoutExportsCount,
          testCasesNeeded: testRequirements.testCasesCount,
        };

        detailedFlowImpacts[flow] = {
          riskLevel,
          affectedFiles: flowFilesList,
          missingVariables: flowVariableAnalysis
            .filter((a) => a.missingVariables.length > 0)
            .map((a) => ({
              filename: a.filename,
              variables: a.missingVariables,
            })),
          modifiedFunctions,
          testRequirements: testRequirements.details,
        };
      },
    );

    return {
      flowRisks,
      detailedFlowImpacts,
      totalFlowsAffected: Object.keys(flowFiles).length,
      highRiskFlows: Object.entries(flowRisks)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .filter(([_, risk]: [string, any]) => risk.riskLevel === 'HIGH')
        .map(([flow]) => flow),
    };
  }

  /**
   * Generates test requirements for a flow
   */
  private _generateTestRequirements(
    flow: string,
    flowFiles: string[],
    variableAnalysis: any[],
    modifiedFunctions: any[],
  ) {
    const testCasesNeeded = [];

    // Test for missing variables
    const filesWithMissingVars = variableAnalysis.filter(
      (a) => a.missingVariables.length > 0,
    );

    filesWithMissingVars.forEach((file) => {
      file.missingVariables.forEach((variable) => {
        testCasesNeeded.push({
          type: 'MISSING_VARIABLE',
          description: `Test that '${variable}' exists before use in ${file.filename}`,
          severity: 'HIGH',
        });
      });
    });

    // Test for modified functions
    modifiedFunctions.forEach((fn) => {
      testCasesNeeded.push({
        type: 'MODIFIED_FUNCTION',
        description: `Test function '${fn.name}' in ${fn.filename} with various inputs`,
        severity: 'MEDIUM',
      });
    });

    // Add flow-specific tests
    if (flow.includes('auth') || flow.includes('login')) {
      testCasesNeeded.push({
        type: 'AUTHENTICATION',
        description: `Test the full ${flow} flow with valid and invalid credentials`,
        severity: 'HIGH',
      });
    } else if (flow.includes('payment') || flow.includes('checkout')) {
      testCasesNeeded.push({
        type: 'PAYMENT',
        description: `Test the complete ${flow} process with various payment methods`,
        severity: 'HIGH',
      });
    } else {
      testCasesNeeded.push({
        type: 'FLOW',
        description: `Test the ${flow} flow end-to-end`,
        severity: 'MEDIUM',
      });
    }

    return {
      testCasesCount: testCasesNeeded.length,
      details: testCasesNeeded,
    };
  }

  /**
   * Analyzes dependencies specifically affected by changes
   * @param enhancedFiles Array of files with their content and metadata
   * @param directlyChangedFiles Array of directly changed file paths
   * @returns Detailed dependency information
   */
  private _analyzeAffectedDependencies(
    enhancedFiles: any[],
    directlyChangedFiles: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    dependencyMap: any,
  ): Record<string, any> {
    const result = {};

    // Create set for faster lookups
    const changedFilesSet = new Set(directlyChangedFiles);

    enhancedFiles.forEach((file) => {
      if (!file.filename) return;

      // For each file, identify:
      // 1. Which changed files it imports from
      // 2. Which files it exports to
      const importedChangedFiles = (file.impactedBy || [])
        .filter((impactingFile) => changedFilesSet.has(impactingFile))
        .map((impactingFile) => {
          // Find the changes in the impacting file
          const impactingFileData = enhancedFiles.find(
            (f) => f.filename === impactingFile,
          );
          return {
            filename: impactingFile,
            exportsUsed: this._identifyExportsUsed(impactingFileData, file),
          };
        });

      // Files that this file exports to (that may be affected)
      const exportedToFiles = (file.impacts || []).map((impactedFile) => {
        const impactedFileData = enhancedFiles.find(
          (f) => f.filename === impactedFile,
        );
        return {
          filename: impactedFile,
          importsUsed: this._identifyExportsUsed(file, impactedFileData),
        };
      });

      result[file.filename] = {
        importedChangedFiles,
        exportedToFiles,
      };
    });

    return result;
  }

  async analyzeRegressionImpact(
    repositoryId: string,
    prNumber: number,
    changedFiles: {
      filename: string;
      patch: string;
      previousContent?: string;
      currentContent?: string;
    }[],
    accountId: string,
  ) {
    try {
      const repository = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
        include: {
          repositorySettings: true,
        },
      });

      if (!repository) {
        throw new Error(`Repository "${repositoryId}" not found.`);
      }

      // Get account credentials to access repository files
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

      // Get the latest repository scan for file documentation
      const repositoryScan = await this.prisma.repositoryScan.findFirst({
        where: { repositoryId },
        orderBy: { createdAt: 'desc' },
      });

      if (!repositoryScan) {
        throw new Error(
          `No repository scan found for repository "${repositoryId}".`,
        );
      }

      // Get file documentation for affected files
      const fileDocumentation = await this.prisma.fileDocumentation.findMany({
        where: {
          repositoryScanId: repositoryScan.id,
          fullPath: {
            in: changedFiles.map((file) => file.filename),
          },
        },
      });

      // Create a map of file documentation for quick lookup
      const fileDocMap = {};
      fileDocumentation.forEach((doc) => {
        fileDocMap[doc.fullPath] = doc;
      });

      // Gather all dependencies from file documentation to analyze flow impact
      const dependencyMap = this._buildDependencyGraph(fileDocumentation);

      console.log('dependencyMap', dependencyMap);

      // Fetch the latest commit from the PR and its parent to get proper "before" and "after" versions
      let latestCommitSha = 'HEAD';
      let parentCommitSha = repository.baseBranch;

      try {
        // Get the latest commit from the PR
        const commitInfo = await this._fetchPrCommitInfo(
          repository,
          prNumber,
          accountCredentials,
        );

        if (commitInfo) {
          latestCommitSha = commitInfo.latestCommitSha;
          parentCommitSha = commitInfo.parentCommitSha;
          console.log(
            `Using commits for comparison: latest=${latestCommitSha}, parent=${parentCommitSha}`,
          );
        } else {
          console.log(
            'Could not determine commit information, using HEAD and baseBranch as fallback',
          );
          parentCommitSha = repository.baseBranch;
        }
      } catch (error) {
        console.error('Error fetching PR commit information:', error);
        console.log('Using HEAD and baseBranch as fallback');
        parentCommitSha = repository.baseBranch;
      }

      // Add this after line ~1691 where commitInfo is retrieved
      if (
        accountCredentials.accountType !== AccountCredentialsType.GITHUB_TOKEN
      ) {
        // For Bitbucket, swap the values since they're reversed
        const temp = latestCommitSha;
        latestCommitSha = parentCommitSha;
        parentCommitSha = temp;
        console.log(
          `[Bitbucket] Swapped commit SHAs - now using latest=${latestCommitSha}, parent=${parentCommitSha}`,
        );
      }

      // Enhanced file content retrieval - fetch from specific commits
      const enhancedChangedFiles = await Promise.all(
        changedFiles.map(async (file) => {
          // Files with complete content (from before and after the changes)
          const fileWithContent = {
            filename: file.filename,
            patch: file.patch,
            documentation: fileDocMap[file.filename] || null,
            functions: fileDocMap[file.filename]?.functions || [],
            imports: fileDocMap[file.filename]?.imports || [],
            exports: fileDocMap[file.filename]?.exports || [],
            impactedBy: dependencyMap.impactedBy[file.filename] || [],
            impacts: dependencyMap.impacts[file.filename] || [],
            previousContent: '',
            currentContent: '',
          };

          // If "previous" content was already provided, use it
          if (file.previousContent) {
            fileWithContent.previousContent = file.previousContent;
          } else {
            // Fetch "previous" version from parent commit
            fileWithContent.previousContent = await this._fetchFileContent(
              repository,
              file.filename,
              parentCommitSha, // Changed from latestCommitSha
              accountCredentials,
            );
          }

          // If "current" content was already provided, use it
          if (file.currentContent) {
            fileWithContent.currentContent = file.currentContent;
          } else {
            // Fetch "current" version from latest commit
            fileWithContent.currentContent = await this._fetchFileContent(
              repository,
              file.filename,
              latestCommitSha, // Changed from parentCommitSha
              accountCredentials,
            );
          }

          return fileWithContent;
        }),
      );

      // Calculate affected flows based on dependencies
      const affectedFlows = await this._identifyAffectedFlows(
        enhancedChangedFiles,
        fileDocumentation,
        dependencyMap,
      );

      // Use DeepSeek to analyze regression impact
      const deepseekAI = new DeepSeek();
      const regressionAnalysis = await deepseekAI.analyzeRegressionImpact(
        enhancedChangedFiles.map((file) => ({
          filename: file.filename,
          patch: file.patch,
          previousContent: file.previousContent || '',
          currentContent: file.currentContent || '',
          documentation: file.documentation || null,
          functions: file.functions || [],
          imports: file.imports || [],
          exports: file.exports || [],
          impactedBy: file.impactedBy || [],
          impacts: file.impacts || [],
          affectedFlows: affectedFlows.fileFlowMap[file.filename] || [],
        })),
      );

      // Include organization information for report creation
      const organizationId = repository.organizationId;

      // Store regression analysis results
      const regressionTestingReport = await this.prisma.regressionReport.create(
        {
          data: {
            repositoryId,
            prNumber,
            status: 'COMPLETED',
            summary: regressionAnalysis.summary,
            impactedFlows: regressionAnalysis.impactedFlows,
            testCases: regressionAnalysis.testCases,
            potentialBreakages: regressionAnalysis.potentialBreakages,
            changedBehavior: regressionAnalysis.changedBehavior,
            organizationId,
          },
        },
      );

      return {
        reportId: regressionTestingReport.id,
        ...regressionAnalysis,
      };
    } catch (error) {
      console.error('❌ Error in analyzeRegressionImpact:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Fetches commit information for a PR to get the latest commit and its parent
   * @param repository Repository object
   * @param prNumber PR number
   * @param credentials Account credentials for API access
   * @returns Object containing the latest commit SHA and its parent commit SHA
   */
  private async _fetchPrCommitInfo(
    repository: any,
    prNumber: number,
    credentials: any,
  ): Promise<{ latestCommitSha: string; parentCommitSha: string } | null> {
    try {
      if (credentials.accountType === AccountCredentialsType.GITHUB_TOKEN) {
        // GitHub PR commit info retrieval
        const url = `https://api.github.com/repos/${repository.owner}/${repository.name}/pulls/${prNumber}/commits`;
        const response = await axios.get(url, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `Bearer ${credentials.decryptedToken}`,
          },
        });

        if (response.data && response.data.length > 0) {
          // Get the latest commit (last in the array)
          const latestCommit = response.data[response.data.length - 1];
          const latestCommitSha = latestCommit.sha;

          // Get the parent commit of the latest commit
          if (latestCommit.parents && latestCommit.parents.length > 0) {
            const parentCommitSha = latestCommit.parents[0].sha;
            return { latestCommitSha, parentCommitSha };
          }
        }
      } else if (
        credentials.accountType === AccountCredentialsType.BITBUCKET_TOKEN
      ) {
        // Bitbucket PR commit info retrieval
        const workspace = credentials.payload.workspace.replace(' ', '-');
        const repo = repository.name.replace(' ', '-');

        const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prNumber}/commits`;
        const response = await axios.get(url, {
          headers: {
            Authorization: `${credentials.decryptedToken}`,
          },
        });

        if (
          response.data &&
          response.data.values &&
          response.data.values.length > 0
        ) {
          // Get the latest commit (first in the values array)
          const latestCommit = response.data.values[0];
          const latestCommitSha = latestCommit.hash;

          // Get the parent commit of the latest commit
          if (latestCommit.parents && latestCommit.parents.length > 0) {
            const parentCommitSha = latestCommit.parents[0].hash;
            return { latestCommitSha, parentCommitSha };
          }
        }
      }

      // If we couldn't get commit information
      return null;
    } catch (error) {
      console.error(
        `Error fetching PR commit information for PR #${prNumber}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * Fetches file content from a specific branch
   * @param repository Repository object with provider details
   * @param filePath Path to the file
   * @param branch Branch name to fetch from
   * @param credentials Account credentials for API access
   * @returns File content as string
   */
  private async _fetchFileContent(
    repository: any,
    filePath: string,
    branch: string,
    credentials: any,
  ): Promise<string> {
    try {
      if (credentials.accountType === AccountCredentialsType.GITHUB_TOKEN) {
        // GitHub file retrieval
        const url = `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${branch}/${filePath}`;
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${credentials.decryptedToken}`,
          },
        });
        return response.data;
      } else {
        // Bitbucket file retrieval
        const workspace = credentials.payload.workspace.replace(' ', '-');
        const repo = repository.name.replace(' ', '-');
        const branchFormatted = branch.replace(' ', '-');

        const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/src/${branchFormatted}/${filePath}`;
        const response = await axios.get(url, {
          headers: {
            Authorization: `${credentials.decryptedToken}`,
          },
        });
        return response.data;
      }
    } catch (error) {
      console.error(
        `Error fetching file ${filePath} from ${branch}:`,
        error.message,
      );
      return ''; // Return empty string if file can't be fetched
    }
  }

  /**
   * Builds a dependency graph for files to track imports/exports relationships
   * @param fileDocumentation Array of file documentation records
   * @returns Map of file dependencies
   */
  private _buildDependencyGraph(fileDocumentation: any[]): any {
    try {
      // Track which files impact others and are impacted by others
      const impacts = {}; // filename -> [files it impacts]
      const impactedBy = {}; // filename -> [files that impact it]

      // Initialize maps
      fileDocumentation.forEach((doc) => {
        if (doc && doc.fullPath) {
          impacts[doc.fullPath] = [];
          impactedBy[doc.fullPath] = [];
        }
      });

      // Build the dependency graph
      fileDocumentation.forEach((sourceDoc) => {
        if (!sourceDoc || !sourceDoc.fullPath) return;

        // Get all imports from this file
        const imports = Array.isArray(sourceDoc.imports)
          ? sourceDoc.imports
          : [];

        imports.forEach((importPath) => {
          if (!importPath) return;

          try {
            // Find the file that matches this import (could be relative or absolute)
            const targetDoc = fileDocumentation.find((doc) => {
              if (!doc || !doc.fullPath) return false;

              try {
                // Handle relative paths, normalize paths for comparison
                const normalizedImport = this._normalizeImportPath(
                  importPath,
                  sourceDoc.fullPath,
                );
                return (
                  doc.fullPath === normalizedImport ||
                  doc.fullPath.endsWith(normalizedImport) ||
                  doc.name === importPath ||
                  doc.name === importPath + '.js' ||
                  doc.name === importPath + '.ts'
                );
              } catch (normError) {
                console.error('Error normalizing import path:', normError);
                return false;
              }
            });

            if (targetDoc) {
              // sourceDoc imports from targetDoc, so:
              // - sourceDoc is impacted by targetDoc
              // - targetDoc impacts sourceDoc
              impacts[targetDoc.fullPath].push(sourceDoc.fullPath);
              impactedBy[sourceDoc.fullPath].push(targetDoc.fullPath);
            }
          } catch (importError) {
            console.error(
              `Error processing import ${importPath}:`,
              importError,
            );
          }
        });
      });

      return { impacts, impactedBy };
    } catch (error) {
      console.error('Error building dependency graph:', error);
      // Return empty structure that won't break the code
      return { impacts: {}, impactedBy: {} };
    }
  }

  /**
   * Normalizes import paths for dependency resolution
   */
  private _normalizeImportPath(importPath: string, sourcePath: string): string {
    // Handle relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // Get the directory of the source file
      const sourceDir = sourcePath.split('/').slice(0, -1).join('/');

      // Resolve relative path
      if (importPath.startsWith('./')) {
        return sourceDir + '/' + importPath.slice(2);
      } else {
        // Handle ../ by going up directories
        let result = sourceDir;
        const importParts = importPath.split('/');

        // For each '../', remove one directory from the result
        while (importParts[0] === '..') {
          result = result.split('/').slice(0, -1).join('/');
          importParts.shift();
        }

        return result + '/' + importParts.join('/');
      }
    }

    // Non-relative imports just return as is
    return importPath;
  }

  /**
   * Identifies flows affected by changed files
   * @param changedFiles Files with their content and metadata
   * @param fileDocumentation File documentation records
   * @param dependencyMap Dependency relationships between files
   * @returns Affected flows information
   */
  private async _identifyAffectedFlows(
    changedFiles: any[],
    fileDocumentation: any[],
    dependencyMap: any,
  ): Promise<any> {
    try {
      // Identify function-level changes in each file
      const changedFunctions = changedFiles.map((file) => {
        try {
          // Parse previous and current content to identify function changes
          // Use safe handling for extracting functions
          let previousFunctions = [];
          let currentFunctions = [];

          try {
            if (file.previousContent) {
              previousFunctions = this._extractFunctions(file.previousContent);
            }
          } catch (prevError) {
            console.error(
              `Error extracting previous functions for ${file.filename}:`,
              prevError,
            );
          }

          try {
            if (file.currentContent) {
              currentFunctions = this._extractFunctions(file.currentContent);
            }
          } catch (currError) {
            console.error(
              `Error extracting current functions for ${file.filename}:`,
              currError,
            );
          }

          // Compare the functions to find changes - with safe handling of null/undefined
          const addedFunctions = currentFunctions.filter(
            (fn) =>
              !previousFunctions.some((prevFn) => prevFn.name === fn.name),
          );

          const modifiedFunctions = currentFunctions.filter((fn) =>
            previousFunctions.some(
              (prevFn) => prevFn.name === fn.name && prevFn.body !== fn.body,
            ),
          );

          const removedFunctions = previousFunctions.filter(
            (fn) => !currentFunctions.some((currFn) => currFn.name === fn.name),
          );

          return {
            filename: file.filename,
            addedFunctions,
            modifiedFunctions,
            removedFunctions,
          };
        } catch (fileError) {
          console.error(
            `Error analyzing functions in file ${file.filename}:`,
            fileError,
          );
          return {
            filename: file.filename,
            addedFunctions: [],
            modifiedFunctions: [],
            removedFunctions: [],
            error: fileError.message,
          };
        }
      });

      // Find all files that directly or indirectly depend on changed files
      const affectedFiles = new Set<string>();

      // First, add directly changed files
      changedFiles.forEach((file) => {
        if (file && file.filename) {
          affectedFiles.add(file.filename);
        }
      });

      // Then, recursively add all files that import from changed files
      let newFilesAdded = true;
      let safetyCounter = 0;
      const maxIterations = 100; // Prevent infinite loops

      while (newFilesAdded && safetyCounter < maxIterations) {
        newFilesAdded = false;
        safetyCounter++;

        affectedFiles.forEach((filename) => {
          // Get files impacted by this file
          const impactedFiles = dependencyMap?.impacts?.[filename] || [];

          impactedFiles.forEach((impactedFile) => {
            if (impactedFile && !affectedFiles.has(impactedFile)) {
              affectedFiles.add(impactedFile);
              newFilesAdded = true;
            }
          });
        });
      }

      if (safetyCounter >= maxIterations) {
        console.warn(
          'Possible circular dependency detected in affected files analysis',
        );
      }

      // Map files to flows they're part of
      const fileFlowMap = {};
      changedFiles.forEach((file) => {
        if (file && file.filename) {
          // Identify flows this file is part of
          fileFlowMap[file.filename] = this._identifyFlowsForFile(
            file.filename,
            fileDocumentation,
          );
        }
      });

      return {
        changedFunctions,
        affectedFiles: Array.from(affectedFiles),
        fileFlowMap,
      };
    } catch (error) {
      console.error('Error in _identifyAffectedFlows:', error);
      // Return minimal valid structure to not break the calling code
      return {
        changedFunctions: [],
        affectedFiles: [],
        fileFlowMap: {},
      };
    }
  }

  /**
   * Extracts function definitions from code text
   * @param code Source code as string
   * @returns Array of identified functions with name and body
   */
  private _extractFunctions(code: string): any[] {
    if (!code) return [];
    const functions = [];

    try {
      // Determine probable language from code or file extension (can be enhanced)
      const language = this._detectLanguage(code);

      if (language === 'python') {
        // Python function extraction patterns
        this._extractPythonFunctions(code, functions);
      } else {
        // JavaScript/TypeScript function extraction patterns
        this._extractJSFunctions(code, functions);
      }

      return functions;
    } catch (error) {
      console.error('Error in _extractFunctions:', error);
      return []; // Return empty array on error
    }
  }

  /**
   * Detects language based on code patterns
   * @param code Source code
   * @returns Detected language string
   */
  private _detectLanguage(code: string): string {
    // Python indicators
    if (
      /def\s+[a-zA-Z0-9_]+\s*\(.*\):\s*(\n|$)/.test(code) ||
      /import\s+[a-zA-Z0-9_]+\s*$/.test(code) ||
      /from\s+[a-zA-Z0-9_.]+\s+import\s+/.test(code)
    ) {
      return 'python';
    }

    // Default to JavaScript/TypeScript
    return 'javascript';
  }

  /**
   * Extracts Python functions from code
   * @param code Python source code
   * @param functions Array to populate with functions
   */
  private _extractPythonFunctions(code: string, functions: any[]): void {
    // Match Python function definitions - note the indentation handling
    const pythonFunctionPattern =
      /def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)(?:\s*->.*?)?\s*:(?:\s*(?:#[^\n]*)?)(?:\n(?:[ \t]+[^\n]+\n?)+)/g;

    let match;
    let loopProtection = 0;
    const maxIterations = 1000;

    try {
      while (
        (match = pythonFunctionPattern.exec(code)) !== null &&
        loopProtection < maxIterations
      ) {
        loopProtection++;

        if (!match[1]) continue;

        const name = match[1].trim();
        const params = match[2] || '';
        const body = match[0].substring(match[0].indexOf(':') + 1).trim();

        // Process params for Python
        let processedParams = [];
        if (params && params.trim().length > 0) {
          processedParams = params.split(',').map((p) => {
            // Handle Python param with default value or type annotation
            const paramParts = p.trim().split('=')[0].split(':')[0];
            return paramParts.trim();
          });
        }

        functions.push({
          name,
          params: processedParams,
          body,
          text: match[0],
          language: 'python',
        });
      }
    } catch (error) {
      console.error('Error extracting Python functions:', error);
    }
  }

  /**
   * Extracts JavaScript/TypeScript functions from code
   * @param code JS/TS source code
   * @param functions Array to populate with functions
   */
  private _extractJSFunctions(code: string, functions: any[]): void {
    // Remove comments to avoid false positives
    const codeWithoutComments = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

    // Patterns specifically designed to avoid if/catch blocks and properly identify functions
    const jsFunctionPatterns = [
      // Named function declarations (avoiding if/else/catch/for blocks)
      /(?<!if|else|catch|for|while|switch|=>)\s*function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*(?:{|\n\s*{)(?:\s*)([\s\S]*?)(?:\n*}\s*(?:;|,|\n|$))/g,

      // Arrow functions with explicit variable assignment
      /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(?([^)=]*)\)?\s*=>\s*(?:{([\s\S]*?})|([^;{]+)(?:;|$))/g,

      // Class methods (including static, async)
      /(?:async\s+|static\s+|public\s+|private\s+|protected\s+)*(?:get\s+|set\s+)?([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*(?:{|\n\s*{)(?:\s*)([\s\S]*?)(?:\n*}\s*(?:;|,|\n|$))/g,

      // Object method definitions
      /([a-zA-Z0-9_$]+)\s*:\s*(?:async\s*)?\s*function\s*\(([^)]*)\)\s*(?:{|\n\s*{)(?:\s*)([\s\S]*?)(?:\n*}\s*(?:;|,|\n|$))/g,

      // Object method shorthand
      /([a-zA-Z0-9_$]+)\s*(?:\(([^)]*)\))(?:\s*{|\n\s*{)(?:\s*)([\s\S]*?)(?:\n*}\s*(?:;|,|\n|$))/g,
    ];

    // Process each pattern
    for (const pattern of jsFunctionPatterns) {
      let match;
      let loopProtection = 0;
      const maxIterations = 1000;

      try {
        while (
          (match = pattern.exec(codeWithoutComments)) !== null &&
          loopProtection < maxIterations
        ) {
          loopProtection++;

          // Skip if no function name found
          if (!match[1]) continue;

          // Skip if the match looks like a control structure
          const firstLine = match[0].split('\n')[0].trim();
          if (/^\s*(if|else|for|while|switch|catch)\s*\(/.test(firstLine)) {
            continue;
          }

          const name = match[1].trim();
          const params = match[2] || '';
          const body = (match[3] || match[4] || '').trim();

          // Skip if it looks like a non-function block
          if (name.match(/^(if|else|for|while|switch|catch)$/)) {
            continue;
          }

          // Process params
          let processedParams = [];
          if (params && params.trim().length > 0) {
            processedParams = params.split(',').map((p) => {
              // Handle TS param with type annotation or default value
              return p.trim().split(':')[0].split('=')[0].trim();
            });
          }

          functions.push({
            name,
            params: processedParams,
            body,
            text: match[0],
            language: 'javascript',
          });
        }

        if (loopProtection >= maxIterations) {
          console.warn(
            'JS function extraction reached iteration limit, possible infinite loop prevented',
          );
        }
      } catch (patternError) {
        console.error('Error in JS regex pattern processing:', patternError);
      }
    }
  }

  /**
   * Identifies business flows that a file is part of
   * @param filename Name of the file
   * @param fileDocumentation File documentation records
   * @returns Array of flow identifiers
   */
  private _identifyFlowsForFile(
    filename: string,
    fileDocumentation: any[],
  ): string[] {
    // This is a heuristic-based flow identification
    const flows = new Set<string>();

    // Get this file's documentation
    const fileDoc = fileDocumentation.find((doc) => doc.fullPath === filename);
    if (!fileDoc) return [];

    // Extract flow hints from file documentation
    if (fileDoc.summary) {
      // Look for flow indicators in summary
      const flowKeywords = [
        'authentication',
        'login',
        'register',
        'signup',
        'sign up',
        'checkout',
        'payment',
        'order',
        'purchase',
        'user profile',
        'settings',
        'configuration',
        'search',
        'filter',
        'sort',
        'pagination',
        'notification',
        'messaging',
        'chat',
        'upload',
        'download',
        'file handling',
        'admin',
        'dashboard',
        'analytics',
        'import',
        'export',
        'data processing',
        'api',
        'integration',
        'webhook',
      ];

      flowKeywords.forEach((keyword) => {
        if (fileDoc.summary.toLowerCase().includes(keyword.toLowerCase())) {
          flows.add(keyword);
        }
      });
    }

    // Identify flows based on file path patterns
    const pathParts = filename.toLowerCase().split('/');

    // Controller, service, and route files often represent specific flows
    if (
      pathParts.some((part) =>
        ['controller', 'service', 'route', 'api'].includes(part),
      )
    ) {
      // Extract the domain/feature name from the path
      const domainPart = pathParts.find(
        (part) =>
          ![
            'src',
            'app',
            'modules',
            'controller',
            'service',
            'route',
            'api',
            'js',
            'ts',
          ].includes(part),
      );

      if (domainPart) {
        flows.add(domainPart);
      }
    }

    // Look at file tags from documentation
    if (fileDoc.fileType && Array.isArray(fileDoc.fileType)) {
      fileDoc.fileType.forEach((tag: string) => {
        // SERVICE, CONTROLLER, API tags often represent flows
        if (['SERVICE', 'CONTROLLER', 'API'].includes(tag)) {
          // Extract domain from filename
          const filenameNoExt = fileDoc.name.replace(/\.(js|ts|jsx|tsx)$/, '');
          if (filenameNoExt.includes('.')) {
            const parts = filenameNoExt.split('.');
            flows.add(parts[0]); // Domain part
          } else if (filenameNoExt.includes('-')) {
            const parts = filenameNoExt.split('-');
            flows.add(parts[0]); // Domain part
          } else {
            // Extract domain by removing common suffixes
            const domain = filenameNoExt
              .replace(/Controller$/, '')
              .replace(/Service$/, '')
              .replace(/Repository$/, '')
              .replace(/Api$/, '');

            if (domain) flows.add(domain);
          }
        }
      });
    }

    return Array.from(flows);
  }

  /**
   * Rescans specific files after they've been changed (e.g., after PR merge)
   * @param repositoryId Repository ID
   * @param changedFiles Array of changed file paths
   * @param accountId User account ID
   * @returns Array of rescanned files with their documentation
   */
  async rescanChangedFiles(
    repositoryId: string,
    changedFiles: string[],
    accountId: string,
  ) {
    try {
      // Get account credentials
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

      // Get repository details
      const repository = await this.prisma.repository.findFirst({
        where: { id: repositoryId },
        include: {
          repositorySettings: true,
        },
      });

      if (!repository) {
        throw new Error(`Repository "${repositoryId}" not found.`);
      }

      // Get the latest COMPLETED scan record for this repository
      const repositoryScan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId: repositoryId,
          status: ScanStatus.COMPLETED,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!repositoryScan) {
        throw new Error('No previous completed scan found for this repository');
      }

      console.log(
        `Using existing scan ID: ${repositoryScan.id} for updating changed files`,
      );

      // Prepare file URLs based on repository provider and credentials
      const fileUrls = changedFiles.map((filePath) => {
        if (
          accountCredentials.accountType === AccountCredentialsType.GITHUB_TOKEN
        ) {
          return {
            name: filePath.split('/').pop(),
            filePath: `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${repository.baseBranch}/${filePath}`,
            fileRelativePath: filePath,
          };
        } else {
          // Bitbucket
          const workspace = accountCredentials.payload.workspace.replace(
            ' ',
            '-',
          );
          const repo = repository.name.replace(' ', '-');
          const branch = repository.baseBranch.replace(' ', '-');

          return {
            name: filePath.split('/').pop(),
            filePath: `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/src/${branch}/${filePath}`,
            fileRelativePath: filePath,
          };
        }
      });

      console.log(
        `Rescanning ${fileUrls.length} changed files for repository ${repository.name}`,
      );

      // Process files in batches to prevent overloading, but with update existing flag set to true
      const analyzedFiles = await this._processInBatches(
        fileUrls,
        10, // Smaller batch size for incremental updates
        (fileData) =>
          this.analyzeFiles(
            fileData,
            accountCredentials.decryptedToken,
            repository.id,
            repositoryScan.id,
            repository,
          ),
      );

      // Update scan status to show completion of update
      await this.prisma.repositoryScan.update({
        where: { id: repositoryScan.id },
        data: {
          totalFilesScanned:
            repositoryScan.totalFilesScanned + analyzedFiles.length,
          status: ScanStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Generate embeddings for the rescanned files
      await this.embedChangedFiles(repositoryScan.id);

      return {
        scanId: repositoryScan.id,
        filesScanned: analyzedFiles.length,
        status: ScanStatus.COMPLETED,
      };
    } catch (error) {
      console.error('Error rescanning changed files:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Generates embeddings only for files in a specific scan
   * @param scanId ID of the repository scan
   * @returns Success status
   */
  async embedChangedFiles(scanId: string) {
    try {
      const fileDocs = await this.prisma.fileDocumentation.findMany({
        where: {
          repositoryScanId: scanId,
        },
      });

      // Import Gemini helper
      const { Gemini } = await import(
        '../../config/helpers/ai/gemini.ai.helper'
      );
      const gemini = new Gemini();

      // Process files in smaller batches for embedding
      const batchSize = 10;
      for (let i = 0; i < fileDocs.length; i += batchSize) {
        const batch = fileDocs.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (doc) => {
            if (!doc.summary) return;

            try {
              // Convert the summary string to embeddings - ensure it's a string
              const embedding = await gemini.getEmbeddings(
                typeof doc.summary === 'string'
                  ? doc.summary
                  : String(doc.summary),
              );

              // Store embeddings as JSON
              // await this.prisma.fileDocumentation.update({
              //   where: { id: doc.id },
              //   data: {
              //     summaryEmbedding: embedding,
              //   },
              // });

              // The below uses raw SQL to update the vector field directly
              // Uncomment if your database supports vector operations

              await this.prisma.$executeRaw`
                UPDATE "FileDocumentation"
                SET "summaryEmbedding" = ${embedding}::vector
                WHERE id = ${doc.id}
              `;
            } catch (err) {
              console.error(`Error embedding file doc ${doc.id}:`, err);
            }
          }),
        );
      }

      return { success: true };
    } catch (error) {
      console.error('Error embedding changed files:', error);
      throw new BadRequestException(error.message);
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

  private _identifyExportsUsed(
    exportingFile: any,
    importingFile: any,
  ): string[] {
    if (!exportingFile || !importingFile) return [];

    // Extract exports from exporting file
    const exports = exportingFile.exports || [];

    // For now, we'll return all exports as potential usage
    // In a more sophisticated implementation, you'd analyze the importing
    // file's code to see which specific exports are used
    return exports;
  }

  /**
   * Analyzes code to extract variables and their usage
   * @param fileContent Source code content
   * @returns Object containing variables defined and used
   */
  private _analyzeVariableUsage(fileContent: string): {
    defined: Set<string>;
    used: Set<string>;
  } {
    if (!fileContent) {
      return { defined: new Set(), used: new Set() };
    }

    const defined = new Set<string>();
    const used = new Set<string>();

    try {
      // Detect defined variables (declarations)
      // Match variable declarations like: const x = ..., let y = ..., var z = ...
      const declarationRegex =
        /(?:const|let|var)\s+([a-zA-Z0-9_$]+)(?:\s*=|\s*,|\s*;)/g;
      let match;
      while ((match = declarationRegex.exec(fileContent)) !== null) {
        defined.add(match[1]);
      }

      // Match function and class declarations
      const funcRegex = /function\s+([a-zA-Z0-9_$]+)/g;
      while ((match = funcRegex.exec(fileContent)) !== null) {
        defined.add(match[1]);
      }

      const classRegex = /class\s+([a-zA-Z0-9_$]+)/g;
      while ((match = classRegex.exec(fileContent)) !== null) {
        defined.add(match[1]);
      }

      // Match arrow functions with explicit names
      const arrowFuncRegex =
        /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/g;
      while ((match = arrowFuncRegex.exec(fileContent)) !== null) {
        defined.add(match[1]);
      }

      // Match export declarations
      const exportRegex =
        /export\s+(?:const|let|var|function|class)\s+([a-zA-Z0-9_$]+)/g;
      while ((match = exportRegex.exec(fileContent)) !== null) {
        defined.add(match[1]);
      }

      // Match exports from object literals (export { x, y })
      const exportObjRegex = /export\s*\{\s*([^}]+)\s*\}/g;
      while ((match = exportObjRegex.exec(fileContent)) !== null) {
        const exportsList = match[1].split(',');
        exportsList.forEach((exp) => {
          const trimmed = exp.trim().split(' as ')[0].trim();
          defined.add(trimmed);
        });
      }

      // Detect variable usage (more complex)
      // We'll focus on variable names in expressions, avoiding declarations
      // This is a simplified approach - a proper parser would be more accurate

      // Remove all strings to avoid false positives
      const contentWithoutStrings = fileContent.replace(
        /'[^']*'|"[^"]*"|`[^`]*`/g,
        '',
      );

      // Split code into words and analyze each
      const words = contentWithoutStrings.split(/[\s.(){},;=+\-*/%[\]<>!&|:?]/);

      words.forEach((word) => {
        // Only consider valid variable names that aren't keywords
        const isValidName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(word);
        const keywords = [
          'if',
          'else',
          'for',
          'while',
          'do',
          'switch',
          'case',
          'break',
          'return',
          'continue',
          'try',
          'catch',
          'finally',
          'throw',
          'new',
          'function',
          'class',
          'import',
          'export',
          'default',
          'const',
          'let',
          'var',
          'this',
          'super',
          'true',
          'false',
          'null',
          'undefined',
        ];

        if (isValidName && !keywords.includes(word) && word !== '') {
          used.add(word);
        }
      });
    } catch (error) {
      console.error('Error analyzing variable usage:', error);
    }

    return { defined, used };
  }

  /**
   * Detects variables used in a file but not defined there
   * @param fileContent Source code of the file
   * @returns Set of variable names that are used but not defined
   */
  private _detectUndefinedVariables(
    fileContent: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    imports: string[],
  ): Set<string> {
    const { defined, used } = this._analyzeVariableUsage(fileContent);
    const undefinedVars = new Set<string>();

    // Check which used variables aren't defined in this file
    used.forEach((variable) => {
      if (!defined.has(variable)) {
        undefinedVars.add(variable);
      }
    });

    return undefinedVars;
  }

  /**
   * Finds all files that import from a given file
   * @param filePath Path of the file to find importers for
   * @param allFiles All file documentation records
   * @returns Array of file paths that import from the given file
   */
  private _findImportersOfFile(filePath: string, allFiles: any[]): string[] {
    const importers = [];

    // Get the file's name without extension for more flexible matching
    const fileName = filePath.split('/').pop();
    const fileNameWithoutExt = fileName.includes('.')
      ? fileName.substring(0, fileName.lastIndexOf('.'))
      : fileName;

    // Check each file to see if it imports the target file
    allFiles.forEach((file) => {
      if (!file.imports || !Array.isArray(file.imports)) return;

      // Check if this file imports the target file
      const importsTargetFile = file.imports.some((importPath) => {
        if (!importPath) return false;

        // Check various import patterns
        return (
          // Exact path match
          importPath === filePath ||
          // Ends with the file path (for absolute imports)
          importPath.endsWith(filePath) ||
          // Matches the file name
          importPath.endsWith(fileName) ||
          // Matches the file name without extension
          importPath.endsWith(fileNameWithoutExt) ||
          // For relative imports like './file' or '../file'
          importPath.endsWith(`./${fileNameWithoutExt}`) ||
          importPath.endsWith(`../${fileNameWithoutExt}`)
        );
      });

      if (importsTargetFile && file.fullPath) {
        importers.push(file.fullPath);
      }
    });

    return importers;
  }

  /**
   * Processes large PRs by chunking files and analyzing them in batches
   * This ensures we stay within AI context limits (60k tokens for Deepseek)
   */
  private async _analyzeRegressionImpactChunked(
    enhancedChangedFiles: any[],
    variableAnalysis: any[],
    affectedFlows: any,
    affectedDependencies: any,
  ) {
    console.log('Using chunked regression analysis strategy for large PR');
    const deepseekAI = new DeepSeek();
    const geminiAI = new Gemini();

    // Constants for chunking
    const MAX_FILES_PER_CHUNK = 3; // Adjusted down to ensure we stay well under token limits
    const MAX_CONTENT_LENGTH = 15000; // ~7k tokens, much less than DeepSeek's context

    // Sort files by importance - changed files first, then importers
    const sortedFiles = [...enhancedChangedFiles].sort((a, b) => {
      // Direct changes are more important than importers
      if (a.importerOnly && !b.importerOnly) return 1;
      if (!a.importerOnly && b.importerOnly) return -1;

      // Files with missing variables are most important
      const aAnalysis = variableAnalysis.find((v) => v.filename === a.filename);
      const bAnalysis = variableAnalysis.find((v) => v.filename === b.filename);

      const aMissingVars = aAnalysis?.missingVariables?.length || 0;
      const bMissingVars = bAnalysis?.missingVariables?.length || 0;

      if (aMissingVars !== bMissingVars) return bMissingVars - aMissingVars;

      // Finally sort by number of flows affected
      const aFlows = (affectedFlows.fileFlowMap[a.filename] || []).length;
      const bFlows = (affectedFlows.fileFlowMap[b.filename] || []).length;
      return bFlows - aFlows;
    });

    console.log('Sorted files by importance for chunked analysis');

    // Create chunks of files
    const fileChunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentChunkSize = 0;

    for (const file of sortedFiles) {
      // Estimate content length (this is approximate)
      const fileContentLength =
        (file.filename?.length || 0) +
        (file.previousContent?.length || 0) +
        (file.currentContent?.length || 0);

      // If adding this file would exceed our chunk size, start a new chunk
      if (
        currentChunk.length >= MAX_FILES_PER_CHUNK ||
        currentChunkSize + fileContentLength > MAX_CONTENT_LENGTH
      ) {
        if (currentChunk.length > 0) {
          fileChunks.push(currentChunk);
        }
        currentChunk = [file];
        currentChunkSize = fileContentLength;
      } else {
        currentChunk.push(file);
        currentChunkSize += fileContentLength;
      }
    }

    // Add the last chunk if it has files
    if (currentChunk.length > 0) {
      fileChunks.push(currentChunk);
    }

    console.log(`Created ${fileChunks.length} chunks for analysis`);

    // Process each chunk with the AI
    const chunkAnalysisResults = await Promise.all(
      fileChunks.map(async (chunk, index) => {
        console.log(
          `Processing chunk ${index + 1}/${fileChunks.length} with ${chunk.length} files`,
        );

        // For each chunk, create a more compact representation to send to AI
        const compactChunk = chunk.map((file) => {
          // Create a more concise representation with just essential data
          const compactFile = {
            filename: file.filename,
            patch: file.patch?.substring(0, 500) || '',
            previousContent: file.previousContent?.substring(0, 1000) || '',
            currentContent: file.currentContent?.substring(0, 1000) || '',
            functions: (file.functions || []).slice(0, 5),
            imports: (file.imports || []).slice(0, 5),
            exports: (file.exports || []).slice(0, 5),
            variableInfo:
              variableAnalysis.find((v) => v.filename === file.filename) || {},
            affectedFlows: (
              affectedFlows.fileFlowMap[file.filename] || []
            ).slice(0, 3),
            dependencyInfo: affectedDependencies[file.filename] || {
              importedChangedFiles: [],
              exportedToFiles: [],
            },
          };

          return compactFile;
        });

        // Try DeepSeek first, if it fails due to token limits, use Gemini
        try {
          console.log(`Analyzing chunk ${index + 1} with DeepSeek`);
          return await deepseekAI.analyzeRegressionImpact(compactChunk);
        } catch (error) {
          console.error(
            `DeepSeek analysis failed for chunk ${index + 1}:`,
            error.message,
          );
          console.log(`Falling back to Gemini for chunk ${index + 1}`);
          return await geminiAI.analyzeRegressionImpact(compactChunk);
        }
      }),
    );

    console.log(`Successfully analyzed ${chunkAnalysisResults.length} chunks`);

    // Merge the results from each chunk
    return this._mergeChunkResults(chunkAnalysisResults, fileChunks);
  }

  /**
   * Merge results from multiple chunk analyses into a single coherent report
   */
  private _mergeChunkResults(chunkResults: any[], fileChunks: any[][]): any {
    console.log('Merging chunk analysis results');

    // Initialize merged result structure
    const mergedResult = {
      summary: '',
      impactedFlows: [],
      testCases: [],
      potentialBreakages: [],
      changedBehavior: [],
    };

    // Generate combined summary
    const summaries = chunkResults
      .map((result) => result.summary || '')
      .filter(Boolean);
    mergedResult.summary = this._generateCombinedSummary(summaries, fileChunks);

    // Merge arrays from each chunk result
    chunkResults.forEach((result, index) => {
      // Merge impacted flows
      if (Array.isArray(result.impactedFlows)) {
        mergedResult.impactedFlows.push(...result.impactedFlows);
      }

      // Merge test cases
      if (Array.isArray(result.testCases)) {
        mergedResult.testCases.push(...result.testCases);
      }

      // Merge potential breakages
      if (Array.isArray(result.potentialBreakages)) {
        mergedResult.potentialBreakages.push(...result.potentialBreakages);
      }

      // Merge behavior changes
      if (Array.isArray(result.changedBehavior)) {
        mergedResult.changedBehavior.push(...result.changedBehavior);
      }
    });

    // Deduplicate results to avoid repetition
    mergedResult.impactedFlows = this._deduplicateByField(
      mergedResult.impactedFlows,
      'flowName',
    );
    mergedResult.testCases = this._deduplicateByField(
      mergedResult.testCases,
      'testName',
    );
    mergedResult.potentialBreakages = this._deduplicateByField(
      mergedResult.potentialBreakages,
      'area',
    );
    mergedResult.changedBehavior = this._deduplicateByField(
      mergedResult.changedBehavior,
      'component',
    );

    console.log('Finished merging chunk results');
    return mergedResult;
  }

  /**
   * Generate a combined summary from individual chunk summaries
   */
  private _generateCombinedSummary(
    summaries: string[],
    fileChunks: any[][],
  ): string {
    // Count total files analyzed
    const totalFiles = fileChunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // Create an intro sentence
    const intro = `Analysis of ${totalFiles} changed files revealed the following key impacts:`;

    // Extract key points from each summary
    let keyPoints: string[] = [];
    summaries.forEach((summary) => {
      // Split summary into sentences and take the most important ones
      const sentences = summary.split(/\.\s+/);
      const importantSentences = sentences
        .filter(
          (s) =>
            s.toLowerCase().includes('impact') ||
            s.toLowerCase().includes('change') ||
            s.toLowerCase().includes('break') ||
            s.toLowerCase().includes('risk'),
        )
        .slice(0, 2);

      keyPoints.push(...importantSentences);
    });

    // Remove duplicates and limit to top 5 points
    keyPoints = [...new Set(keyPoints)].slice(0, 5);

    // Format key points as bullet points
    const bulletPoints = keyPoints.map((point) => `• ${point}`).join('\n');

    // Create a summary from intro and bullet points
    return `${intro}\n\n${bulletPoints}`;
  }

  /**
   * Deduplicate array items by a specific field
   */
  private _deduplicateByField(items: any[], field: string): any[] {
    const uniqueMap = new Map();

    items.forEach((item) => {
      const key = item[field];
      if (key && !uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      }
    });

    return Array.from(uniqueMap.values());
  }

  /**
   * Create a compact file representation for AI analysis
   */
  private _createCompactFileRepresentation(
    file: any,
    variableAnalysis: any,
    affectedFlows: any[],
    dependencyInfo: any,
  ): any {
    return {
      filename: file.filename,
      patch: file.patch,
      previousContent: file.previousContent?.substring(0, 1500) || '',
      currentContent: file.currentContent?.substring(0, 1500) || '',
      functions: (file.functions || []).slice(0, 5),
      imports: (file.imports || []).slice(0, 5),
      exports: (file.exports || []).slice(0, 5),
      variableInfo: variableAnalysis || {},
      affectedFlows: affectedFlows || [],
      dependencyInfo: dependencyInfo || {
        importedChangedFiles: [],
        exportedToFiles: [],
      },
    };
  }

  /**
   * Retrieves regression testing reports for a repository with pagination
   * @param repositoryId Repository ID
   * @param options Pagination options
   * @returns Paginated list of regression reports
   */
  async getRegressionReports(
    repositoryId: string,
    options: {
      page: number;
      limit: number;
      status?: string;
    },
  ) {
    try {
      const { page, limit, status } = options;
      const skip = (page - 1) * limit;

      // Build the where clause based on the provided filters
      const whereClause: any = {
        repositoryId,
      };

      if (status) {
        whereClause.status = status;
      }

      // Count total matching records for pagination info
      const totalCount = await this.prisma.regressionReport.count({
        where: whereClause,
      });

      // Get the data with pagination
      const reports = await this.prisma.regressionReport.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc', // Most recent first
        },
        skip,
        // @ts-ignore
        take: parseInt(limit),
        include: {
          repository: {
            select: {
              name: true,
              owner: true,
              baseBranch: true,
            },
          },
        },
      });

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: reports.map((report) => ({
          id: report.id,
          repositoryId: report.repositoryId,
          repositoryName: report.repository.name,
          prNumber: report.prNumber,
          status: report.status,
          summary: report.summary,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
          impactedFlowsCount: Array.isArray(report.impactedFlows)
            ? report.impactedFlows.length
            : Object.keys(report.impactedFlows || {}).length,
          testCasesCount: Array.isArray(report.testCases)
            ? report.testCases.length
            : Object.keys(report.testCases || {}).length,
          potentialBreakagesCount: Array.isArray(report.potentialBreakages)
            ? report.potentialBreakages.length
            : Object.keys(report.potentialBreakages || {}).length,
        })),
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrevious: page > 1,
        },
      };
    } catch (error) {
      console.error('Error retrieving regression reports:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Retrieves a specific regression report by ID
   * @param reportId Regression report ID
   * @returns Detailed regression report
   */
  async getRegressionReportDetail(reportId: string) {
    try {
      const report = await this.prisma.regressionReport.findUnique({
        where: {
          id: reportId,
        },
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              owner: true,
              baseBranch: true,
            },
          },
        },
      });

      if (!report) {
        throw new NotFoundException(
          `Regression report with ID "${reportId}" not found`,
        );
      }

      // Convert JSON fields for better readability
      return {
        id: report.id,
        repositoryId: report.repositoryId,
        repository: report.repository,
        prNumber: report.prNumber,
        status: report.status,
        summary: report.summary,
        impactedFlows: report.impactedFlows,
        testCases: report.testCases,
        potentialBreakages: report.potentialBreakages,
        changedBehavior: report.changedBehavior,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
      };
    } catch (error) {
      console.error('Error retrieving regression report detail:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Rescans missing files from repositories that were scanned the previous day
   * This should be called via a cron job that runs daily
   * Processes work through the BullMQ worker queue
   */
  async rescanMissingFiles() {
    try {
      console.log('Starting daily rescan of missing files...');

      // Get repositories that were scanned in the last 24 hours
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const recentScans = await this.prisma.repositoryScan.findMany({
        where: {
          createdAt: {
            gte: yesterday,
          },
          status: ScanStatus.COMPLETED, // Only consider completed scans
        },
        include: {
          repository: true,
          account: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      console.log(
        `Found ${recentScans.length} recent repository scans to check for missing files`,
      );

      if (recentScans.length === 0) {
        return { success: true, message: 'No recent scans to process' };
      }

      // Group scans by repository to avoid duplicate work
      // Take the latest scan for each repository
      const latestScanByRepo: Record<string, any> = {};
      recentScans.forEach((scan) => {
        if (
          !latestScanByRepo[scan.repositoryId] ||
          new Date(scan.createdAt) >
            new Date(latestScanByRepo[scan.repositoryId].createdAt)
        ) {
          latestScanByRepo[scan.repositoryId] = scan;
        }
      });

      // Process each repository's latest scan
      const rescannedFiles = [];

      for (const scan of Object.values(latestScanByRepo)) {
        const typedScan = scan as any; // Type assertion for TypeScript
        const repo = typedScan.repository;
        const accountId = typedScan.accountId;

        console.log(`Processing repository: ${repo.name} (ID: ${repo.id})`);

        try {
          // Get account credentials for repository access
          const accountCredentials =
            await this.accountCredentialService.getAccountToken({ accountId });

          // Fetch complete file structure from the repository
          let repositoryStructure;
          if (
            accountCredentials.accountType ===
            AccountCredentialsType.GITHUB_TOKEN
          ) {
            repositoryStructure = await githubRepositoryAccess({
              owner: repo.owner,
              repo: repo.name,
              branch: repo.baseBranch,
              token: accountCredentials.decryptedToken,
            });
          } else {
            repositoryStructure = await bitbucketRepositoryAccess({
              workspace: accountCredentials.payload.workspace.replace(' ', '-'),
              repo: repo.name.replace(' ', '-'),
              branch: repo.baseBranch.replace(' ', '-'),
              token: accountCredentials.decryptedToken,
            });
          }

          console.log(
            `Found ${repositoryStructure.length} files in repository structure`,
          );

          // Get all files that have been documented for this repository
          const documentedFiles = await this.prisma.fileDocumentation.findMany({
            where: {
              repositoryId: repo.id,
            },
            select: {
              fullPath: true,
            },
          });

          const documentedPaths = new Set(
            documentedFiles.map((f) => f.fullPath),
          );

          console.log(`Found ${documentedPaths.size} already documented files`);

          // Find files that exist in repository but aren't documented
          const missingFiles = repositoryStructure.filter((file) => {
            // Skip files that are already documented
            if (documentedPaths.has(file.fileRelativePath)) {
              return false;
            }

            // Skip unsupported file types (bin, images, etc.)
            const fileName = file.fileRelativePath.split('/').pop() || '';
            const fileExtension = fileName.includes('.')
              ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
              : '';

            // List of supported extensions for scanning
            // const supportedExtensions = [
            //   '.js',
            //   '.jsx',
            //   '.ts',
            //   '.tsx',
            //   '.py',
            //   '.rb',
            //   '.java',
            //   '.c',
            //   '.cpp',
            //   '.h',
            //   '.cs',
            //   '.php',
            //   '.go',
            //   '.rs',
            //   '.swift',
            //   '.kt',
            //   '.html',
            //   '.css',
            //   '.scss',
            //   '.json',
            //   '.xml',
            //   '.yaml',
            //   '.yml',
            //   '.md',
            //   '.txt',
            // ];

            // Skip if extension is not supported
            if (ignoredExtensionsForFileScan.includes(fileExtension)) {
              return false;
            }

            return true;
          });

          console.log(`Found ${missingFiles.length} missing files to scan`);

          // Process missing files using the BullMQ queue
          if (missingFiles.length > 0) {
            // Convert file objects to file paths for the queue
            const filePaths = missingFiles.map((file) => file.fileRelativePath);

            // Add a job to the BullMQ queue
            const jobsAdded = await queueChangedFilesScan(
              repo.id,
              filePaths,
              accountId,
            );

            // Update scan logs with the queued information
            await this.prisma.repositoryScan.update({
              where: { id: typedScan.id },
              data: {
                logs: {
                  set: `${typedScan.logs || ''}${new Date().toISOString()} - Queued ${jobsAdded} missing files for scanning\n`,
                },
              },
            });

            rescannedFiles.push({
              repositoryId: repo.id,
              repositoryName: repo.name,
              missingFilesCount: missingFiles.length,
              queuedFilesCount: jobsAdded,
              scanId: typedScan.id,
            });
          }
        } catch (repoError) {
          console.error(`Error processing repository ${repo.name}:`, repoError);
          // Continue to next repository
        }
      }

      console.log('Completed daily rescan setup - files queued for processing');
      return {
        success: true,
        message: `Processed ${Object.keys(latestScanByRepo).length} repositories`,
        rescannedFiles,
      };
    } catch (error) {
      console.error('Error in rescanMissingFiles:', error);
      return {
        success: false,
        message: `Failed to rescan missing files: ${error.message}`,
      };
    }
  }

  /**
   * Embeds specific files instead of the entire repository
   * @param repositoryId Repository ID
   * @param filePaths Array of file paths to embed
   * @returns Success status
   */
  async embedSpecificFiles(repositoryId: string, filePaths: string[]) {
    try {
      if (!filePaths || filePaths.length === 0) {
        return { success: true, message: 'No files to embed' };
      }

      // Get documentation for the specific files
      const fileDocs = await this.prisma.fileDocumentation.findMany({
        where: {
          repositoryId,
          fullPath: {
            in: filePaths,
          },
        },
      });

      console.log(`Found ${fileDocs.length} files to embed`);

      const gemini = new Gemini();

      // Process files in smaller batches for embedding
      const batchSize = 10;
      for (let i = 0; i < fileDocs.length; i += batchSize) {
        const batch = fileDocs.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (doc) => {
            if (!doc.summary) return;

            try {
              // Convert the summary string to embeddings - ensure it's a string
              const embedding = await gemini.getEmbeddings(
                typeof doc.summary === 'string'
                  ? doc.summary
                  : String(doc.summary),
              );

              // Store embeddings using raw SQL to update the vector field directly
              await this.prisma.$executeRaw`
                UPDATE "FileDocumentation"
                SET "summaryEmbedding" = ${embedding}::vector
                WHERE id = ${doc.id}
              `;
            } catch (err) {
              console.error(`Error embedding file doc ${doc.id}:`, err);
            }
          }),
        );
      }

      return { success: true, filesEmbedded: fileDocs.length };
    } catch (error) {
      console.error('Error embedding specific files:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Scans a specific file when requested during document retrieval
   * Used when a file is requested but not found in the database
   * Processes directly for API responses
   */
  async scanOnDemand(
    repositoryId: string,
    filePath: string,
    accountId: string,
  ) {
    try {
      // First check if the file already exists (just in case it was created since)
      const existingFile = await this.prisma.fileDocumentation.findFirst({
        where: {
          repositoryId,
          fullPath: filePath,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (existingFile) {
        console.log(
          `File documentation already exists for ${filePath}, returning existing documentation`,
        );
        return existingFile;
      }

      // Check if repository exists
      const repository = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
        include: {
          repositorySettings: true,
        },
      });

      if (!repository) {
        throw new NotFoundException(
          `Repository with ID ${repositoryId} not found`,
        );
      }

      // Get account credentials for repository access
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

      // Process the file directly to ensure quick API response
      console.log(
        `Processing file directly: ${filePath} in repository ${repositoryId}`,
      );

      const result = await queueOnDemandFileScan(
        repositoryId,
        filePath,
        accountId,
        true, // Process directly
        this.prisma,
        repository,
        accountCredentials,
      );

      if (!result.success) {
        console.error(
          `Direct processing failed for ${filePath}: ${result.error}`,
        );
        throw new BadRequestException(result.error || 'Failed to process file');
      }

      // Return the processed file documentation
      if (result.fileDoc) {
        return result.fileDoc;
      }

      // If we got a success but no fileDoc (should not happen), check if it's in the database now
      const processedDoc = await this.prisma.fileDocumentation.findFirst({
        where: {
          repositoryId,
          fullPath: filePath,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (processedDoc) {
        return processedDoc;
      }

      // If somehow we still don't have the document, provide a reasonable error response
      throw new BadRequestException(
        'File was processed but documentation not found. Please try again.',
      );
    } catch (error) {
      console.error(`Error in scanOnDemand for file ${filePath}:`, error);
      throw error;
    }
  }
}
