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
import { bitbucketRepositoryAccess } from 'src/config/helpers/repositories/bitbucket.helper';
import {
  bitbucketRepositoryStructure,
  fetchFileByUrl,
  githubRepositoryAccess,
  githubRepositoryStructure,
} from 'src/config/helpers/repositories/github.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { repositoryScanQueue } from 'src/queue/repository.scan.queue';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import { CommentService } from '../comment/comment.service';

@Injectable()
export class RepositoryScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly _commentService: CommentService,
    private readonly accountCredentialService: AccountCredentialService,
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

      const analyzedFiles = await this._processInBatches(
        repositoryStructure,
        50, // Batch size
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
      // console.log(
      //   'cp 02: fileChanges, token, repositoryId, repositoryScanId: ',
      //   fileChanges,
      //   token,
      //   repositoryId,
      //   repositoryScanId,
      //   repository.repositorySettings,
      // );
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
      let allowedIssues = {};

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

      let createCommentsMapping = filteredIssues
        .map((data, index) => {
          // @ts-ignore
          let payload = {
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
      let { decryptedToken, payload, accountType } =
        await this.accountCredentialService.getAccountToken({ accountId });
      let scan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId,
        },
        include: {
          repository: true,
        },
      });
      if (!scan) return [];

      let fetchRepositoryStructuredPayload = {
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
      let scan = await this.prisma.repositoryScan.findFirst({
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

      let fetchFileContentPayload = {
        repositoryScanId: scan.id,
        repositoryId: scan.repositoryId,
        fullPath: data.path,
        // https://api.bitbucket.org/2.0/repositories/muhammad-mudassir/hiksflow-test-repo/src/80d3fdd5c4a55c68309eb20f81f49d6f1d3f697a/app.js
        // fullPath: `https://api.bitbucket.org/2.0/repositories/${scan.repository.owner}/${scan.repository.name}/src/80d3fdd5c4a55c68309eb20f81f49d6f1d3f697a/${data.path}`,

        // fullPath: `https://raw.githubusercontent.com/${scan.repository.owner}/${scan.repository.name}/${scan.repository.baseBranch}/${data.path}`,
      };

      let contentSummary = await this.prisma.fileDocumentation.findFirst({
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
      let scan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId,
        },
        include: {
          repository: true,
        },
      });
      return {
        status: scan?.status || 'NOT_FOUND',
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

  async testAnalyzeAssistance(
    repositoryId: string,
    query: string,
    accountId: string,
  ) {
    try {
      const repository = await this.prisma.repository.findUnique({
        where: { id: repositoryId },
      });

      if (!repository) throw new NotFoundException();

      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

      let repositoryScan = await this.prisma.repositoryScan.findFirst({
        where: {
          repositoryId: repositoryId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      let repositoryScanId = repositoryScan.id;

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

      console.log('uniqueTags: ', uniqueTags);

      let usedTags = uniqueTags.map((data) => data.tag).join(', ');

      const gemini = new Gemini();

      const embedding = await gemini.getEmbeddings(query);
      const vectorQuery = `[${embedding.join(',')}]`;

      let projectContext = await gemini.getQueryContext(query, usedTags);
      console.log('projectContext: ', projectContext);
      if (!projectContext.output.context) {
        let result = (await this.prisma.$queryRaw`
          SELECT
            name as fileName,
            summary,
            "fullPath" as filePath,
            imports,
            exports,
            functions,
            classes,
            components,
            1 - ("summaryEmbedding" <=> ${vectorQuery}::vector) as similarity
          FROM "FileDocumentation"
          WHERE 1 - ("summaryEmbedding" <=> ${vectorQuery}::vector) > 0.6
            AND "repositoryScanId" = ${repositoryScanId}
          ORDER BY similarity DESC
          LIMIT 10;
        `) as { fileName: string; filepath: string; summary: string }[];

        console.log('if block : result', result.length);

        let sourceCodeMapping = result.map((data) => {
          return axios.get(
            `https://raw.githubusercontent.com/${documentedFile[0].repository.owner}/${documentedFile[0].repository.name}/${documentedFile[0].repository.baseBranch}/${data.filepath}`,
            {
              headers: {
                Authorization: `Bearer ${accountCredentials.decryptedToken}`,
              },
            },
          );
        });

        let sourceCodeResponses = await Promise.all(sourceCodeMapping);
        result = sourceCodeResponses.map((res, index) => ({
          ...result[index],
          sourceCode: res.data,
        }));

        let queryResponse = await gemini.generateAnswer(query, result);

        let assistedQuestionPayload = {
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

        console.log(
          'queryResponse: ',
          JSON.stringify(queryResponse.output.response, null, 2),
        );

        let assistedQuestions = await this.prisma.assistedQuestions.create({
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
        console.log(`else block: result: `, result);
        let fileQuickInfo = result.map((data) => ({
          fileName: data.name,
          filePath: data.fullPath,
          fileSummary: data.summary,
          fileTags: data.tags,
        }));

        // TODO: need to work here
        console.log('initial file length: ', result.length);

        let filteredFiles = await gemini.filterRelevantFiles(
          query,
          fileQuickInfo,
        );
        console.log('filtered file length: ', filteredFiles.output);

        result = result.filter((data) =>
          filteredFiles.output.some((file) => file.fileName === data.name),
        );

        console.log('filtered result: ', result);

        let sourceCodeMapping = result.map((data) => {
          return axios.get(
            `https://raw.githubusercontent.com/${documentedFile[0].repository.owner}/${documentedFile[0].repository.name}/${documentedFile[0].repository.baseBranch}/${data.fullPath}`,
            {
              headers: {
                Authorization: `Bearer ${accountCredentials.decryptedToken}`,
              },
            },
          );
        });

        let sourceCodeResponses = await Promise.all(sourceCodeMapping);
        result = sourceCodeResponses.map((res, index) => ({
          ...result[index],
          sourceCode: res.data,
        }));

        console.log('else block cp:02: result: ', result.length);

        result = result.map((data) => ({
          summary: data.summary,
          fileName: data.name,
          sourceCode: data.sourceCode,
        }));

        let queryResponse = await gemini.generateAnswer(query, result);
        // console.log(
        //   'queryResponse: ',
        //   JSON.stringify(queryResponse.output.response, null, 2),
        // );

        let assistedQuestionPayload = {
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

        let assistedQuestions = await this.prisma.assistedQuestions.create({
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
      let repository = await this.prisma.repository.findUnique({
        where: {
          id: repositoryId,
        },
      });

      if (!repository) throw new BadRequestException();

      let questions = await this.prisma.assistedQuestions.findMany({
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
      let question = await this.prisma.assistedQuestions.findUnique({
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
