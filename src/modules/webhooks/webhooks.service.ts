import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CommentType, PrTrackerStatus } from '@prisma/client';
import { shouldAnalyze } from 'src/config/constants/unnecessary.files.constant';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { filterHighPriorityComments } from 'src/config/helpers/comment.helper';
import {
  changesMapping,
  commentBitbucketPr,
  commitInfoBitbucket,
  extractChangesFromPatch,
  fetchBitbucketDiff,
  fetchBitbucketPrCommits,
  fetchBitbucketPrPatch,
} from 'src/config/helpers/repositories/bitbucket.helper';
import {
  commentPr,
  commentPrSummary,
  commitInfo,
  fetchFiles,
  fetchPrCommits,
  fetchPrFiles,
  parseGitHubPatchResponse,
} from 'src/config/helpers/repositories/github.helper';
import { filterFiles } from 'src/config/helpers/unnecessary.files.helper';
import { MailService } from 'src/mail/mail.service';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import { BillingService } from '../billing/billing.service';
import { CodeOverviewService } from '../codeOverview/codeOverview.service';
import { CommentService } from '../comment/comment.service';
import { CommitSummaryService } from '../commitSummary/commitSummary.service';
import { ExecutiveReportService } from '../executiveReport/executiveReport.service';
import { PrTrackerService } from '../prTracker/prTracker.service';
import { PullRequestService } from '../pullRequest/pullRequest.service';
import { RepositoryService } from '../repository/repository.service';
import { PrismaService } from './../../prisma/prisma.service';

const MAX_TOKENS = 62000;

// const DEFAULT_TOKENS = 50;
// const DEFAULT_TOKENS_2 = 150;

@Injectable()
export class WebhooksService {
  // private _repositoryService: RepositoryService
  constructor(
    private _prismaService: PrismaService,
    private _pullRequestService: PullRequestService,
    private _repositoryService: RepositoryService,
    private _commentService: CommentService,
    private _executiveReportService: ExecutiveReportService,
    private _accountCredentialService: AccountCredentialService,
    private _codeOverviewService: CodeOverviewService,
    private _mailService: MailService,
    private _commitSummaryService: CommitSummaryService,
    private _billingService: BillingService,
    @Inject(forwardRef(() => PrTrackerService))
    private _prTrackerService: PrTrackerService,
  ) {}

  private _accountCredentialByRepository = async (data) => {
    const repository = await this._prismaService.repository.findUnique({
      where: {
        repositoryId: data.repository.id.toString(),
      },
    });

    const organization = await this._prismaService.organization.findFirst({
      where: {
        id: repository.organizationId,
      },
    });

    const organizationAccount =
      await this._prismaService.organizationAccounts.findFirst({
        where: {
          organizationId: organization.id,
          role: 'ADMIN',
        },
      });

    const credentialPayload = {
      accountId: organizationAccount.accountId,
      // type: AccountCredentialsType.GITHUB_TOKEN,
    };
    const remoteAccountCredentials =
      await this._accountCredentialService.getAccountToken(credentialPayload);

    return {
      decryptedToken: remoteAccountCredentials.decryptedToken,
      accountId: organizationAccount.accountId,
    };
  };

