import { Controller, Get, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetPullRequestDto } from './dto/pullRequest.request.dto';
import { PullRequestService } from './pullRequest.service';

@ApiTags('Pull Request')
@Controller('pullRequest')
export class PullRequestController {
  constructor(private _pullRequestService: PullRequestService) {}

  @ApiBearerAuth()
  @Get('/recent')
  async RecentPullRequests(
    @Query() payload: GetPullRequestDto,
    @Request() req: any,
  ) {
    return await this._pullRequestService.recentPullRequests(
      req.user.accountId,
      payload,
    );
  }
}
