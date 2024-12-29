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
      console.log('payload:: ', payload);
      let repositoryIdToTitleMap = {};
      let accountRepositories;
      let repositoryIds;

      if (!payload.repositoryId) {
        accountRepositories =
          await this._prismaService.accountRepository.findMany({
            where: { accountId: accountId },
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

        console.log('accountRepositories:: ', accountRepositories);
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

      pullRequests.forEach((pullRequest) => {
        pullRequest.repositoryTitle =
          repositoryIdToTitleMap[pullRequest.repositoryId];
        pullRequest.commentCount = pullRequest.comments.length;
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
