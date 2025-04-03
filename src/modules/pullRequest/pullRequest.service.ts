import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountCredentialsType, PullRequest } from '@prisma/client';
import {
  commitInfoBitbucket,
  fetchBitbucketPrCommits,
  parseGitDiff,
} from 'src/config/helpers/repositories/bitbucket.helper';
import {
  commitInfo,
  fetchPrCommits,
} from 'src/config/helpers/repositories/github.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import {
  GetPullRequestDto,
  RegisterPullRequestDto,
} from './dto/pullRequest.request.dto';

@Injectable()
export class PullRequestService {
  constructor(
    private _prismaService: PrismaService,
    private _accountCredentialService: AccountCredentialService,
  ) {}

  async registerPullRequest(
    data: RegisterPullRequestDto,
  ): Promise<PullRequest> {
    try {
      return await this._prismaService.pullRequest.create({ data });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async updatePullRequest(id: string, data: any) {
    try {
      return await this._prismaService.pullRequest.update({
        where: { id },
        data,
      });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async recentPullRequests(accountId: string, payload: GetPullRequestDto) {
    try {
      let repositoryIdToTitleMap = {};
      let accountRepositories;
      let repositoryIds;

      let accountOrganization =
        await this._prismaService.organizationAccounts.findMany({
          where: {
            accountId: accountId,
          },
        });

      let organizationIds = accountOrganization.map(
        (data) => data.organizationId,
      );

      if (!payload.repositoryId) {
        accountRepositories =
          await this._prismaService.accountRepository.findMany({
            where: { organizationId: { in: organizationIds } },
            include: { repository: true },
          });
        repositoryIds = accountRepositories.map((data) => {
          repositoryIdToTitleMap[data.repository.repositoryId] =
            data.repository.name;
          return data.repository.repositoryId;
        });
      } else {
        accountRepositories = [
          await this._prismaService.accountRepository.findFirst({
            where: { repositoryId: payload.repositoryId },
            include: { repository: true },
          }),
        ];

        repositoryIds = [accountRepositories[0].repository.repositoryId];
        repositoryIdToTitleMap[accountRepositories[0].repository.repositoryId] =
          accountRepositories[0].repository.name;
      }

      let pullRequests: any = await this._prismaService.pullRequest.findMany({
        where: {
          repositoryId: { in: repositoryIds },
          summary: { not: '' },
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(payload?.pageSize) || 5,
        ...(payload?.pageNumber && {
          skip:
            (parseInt(payload?.pageNumber) - 1) * parseInt(payload.pageSize),
        }),
      });

      let commentsCount = await Promise.all(
        pullRequests.map((pr) =>
          this._prismaService.comment.count({
            where: {
              prId: pr.id,
            },
          }),
        ),
      );

      let prReportMapping = pullRequests.map((data) =>
        this._prismaService.executiveReport.findFirst({
          where: { prNumber: data.prNumber, repositoryId: data.repositoryId },
        }),
      );

      let prReport = await Promise.all(prReportMapping);

      pullRequests.forEach((pullRequest, index) => {
        pullRequest.repositoryTitle =
          repositoryIdToTitleMap[pullRequest.repositoryId];
        pullRequest.commentCount = commentsCount[index];
        pullRequest.report = prReport[index];
      });

      let prCount = await this._prismaService.pullRequest.count({
        where: {
          repositoryId: { in: repositoryIds },
          summary: { not: '' },
        },
      });
      return { pullRequests, totalPRs: prCount };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async pullRequestCommits(id: string, prNumber: number, accountId: string) {
    try {
      let repository = await this._prismaService.repository.findUnique({
        where: { id: id },
      });

      let organizationAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: { role: 'ADMIN', organizationId: repository.organizationId },
          include: { account: true },
        });
      let accountId = organizationAccount.accountId;
      let credentialPayload = {
        accountId,
        type: AccountCredentialsType.GITHUB_TOKEN,
      };

      let { decryptedToken, accountType, payload } =
        await this._accountCredentialService.getAccountToken(credentialPayload);

      if (accountType == AccountCredentialsType.BITBUCKET_TOKEN) {
        let prCommits = await fetchBitbucketPrCommits({
          token: decryptedToken,
          workspace: payload.workspace,
          repoSlug: repository.name,
          prNumber: prNumber,
        });

        let diffChangesMapping = prCommits.map((commit) => {
          return commitInfoBitbucket(
            {
              token: decryptedToken,
              commitDiffUrl: commit.links.diff.href,
            },
            true,
          );
        });
        let diffChanges = await Promise.all(diffChangesMapping);

        diffChanges = diffChanges.map((patch, i) => {
          let { fileChanges, totalAdditions, totalDeletions } =
            parseGitDiff(patch);
          return {
            sha: prCommits[i].hash,
            date: prCommits[i].date,
            author: prCommits[i].author.user.display_name,
            message: prCommits[i].message,
            additions: totalAdditions,
            deletions: totalDeletions,
            totalChanges: totalAdditions + totalDeletions,
            url: prCommits[i].links.html.href,
            files: fileChanges,
          };
        });

        return diffChanges.reverse();
      }

      let prUrl = `https://api.github.com/repos/${repository.owner}/${repository.name}/pulls/${prNumber}/commits`;
      let prCommits = await fetchPrCommits(prUrl, decryptedToken);
      let prCommitDetailsMapping = prCommits.map((data) =>
        commitInfo({
          owner: repository.owner,
          repo: repository.name,
          commitSha: data.sha,
          token: decryptedToken,
        }),
      );
      let prCommitDetails = await Promise.all(prCommitDetailsMapping);
      return prCommitDetails.map((data) => {
        return {
          sha: data.sha,
          date: data.commit.author.date,
          author: data.commit.author.name,
          message: data.commit.message,
          additions: data.stats.additions,
          deletions: data.stats.deletions,
          totalChanges: data.stats.total,
          url: data.html_url,
          files: data.files,
        };
      });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