  async syncPR(data: any) {
    try {
      const isBaseBranchMatch = await this._prismaService.repository.findUnique(
        {
          where: {
            repositoryId: data.repository.id.toString(),
            baseBranch: data.pull_request.base.ref,
          },
        },
      );
      if (!isBaseBranchMatch) {
        return;
      }

      const { decryptedToken } =
        await this._accountCredentialByRepository(data);

      // , accountGithubCredentials.decryptedToken
      const prCommits = await fetchPrCommits(
        data.pull_request.commits_url,
        decryptedToken,
      ); // we need to use Codedeno github token here.
      const lastPrCommit = prCommits[prCommits.length - 1].sha;
      // // commitInfo()

      // // data.pull_request.patch_url
      const prInfo = {
        id: data.repository.id.toString(),
        owner: data.repository.owner.login,
        prNumber: data.number,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
        token: decryptedToken,
      };

      const resp = await commitInfo({
        owner: prInfo.owner,
        repo: prInfo.repo,
        commitSha: lastPrCommit,
        token: decryptedToken,
      });
      const fileChanges = parseGitHubPatchResponse(resp.files);

      const pullRequest = await this._prismaService.pullRequest.findFirst({
        where: { prUrl: data.pull_request.url },
      });

      const currentComments = await this._prismaService.comment.findMany({
        where: {
          prId: pullRequest.id,
          file: { in: fileChanges.map((data) => data.file) },
        },
      });

      const currentChangesMap = {};

      currentComments.forEach((data) => {
        currentChangesMap[`${data.file}-${data.line}`] = data;
      });

      // let fileChanges = await synchronizePrPatches(data.pull_request.diff_url);
      let changes = [];
      fileChanges.forEach((file) => {
        changes = [
          ...changes,
          ...file.changes
            // .filter((change) => change.type === 'addition')
            .map((change) =>
              change.lines.map((eachline, i) => ({
                lineNumber: change.startLine + i,
                content: eachline,
                fileName: file.file,
                type: change.type,
              })),
            )
            .flat(),
        ];
      });

      const outdatedComments = [];
      changes.forEach((data) => {
        if (currentChangesMap[`${data.fileName}-${data.lineNumber}`]?.id) {
          outdatedComments.push(
            currentChangesMap[`${data.fileName}-${data.lineNumber}`].id,
          );
        }
      });

      this._commentService.updateComments(outdatedComments);

      const deepSeekWrapper = new DeepSeek();
      const AiResponse = await deepSeekWrapper.analyzeCodeFilesForIssues(
        changes.filter((data) => data.type === 'addition'),
      );

      // lastCommit should need to send.
      const commentsMapping = AiResponse.codeIssues.map((data) =>
        commentPr(data, prInfo),
      );

      // await this._pullRequestService.registerPullRequest(pullRequestPayload);
      prInfo['prId'] = pullRequest.id;

      const createCommentsMapping = AiResponse.codeIssues.map((data) => {
        const payload = {
          repositoryId: prInfo.id,
          prId: pullRequest.id,
          content: data.content,
          line: data.line,
          file: data.file,
          issue: data.issue,
          issueCategory: data.category,
          severity: data.priority.split(' ')[0],
          reason: data.reason,
          type: CommentType.PULL_REQUEST,
        };
        return this._commentService.createComment(payload);
      });

      await Promise.allSettled(commentsMapping);
      await Promise.allSettled(createCommentsMapping);

      // Log PR evaluation usage for billing
      try {
        // Find the repository to get its ID and organization ID
        const repository = await this._prismaService.repository.findUnique({
          where: { repositoryId: data.repository.id.toString() },
        });

        if (repository) {
          await this._billingService.createUsageLog({
            organizationId: repository.organizationId,
            repositoryId: repository.id,
            type: 'PR_ANALYSIS',
            description: `PR Analysis: #${data.number} in ${data.repository.name}`,
          });
        }
      } catch (logError) {
        console.error('Error logging PR analysis usage:', logError);
      }

      return changes;
    } catch (error) {
      // console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async syncBitbucketPR(data: any) {
    try {
      const isBaseBranchMatch = await this._prismaService.repository.findUnique(
        {
          where: {
            repositoryId: data.repository.uuid,
            baseBranch: data.pullrequest.destination.branch.name,
          },
        },
      );
      if (!isBaseBranchMatch) {
        return;
      }

      data = {
        ...data,
        repository: {
          ...data.repository,
          id: data.repository.uuid,
        },
      };

      const { decryptedToken } =
        await this._accountCredentialByRepository(data);

      // , accountGithubCredentials.decryptedToken
      const prCommits = await fetchBitbucketPrCommits({
        token: decryptedToken,
        workspace: data.repository.workspace.slug,
        repoSlug: data.repository.name,
        prNumber: data.pullrequest.id,
      });

      const lastPrCommit = prCommits[prCommits.length - 1];

      const prInfo = {
        id: data.repository.uuid,
        owner: data.actor.display_name,
        prNumber: data.pullrequest.id,
        repo: data.repository.name,
        lastCommit: lastPrCommit.hash,
        token: decryptedToken,
      };

      let diffChanges = await commitInfoBitbucket({
        token: decryptedToken,
        commitDiffUrl: lastPrCommit.links.diff.href,
      });

      diffChanges = {
        ...lastPrCommit,
        author: {
          ...lastPrCommit.author,
          login: lastPrCommit.author.user.display_name,
        },
        html_url: lastPrCommit.links.html.href,
        files: diffChanges.map((commit) => commit.filename),
        patch: diffChanges.map((commit) => commit.patch),
      };

      const pullRequest = await this._prismaService.pullRequest.findFirst({
        where: { prUrl: data.pullrequest.links.html.href },
      });

      const currentComments = await this._prismaService.comment.findMany({
        where: {
          prId: pullRequest.id,
          file: { in: diffChanges.files.map((data) => data) },
        },
      });

      const currentChangesMap = {};

      currentComments.forEach((data) => {
        currentChangesMap[`${data.file}-${data.line}`] = data;
      });

      let changes = [];
      diffChanges.files.forEach((file, index) => {
        changes = [
          ...changes,
          ...extractChangesFromPatch(diffChanges.patch[index])
            .additions // .filter((change) => change.type === 'addition')
            .map((change, i) => ({
              lineNumber: change.line + i,
              content: change.content,
              fileName: file,
            }))
            .flat(),
        ];
      });

      const outdatedComments = [];
      changes.forEach((data) => {
        if (currentChangesMap[`${data.fileName}-${data.lineNumber}`]?.id) {
          outdatedComments.push(
            currentChangesMap[`${data.fileName}-${data.lineNumber}`].id,
          );
        }
      });

      this._commentService.updateComments(outdatedComments);

      const deepSeekWrapper = new DeepSeek();
      // TODO need to use flags from DB
      const AiResponse =
        await deepSeekWrapper.analyzeCodeFilesForIssues(changes);

      const commentsMapping = AiResponse.codeIssues.map((issue) =>
        commentBitbucketPr({
          token: prInfo.token,
          commentUrl: data.pullrequest.links.comments.href,
          body: {
            content: {
              raw: `${issue.issue} - Priority: ${issue.priority} \n ${issue.reason}`,
            },
            inline: {
              to: parseInt(issue.line),
              path: issue.file,
            },
          },
        }),
      );

      prInfo['prId'] = pullRequest.id;

      const createCommentsMapping = AiResponse.codeIssues.map((data) => {
        const payload = {
          repositoryId: prInfo.id,
          prId: pullRequest.id,
          content: data.content,
          line: data.line,
          file: data.file,
          issue: data.issue,
          issueCategory: data.category,
          severity: data.priority.split(' ')[0],
          reason: data.reason,
          type: CommentType.PULL_REQUEST,
        };
        return this._commentService.createComment(payload);
      });

      await Promise.allSettled(commentsMapping);
      await Promise.allSettled(createCommentsMapping);

      // Log PR evaluation usage for billing
      try {
        const repository = await this._prismaService.repository.findUnique({
          where: { repositoryId: data.repository.uuid },
        });

        if (repository) {
          await this._billingService.createUsageLog({
            organizationId: repository.organizationId,
            repositoryId: repository.id,
            type: 'PR_ANALYSIS',
            description: `PR Analysis: #${data.pullrequest.id} in ${data.repository.name}`,
          });
        }
      } catch (logError) {
        console.error('Error logging PR analysis usage:', logError);
      }

      return changes;
    } catch (error) {
      // console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async managePRs(data: any) {
    try {
      const isBaseBranchMatch = await this._prismaService.repository.findUnique(
        {
          where: {
            repositoryId: data.repository.id.toString(),
            baseBranch: data.pull_request.base.ref,
          },
        },
      );
      if (!isBaseBranchMatch) {
        // console.log('base branch not found');
        return;
      }

      const prTrackerPayload = {
        prId: `${data.repository.name}-${data.number}-${data.action}`,
        status: PrTrackerStatus.PENDING,
        response: data,
      };

      const { success } =
        await this._prTrackerService.trackPr(prTrackerPayload);
      if (!success) return;
      const { decryptedToken, accountId } =
        await this._accountCredentialByRepository(data);
      const prCommits = await fetchPrCommits(
        data.pull_request.commits_url,
        decryptedToken,
      );

      const lastPrCommit = prCommits[prCommits.length - 1].sha;

      const prInfo = {
        id: data.repository.id.toString(),
        owner: data.repository.owner.login,
        prNumber: data.number,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
        token: decryptedToken,
        repositoryId: isBaseBranchMatch.id,
        organizationId: isBaseBranchMatch.organizationId,
        accountId,
        action: data.action,
      };

      const repository = await this._repositoryService.getRepository(
        {
          repositoryId: data.repository.id.toString(),
        },
        {},
      );

      const pullRequestPayload = {
        repositoryId: repository.repositoryId,
        prUrl: data.pull_request.url,
        prNumber: data.number,
        prTitle: data.pull_request.title,
        prDescription: data.pull_request?.body || '',
        head: data.pull_request.head.ref,
        base: data.pull_request.base.ref,
      };

      const pullRequest =
        await this._pullRequestService.registerPullRequest(pullRequestPayload);
      prInfo['prId'] = pullRequest.id;
      prInfo['head'] = data.pull_request.head.ref;
      this.diffFunctionality3(prInfo);
    } catch (error) {
      // console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async bitbucketCreateRequest(data: any) {
    try {
      const isBaseBranchMatch = await this._prismaService.repository.findUnique(
        {
          where: {
            repositoryId: data.repository.uuid,
            baseBranch: data.pullrequest.destination.branch.name,
          },
        },
      );
      if (!isBaseBranchMatch) {
        console.log('base branch not found');
        return;
      }

      const prTrackerPayload = {
        prId: `${data.repository.name}-${data.pullrequest.id}-${data.event}`,
        status: PrTrackerStatus.PENDING,
        response: data,
      };

      const { success } =
        await this._prTrackerService.trackPr(prTrackerPayload);
      if (!success) return;
      data = {
        ...data,
        repository: {
          ...data.repository,
          id: data.repository.uuid,
        },
      };

      const { decryptedToken, accountId } =
        await this._accountCredentialByRepository(data);

      // need to hit bitbucket api
      const prCommits = await fetchBitbucketPrCommits({
        token: decryptedToken,
        workspace: data.repository.workspace.slug,
        repoSlug: data.repository.name,
        prNumber: data.pullrequest.id,
      });

      const lastPrCommit = prCommits[prCommits.length - 1].hash;

      const prInfo = {
        id: data.repository.id.toString(),
        owner: data.actor.display_name,
        prNumber: data.pullrequest.id,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
        token: decryptedToken,
        repositoryId: isBaseBranchMatch.id,
        organizationId: isBaseBranchMatch.organizationId,
        accountId,
        links: data.pullrequest.links,
        action: data.event,
      };

      const repository = await this._repositoryService.getRepository(
        {
          repositoryId: data.repository.id.toString(),
        },
        {},
      );

      const pullRequestPayload = {
        repositoryId: repository.repositoryId,
        prUrl: data.pullrequest.links.html.href,
        prNumber: data.pullrequest.id,
        prTitle: data.pullrequest.title,
        prDescription: data.pullrequest?.description || '',
        head: data.pullrequest.source.branch.name,
        base: data.pullrequest.destination.branch.name,
      };

      const pullRequest =
        await this._pullRequestService.registerPullRequest(pullRequestPayload);
      prInfo['prId'] = pullRequest.id;
      prInfo['head'] = data.pullrequest.source.branch.name;
      //
      this.bitbucketDiffFunctionality(prInfo);
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async generatePrReport(data?: any) {
    try {
      const isBaseBranchMatch = await this._prismaService.repository.findUnique(
        {
          where: {
            repositoryId: data.repository.id.toString(),
            baseBranch: data.pull_request.base.ref,
          },
        },
      );
      if (!isBaseBranchMatch) {
        return;
      }

      const prTrackerPayload = {
        prId: `${data.repository.name}-${data.number}-${data.action}`,
        status: PrTrackerStatus.PENDING,
        response: data,
      };

      const { success } =
        await this._prTrackerService.trackPr(prTrackerPayload);
      if (!success) return;

      const { decryptedToken, accountId } =
        await this._accountCredentialByRepository(data);

      const prCommits = await fetchPrCommits(
        data.pull_request.commits_url,
        decryptedToken,
      );
      // let prCommits = await fetchPrCommits(
      //   'https://api.github.com/repos/mudassir693/mini-microservices-blog-app/pulls/22/commits',
      // );
      const lastPrCommit = prCommits[prCommits.length - 1].sha;
      const prInfo = {
        owner: data.repository.owner.login,
        prNumber: data.number,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
        token: decryptedToken,
        accountId,
      };
      // let prInfo = {
      //   owner: 'mudassir693',
      //   prNumber: 22,
      //   repo: 'mini-microservices-blog-app',
      //   // lastCommit: lastPrCommit,
      // };
      // fetch PR files
      const fileChanges = await fetchPrFiles(prInfo, false);
      const { modified, added } = this._countChanges(fileChanges);

      // remove setup or unnecessary files.
      let filteredFiles = filterFiles(fileChanges);

      filteredFiles = filteredFiles.map((data) => ({
        filename: data.filename,
        patch: data.patch,
      }));
      const deepSeekAgent = new DeepSeek();
      const complexityAndDuplication =
        await deepSeekAgent.analyzeCodeComplexityAndDuplication(filteredFiles);

      const mapPrCommit = prCommits.map((data) =>
        commitInfo({ ...prInfo, commitSha: data.sha }),
      );

      const commits = await Promise.all(mapPrCommit);

      const codeChurn = await this._analyzeHotSpotsAndCodeChurn(commits);
      const contributorsAndCodeOwnership =
        await this._analyzeContributorsAndCodeOwnership(commits);

      const repository = await this._repositoryService.getRepository(
        {
          repositoryId: data.repository.id.toString(),
        },
        {},
      );
      const executiveReportPayload = {
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
      const { report } =
        await this._executiveReportService.createExecutiveReport(
          executiveReportPayload,
        );

      const commitSummaryMapping = commits.map((commit, index) =>
        this._commitSummaryService.createCommitSummary(
          commit,
          data.repository.id.toString(),
          report.id,
        ),
      );

      const payload = {
        accountId: prInfo.accountId,
        authorName: prInfo.owner,
        reportId: report.id,
        repositoryInfo: {
          repositoryName: prInfo.repo,
        },
      };

      const response = await deepSeekAgent.processCodeFiles(filteredFiles);
      // TODO: Code Overview
      const createCodeOverviewPayload = {
        summary: response,
        repositoryId: repository.repositoryId,
        reportId: report.id,
      };
      await this._codeOverviewService.createCodeOverview(
        createCodeOverviewPayload,
      );
      await this.sendPrCloseNotification(payload);
      this._prTrackerService.updatePrInfo(
        `${data.repository.name}-${data.number}-${data.action}`,
        PrTrackerStatus.APPROVED,
      );

      // Log PR evaluation usage for billing
      try {
        await this._billingService.createUsageLog({
          organizationId: isBaseBranchMatch.organizationId,
          repositoryId: isBaseBranchMatch.id,
          type: 'PR_ANALYSIS',
          description: `PR Report: #${data.number} in ${data.repository.name}`,
        });
      } catch (logError) {
        console.error('Error logging PR report usage:', logError);
      }

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
      this._prTrackerService.updatePrInfo(
        `${data.repository.name}-${data.number}-${data.action}`,
        PrTrackerStatus.REJECTED,
      );
      // console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async generateBitbucketPrReport(data?: any) {
    try {
      const isBaseBranchMatch = await this._prismaService.repository.findUnique(
        {
          where: {
            repositoryId: data.repository.uuid,
            baseBranch: data.pullrequest.destination.branch.name,
          },
        },
      );
      if (!isBaseBranchMatch) {
        return;
      }

      const prTrackerPayload = {
        prId: `${data.repository.name}-${data.pullrequest.id}-${data.event}`,
        status: PrTrackerStatus.PENDING,
        response: data,
      };

      const { success } =
        await this._prTrackerService.trackPr(prTrackerPayload);
      if (!success) return;

      const { decryptedToken, accountId } =
        await this._accountCredentialByRepository({
          ...data,
          repository: { ...data.repository, id: data.repository.uuid },
        });

      const prCommits = await fetchBitbucketPrCommits({
        token: decryptedToken,
        workspace: data.repository.workspace.slug,
        repoSlug: data.repository.name,
        prNumber: data.pullrequest.id,
      });

      const lastPrCommit = prCommits[prCommits.length - 1].hash;

      const prInfo = {
        owner: data.actor.display_name,
        prNumber: data.repository.id,
        repo: data.repository.name,
        lastCommit: lastPrCommit,
        token: decryptedToken,
        accountId,
        links: data.pullrequest.links,
      };

      const fileChanges = await fetchBitbucketPrPatch({
        token: decryptedToken,
        diffUrl: prInfo.links.diff.href,
      }); // after this I want to check each file patch

      const { modified, added } = this._countChanges(fileChanges);

      // remove setup or unnecessary files.
      let filteredFiles = filterFiles(fileChanges);

      filteredFiles = filteredFiles.map((data) => ({
        filename: data.filename,
        patch: data.changes.map((data) => data.lines.join()),
      }));
      const deepSeekAgent = new DeepSeek();

      // let complexityAndDuplication = {};
      const complexityAndDuplication =
        await deepSeekAgent.analyzeCodeComplexityAndDuplication(filteredFiles);

      const mapPrCommit = prCommits.map((data, i) => {
        // console.log('mapPrCommit: ', i + ' ' + JSON.stringify(data, null, 2));
        return commitInfoBitbucket({
          token: decryptedToken,
          commitDiffUrl: data.links.diff.href,
        });
      });

      let commits = await Promise.all(mapPrCommit);
      commits = commits.map((data, index) => {
        return {
          ...prCommits[index],
          author: {
            ...prCommits[index].author,
            login: prCommits[index].author.user.display_name,
          },
          html_url: prCommits[index].links.html.href,
          files: data.map((commit) => commit.filename),
          patch: data.map((commit) => commit.patch),
        };
      });
      const codeChurn = {};
      // let codeChurn = await this._analyzeHotSpotsAndCodeChurn(commits);
      const contributorsAndCodeOwnership =
        await this._analyzeContributorsAndCodeOwnership(commits);
      // console.log('Commits;;;', contributorsAndCodeOwnership);

      const repository = await this._repositoryService.getRepository(
        {
          repositoryId: data.repository.uuid.toString(),
        },
        {},
      );
      // console.log('WOW;;;', repository);

      const executiveReportPayload = {
        repositoryId: repository.repositoryId,
        prNumber: data.pullrequest.id,
        summary: {
          modified,
          added,
          complexityAndDuplication,
          codeChurn,
          contributorsAndCodeOwnership,
        },
      };
      const { report } =
        await this._executiveReportService.createExecutiveReport(
          executiveReportPayload,
        );

      // TODO contibue from here

      const commitSummaryMapping = commits.map((commit, index) => {
        const stats = extractChangesFromPatch(commit.patch[0]);
        return this._commitSummaryService.createCommitSummary(
          {
            ...commit,
            stats: {
              additions: stats.additionCount,
              deletions: stats.deletionCount,
            },
            commit: { message: commit.message },
            sha: commit.hash,
            author: { login: commit.author.user.display_name },
          },
          data.repository.uuid.toString(),
          report.id,
        );
      });

      const payload = {
        accountId: prInfo.accountId,
        authorName: prInfo.owner,
        reportId: report.id,
        repositoryInfo: {
          repositoryName: prInfo.repo,
        },
      };

      const response = await deepSeekAgent.processCodeFiles(filteredFiles);
      // TODO: Code Overview
      const createCodeOverviewPayload = {
        summary: response,
        repositoryId: repository.repositoryId,
        reportId: report.id,
      };
      await this._codeOverviewService.createCodeOverview(
        createCodeOverviewPayload,
      );
      await this.sendPrCloseNotification(payload);
      this._prTrackerService.updatePrInfo(
        `${data.repository.name}-${data.pullrequest.id}-${data.event}`,
        PrTrackerStatus.APPROVED,
      );

      // Log PR evaluation usage for billing
      try {
        await this._billingService.createUsageLog({
          organizationId: isBaseBranchMatch.organizationId,
          repositoryId: isBaseBranchMatch.id,
          type: 'PR_ANALYSIS',
          description: `PR Report: #${data.pullrequest.id} in ${data.repository.name}`,
        });
      } catch (logError) {
        console.error('Error logging PR report usage:', logError);
      }

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
      this._prTrackerService.updatePrInfo(
        `${data.repository.name}-${data.pullrequest.id}-${data.event}`,
        PrTrackerStatus.REJECTED,
      );
      // console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  private async _analyzeContributorsAndCodeOwnership(commitHistory) {
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
        const fileName = file.filename || file;

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

  async bitbucketDiffFunctionality(prInfo: any) {
    try {
      let files = await fetchBitbucketDiff({
        token: prInfo.token,
        diffUrl: prInfo.links.diffstat.href,
      });

      const filePatch = await fetchBitbucketPrPatch({
        token: prInfo.token,
        diffUrl: prInfo.links.diff.href,
      });

      files = files.filter((file) => shouldAnalyze(file.fileName));
      const filesContent = [];

      files.forEach((data) => {
        const lines = data.content.split('\n');
        const withLineNumbers = lines
          .map((line, index) => `${index + 1}: ${line}`)
          .join('\n');
        filesContent.push({ file: data.fileName, content: withLineNumbers });
      });

      const { duplicateIdenticalCodeIssue, duplicateCodes, identicalCodes } =
        await this.detectDuplicateAndIdenticalCode(filePatch);

      const PrPatches = changesMapping(filePatch);

      const { repositorySettings } =
        await this._prismaService.repository.findFirst({
          where: { id: prInfo.repositoryId },
          include: {
            repositorySettings: true,
          },
        });
      const deepSeekWrapper = new DeepSeek();

      let allIssues = duplicateIdenticalCodeIssue;

      const allSummaries = [];
      // let prompt = transformPrompts(repositorySettings);
      for (let i = 0; i < filesContent.length; i++) {
        const changes = filesContent[i];
        const AiResponse = await deepSeekWrapper.deepAnalyzeCodeFilesForIssues(
          changes,
          repositorySettings,
        );
        allIssues = [...allIssues, ...AiResponse.codeIssues];
        allSummaries.push({ prSummary: AiResponse.prSummary });
      }

      allIssues = (
        await deepSeekWrapper.deepAnalyzeCodeFilesForIssuesReliability(
          allIssues,
        )
      )?.codeIssues;

      const combinedSummary = allSummaries;

      const filteredIssues = filterHighPriorityComments(allIssues);

      const commentsMapping = filteredIssues.map((data) =>
        commentBitbucketPr({
          token: prInfo.token,
          commentUrl: prInfo.links.comments.href,
          body: {
            content: {
              raw: `${data.issue} - Priority: ${data.priority} \n ${data.reason}`,
            },
            inline: {
              to: parseInt(data.line),
              path: data.file,
            },
          },
        }),
      );

      const comments = await Promise.allSettled(commentsMapping);
      const createCommentsMapping = filteredIssues
        .map((data, index) => {
          // @ts-ignore
          const payload = {
            repositoryId: prInfo.id,
            prId: prInfo.prId,
            content: data.content,
            line: parseInt(data.line),
            file: data.file,
            issue: data.issue,
            issueCategory: data.category,
            severity: data.priority,
            reason: data.reason,
            type: PrPatches[`${data.file}-${data.line}`]
              ? CommentType.PULL_REQUEST
              : CommentType.ISSUE, // Since it's a PR comment, set the type as PULL_REQUEST
          };

          // Only create the comment if it's a PR-related comment
          return this._commentService.createComment(payload);
        })
        .filter((comment) => comment !== undefined);

      const analyzeCombineSummary =
        await deepSeekWrapper.analyzeCombineSummary(combinedSummary);

      await this._pullRequestService.updatePullRequest(prInfo.prId, {
        summary: analyzeCombineSummary.prSummary,
      });

      await this._commentService.registerDuplicateCode(
        duplicateCodes.map((data) => ({
          ...data,
          repositoryId: prInfo.repositoryId,
          prId: prInfo.prNumber.toString(),
        })),
      );

      await Promise.allSettled(createCommentsMapping);
      // TODO: email

      const payload = {
        accountId: prInfo.accountId,
        authorName: prInfo.owner,
        repositoryInfo: {
          repositoryName: prInfo.repo,
          repositoryId: prInfo.repositoryId,
        },
        organizationId: prInfo.organizationId,
      };
      await this.sendPrCreateNotification(payload);
      this._prTrackerService.updatePrInfo(
        `${prInfo.repo}-${prInfo.prNumber}-${prInfo.action}`,
        PrTrackerStatus.APPROVED,
      );

      // Log PR evaluation usage for billing
      try {
        await this._billingService.createUsageLog({
          organizationId: prInfo.organizationId,
          repositoryId: prInfo.repositoryId,
          type: 'PR_ANALYSIS',
          description: `PR Analysis: #${prInfo.prNumber} in ${prInfo.repo}`,
        });
      } catch (logError) {
        console.error('Error logging PR analysis usage:', logError);
      }

      return {
        // fileChanges,
        AiResponse: {
          codeIssues: allIssues,
          prSummary: analyzeCombineSummary.prSummary,
        },
      };
    } catch (error) {
      this._prTrackerService.updatePrInfo(
        `${prInfo.repo}-${prInfo.prNumber}-${prInfo.action}`,
        PrTrackerStatus.REJECTED,
      );
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async diffFunctionality3(prInfo: any) {
    try {
      const fileChanges = await fetchPrFiles(prInfo);
      const filePaths = await fileChanges.map((data) => data.file);

      const fileMapping = filePaths.map((data) => fetchFiles(prInfo, data));
      let files = await Promise.all(fileMapping);
      files = files
        .filter((data) => data)
        .map((data, i) => ({
          fileName: filePaths[i],
          content: data.toString(),
        }));

      files = files.filter((file) => shouldAnalyze(file.fileName));
      const filesContent = [];

      files.forEach((data) => {
        const lines = data.content.split('\n');
        const withLineNumbers = lines
          .map((line, index) => `${index + 1}: ${line}`)
          .join('\n');
        filesContent.push({ file: data.fileName, content: withLineNumbers });
      });
      // return;
      const { duplicateIdenticalCodeIssue, duplicateCodes } =
        await this.detectDuplicateAndIdenticalCode(fileChanges);

      const { repositorySettings } =
        await this._prismaService.repository.findFirst({
          where: { id: prInfo.repositoryId },
          include: {
            repositorySettings: true,
          },
        });
      const deepSeekWrapper = new DeepSeek();

      let allIssues = duplicateIdenticalCodeIssue;
      const allSummaries = [];
      // let prompt = transformPrompts(repositorySettings);
      for (let i = 0; i < filesContent.length; i++) {
        const changes = filesContent[i];
        const AiResponse = await deepSeekWrapper.deepAnalyzeCodeFilesForIssues(
          changes,
          repositorySettings,
        );
        allIssues = [...allIssues, ...AiResponse.codeIssues];
        allSummaries.push({ prSummary: AiResponse.prSummary });
      }

      allIssues = (
        await deepSeekWrapper.deepAnalyzeCodeFilesForIssuesReliability(
          allIssues,
        )
      )?.codeIssues;

      // Step 3: Combine summaries into a single PR summary
      const combinedSummary = allSummaries;

      // Step 4: Create comments and update PR
      const commentsMapping = allIssues.map((data) => commentPr(data, prInfo));

      const comments = await Promise.allSettled(commentsMapping);
      const createCommentsMapping = allIssues
        .map((data, index) => {
          // Check if it's a PR comment by checking the 'isPrIssue' flag
          // @ts-ignore
          if (comments[index].value.isPrIssue) {
            const payload = {
              repositoryId: prInfo.id,
              prId: prInfo.prId,
              content: data.content,
              line: parseInt(data.line),
              file: data.file,
              issue: data.issue,
              issueCategory: data.category,
              severity: data.priority,
              reason: data.reason,
              type: CommentType.PULL_REQUEST, // Since it's a PR comment, set the type as PULL_REQUEST
            };

            // Only create the comment if it's a PR-related comment
            return this._commentService.createComment(payload);
          }

          // If it's not a PR comment, return undefined (or you can filter out these)
          return undefined;
        })
        .filter((comment) => comment !== undefined);

      const analyzeCombineSummary =
        await deepSeekWrapper.analyzeCombineSummary(combinedSummary);

      await this._pullRequestService.updatePullRequest(prInfo.prId, {
        summary: analyzeCombineSummary.prSummary,
      });
      await commentPrSummary(prInfo, {
        issue: analyzeCombineSummary.prSummary,
      });
      await Promise.allSettled(createCommentsMapping);

      await this._commentService.registerDuplicateCode(
        duplicateCodes.map((data) => ({
          ...data,
          repositoryId: prInfo.repositoryId,
          prId: prInfo.prNumber.toString(),
        })),
      );
      // TODO: email

      const payload = {
        accountId: prInfo.accountId,
        authorName: prInfo.owner,
        repositoryInfo: {
          repositoryName: prInfo.repo,
          repositoryId: prInfo.repositoryId,
        },
        organizationId: prInfo.organizationId,
      };
      await this.sendPrCreateNotification(payload);
      this._prTrackerService.updatePrInfo(
        `${prInfo.repo}-${prInfo.prNumber}-${prInfo.action}`,
        PrTrackerStatus.APPROVED,
      );

      // Log PR evaluation usage for billing
      try {
        await this._billingService.createUsageLog({
          organizationId: prInfo.organizationId,
          repositoryId: prInfo.repositoryId,
          type: 'PR_ANALYSIS',
          description: `PR Analysis: #${prInfo.prNumber} in ${prInfo.repo}`,
        });
      } catch (logError) {
        console.error('Error logging PR analysis usage:', logError);
      }

      return {
        fileChanges,
        AiResponse: {
          codeIssues: allIssues,
          prSummary: analyzeCombineSummary.prSummary,
        },
      };
    } catch (error) {
      this._prTrackerService.updatePrInfo(
        `${prInfo.repo}-${prInfo.prNumber}-${prInfo.action}`,
        PrTrackerStatus.REJECTED,
      );
      // console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async detectDuplicateAndIdenticalCode(fileChanges: any) {
    try {
      const deepSeekWrapper = new DeepSeek();
      const tokenizer = require('gpt-3-encoder'); // Tokenizer library

      // Helper function to calculate token count for a block of changes
      const calculateTokenCount = (block) => {
        return tokenizer.encode(JSON.stringify(block)).length;
      };

      const chunks = [];
      let currentChunk = [];
      let currentTokenCount = 0;

      for (const file of fileChanges) {
        const fileBlock = [];

        for (const change of file.changes.filter(
          (c) => c.type === 'addition',
        )) {
          const lines = change.lines.map((line, i) => ({
            lineNumber: change.startLine + i,
            content: line,
            fileName: file.file || file.filename,
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

      // Analyze each chunk with DeepSeek
      const duplicateCodes = [];
      const identicalCodes = [];
      const allIssues = [];

      for (const chunk of chunks) {
        const AiResponse = await deepSeekWrapper.analyzeDuplicateIdenticalCode(
          chunk,
          JSON.stringify(duplicateCodes),
          JSON.stringify(identicalCodes),
        );

        if (AiResponse?.duplicateCodes) {
          duplicateCodes.push(...AiResponse.duplicateCodes);
        }
        if (AiResponse?.identicalCodes) {
          identicalCodes.push(...AiResponse.identicalCodes);
        }
        allIssues.push(...AiResponse.codeIssues);
      }

      return {
        duplicateIdenticalCodeIssue: allIssues.filter((data) => data.content),
        duplicateCodes: duplicateCodes.filter((data) => data.content),
        identicalCodes: identicalCodes.filter((data) => data.content),
      };
    } catch (error) {
      console.error(error.message);
      throw new BadRequestException(error.message);
    }
  }

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

  async sendPrCreateNotification(data: {
    accountId: string;
    authorName: string;
    organizationId: string;
    repositoryInfo: { repositoryName: string; repositoryId: string };
  }) {
    try {
      const orgAdmins = await this._prismaService.organizationAccounts.findMany(
        {
          where: {
            organizationId: data.organizationId,
            role: { not: 'MEMBER' },
          },
          include: {
            account: true,
          },
        },
      );
      const organizationAdminsAccount = orgAdmins.map((data) => data.accountId);
      const accounts = await this._prismaService.account.findMany({
        where: {
          id: { in: organizationAdminsAccount },
        },
        include: {
          user: true,
        },
      });

      const emailMapping = accounts
        .filter((account) => account.user.sendEmail)
        .map((account) => {
          const payload = {
            email: account.user.email,
            adminName: account.user.firstName,
            repositoryName: data.repositoryInfo.repositoryName,
            authorName: data.authorName,
            prUrl: `${process.env.HIKAFLOW_PORTAL_URL}/repository/${data.repositoryInfo.repositoryId}/${data.organizationId}`,
          };
          return this._mailService.prCreatedNotification(payload);
        });

      await Promise.all(emailMapping);
      return {
        success: true,
      };
      // TODO: send email
    } catch (error) {
      console.error(error.message);
    }
  }

  async sendPrCloseNotification(data: {
    accountId: string;
    authorName: string;
    reportId: string;
    repositoryInfo: { repositoryName: string };
  }) {
    try {
      const organizationalAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            role: 'ADMIN',
            accountId: data.accountId,
          },
        });
      if (!organizationalAccount) {
        throw new Error('Account not found');
      }
      const orgAdmins = await this._prismaService.organizationAccounts.findMany(
        {
          where: {
            organizationId: organizationalAccount.organizationId,
            role: { not: 'MEMBER' },
          },
          include: {
            account: true,
          },
        },
      );
      const organizationAdminsAccount = orgAdmins.map((data) => data.accountId);
      const accounts = await this._prismaService.account.findMany({
        where: {
          id: { in: organizationAdminsAccount },
        },
        include: {
          user: true,
        },
      });

      const emailMapping = accounts
        .filter((account) => account.user.sendEmail)
        .map((account) => {
          const payload = {
            email: account.user.email,
            adminName: account.user.firstName,
            repositoryName: data.repositoryInfo.repositoryName,
            authorName: data.authorName,
            reportUrl: `${process.env.HIKAFLOW_PORTAL_URL}/repository/report/${data.reportId}`,
          };
          this._mailService.prClosedNotification(payload);
        });

      await Promise.all(emailMapping);

      // TODO: send email
    } catch (error) {
      console.error(error.message);
    }
  }

  async getRepositoryById(repositoryId: string) {
    return this._prismaService.repository.findUnique({
      where: { repositoryId },
    });
  }
}
