import { BadRequestException, Injectable } from '@nestjs/common';
import { CommentStatus } from '@prisma/client';
import { CommentCategory } from 'src/config/constants/comment.type.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CommentRequestType,
  CreateCommentRequestDto,
  GetCommentRequestDto,
  RegisterDuplicateCodeRequestDto,
} from './dto/comment.request.dto';

@Injectable()
export class CommentService {
  constructor(private _prismaService: PrismaService) {}

  async registerDuplicateCode(data: RegisterDuplicateCodeRequestDto[]) {
    try {
      console.log('data: ', JSON.stringify(data, null, 2));
      let dataMapping = data.map((duplicateCode) =>
        this._prismaService.duplicatedCode.create({ data: duplicateCode }),
      );
      await Promise.all(dataMapping);
    } catch (error) {
      console.log(error);
      throw new Error('Failed to register duplicate code');
    }
  }

  async fetchRepositoryDuplicateCode(
    accountId: string,
    data: GetCommentRequestDto,
  ) {
    try {
      let whereParams = {
        repositoryId: data.repositoryId,
      };
      let accountRepository =
        await this._prismaService.accountRepository.findFirst({
          where: whereParams,
          include: {
            repository: true,
          },
        });
      if (!accountRepository)
        throw new BadRequestException('Repository not found');
      let repositoryGithubId = accountRepository.repository.repositoryId;
      let pullRequests = null;
      if (data.prId) {
        pullRequests = await this._prismaService.pullRequest.findFirst({
          where: {
            repositoryId: repositoryGithubId,
            prNumber: parseInt(data.prId),
          },
        });
      }
      let comments = await this._prismaService.duplicatedCode.findMany({
        where: {
          repositoryId: accountRepository.repository.id,
          ...(data.prId && { prId: data.prId }),
        },
        skip: (parseInt(data.currentPage) - 1) * parseInt(data.pageSize),
        take: parseInt(data.pageSize),
        orderBy: { createdAt: 'desc' },
      });

      let commentCount = await this._prismaService.duplicatedCode.count({
        where: {
          repositoryId: accountRepository.repository.id,
          ...(data.prId && { prId: data.prId }),
        },
      });

      return { comments: comments, commentCount: commentCount };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async createComment(data: CreateCommentRequestDto): Promise<any> {
    try {
      await this._prismaService.comment.create({
        data: { ...data, status: CommentStatus.OPEN, reason: '' },
      });
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async fetchRepositoryComments(accountId: string, data: GetCommentRequestDto) {
    try {
      let whereParams = {
        repositoryId: data.repositoryId,
      };
      let repository = await this._prismaService.accountRepository.findFirst({
        where: whereParams,
        include: {
          repository: true,
        },
      });
      if (!repository) throw new BadRequestException('Repository not found');
      let repositoryGithubId = repository.repository.repositoryId;
      let pullRequests = null;
      if (data.prId) {
        pullRequests = await this._prismaService.pullRequest.findFirst({
          where: {
            repositoryId: repositoryGithubId,
            prNumber: parseInt(data.prId),
          },
        });
      }
      let comments = await this._prismaService.comment.findMany({
        where: {
          repositoryId: repositoryGithubId,
          ...(data.prId && { prId: pullRequests.id }),
          ...(data.category && {
            issueCategory:
              data.category == CommentRequestType.CODE_ISSUES
                ? { not: CommentCategory.SecurityConcerns }
                : CommentCategory.SecurityConcerns,
          }),
        },
        skip: (parseInt(data.currentPage) - 1) * parseInt(data.pageSize),
        take: parseInt(data.pageSize),
        orderBy: { createdAt: 'desc' },
      });

      let commentCount = await this._prismaService.comment.count({
        where: {
          repositoryId: repositoryGithubId,
          ...(data.prId && { prId: pullRequests.id }),
          ...(data.category && {
            issueCategory:
              data.category == CommentRequestType.CODE_ISSUES
                ? { not: CommentCategory.SecurityConcerns }
                : CommentCategory.SecurityConcerns,
          }),
        },
      });

      return { comments: comments, commentCount: commentCount };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async updateComments(commentIds: string[]) {
    try {
      await this._prismaService.comment.updateMany({
        where: {
          id: {
            in: commentIds,
          },
        },
        data: {
          status: CommentStatus.OUTDATED,
        },
      });
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
