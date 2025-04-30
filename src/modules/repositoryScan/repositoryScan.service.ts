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
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.hepler';
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
import { PrismaService } from 'src/prisma/prisma.service';
import { repositoryScanQueue } from 'src/queue/repository.scan.queue';
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

      // return;
      const repositoryScan = await this.prisma.repositoryScan.create({
        data: {
          repositoryId: repository.id,
          accountId,
          status: ScanStatus.PENDING,
        },
      });

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

      // Analyze all files in parallel
      // const analyzedFiles = await Promise.allSettled(
      //   repositoryStructure.map((data) =>
      //     this.analyzeFiles(
      //       data,
      //       accountCredentials.decryptedToken,
      //       repository.id,
      //       repositoryScanId,
      //       repository,
      //     ),
      //   ),
      // );

      await this.prisma.repositoryScan.update({
        where: { id: repositoryScanId },
        data: {
          totalFiles: repositoryStructure.length,
        },
      });

      const analyzedFiles = await this._processInBatches(
        repositoryStructure,
        25, // Batch size
        (data) =>
          this.analyzeFiles(
            data,
            accountCredentials.decryptedToken,
            repository.id,
            repositoryScanId,
            repository,
          ),
      );

      // scanning started
      await this.embedRepositoryById(repositoryScanId);

      // Update scan status as COMPLETED
      await this.prisma.repositoryScan.update({
        where: { id: repositoryScanId },
        data: {
          totalFilesScanned: analyzedFiles.length,
          status: ScanStatus.COMPLETED,
        },
      });

      return analyzedFiles;
    } catch (error) {
      console.error('❌ Error in scanRepositoriesDirect:', error);
      throw new Error('Failed to scan repositories.');
    }
  }

  /**
   * Analyzes individual files from the repository.
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
      } catch (error) {
        console.error(
          '❌ **fileContent**: ',
          typeof fileContent,
          fileChanges.filePath,
          fileContent,
        );
      }

      // console.log('lines: ', lines);

      const analysisResult = await deepseekAI.analyzeFile({
        ...fileChanges,
        content: fileContent,
      });

      try {
        await this.prisma.fileDocumentation.create({
          data: {
            name: fileChanges.fileRelativePath,
            fullPath: fileChanges.fileRelativePath,
            imports: analysisResult.relations.imports || [],
            exports: analysisResult.relations.exports || [],
            functions: analysisResult.functions || [],
            classes: analysisResult.classes || [],
            components: analysisResult.components || [],
            fileType: analysisResult.tags,
            summary: analysisResult.summary,
            repositoryId,
            repositoryScanId,
          },
        });
      } catch (error) {
        console.log('error: ', error);
      }

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
      const allowedIssues = {};

      repository.repositorySettings.forEach((element) => {
        allowedIssues[element.key] = 1;
      });

      // codeIssues = codeIssues.filter(
      //   (issue) => allowedIssues[issue.issue] === 1,
      // );
      let filteredIssues;
      try {
        filteredIssues = filterHighPriorityComments(
          codeIssues.filter((data) => data.content !== ''),
        );
      } catch (error) {
        console.log(filteredIssues);
      }

      const createCommentsMapping = filteredIssues
        .map((data, index) => {
          // @ts-ignore
          const payload = {
            repositoryId: repository.repositoryId,
            content: data.content,
            line: parseInt(data.line),
            file: data.file,
            issue: data.issue,
            issueCategory: data.category,
            severity: data.priority,
            reason: data.reason,
            type: CommentType.ISSUE, // Since it's a PR comment, set the type as PULL_REQUEST
          };

          // Only create the comment if it's a PR-related comment
          return this._commentService.createComment(payload);
        })
        .filter((comment) => comment !== undefined);

      // If it's not a PR comment, return undefined (or you can filter out these)

      await Promise.all(createCommentsMapping);
      return analysisResult;
    } catch (error) {
      console.error('❌ Error in analyzeFiles:', error);
      throw new Error(`Failed to analyze file: ${fileChanges.filePath}`);
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
      if (!scan) return [];

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

  async fetchFileSummary(data: { repositoryId: string; path: string }) {
    try {
      const scan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId: data.repositoryId,
        },
        include: {
          repository: true,
        },
        orderBy: {
          // Assuming you have a createdAt or id field to order by
          createdAt: 'desc', // or 'id' if you want to order by the ID
        },
      });

      const fetchFileContentPayload = {
        repositoryScanId: scan.id,
        repositoryId: scan.repositoryId,
        fullPath: data.path,
        // https://api.bitbucket.org/2.0/repositories/muhammad-mudassir/hiksflow-test-repo/src/80d3fdd5c4a55c68309eb20f81f49d6f1d3f697a/app.js
        // fullPath: `https://api.bitbucket.org/2.0/repositories/${scan.repository.owner}/${scan.repository.name}/src/80d3fdd5c4a55c68309eb20f81f49d6f1d3f697a/${data.path}`,

        // fullPath: `https://raw.githubusercontent.com/${scan.repository.owner}/${scan.repository.name}/${scan.repository.baseBranch}/${data.path}`,
      };

      const contentSummary = await this.prisma.fileDocumentation.findFirst({
        where: fetchFileContentPayload,
      });

      return contentSummary;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async fetchScanStatus(repositoryId: string) {
    try {
      const scan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId,
        },
        include: {
          repository: true,
        },
      });

      if (!scan)
        return { status: 'NOT_FOUND', totalFiles: 0, totalFilesScanned: 0 };

      const totalFiles = await this.prisma.fileDocumentation.count({
        where: {
          repositoryScanId: scan.id,
        },
      });

      return {
        status: scan?.status || 'NOT_FOUND',
        totalFiles: scan?.totalFiles || 0,
        totalFilesScanned: totalFiles || 0,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  private async _processInBatches<T>(
    items: T[],
    batchSize: number,
    callback: (item: T) => Promise<any>,
  ) {
    console.log(`Processing ${items.length} items in batches of ${batchSize}`);
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      console.log(`current batch: ${i} - ${i + batchSize}`);
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(callback));
      results.push(...batchResults);
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

            const embedding = await gemini.getEmbeddings(scan.summary);

            await this.prisma.$executeRaw`
              UPDATE "FileDocumentation"
              SET "summaryEmbedding" = ${embedding}::vector
              WHERE id = ${scan.id}
            `;
          }),
        );
      }

      return { success: true };
    } catch (error) {
      console.log(error.message);
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
          // Process files based on tags
          const fileQuickInfo = tagBasedFiles.map((data) => ({
            fileName: data.name,
            filePath: data.fullPath,
            fileSummary: data.summary,
            fileTags: data.fileType,
          }));

          const filteredFiles = await gemini.filterRelevantFiles(
            query,
            fileQuickInfo,
          );

          tagBasedFiles = tagBasedFiles.filter((data) =>
            filteredFiles.output.some((file) => file.fileName === data.name),
          );

          // Only if we don't find enough tag-based files, look at README files
          if (tagBasedFiles.length < 3) {
            const readmeFiles = await this.prisma.fileDocumentation.findMany({
              where: {
                repositoryScanId,
                OR: [
                  { name: { contains: 'README', mode: 'insensitive' } },
                  { name: { contains: 'package.json', mode: 'insensitive' } },
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

          // Get source code for the files
          let sourceCodeMapping;
          if (
            accountCredentials.accountType ===
            AccountCredentialsType.GITHUB_TOKEN
          ) {
            sourceCodeMapping = tagBasedFiles.map((data) => {
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
            sourceCodeMapping = tagBasedFiles.map((data) => {
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
                `https://api.bitbucket.org/2.0/repositories/${payload.workspace}/${payload.repo}/src/${payload.branch}/${data.fullPath}`,
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
              await this._billingService.createUsageLog({
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
          await this._billingService.createUsageLog({
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
}
