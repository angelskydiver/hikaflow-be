import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateCommentRequestDto,
  GetCommentRequestDto,
} from './dto/comment.request.dto';

@Injectable()
export class CommentService {
  constructor(private _prismaService: PrismaService) {}

  async createComment(data: CreateCommentRequestDto): Promise<any> {
    try {
      await this._prismaService.comment.create({ data });
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
      let repository = await this._prismaService.accountRepository.findFirst({
        where: {
          repositoryId: data.repositoryId,
        },
        include: {
          repository: true,
        },
      });
      if (!repository) throw new BadRequestException('Repository not found');
      console.log('repository: ', repository);
      let repositoryGithubId = repository.repository.repositoryId;
      let comments = await this._prismaService.comment.findMany({
        where: {
          repositoryId: repositoryGithubId,
        },
        skip: (parseInt(data.currentPage) - 1) * parseInt(data.pageSize),
        take: parseInt(data.pageSize),
        orderBy: { createdAt: 'desc' },
      });

      let commentCount = await this._prismaService.comment.count({
        where: {
          repositoryId: repositoryGithubId,
        },
      });

      return { comments: comments, commentCount: commentCount };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
