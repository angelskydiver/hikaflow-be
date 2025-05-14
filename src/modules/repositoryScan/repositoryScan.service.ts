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
import { repositoryScanQueue } from 'src/queue/repository.scan.queue';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import { BillingService } from '../billing/billing.service';
import { CommentService } from '../comment/comment.service';
import { CommentRequestType } from '../comment/dto/comment.request.dto';

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
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

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
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

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

      // Get security and code issues
      const securityIssues = await this._commentService.fetchRepositoryComments(
        scan.accountId,
        {
          repositoryId: repository.id,
          category: CommentRequestType.SECURITY_ISSUES,
          currentPage: '1',
          pageSize: '5',
          prId: '', // Empty string for non-PR comments
        },
      );
      const codeSmells = await this._commentService.fetchRepositoryComments(
        scan.accountId,
        {
          repositoryId: repository.id,
          category: CommentRequestType.CODE_ISSUES,
          currentPage: '1',
          pageSize: '5',
          prId: '', // Empty string for non-PR comments
        },
      );

      // Update scan status as COMPLETED
      await this.prisma.repositoryScan.update({
        where: { id: repositoryScanId },
        data: {
          totalFilesScanned: analyzedFiles.length,
          status: ScanStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Send email notification
      // await this._mailService.repositoryScanCompleteNotification({
      //   email: scan.account.user.email,
      //   adminName: scan.account.user.firstName,
      //   repositoryName: repository.name,
      //   totalFiles: scan.totalFiles,
      //   issuesFound: securityIssues.commentCount + codeSmells.commentCount,
      //   securityIssues: securityIssues.commentCount,
      //   codeSmells: codeSmells.commentCount,
      //   topSecurityIssues: securityIssues.comments.slice(0, 5).map((issue) => ({
      //     severity: issue.severity,
      //     title: issue.issue,
      //     description: issue.content,
      //   })),
      //   topCodeIssues: codeSmells.comments.slice(0, 5).map((issue) => ({
      //     severity: issue.severity,
      //     title: issue.issue,
      //     description: issue.content,
      //   })),
      //   reportUrl: `${process.env.HIKAFLOW_PORTAL_URL}/repository/${repository.id}/${repository.organizationId}`,
      // });

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

      // Enhanced check for project-level/domain-level questions with more patterns
      const isProjectLevelQuestion =
        /project|purpose|domain|target|user|customer|unique|feature|high[ -]level|overview|goal|aim|objective|what|why|how|main|core|key|primary|functionality|architecture|structure|design|pattern|flow|process/i.test(
          query,
        );

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

      const usedTags = uniqueTags.map((data) => data.tag).join(', ');

      const gemini = new Gemini();

      const embedding = await gemini.getEmbeddings(query);
      const vectorQuery = `[${embedding.join(',')}]`;

      // For project-level questions, we'll focus on key files based on tags first
      let projectContext;

      if (isProjectLevelQuestion) {
        // Define broader set of tags for project-level understanding
        projectContext = {
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

        // Start with the tag-based approach instead of README files
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

          // Only if we don't find enough tag-based files, look at README files
          if (tagBasedFiles.length < 3) {
            const readmeFiles = await this.prisma.fileDocumentation.findMany({
              where: {
                repositoryScanId,
                OR: [
                  { name: { contains: 'README', mode: 'insensitive' } },
                  {
                    name: { contains: 'package.json', mode: 'insensitive' },
                  },
                  { name: { contains: 'config', mode: 'insensitive' } },
                  { fullPath: { contains: 'README', mode: 'insensitive' } },
                ],
              },
            });

            // Add README files to the result set if they exist
            if (readmeFiles.length > 0) {
              tagBasedFiles = [...tagBasedFiles, ...readmeFiles];
            }
          }

          // Get source code for the files - Fix for the fullPath access
          let sourceCodeMapping;
          if (
            accountCredentials.accountType ===
            AccountCredentialsType.GITHUB_TOKEN
          ) {
            sourceCodeMapping = tagBasedFiles.map((data) => {
              const mappedData = this.mapDocumentFields(data);
              return axios.get(
                `https://raw.githubusercontent.com/${documentedFile[0].repository.owner}/${documentedFile[0].repository.name}/${documentedFile[0].repository.baseBranch}/${mappedData.filePath}`,
                {
                  headers: {
                    Authorization: `Bearer ${accountCredentials.decryptedToken}`,
                  },
                },
              );
            });
          } else {
            sourceCodeMapping = tagBasedFiles.map((data) => {
              const mappedData = this.mapDocumentFields(data);
              const payload = {
                workspace: accountCredentials.payload.workspace.replace(
                  ' ',
                  '-',
                ),
                repo: documentedFile[0].repository.name.replace(' ', '-'),
                branch: documentedFile[0].repository.baseBranch.replace(
                  ' ',
                  '-',
                ),
                token: accountCredentials.decryptedToken,
              };
              return axios.get(
                `https://api.bitbucket.org/2.0/repositories/${payload.workspace}/${payload.repo}/src/${payload.branch}/${mappedData.filePath}`,
                {
                  headers: {
                    Authorization: `${accountCredentials.decryptedToken}`,
                  },
                },
              );
            });
          }

          try {
            const sourceCodeResponses = await Promise.all(sourceCodeMapping);
            const filesWithCode = sourceCodeResponses.map((res, index) => ({
              summary: tagBasedFiles[index].summary,
              fileName: tagBasedFiles[index].name,
              sourceCode: res.data,
            }));

            const queryResponse = await gemini.generateAnswer(
              query,
              filesWithCode,
            );

            const assistedQuestionPayload = {
              question: query,
              answer: {
                response:
                  queryResponse.output.response.candidates[0].content.parts[0]
                    .text,
                filteredFiles: queryResponse.filesReferenced.map((data) => ({
                  name: data.fileName,
                  content:
                    typeof data.sourceCode === 'string'
                      ? data.sourceCode
                      : JSON.stringify(data.sourceCode),
                })),
              },
              repositoryId: repositoryId,
              scanId: repositoryScanId,
              tokenUtilized:
                queryResponse.output.response.usageMetadata.totalTokenCount,
              accountId,
            };

            const assistedQuestions =
              await this.prisma.assistedQuestions.create({
                data: assistedQuestionPayload,
              });

            // After creating the assistedQuestions record, log the usage
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

            return {
              id: assistedQuestions.id,
              response:
                queryResponse.output.response.candidates[0].content.parts[0]
                  .text,
              filteredFiles: queryResponse.filesReferenced.map((data) => ({
                name: data.fileName,
                content:
                  typeof data.sourceCode === 'string'
                    ? data.sourceCode
                    : JSON.stringify(data.sourceCode, null, 2),
              })),
            };
          } catch (error) {
            console.log('Error processing tag-based files:', error);
            // Continue with normal processing if tag-based file handling fails
          }
        }

        // Fallback to existing README approach if tag-based approach fails
      } else {
        projectContext = await gemini.getQueryContext(query, usedTags);
      }

      if (!projectContext.output.context || !projectContext.output.tag) {
        let result: any[] = await this.prisma.$queryRaw`
          SELECT
            name as fileName,
            summary,
            "fullPath" as filePath,
            imports,
            exports,
            functions,
            classes,
            components,
            "fileType" as fileType,
            1 - ("summaryEmbedding" <=> ${vectorQuery}::vector) as similarity
          FROM "FileDocumentation"
          WHERE 1 - ("summaryEmbedding" <=> ${vectorQuery}::vector) > 0.3
            AND "repositoryScanId" = ${repositoryScanId}
          ORDER BY similarity DESC
          LIMIT 15;
        `;

        const fileQuickInfo = result.map((data) => ({
          ...data,
          fileName: data.fileName,
          filePath: data.filepath,
          fileSummary: data.summary,
        }));

        // TODO: need to work here

        const filteredFiles = await gemini.filterRelevantFiles(
          query,
          fileQuickInfo,
        );

        result = result.filter((data) =>
          filteredFiles.output.some((file) => file.fileName === data.filename),
        );

        let sourceCodeMapping;

        if (
          accountCredentials.accountType === AccountCredentialsType.GITHUB_TOKEN
        ) {
          sourceCodeMapping = result.map((data) => {
            return axios.get(
              `https://raw.githubusercontent.com/${documentedFile[0].repository.owner}/${documentedFile[0].repository.name}/${documentedFile[0].repository.baseBranch}/${data.filepath}`,
              {
                headers: {
                  Authorization: `Bearer ${accountCredentials.decryptedToken}`,
                },
              },
            );
          });
        } else {
          sourceCodeMapping = result.map((data) => {
            const payload = {
              workspace: accountCredentials.payload.workspace.replace(' ', '-'),
              repo: documentedFile[0].repository.name.replace(' ', '-'),
              branch: documentedFile[0].repository.baseBranch.replace(' ', '-'),
              token: accountCredentials.decryptedToken,
            };
            return axios.get(
              `https://api.bitbucket.org/2.0/repositories/${payload.workspace}/${payload.repo}/src/${payload.branch}/${data.filepath}`,
              {
                headers: {
                  Authorization: `${accountCredentials.decryptedToken}`,
                },
              },
            );
          });
        }

        const sourceCodeResponses = await Promise.all(sourceCodeMapping);
        result = sourceCodeResponses.map((res, index) => ({
          ...result[index],
          sourceCode: res.data,
        }));

        const queryResponse = await gemini.generateAnswer(query, result);

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
                  : JSON.stringify(data.sourceCode),
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
        return {
          id: assistedQuestions.id,
          response:
            queryResponse.output.response.candidates[0].content.parts[0].text,
          filteredFiles: queryResponse.filesReferenced.map((data) => ({
            name: data.fileName,
            content:
              typeof data.sourceCode === 'string'
                ? data.sourceCode
                : JSON.stringify(data.sourceCode, null, 2),
          })),
        };
      } else {
        // all unique Tags used in project documentation
        let result: any = await this.prisma.fileDocumentation.findMany({
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
        const fileQuickInfo = result.map((data) => ({
          fileName: data.name,
          filePath: data.fullPath,
          fileSummary: data.summary,
          fileTags: data.tags,
        }));

        // TODO: need to work here

        const filteredFiles = await gemini.filterRelevantFiles(
          query,
          fileQuickInfo,
        );

        result = result.filter((data) =>
          filteredFiles.output.some((file) => file.fileName === data.name),
        );

        let sourceCodeMapping;

        if (
          accountCredentials.accountType === AccountCredentialsType.GITHUB_TOKEN
        ) {
          sourceCodeMapping = result.map((data) => {
            return axios.get(
              `https://raw.githubusercontent.com/${documentedFile[0].repository.owner}/${documentedFile[0].repository.name}/${documentedFile[0].repository.baseBranch}/${data.fullPath}`,
              {
                headers: {
                  Authorization: `Bearer ${accountCredentials.decryptedToken}`,
                },
              },
            );
          });
        } else {
          sourceCodeMapping = result.map((data) => {
            const payload = {
              workspace: accountCredentials.payload.workspace.replace(' ', '-'),
              repo: documentedFile[0].repository.name.replace(' ', '-'),
              branch: documentedFile[0].repository.baseBranch.replace(' ', '-'),
              token: accountCredentials.decryptedToken,
            };
            return axios.get(
              `https://api.bitbucket.org/2.0/repositories/${payload.workspace}/${payload.repo}/src/${payload.branch}/${data.fullPath}`,
              {
                headers: {
                  Authorization: `${accountCredentials.decryptedToken}`,
                },
              },
            );
          });
        }

        const sourceCodeResponses = await Promise.all(sourceCodeMapping);
        result = sourceCodeResponses.map((res, index) => ({
          ...result[index],
          sourceCode: res.data,
        }));

        result = result.map((data) => ({
          summary: data.summary,
          fileName: data.name,
          sourceCode: data.sourceCode,
        }));

        const queryResponse = await gemini.generateAnswer(query, result);
        // console.log(
        //   'queryResponse: ',
        //   JSON.stringify(queryResponse.output.response, null, 2),
        // );

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
                  : JSON.stringify(data.sourceCode),
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

        // After creating the assistedQuestions record, log the usage
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

        return {
          id: assistedQuestions.id,
          response:
            queryResponse.output.response.candidates[0].content.parts[0].text,
          filteredFiles: queryResponse.filesReferenced.map((data) => ({
            name: data.fileName,
            content:
              typeof data.sourceCode === 'string'
                ? data.sourceCode
                : JSON.stringify(data.sourceCode, null, 2),
          })), // Assuming you want to return the file name and content
        };
      }
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
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
      let parentCommitSha = null;

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

      // Create a map of file documentation for quick lookup
      const fileDocMap = {};
      fileDocumentation.forEach((doc) => {
        if (doc && doc.fullPath) {
          fileDocMap[doc.fullPath] = doc;
        }
      });

      // Get test files from the repository to understand test coverage
      const testFiles = fileDocumentation.filter(
        (doc) => doc.fileType && doc.fileType.includes('TEST'),
      );
      const testFilePaths = testFiles.map((file) => file.fullPath);

      // Define type for enhanced file
      type EnhancedFile = {
        filename: string;
        patch: string;
        documentation: any;
        functions: any;
        imports: any[];
        exports: any[];
        impactedBy: any[];
        impacts: any[];
        previousContent: string;
        currentContent: string;
        testCoverage: any[];
        modifiedFunctions?: any[];
      };

      // Prepare enhanced file data with content and metadata
      const enhancedChangedFiles = await Promise.all(
        changedFiles.map(async (file) => {
          // Skip if file is missing name
          if (!file.filename) {
            console.warn('Skipping file with missing filename');
            return null;
          }

          // Prepare file content and metadata
          const enhancedFile: EnhancedFile = {
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
            testCoverage: testFilePaths.filter(
              (testPath) =>
                testPath.includes(file.filename.replace(/\.[^/.]+$/, '')) ||
                testPath.includes(
                  file.filename
                    .split('/')
                    .pop()
                    .replace(/\.[^/.]+$/, ''),
                ),
            ),
          };

          // If content isn't already provided, fetch it from the repository
          if (!enhancedFile.previousContent) {
            try {
              enhancedFile.previousContent = await this._fetchFileContent(
                repository,
                file.filename,
                parentCommitSha,
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
                latestCommitSha,
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

          // Analyze diff to identify exact function changes
          if (enhancedFile.previousContent && enhancedFile.currentContent) {
            const previousFunctions = this._extractFunctions(
              enhancedFile.previousContent,
            );
            enhancedFile.modifiedFunctions = this._identifyModifiedFunctions(
              previousFunctions,
              enhancedFile.functions,
            );
          }

          return enhancedFile;
        }),
      );

      // Filter out null entries
      const filteredFiles = enhancedChangedFiles.filter(
        Boolean,
      ) as EnhancedFile[];

      // Identify affected flows based on dependencies
      const affectedFlows = await this._identifyAffectedFlows(
        filteredFiles,
        fileDocumentation,
        dependencyMap,
      );

      // Analyze variable usage to detect undefined variables and find pattern changes
      const variableAnalysis = filteredFiles.map((file) => {
        const fileExtension = file.filename.split('.').pop()?.toLowerCase();
        const language = this._detectLanguage(file.currentContent || '');
        const previousVariableUsage = file.previousContent
          ? this._analyzeVariableUsage(file.previousContent)
          : { defined: new Set(), used: new Set() };
        const currentVariableUsage = this._analyzeVariableUsage(
          file.currentContent || '',
        );

        // Identify changes in variable usage patterns
        const newVariables = Array.from(currentVariableUsage.defined).filter(
          (v) => !previousVariableUsage.defined.has(v as string),
        );
        const removedVariables = Array.from(
          previousVariableUsage.defined,
        ).filter((v) => !currentVariableUsage.defined.has(v as string));
        const newUsages = Array.from(currentVariableUsage.used).filter(
          (v) => !previousVariableUsage.used.has(v as string),
        );

        const docType = this.mapFileTypeToDocumentationType(
          file.filename.split('.').pop() || '',
        );

        return {
          filename: file.filename,
          language,
          variables: {
            defined: Array.from(currentVariableUsage.defined),
            used: Array.from(currentVariableUsage.used),
            newlyDefined: newVariables,
            removed: removedVariables,
            newUsages: newUsages,
          },
          potentialUndefined: this._detectUndefinedVariables(
            file.currentContent || '',
            file.imports || [],
          ),
        };
      });

      // Analyze dependencies across files to find potential breakages
      const affectedDependencies = this._analyzeAffectedDependencies(
        filteredFiles,
        filteredFiles.map((f) => f.filename),
        dependencyMap,
      );

      // Identify API changes that could break consumers
      const apiChanges = this._identifyAPIChanges(
        filteredFiles,
        fileDocumentation,
      );

      // Generate test requirements based on the changes
      const testRequirements = [];
      for (const flow of Object.keys(affectedFlows.flows || {})) {
        const flowFiles = affectedFlows.flows[flow] || [];
        const requirements = this._generateTestRequirements(
          flow,
          flowFiles,
          variableAnalysis,
          filteredFiles.flatMap((f) => f.modifiedFunctions || []),
        );
        if (Array.isArray(requirements)) {
          testRequirements.push(...requirements);
        } else if (requirements) {
          // If it's an object with a details array, add those details
          if (requirements.details && Array.isArray(requirements.details)) {
            testRequirements.push(...requirements.details);
          }
        }
      }

      // Use DeepSeek AI for regression analysis
      const deepseekAI = new DeepSeek();
      const geminiAI = new Gemini(); // Gemini as potential fallback

      console.log(
        `Performing regression analysis on ${filteredFiles.length} files`,
      );

      // Break analysis into manageable chunks to avoid context window limitations
      const MAX_FILES_PER_CHUNK = 5;
      const fileChunks = [];
      for (let i = 0; i < filteredFiles.length; i += MAX_FILES_PER_CHUNK) {
        fileChunks.push(filteredFiles.slice(i, i + MAX_FILES_PER_CHUNK));
      }

      // Process analysis in chunks
      let regressionAnalysis = null;
      try {
        if (fileChunks.length > 1) {
          console.log(
            `Breaking analysis into ${fileChunks.length} chunks due to size`,
          );

          // Process each chunk separately
          const chunkResults = await this._analyzeRegressionImpactChunked(
            fileChunks,
            variableAnalysis,
            affectedFlows,
            affectedDependencies,
          );

          // Merge results
          regressionAnalysis = this._mergeChunkResults(
            chunkResults,
            fileChunks,
          );
        } else {
          // For small changes, analyze everything at once
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
              testCoverage: file.testCoverage || [],
              modifiedFunctions: file.modifiedFunctions || [],
            })),
          );
        }
      } catch (error) {
        console.error('Error with DeepSeek analysis:', error);

        // Fallback to Gemini if DeepSeek fails
        try {
          console.log('Falling back to Gemini for analysis');
          regressionAnalysis = await geminiAI.analyzeRegressionImpact(
            filteredFiles.map((file) => ({
              filename: file.filename,
              patch: file.patch,
              previousContent: file.previousContent || '',
              currentContent: file.currentContent || '',
              functions: file.functions || [],
              imports: file.imports || [],
              exports: file.exports || [],
              affectedFlows: affectedFlows.fileFlowMap[file.filename] || [],
            })),
          );
        } catch (geminiError) {
          console.error('Both AI analyses failed:', geminiError);
          // Continue with partial results
        }
      }

      // Add confidence scores to results
      if (regressionAnalysis) {
        regressionAnalysis.confidenceScores = {
          overall: this._calculateConfidenceScore(
            filteredFiles,
            variableAnalysis,
            affectedFlows,
            testRequirements,
          ),
          byFlow: Object.keys(affectedFlows.flows || {}).reduce((acc, flow) => {
            acc[flow] = this._calculateFlowConfidenceScore(
              flow,
              affectedFlows.flows[flow] || [],
              testRequirements,
              variableAnalysis,
            );
            return acc;
          }, {}),
        };
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
            testCases: regressionAnalysis?.testCases || testRequirements || [],
            potentialBreakages: regressionAnalysis?.potentialBreakages || [],
            changedBehavior: regressionAnalysis?.changedBehavior || [],
            organizationId: repository.organizationId,
          },
        },
      );

      return {
        reportId: regressionTestingReport.id,
        confidenceScores: regressionAnalysis?.confidenceScores || {
          overall: 0.5,
        },
        ...regressionAnalysis,
      };
    } catch (error) {
      console.error('Error in analyzeRegressionImpactEnhanced:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Analyzes regression impact in chunks to avoid context window limitations
   * @param fileChunks Arrays of files split into manageable chunks
   * @param variableAnalysis Variable usage analysis
   * @param affectedFlows Flow information
   * @param affectedDependencies Dependency information
   * @returns Combined analysis results
   */
  private async _analyzeRegressionImpactChunked(
    fileChunks: any[][],
    variableAnalysis: any[],
    affectedFlows: any,
    affectedDependencies: any,
  ) {
    const deepseekAI = new DeepSeek();
    const results = [];

    // Create compact file representations to reduce context size
    const compactFileChunks = fileChunks.map((chunk) =>
      chunk.map((file) =>
        this._createCompactFileRepresentation(
          file,
          variableAnalysis.find((v) => v.filename === file.filename),
          affectedFlows.fileFlowMap[file.filename] || [],
          affectedDependencies[file.filename] || {},
        ),
      ),
    );

    // Analyze each chunk
    for (let i = 0; i < compactFileChunks.length; i++) {
      try {
        console.log(`Analyzing chunk ${i + 1}/${compactFileChunks.length}`);
        const chunkResult = await deepseekAI.analyzeRegressionImpact(
          compactFileChunks[i],
        );
        results.push(chunkResult);
      } catch (error) {
        console.error(`Error analyzing chunk ${i + 1}:`, error);
        // Continue with other chunks
      }
    }

    return results;
  }

  /**
   * Merges results from chunked analysis
   * @param chunkResults Results from each analyzed chunk
   * @param fileChunks Original file chunks
   * @returns Combined analysis
   */
  private _mergeChunkResults(chunkResults: any[], fileChunks: any[][]) {
    // Start with empty result structure
    const merged = {
      summary: '',
      impactedFlows: [],
      testCases: [],
      potentialBreakages: [],
      changedBehavior: [],
    };

    // Merge each section
    chunkResults.forEach((result, index) => {
      if (!result) return;

      // Merge arrays with deduplication
      merged.impactedFlows = this._deduplicateByField(
        [...merged.impactedFlows, ...(result.impactedFlows || [])],
        'flow',
      );

      merged.testCases = this._deduplicateByField(
        [...merged.testCases, ...(result.testCases || [])],
        'scenario',
      );

      merged.potentialBreakages = this._deduplicateByField(
        [...merged.potentialBreakages, ...(result.potentialBreakages || [])],
        'description',
      );

      merged.changedBehavior = this._deduplicateByField(
        [...merged.changedBehavior, ...(result.changedBehavior || [])],
        'description',
      );
    });

    // Generate a combined summary
    const summaries = chunkResults
      .filter((r) => r && r.summary)
      .map((r) => r.summary);

    merged.summary = this._generateCombinedSummary(summaries, fileChunks);

    return merged;
  }

  /**
   * Generates a unified summary from chunk summaries
   * @param summaries Individual chunk summaries
   * @param fileChunks Original file chunks
   * @returns Combined summary
   */
  private _generateCombinedSummary(summaries: string[], fileChunks: any[][]) {
    if (summaries.length === 0) return 'No analysis results available.';
    if (summaries.length === 1) return summaries[0];

    // Count total files analyzed
    const totalFiles = fileChunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // Extract key points from each summary
    const keyPoints = summaries.flatMap((summary) => {
      const lines = summary
        .split('\n')
        .filter((line) => line.trim().length > 0);
      return lines.filter(
        (line) =>
          !line.toLowerCase().startsWith('analyzed') &&
          !line.toLowerCase().startsWith('this pr') &&
          line.length > 15,
      );
    });

    // Deduplicate points
    const uniquePoints = Array.from(new Set(keyPoints));

    // Construct combined summary
    return (
      `Analysis of ${totalFiles} changed files across multiple chunks:\n\n` +
      uniquePoints.slice(0, 10).join('\n\n') +
      (uniquePoints.length > 10
        ? '\n\n...additional findings omitted for brevity'
        : '')
    );
  }

  /**
   * Deduplicates items in an array based on a field value
   * @param items Array of items to deduplicate
   * @param field Field to check for uniqueness
   * @returns Deduplicated array
   */
  private _deduplicateByField(items: any[], field: string): any[] {
    const seen = new Set();
    return items.filter((item) => {
      const value = item[field];
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  /**
   * Creates a compact representation of a file to reduce context size
   * @param file Full file data
   * @param variableAnalysis Variable analysis for the file
   * @param affectedFlows Flows affected by this file
   * @param dependencyInfo Dependency information
   * @returns Compact representation
   */
  private _createCompactFileRepresentation(
    file: any,
    variableAnalysis: any,
    affectedFlows: any[],
    dependencyInfo: any,
  ): any {
    // Extract just the changed parts from the diff
    const patchLines = file.patch?.split('\n') || [];
    const changedContext = patchLines
      .filter((line) => line.startsWith('+') || line.startsWith('-'))
      .join('\n');

    // Extract the most relevant parts of the file content
    const modifiedFunctions = file.modifiedFunctions || [];
    const modifiedFunctionBodies = modifiedFunctions
      .map((fn) => `${fn.name || 'anonymous'}:\n${fn.body || ''}`)
      .join('\n\n');

    return {
      filename: file.filename,
      functions: file.functions || [],
      imports: file.imports || [],
      exports: file.exports || [],
      impactedBy: file.impactedBy || [],
      impacts: file.impacts || [],
      affectedFlows: affectedFlows,
      patchSummary: changedContext,
      modifiedFunctions: modifiedFunctionBodies,
      variableChanges: variableAnalysis
        ? {
            newlyDefined: variableAnalysis.variables?.newlyDefined || [],
            removed: variableAnalysis.variables?.removed || [],
            newUsages: variableAnalysis.variables?.newUsages || [],
          }
        : {},
      dependsOn: dependencyInfo.dependsOn || [],
      dependedOnBy: dependencyInfo.dependedOnBy || [],
    };
  }

  /**
   * Identifies changes in APIs that could affect consumers
   * @param files Changed files with their content
   * @param fileDocumentation Documentation for all files
   * @returns API changes that might break consumers
   */
  private _identifyAPIChanges(files: any[], fileDocumentation: any[]) {
    const apiChanges = [];

    files.forEach((file) => {
      // Skip files without both previous and current content
      if (!file.previousContent || !file.currentContent) return;

      const previousFunctions = this._extractFunctions(file.previousContent);
      const currentFunctions = this._extractFunctions(file.currentContent);

      // Find consumers of this file
      const consumers = this._findImportersOfFile(
        file.filename,
        fileDocumentation,
      );

      // If this file is imported by others, check for API changes
      if (consumers.length > 0) {
        // Check for removed functions
        previousFunctions.forEach((prevFn) => {
          const stillExists = currentFunctions.some(
            (currFn) => currFn.name === prevFn.name,
          );

          if (!stillExists) {
            apiChanges.push({
              type: 'REMOVED_FUNCTION',
              file: file.filename,
              name: prevFn.name,
              consumers: consumers,
              risk: 'HIGH',
            });
          }
        });

        // Check for changed function signatures
        previousFunctions.forEach((prevFn) => {
          const currentFn = currentFunctions.find(
            (fn) => fn.name === prevFn.name,
          );

          if (currentFn && prevFn.params !== currentFn.params) {
            apiChanges.push({
              type: 'CHANGED_SIGNATURE',
              file: file.filename,
              name: prevFn.name,
              consumers: consumers,
              previousParams: prevFn.params,
              currentParams: currentFn.params,
              risk: 'HIGH',
            });
          }
        });
      }
    });

    return apiChanges;
  }

  /**
   * Identifies modified functions between two sets of function definitions
   * @param previousFunctions Functions from previous version
   * @param currentFunctions Functions from current version
   * @returns Modified functions with details about changes
   */
  private _identifyModifiedFunctions(
    previousFunctions: any[],
    currentFunctions: any[],
  ) {
    const modifiedFunctions = [];

    // Map functions by name for easier lookup
    const prevFunctionMap = {};
    previousFunctions.forEach((fn) => {
      if (fn.name) prevFunctionMap[fn.name] = fn;
    });

    // Find modified functions
    currentFunctions.forEach((currFn) => {
      if (!currFn.name) return; // Skip anonymous functions

      const prevFn = prevFunctionMap[currFn.name];

      // New function
      if (!prevFn) {
        modifiedFunctions.push({
          ...currFn,
          changeType: 'ADDED',
        });
        return;
      }

      // Check if function body or parameters changed
      if (prevFn.body !== currFn.body || prevFn.params !== currFn.params) {
        modifiedFunctions.push({
          ...currFn,
          changeType: 'MODIFIED',
          previousBody: prevFn.body,
          previousParams: prevFn.params,
        });
      }
    });

    // Find removed functions
    previousFunctions.forEach((prevFn) => {
      if (!prevFn.name) return; // Skip anonymous functions

      const stillExists = currentFunctions.some(
        (fn) => fn.name === prevFn.name,
      );

      if (!stillExists) {
        modifiedFunctions.push({
          ...prevFn,
          changeType: 'REMOVED',
        });
      }
    });

    return modifiedFunctions;
  }

  /**
   * Calculates overall confidence score for the regression analysis
   * @param files Changed files
   * @param variableAnalysis Variable analysis results
   * @param affectedFlows Flow analysis results
   * @param testRequirements Generated test requirements
   * @returns Confidence score between 0 and 1
   */
  private _calculateConfidenceScore(
    files: any[],
    variableAnalysis: any[],
    affectedFlows: any,
    testRequirements: any[],
  ) {
    let score = 0.5; // Default middle score

    // Factors that increase confidence
    if (testRequirements.length > 0) score += 0.1;
    if (files.every((f) => f.previousContent && f.currentContent)) score += 0.1;

    // Factors that decrease confidence
    const flowCount = Object.keys(affectedFlows.flows || {}).length;
    if (flowCount > 5) score -= 0.1;

    const undefinedVars = variableAnalysis.flatMap((v) =>
      Array.from(v.potentialUndefined || []),
    ).length;
    if (undefinedVars > 0) score -= 0.05;

    return Math.min(Math.max(score, 0.1), 0.95); // Keep between 0.1 and 0.95
  }

  /**
   * Calculates confidence score for a specific flow
   * @param flow Flow name
   * @param flowFiles Files in the flow
   * @param testRequirements Generated test requirements
   * @param variableAnalysis Variable analysis results
   * @returns Confidence score between 0 and 1
   */
  private _calculateFlowConfidenceScore(
    flow: string,
    flowFiles: string[],
    testRequirements: any[],
    variableAnalysis: any[],
  ) {
    let score = 0.5; // Default middle score

    // Factors that increase confidence
    const flowTests = testRequirements.filter(
      (test) => test.flow === flow || test.relatedFlows?.includes(flow),
    );
    if (flowTests.length > 0) score += 0.15;

    // Factors that decrease confidence
    const flowVarAnalysis = variableAnalysis.filter((v) =>
      flowFiles.includes(v.filename),
    );

    const undefinedVars = flowVarAnalysis.flatMap((v) =>
      Array.from(v.potentialUndefined || []),
    ).length;
    if (undefinedVars > 0) score -= 0.1;

    return Math.min(Math.max(score, 0.1), 0.95); // Keep between 0.1 and 0.95
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
      let parentCommitSha = null;

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
              parentCommitSha,
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
              latestCommitSha,
              accountCredentials,
            );
          }

          return fileWithContent;
        }),
      );

      console.log('enhancedChangedFiles', enhancedChangedFiles);
      console.log('fileDocumentation', fileDocumentation);
      console.log('dependencyMap', dependencyMap);

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

      console.log('regressionAnalysis', regressionAnalysis);

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

          // Only log if both extractions were successful
          if (previousFunctions && currentFunctions) {
            console.log('previousFunctions', previousFunctions);
            console.log('currentFunctions', currentFunctions);
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
    // Implement the logic to map document fields based on your data structure
    // This is a placeholder and should be replaced with the actual implementation
    return {
      fileName: data.name,
      filePath: data.fullPath,
      fileSummary: data.summary,
      fileType: data.fileType,
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

  // Add this method as a temporary placeholder since it's being called
  async scanOnDemand(
    repositoryId: string,
    filePath: string,
    accountId: string,
  ) {
    try {
      console.log(`On-demand scan requested for ${filePath}`);

      // Try to get existing file documentation first
      const fileDocumentation = await this.prisma.fileDocumentation.findFirst({
        where: {
          repositoryId,
          fullPath: filePath,
        },
        include: {
          repository: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (fileDocumentation) {
        return fileDocumentation;
      }

      // If we don't have documentation, throw an error
      throw new NotFoundException(`File not found: ${filePath}`);
    } catch (error) {
      console.error(`Error in scanOnDemand: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retrieves regression testing reports for a repository with pagination
   * @param repositoryId Repository ID
   * @param options Pagination and filtering options
   * @returns Paginated list of regression reports
   */
  async getRegressionReports(
    repositoryId: string,
    options: { page: number; limit: number; status?: string },
  ) {
    try {
      const { page = 1, limit = 10, status } = options;
      const skip = (page - 1) * limit;

      // Build the where clause for the query
      const where: any = { repositoryId };

      // Add status filter if provided
      if (status) {
        where.status = status;
      }

      // Get the total count for pagination
      const totalCount = await this.prisma.regressionReport.count({ where });

      // Fetch the paginated reports
      const reports = await this.prisma.regressionReport.findMany({
        where,
        skip,
        take: parseInt(limit.toString()),
        orderBy: { createdAt: 'desc' },
        include: {
          repository: {
            select: {
              name: true,
              owner: true,
            },
          },
        },
      });

      // Calculate pagination metadata
      const totalPages = Math.ceil(totalCount / limit);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

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
          page,
          limit,
          totalCount,
          totalPages,
          hasNextPage,
          hasPreviousPage,
        },
      };
    } catch (error) {
      console.error('Error retrieving regression reports:', error);
      throw new BadRequestException(
        error.message || 'Failed to retrieve regression reports',
      );
    }
  }

  /**
   * Retrieves a specific regression report by ID with detailed information
   * @param reportId The ID of the regression report to retrieve
   * @returns Detailed regression report information
   */
  async getRegressionReportDetail(reportId: string) {
    try {
      const report = await this.prisma.regressionReport.findUnique({
        where: { id: reportId },
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              owner: true,
              baseBranch: true,
              repositoryId: true,
            },
          },
        },
      });

      if (!report) {
        throw new NotFoundException(
          `Regression report with ID ${reportId} not found`,
        );
      }

      // Parse JSON fields to return structured data
      const parsedReport = {
        ...report,
        impactedFlows:
          typeof report.impactedFlows === 'string'
            ? JSON.parse(report.impactedFlows as string)
            : report.impactedFlows,
        changedBehavior:
          typeof report.changedBehavior === 'string'
            ? JSON.parse(report.changedBehavior as string)
            : report.changedBehavior,
        potentialBreakages:
          typeof report.potentialBreakages === 'string'
            ? JSON.parse(report.potentialBreakages as string)
            : report.potentialBreakages,
        testCases:
          typeof report.testCases === 'string'
            ? JSON.parse(report.testCases as string)
            : report.testCases,
      };

      return parsedReport;
    } catch (error) {
      console.error('Error retrieving regression report detail:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        error.message || 'Failed to retrieve regression report detail',
      );
    }
  }

  /**
   * Rescans files that were missing or failed in previous scans
   * This function is called by the cron job and the controller
   * @returns Object containing success status and details about rescanned files
   */
  async rescanMissingFiles() {
    try {
      console.log('Starting rescan of missing files...');

      // Get repositories with completed scans in the last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const recentScans = await this.prisma.repositoryScan.findMany({
        where: {
          status: ScanStatus.COMPLETED,
          completedAt: {
            gte: oneDayAgo,
          },
        },
        orderBy: {
          completedAt: 'desc',
        },
        include: {
          repository: true,
        },
        distinct: ['repositoryId'],
      });

      if (recentScans.length === 0) {
        return {
          success: true,
          message: 'No repositories with recent scans found',
          rescannedFiles: [],
        };
      }

      // Track results for each repository
      const rescannedFiles = [];

      // Process each repository
      for (const scan of recentScans) {
        try {
          const repo = scan.repository;
          if (!repo) continue;

          // Check if total files scanned matches total files
          // This would indicate a complete scan with no missing files
          if (scan.totalFilesScanned === scan.totalFiles) {
            console.log(`Repository ${repo.name}: All files already scanned`);
            continue;
          }

          // Get account credentials for the repository
          const accountCredentials =
            await this.accountCredentialService.getAccountToken({
              accountId: scan.accountId,
            });

          if (!accountCredentials) {
            console.log(
              `Repository ${repo.name}: No account credentials found`,
            );
            continue;
          }

          // Get the file structure for this repository
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

          // Get files that have already been scanned
          const scannedFiles = await this.prisma.fileDocumentation.findMany({
            where: {
              repositoryScanId: scan.id,
            },
            select: {
              fullPath: true,
            },
          });

          const scannedFilePaths = new Set(scannedFiles.map((f) => f.fullPath));

          // Identify missing files
          const missingFiles = repositoryStructure.filter((file) => {
            const fileExtension = fetchFileExtension(file.name);
            // Skip files with ignored extensions
            if (ignoredExtensionsForFileScan.includes(fileExtension)) {
              return false;
            }
            // Keep files that haven't been scanned yet
            return !scannedFilePaths.has(file.fileRelativePath);
          });

          if (missingFiles.length === 0) {
            console.log(`Repository ${repo.name}: No missing files to scan`);
            continue;
          }

          console.log(
            `Repository ${repo.name}: Found ${missingFiles.length} missing files to scan`,
          );

          // Scan missing files in batches
          const analyzedFiles = await this._processInBatches(
            missingFiles,
            25, // Batch size
            async (fileData) => {
              try {
                return await this.analyzeFiles(
                  fileData,
                  accountCredentials.decryptedToken,
                  repo.id,
                  scan.id,
                  repo,
                );
              } catch (fileError) {
                console.error(
                  `Error analyzing file ${fileData.filePath}:`,
                  fileError,
                );
                return null;
              }
            },
          );

          // Filter out nulls (failed files)
          const successfullyScanned = analyzedFiles.filter(
            (file) => file !== null,
          );

          // Update scan status
          await this.prisma.repositoryScan.update({
            where: { id: scan.id },
            data: {
              totalFilesScanned: {
                increment: successfullyScanned.length,
              },
            },
          });

          // Generate embeddings for newly scanned files
          await this.embedChangedFiles(scan.id);

          // Record results
          rescannedFiles.push({
            repositoryId: repo.id,
            repositoryName: repo.name,
            scanId: scan.id,
            missingFilesCount: missingFiles.length,
            successfullyScannedCount: successfullyScanned.length,
          });
        } catch (repoError) {
          console.error(
            `Error rescanning repository ${scan.repository?.name || scan.repositoryId}:`,
            repoError,
          );
          // Continue with next repository
        }
      }

      return {
        success: true,
        rescannedFiles,
      };
    } catch (error) {
      console.error('Error in rescanMissingFiles:', error);
      return {
        success: false,
        message: `Failed to rescan missing files: ${error.message}`,
        error: error,
      };
    }
  }
}
