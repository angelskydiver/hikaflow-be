import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccountCredentialsType,
  CommentType,
  ScanStatus,
} from '@prisma/client';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
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
  async queueRepositoryScan(repositoryName: string, accountId: string) {
    try {
      const accountCredentials =
        await this.accountCredentialService.getAccountToken({ accountId });

      const repository = await this.prisma.repository.findFirst({
        where: { name: repositoryName },
      });

      if (!repository)
        throw new Error(`Repository "${repositoryName}" not found.`);

      // Register scan as PENDING
      const repositoryScan = await this.prisma.repositoryScan.create({
        data: {
          repositoryId: repository.id,
          accountId,
          status: ScanStatus.PENDING,
        },
      });

      // Add job to BullMQ queue
      await repositoryScanQueue.add('scan-repo', {
        repositoryName,
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
      const analyzedFiles = await Promise.allSettled(
        repositoryStructure.map((data) =>
          this.analyzeFiles(
            data,
            accountCredentials.decryptedToken,
            repository.id,
            repositoryScanId,
            repository,
          ),
        ),
      );

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
      const fileContent = await fetchFileByUrl(fileChanges.filePath, token);

      // console.log('**fileContent**: ', typeof fileContent, fileContent);
      const lines = fileContent.split('\n');
      // console.log('lines: ', lines);

      const analysisResult = await deepseekAI.analyzeFile({
        ...fileChanges,
        content: fileContent,
      });

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

      const withLineNumbers = lines
        .map((line, index) => `${index + 1}: ${line}`)
        .join('\n');

      let { codeIssues } = await deepseekAI.deepAnalyzeCodeFilesForIssues(
        { file: fileChanges.name, content: withLineNumbers },
        repository.repositorySettings,
      );
      let allowedIssues = {};

      repository.repositorySettings.forEach((element) => {
        allowedIssues[element.key] = 1;
      });

      // codeIssues = codeIssues.filter(
      //   (issue) => allowedIssues[issue.issue] === 1,
      // );

      let filteredIssues = filterHighPriorityComments(
        codeIssues.filter((data) => data.content !== ''),
      );

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
}
