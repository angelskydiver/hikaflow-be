import { BadRequestException, Injectable } from '@nestjs/common';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import {
  commentPr,
  commentPrSummary,
  commitInfo,
  fetchPrCommits,
  fetchPrFiles,
  parseGitHubPatchResponse,
} from 'src/config/helpers/repositories/github.helper';
import { filterFiles } from 'src/config/helpers/unnecessary.files.helper';
import { CommentService } from '../comment/comment.service';
import { ExecutiveReportService } from '../executiveReport/executiveReport.service';
import { PullRequestService } from '../pullRequest/pullRequest.service';
import { RepositoryService } from '../repository/repository.service';
import { PrismaService } from './../../prisma/prisma.service';

const MAX_TOKENS = 63000;
const MIN_TOKENS = 10;
@Injectable()
export class WebhooksService {
  // private _repositoryService: RepositoryService
  constructor(
    private _prismaService: PrismaService,
    private _pullRequestService: PullRequestService,
    private _repositoryService: RepositoryService,
    private _commentService: CommentService,
    private _executiveReportService: ExecutiveReportService,
  ) {}

  async syncPR(data: any) {
    try {
      let isBaseBranchMatch = await this._prismaService.repository.findUnique({
        where: {
          repositoryId: data.repository.id.toString(),
          baseBranch: data.pull_request.base.ref,
        },
      });
      if (!isBaseBranchMatch) {
        return;
      }

      let prCommits = await fetchPrCommits(data.pull_request.commits_url); // we need to use Codedeno github token here.
      let lastPrCommit = prCommits[prCommits.length - 1].sha;
      // // commitInfo()

      // // data.pull_request.patch_url
      let prInfo = {
        id: data.repository.id.toString(),
        owner: data.repository.owner.login,
        prNumber: data.number,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
      };

      let resp = await commitInfo({
        owner: prInfo.owner,
        repo: prInfo.repo,
        commitSha: lastPrCommit,
      });
      let fileChanges = parseGitHubPatchResponse(resp.files);
      // let fileChanges = await synchronizePrPatches(data.pull_request.diff_url);
      let changes = [];
      fileChanges.forEach((file) => {
        changes = [
          ...changes,
          ...file.changes
            .filter((change) => change.type === 'addition')
            .map((change) =>
              change.lines.map((eachline, i) => ({
                lineNumber: change.startLine + i,
                content: eachline,
                fileName: file.file,
              })),
            )
            .flat(),
        ];
      });

      let deepSeekWrapper = new DeepSeek();
      let AiResponse = await deepSeekWrapper.analyzeCodeFilesForIssues(changes);

      // lastCommit should need to send.
      let commentsMapping = AiResponse.codeIssues.map((data) =>
        commentPr(data, prInfo),
      );
      let pullRequest = await this._prismaService.pullRequest.findFirst({
        where: { prUrl: data.pull_request.url },
      });
      // await this._pullRequestService.registerPullRequest(pullRequestPayload);
      prInfo['prId'] = pullRequest.id;

      let createCommentsMapping = AiResponse.codeIssues.map((data) => {
        let payload = {
          repositoryId: prInfo.id,
          prId: pullRequest.id,
          content: data.content,
          line: data.line,
          file: data.file,
          issue: data.issue,
          issueCategory: data.category,
        };
        return this._commentService.createComment(payload);
      });

      await Promise.all(commentsMapping);
      await Promise.all(createCommentsMapping);

      return changes;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async managePRs(data: any) {
    try {
      let isBaseBranchMatch = await this._prismaService.repository.findUnique({
        where: {
          repositoryId: data.repository.id.toString(),
          baseBranch: data.pull_request.base.ref,
        },
      });
      if (!isBaseBranchMatch) {
        return;
      }
      let prCommits = await fetchPrCommits(data.pull_request.commits_url); // we need to use Codedeno github token here.
      console.log('PR commits: ', prCommits);

      let lastPrCommit = prCommits[prCommits.length - 1].sha;

      let prInfo = {
        id: data.repository.id.toString(),
        owner: data.repository.owner.login,
        prNumber: data.number,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
      };

      let repository = await this._repositoryService.getRepository(
        {
          repositoryId: data.repository.id.toString(),
        },
        {},
      );

      let pullRequestPayload = {
        repositoryId: repository.repositoryId,
        prUrl: data.pull_request.url,
        prNumber: data.number,
        prTitle: data.pull_request.title,
        prDescription: data.pull_request?.body || '',
        head: data.pull_request.head.ref,
        base: data.pull_request.base.ref,
      };

      let pullRequest =
        await this._pullRequestService.registerPullRequest(pullRequestPayload);
      prInfo['prId'] = pullRequest.id;
      this.diffFunctionality2(prInfo);
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async generatePrReport(data?: any) {
    try {
      let isBaseBranchMatch = await this._prismaService.repository.findUnique({
        where: {
          repositoryId: data.repository.id.toString(),
          baseBranch: data.pull_request.base.ref,
        },
      });
      if (!isBaseBranchMatch) {
        return;
      }

      let prCommits = await fetchPrCommits(data.pull_request.commits_url);
      // let prCommits = await fetchPrCommits(
      //   'https://api.github.com/repos/mudassir693/mini-microservices-blog-app/pulls/22/commits',
      // );
      let lastPrCommit = prCommits[prCommits.length - 1].sha;
      console.log('lastPrCommit: ', lastPrCommit);
      let prInfo = {
        owner: data.repository.owner.login,
        prNumber: data.number,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
      };
      // let prInfo = {
      //   owner: 'mudassir693',
      //   prNumber: 22,
      //   repo: 'mini-microservices-blog-app',
      //   // lastCommit: lastPrCommit,
      // };
      // fetch PR files
      let fileChanges = await fetchPrFiles(prInfo, false);
      let { modified, added } = this._countChanges(fileChanges);

      // remove setup or unnecessary files.
      let filteredFiles = filterFiles(fileChanges);

      filteredFiles = filteredFiles.map((data) => ({
        filename: data.filename,
        patch: data.patch,
      }));
      let deepSeekAgent = new DeepSeek();
      let complexityAndDuplication =
        await deepSeekAgent.analyzeCodeComplexityAndDuplication(filteredFiles);

      let mapPrCommit = prCommits.map((data) =>
        commitInfo({ ...prInfo, commitSha: data.sha }),
      );

      let commits = await Promise.all(mapPrCommit);
      console.log('commits: ', commits);

      // let codeChurn =
      // await deepSeekAgent.analyzeHotSpotsAndCodeChurnWithAI(commits);
      let codeChurn = await this._analyzeHotSpotsAndCodeChurn(commits);
      console.log('codeChurn: ', codeChurn);
      let contributorsAndCodeOwnership =
        await this._analyzeContributorsAndCodeOwnership(commits);

      let repository = await this._repositoryService.getRepository(
        {
          repositoryId: data.repository.id.toString(),
        },
        {},
      );
      let executiveReportPayload = {
        repositoryId: repository.repositoryId,
        prNumber: data.number,
        summary: {
          modified,
          added,
          complexityAndDuplication,
          codeChurn,
          contributorsAndCodeOwnership,
        },
      };
      await this._executiveReportService.createExecutiveReport(
        executiveReportPayload,
      );
      return {
        modified,
        added,
        complexityAndDuplication,
        codeChurn,
        contributorsAndCodeOwnership,
      };

      // fetch commits
      // 1. hot spots frequently changed and error-prone files
      // 2. code churn - High modification frequency in file

      // team contribution
      // 1. commits by contributors
      // 2. Review and comments
      // 3. code ownership
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  private async _analyzeContributorsAndCodeOwnership(commitHistory) {
    console.log(
      'Analyzing commit history for contributors and code ownership...',
    );

    // Step 1: Initialize maps to track commit counts, code ownership, and commit URLs
    const contributorCommitCounts = new Map(); // Map<contributor, commitCount>
    const fileOwnership = new Map(); // Map<fileName, Map<contributor, { commitCount, commitUrls }>>

    // Step 2: Iterate through the commit history
    commitHistory.forEach((commit) => {
      const contributor = commit.author?.login || 'Unknown'; // Use the commit author or default to 'Unknown'
      const commitUrl = commit.html_url; // URL to the specific commit

      // Update contributor commit counts
      if (contributorCommitCounts.has(contributor)) {
        contributorCommitCounts.set(
          contributor,
          contributorCommitCounts.get(contributor) + 1,
        );
      } else {
        contributorCommitCounts.set(contributor, 1);
      }

      // Update file ownership
      commit.files.forEach((file) => {
        const fileName = file.filename;

        if (!fileOwnership.has(fileName)) {
          fileOwnership.set(fileName, new Map());
        }

        const ownershipMap = fileOwnership.get(fileName);
        if (ownershipMap.has(contributor)) {
          const existing = ownershipMap.get(contributor);
          ownershipMap.set(contributor, {
            commitCount: existing.commitCount + 1,
            commitUrls: [...existing.commitUrls, commitUrl], // Add the commit URL
          });
        } else {
          ownershipMap.set(contributor, {
            commitCount: 1,
            commitUrls: [commitUrl], // Initialize with the commit URL
          });
        }
      });
    });

    console.log('contributorCommitCounts: ', contributorCommitCounts);
    console.log('fileOwnership: ', fileOwnership);

    // Step 3: Prepare the results for contributors
    const contributors = Array.from(contributorCommitCounts.entries())
      .map(([contributor, commitCount]) => ({
        contributor,
        commitCount,
      }))
      .sort((a, b) => b.commitCount - a.commitCount); // Sort by commit count (descending)

    // Step 4: Prepare the results for code ownership
    const ownership = Array.from(fileOwnership.entries())
      .map(([fileName, ownershipMap]) => {
        const contributors = Array.from(ownershipMap.entries())
          .map(([contributor, { commitCount, commitUrls }]) => ({
            contributor,
            commitCount,
            commitUrls, // Include the commit URLs
          }))
          .sort((a, b) => b.commitCount - a.commitCount); // Sort by commit count (descending)

        return {
          fileName,
          contributors,
        };
      })
      .sort(
        (a, b) => b.contributors[0].commitCount - a.contributors[0].commitCount,
      ); // Sort by top contributor's commit count (descending)

    // Step 5: Return the results in JSON format
    return {
      contributors: {
        list: contributors,
      },
      codeOwnership: {
        files: ownership,
      },
    };
  }

  private async _analyzeHotSpotsAndCodeChurn(commitHistory, topN = 3) {
    console.log('Analyzing commit history for hot spots and code churn...');

    // Step 1: Initialize a map to track file modification counts
    const fileModificationCounts = new Map();

    // Step 2: Iterate through the commit history to count modifications per file
    commitHistory.forEach((commit) => {
      commit.files.forEach((file) => {
        const fileName = file.filename;
        if (fileModificationCounts.has(fileName)) {
          fileModificationCounts.set(
            fileName,
            fileModificationCounts.get(fileName) + 1,
          );
        } else {
          fileModificationCounts.set(fileName, 1);
        }
      });
    });

    console.log('fileModificationCounts: ', fileModificationCounts);

    // Step 3: Convert the map to an array and sort by modification count (descending)
    const sortedFiles = Array.from(fileModificationCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    ); // Sort by modification count (highest first)

    // Step 4: Identify hot spots (frequently changed and error-prone files)
    const hotSpots = sortedFiles
      .filter(([fileName, count]) => count > 4) // Threshold for hot spots (adjust as needed)
      .slice(0, topN) // Limit to top N files
      .map(([fileName, count]) => ({
        fileName,
        modificationCount: count,
        description: `This file is frequently changed and may be error-prone.`,
      }));

    // Step 5: Identify code churn (high modification frequency)
    const codeChurn = sortedFiles
      .filter(([fileName, count]) => count > 1) // Threshold for code churn (adjust as needed)
      .slice(0, topN) // Limit to top N files
      .map(([fileName, count]) => ({
        fileName,
        modificationCount: count,
        description: `This file has high modification frequency.`,
      }));

    // Step 6: Return the results in JSON format
    return {
      hotSpots: {
        files: hotSpots,
      },
      codeChurn: {
        files: codeChurn,
      },
    };
  }

  async diffFunctionality2(prInfo: any) {
    try {
      let fileChanges = await fetchPrFiles(prInfo);
      let { duplicateIdenticalCodeIssue } =
        await this.detectDuplicateAndIdenticalCode(fileChanges);
      let deepSeekWrapper = new DeepSeek();

      // Step 1: Group changes by file
      const changesByFile = new Map<string, any[]>();

      fileChanges.forEach((file) => {
        const fileChanges = file.changes
          .filter((change) => change.type === 'addition')
          .map((change) =>
            change.lines.map((eachline, i) => ({
              lineNumber: change.startLine + i,
              content: eachline,
              fileName: file.file,
            })),
          )
          .flat();

        if (changesByFile.has(file.file)) {
          changesByFile.get(file.file).push(...fileChanges);
        } else {
          changesByFile.set(file.file, fileChanges);
        }
      });

      let allIssues = duplicateIdenticalCodeIssue;
      let allSummaries = [];

      for (const [fileName, changes] of changesByFile.entries()) {
        const tokenizer = require('gpt-3-encoder'); // Use a tokenizer library

        let tokenCount = tokenizer.encode(JSON.stringify(changes)).length;

        if (tokenCount > MAX_TOKENS) {
          // If the file's changes exceed the token limit, split into smaller chunks
          let chunks = [];
          let currentChunk = [];
          let currentTokenCount = 0;

          for (const change of changes) {
            const changeTokens = tokenizer.encode(
              JSON.stringify(change),
            ).length;

            if (currentTokenCount + changeTokens > MAX_TOKENS) {
              chunks.push(currentChunk);
              currentChunk = [change];
              currentTokenCount = changeTokens;
            } else {
              currentChunk.push(change);
              currentTokenCount += changeTokens;
            }
          }

          if (currentChunk.length > 0) {
            chunks.push(currentChunk);
          }

          // Analyze each chunk
          for (const chunk of chunks) {
            const AiResponse =
              await deepSeekWrapper.analyzeCodeFilesForIssues(chunk);
            allIssues.push(...AiResponse.codeIssues);
            allSummaries.push(AiResponse.prSummary);
          }
        } else {
          // If the file's changes are within the token limit, analyze as a single chunk
          const AiResponse =
            await deepSeekWrapper.analyzeCodeFilesForIssues(changes);
          allIssues.push(...AiResponse.codeIssues);
          allSummaries.push({ prSummary: AiResponse.prSummary });
        }
      }

      // Step 3: Combine summaries into a single PR summary
      const combinedSummary = allSummaries;

      // Step 4: Create comments and update PR
      let commentsMapping = allIssues.map((data) => commentPr(data, prInfo));

      let createCommentsMapping = allIssues.map((data) => {
        let payload = {
          repositoryId: prInfo.id,
          prId: prInfo.prId,
          content: data.content,
          line: parseInt(data.line),
          file: data.file,
          issue: data.issue,
          issueCategory: data.category,
        };
        return this._commentService.createComment(payload);
      });

      let analyzeCombineSummary =
        await deepSeekWrapper.analyzeCombineSummary(combinedSummary);

      await this._pullRequestService.updatePullRequest(prInfo.prId, {
        summary: analyzeCombineSummary.prSummary,
      });
      await commentPrSummary(prInfo, {
        issue: analyzeCombineSummary.prSummary,
      });
      await Promise.all(commentsMapping);
      await Promise.all(createCommentsMapping);

      return {
        fileChanges,
        AiResponse: {
          codeIssues: allIssues,
          prSummary: analyzeCombineSummary.prSummary,
        },
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async detectDuplicateAndIdenticalCode(fileChanges: any) {
    try {
      let deepSeekWrapper = new DeepSeek();
      const tokenizer = require('gpt-3-encoder'); // Tokenizer library

      // Helper function to calculate token count for a block of changes
      const calculateTokenCount = (block) => {
        return tokenizer.encode(JSON.stringify(block)).length;
      };

      let chunks = [];
      let currentChunk = [];
      let currentTokenCount = 0;

      for (const file of fileChanges) {
        let fileBlock = [];

        for (const change of file.changes.filter(
          (c) => c.type === 'addition',
        )) {
          const lines = change.lines.map((line, i) => ({
            lineNumber: change.startLine + i,
            content: line,
            fileName: file.file,
          }));

          for (const line of lines) {
            const lineTokens = calculateTokenCount([line]);

            if (currentTokenCount + lineTokens > MAX_TOKENS) {
              // Push the current chunk to the chunks array
              if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentTokenCount = 0;
              }

              // Start a new chunk if this line doesn't fit in the current chunk
              if (lineTokens <= MAX_TOKENS) {
                currentChunk.push(line);
                currentTokenCount += lineTokens;
              } else {
                // Split this line into a standalone chunk
                chunks.push([line]);
              }
            } else {
              // Add line to the current chunk
              currentChunk.push(line);
              currentTokenCount += lineTokens;
            }
          }
        }

        // Finalize the file's block and add to the chunks
        if (fileBlock.length > 0) {
          chunks.push(fileBlock);
        }
      }

      // Add any remaining changes in the current chunk
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      console.log('Chunks: ', chunks);
      console.log('Chunks Count: ', chunks.length);

      // Analyze each chunk with DeepSeek
      let duplicateCodes = [];
      let identicalCodes = [];
      let allIssues = [];

      for (const chunk of chunks) {
        const AiResponse = await deepSeekWrapper.analyzeDuplicateIdenticalCode(
          chunk,
          JSON.stringify(duplicateCodes),
          JSON.stringify(identicalCodes),
        );

        duplicateCodes.push(...AiResponse.duplicateCodes);
        identicalCodes.push(...AiResponse.identicalCodes);
        allIssues.push(...AiResponse.codeIssues);
      }

      return {
        duplicateIdenticalCodeIssue: allIssues,
        duplicateCodes,
        identicalCodes,
      };
    } catch (error) {
      console.error(error.message);
      throw new BadRequestException(error.message);
    }
  }

  // async diffFunctionality2(prInfo: any) {
  //   try {
  //     let fileChanges = await fetchPrFiles(prInfo);
  //     let deepSeekWrapper = new DeepSeek();
  //     console.log('fileChanges:: ', fileChanges);

  //     // Step 1: Extract changes and group them into chunks
  //     let changes = [];
  //     fileChanges.forEach((file) => {
  //       changes = [
  //         ...changes,
  //         ...file.changes
  //           .filter((change) => change.type === 'addition')
  //           .map((change) =>
  //             change.lines.map((eachline, i) => ({
  //               lineNumber: change.startLine + i,
  //               content: eachline,
  //               fileName: file.file,
  //             })),
  //           )
  //           .flat(),
  //       ];
  //     });

  //     // Step 2: Split changes into chunks based on token limits
  //     const MAX_TOKENS = 63000; // DeepSeek's token limit
  //     // const tokenizer = require('gpt-3-encoder'); // Use a tokenizer library
  //     // const MAX_TOKENS = 200;

  //     let chunks = [];
  //     let currentChunk = [];
  //     let currentTokenCount = 0;

  //     for (const change of changes) {
  //       const changeTokens = encode(JSON.stringify(change)).length;

  //       if (currentTokenCount + changeTokens > MAX_TOKENS) {
  //         // If adding this change exceeds the token limit, start a new chunk
  //         chunks.push(currentChunk);
  //         currentChunk = [change];
  //         currentTokenCount = changeTokens;
  //       } else {
  //         // Add the change to the current chunk
  //         currentChunk.push(change);
  //         currentTokenCount += changeTokens;
  //       }
  //     }

  //     // Add the last chunk
  //     if (currentChunk.length > 0) {
  //       chunks.push(currentChunk);
  //     }

  //     console.log('chunks: ', chunks);
  //     console.log('chunks.length: ', chunks.length);
  //     return;

  //     // Step 3: Analyze each chunk with DeepSeek
  //     let allIssues = [];
  //     let allSummaries = [];

  //     for (const chunk of chunks) {
  //       const AiResponse =
  //         await deepSeekWrapper.analyzeCodeFilesForIssues(chunk);
  //       allIssues.push(...AiResponse.codeIssues);
  //       allSummaries.push(AiResponse.prSummary);
  //     }

  //     // Step 4: Combine summaries into a single PR summary
  //     const combinedSummary = allSummaries.join('\n\n');

  //     // Step 5: Create comments and update PR
  //     let commentsMapping = allIssues.map((data) => commentPr(data, prInfo));

  //     let createCommentsMapping = allIssues.map((data) => {
  //       let payload = {
  //         repositoryId: prInfo.id,
  //         prId: prInfo.prId,
  //         content: data.content,
  //         line: parseInt(data.line),
  //         file: data.file,
  //         issue: data.issue,
  //         issueCategory: data.category,
  //       };
  //       return this._commentService.createComment(payload);
  //     });

  //     await this._pullRequestService.updatePullRequest(prInfo.prId, {
  //       summary: combinedSummary,
  //     });
  //     await commentPrSummary(prInfo, { issue: combinedSummary });
  //     await Promise.all(commentsMapping);
  //     await Promise.all(createCommentsMapping);

  //     return {
  //       fileChanges,
  //       AiResponse: { codeIssues: allIssues, prSummary: combinedSummary },
  //     };
  //   } catch (error) {
  //     console.log(error.message);
  //     throw new BadRequestException(error.message);
  //   }
  // }

  private _countChanges(files) {
    let addedCount = 0;
    let modifiedCount = 0;

    // Loop through the files array
    files.forEach((file) => {
      if (file.status === 'added') {
        addedCount++;
      } else if (file.status === 'modified') {
        modifiedCount++;
      }
    });

    return {
      added: addedCount,
      modified: modifiedCount,
    };
  }
}
