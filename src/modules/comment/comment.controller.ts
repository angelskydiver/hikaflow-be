import { Controller, Get, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CommentService } from './comment.service';
import { GetCommentRequestDto } from './dto/comment.request.dto';

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
}
