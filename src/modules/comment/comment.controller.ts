import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CommentService } from './comment.service';
import {
  GetCommentRequestDto,
  IgnoreCommentRequestDto,
} from './dto/comment.request.dto';

@ApiTags('Comment')
@Controller('comments')
export class CommentController {
  constructor(private _commentService: CommentService) {}

  @ApiBearerAuth()
  @Get('get')
  async FetchRepositoryComments(
    @Query() payload: GetCommentRequestDto,
    @Request() req: any,
  ) {
    return await this._commentService.fetchRepositoryComments(
      req.user.accountId,
      payload,
    );
  }

  @ApiBearerAuth()
  @Get('getDuplicatedCode')
  async FetchRepositoryDuplicateCode(
    @Query() payload: GetCommentRequestDto,
    @Request() req: any,
  ) {
    return await this._commentService.fetchRepositoryDuplicateCode(
      req.user.accountId,
      payload,
    );
  }

  @ApiBearerAuth()
  @Post('ignore')
  async ignoreComment(
    @Body() payload: IgnoreCommentRequestDto,
    @Request() req: any,
  ) {
    return await this._commentService.ignoreComment(
      payload.commentId,
      payload.ignoreReason,
    );
  }

  @ApiBearerAuth()
  @Post('unignore')
  async unignoreComment(
    @Body() payload: { commentId: string },
    @Request() req: any,
  ) {
    return await this._commentService.unignoreComment(payload.commentId);
  }

  @ApiBearerAuth()
  @Post(':commentId/reformat')
  async reformatCommentAnalysis(
    @Param('commentId') commentId: string,
    @Request() req: any,
  ) {
    return await this._commentService.reformatCommentAnalysis(commentId);
  }
}
