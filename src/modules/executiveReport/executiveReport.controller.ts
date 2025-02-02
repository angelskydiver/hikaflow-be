import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExecutiveReportService } from './executiveReport.service';

@ApiTags('Executive Report')
@Controller('executiveReport')
export class ExecutiveReportController {
  constructor(private executiveReportService: ExecutiveReportService) {}

  @ApiBearerAuth()
  @Get('/fetch/:id')
  async GetExecutiveReportById(@Param('id') id: string) {
    return await this.executiveReportService.getExecutiveReportById(id);
  }
}
