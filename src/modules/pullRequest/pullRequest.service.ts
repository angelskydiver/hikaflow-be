import { BadRequestException, Injectable } from '@nestjs/common';
import { PullRequest } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  GetPullRequestDto,
  RegisterPullRequestDto,
} from './dto/pullRequest.request.dto';

@Injectable()
export class PullRequestService {
  constructor(private _prismaService: PrismaService) {}

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
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(payload?.pageSize) || 5,
        ...(payload?.pageNumber && {
          skip:
            (parseInt(payload?.pageNumber) - 1) * parseInt(payload.pageSize),
        }),
        include: { comments: true },
      });

      let prReportMapping = pullRequests.map((data) =>
        this._prismaService.executiveReport.findFirst({
          where: { prNumber: data.prNumber, repositoryId: data.repositoryId },
        }),
      );

      let prReport = await Promise.all(prReportMapping);

      pullRequests.forEach((pullRequest, index) => {
        pullRequest.repositoryTitle =
          repositoryIdToTitleMap[pullRequest.repositoryId];
        pullRequest.commentCount = pullRequest.comments.length;
        pullRequest.report = prReport[index];
      });

      let prCount = await this._prismaService.pullRequest.count({
        where: {
          repositoryId: { in: repositoryIds },
        },
      });
      return { pullRequests, totalPRs: prCount };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
