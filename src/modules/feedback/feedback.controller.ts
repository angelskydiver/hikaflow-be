import { Body, Controller, Post, Put, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CollectIgnoreFeedbackRequestDto,
  DisableAnalysisRuleRequestDto,
  EnableAnalysisRuleRequestDto,
} from './dto/feedback.request.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('Feedback')
@Controller('feedback')
export class FeedbackController {
  constructor(private _feedbackService: FeedbackService) {}

  @ApiBearerAuth()
  @Post('ignore')
  async collectIgnoreFeedback(
    @Body() payload: CollectIgnoreFeedbackRequestDto,
    @Request() req: any,
  ) {
    return await this._feedbackService.collectIgnoreFeedback(payload);
  }

  @ApiBearerAuth()
  @Post('disable-rule')
  async disableAnalysisRule(
    @Body() payload: DisableAnalysisRuleRequestDto,
    @Request() req: any,
  ) {
    return await this._feedbackService.disableAnalysisRule(payload);
  }

  @ApiBearerAuth()
  @Put('enable-rule')
  async enableAnalysisRule(@Body() payload: EnableAnalysisRuleRequestDto) {
    return await this._feedbackService.enableAnalysisRule(payload);
  }

  @ApiBearerAuth()
  @Post('ignore-feedback')
  async getIgnoreFeedback(
    @Query('organizationId') organizationId: string,
    @Query('daysBack') daysBack: number = 7,
  ) {
    return await this._feedbackService.getIgnoreFeedbackForAnalysis(
      organizationId,
      daysBack,
    );
  }
}
