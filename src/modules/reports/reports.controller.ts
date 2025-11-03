import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../decorators/public';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerateWeeklyReportDto,
  GetWeeklyReportDto,
  ReportType,
} from './reports.dtos';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiBearerAuth()
  @Post('weekly/generate')
  async generateWeeklyReport(
    @Body() dto: GenerateWeeklyReportDto,
    @Request() req: any,
  ) {
    return await this.reportsService.generateWeeklyReport(
      dto,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('weekly')
  @ApiQuery({
    name: 'skip',
    required: false,
    type: Number,
    description: 'Skip number of records for pagination',
  })
  @ApiQuery({
    name: 'take',
    required: false,
    type: Number,
    description: 'Take number of records for pagination',
  })
  async getWeeklyReport(@Query() dto: GetWeeklyReportDto, @Request() req: any) {
    // Convert string query params to numbers if provided
    if (dto.skip) {
      dto.skip =
        typeof dto.skip === 'string' ? parseInt(dto.skip, 10) : dto.skip;
    }
    if (dto.take) {
      dto.take =
        typeof dto.take === 'string' ? parseInt(dto.take, 10) : dto.take;
    }

    // If no startDate provided, return list of available reports
    if (!dto.startDate) {
      return await this.reportsService.listWeeklyReports(
        dto,
        req.user.accountId,
      );
    }
    // Otherwise, return the specific report
    return await this.reportsService.getWeeklyReport(dto, req.user.accountId);
  }

  @ApiBearerAuth()
  @Get('team/:teamId/weekly')
  async getTeamWeeklyReport(
    @Param('teamId') teamId: string,
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!organizationId) {
      throw new Error('organizationId required');
    }
    const dto: GetWeeklyReportDto = {
      reportType: ReportType.TEAM,
      teamId,
      organizationId,
      startDate,
    };
    return await this.reportsService.getWeeklyReport(dto, req.user.accountId);
  }

  @ApiBearerAuth()
  @Get('contributor/:accountId/weekly')
  async getContributorWeeklyReport(
    @Param('accountId') accountId: string,
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!organizationId) {
      throw new Error('organizationId required');
    }
    const dto: GetWeeklyReportDto = {
      reportType: ReportType.CONTRIBUTOR,
      accountId,
      organizationId,
      startDate,
    };
    return await this.reportsService.getWeeklyReport(dto, req.user.accountId);
  }

  @ApiBearerAuth()
  @Get('report/:reportId')
  @ApiOperation({
    summary: 'Get weekly report by ID',
    description: 'Fetches a specific weekly report by its ID',
  })
  @ApiParam({
    name: 'reportId',
    description: 'The ID of the weekly report to fetch',
    type: String,
  })
  async getWeeklyReportById(
    @Param('reportId') reportId: string,
    @Request() req: any,
  ) {
    const report = await this.reportsService.getWeeklyReportById(
      reportId,
      req.user.accountId,
    );
    return {
      data: report,
      message: 'Report fetched successfully',
      success: true,
    };
  }

  @ApiBearerAuth()
  @Get('project/:repositoryId/weekly')
  async getProjectWeeklyReport(
    @Param('repositoryId') repositoryId: string,
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('organizationId') organizationId?: string,
    @Query('reportId') reportId?: string,
  ) {
    // If reportId is provided, fetch by ID
    if (reportId) {
      const report = await this.reportsService.getWeeklyReportById(
        reportId,
        req.user.accountId,
      );
      return {
        data: report,
        message: 'Report fetched successfully',
        success: true,
      };
    }

    // Otherwise, use the existing logic
    if (!organizationId) {
      throw new Error('organizationId required');
    }
    const dto: GetWeeklyReportDto = {
      reportType: ReportType.PROJECT,
      repositoryId,
      organizationId,
      startDate,
    };
    // Otherwise, return the specific report
    let report = await this.reportsService.getWeeklyReport(
      dto,
      req.user.accountId,
    );
    return {
      data: report,
      message: 'Report fetched successfully',
      success: true,
    };
  }

  @ApiBearerAuth()
  @Get('organization/:organizationId/weekly')
  async getOrganizationWeeklyReport(
    @Param('organizationId') organizationId: string,
    @Request() req: any,
    @Query('startDate') startDate?: string,
  ) {
    const dto: GetWeeklyReportDto = {
      reportType: ReportType.ORGANIZATION,
      organizationId,
      startDate,
    };
    return await this.reportsService.getWeeklyReport(dto, req.user.accountId);
  }

  @ApiBearerAuth()
  @Get('teams/activity-summary')
  @ApiOperation({
    summary: 'Get activity summary for all teams in organization',
    description:
      'Returns a summary of activity metrics for all teams, useful for displaying in a table',
  })
  @ApiQuery({
    name: 'organizationId',
    required: true,
    description: 'Organization ID to get teams activity for',
  })
  async getTeamsActivitySummary(
    @Query('organizationId') organizationId: string,
    @Request() req: any,
  ) {
    return await this.reportsService.getTeamsActivitySummary(
      organizationId,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('history')
  async getReportHistory(
    @Query('organizationId') organizationId: string,
    @Query('reportType') reportType: ReportType,
    @Request() req: any,
    @Query('teamId') teamId?: string,
    @Query('accountId') accountId?: string,
    @Query('repositoryId') repositoryId?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.reportsService.getReportHistory(
      organizationId,
      reportType,
      teamId,
      accountId,
      repositoryId,
      limit ? parseInt(limit) : 10,
    );
  }

  /**
   * Public route to manually trigger weekly reports cron job for testing
   * This route is public so it can be called locally without authentication
   */
  @Public()
  @Post('cron/generate-weekly-reports')
  @ApiOperation({
    summary: 'Manually trigger weekly reports generation (for testing)',
    description:
      'Public endpoint to test the weekly reports cron job. Generates reports for all organizations for the previous week.',
  })
  async triggerWeeklyReportsCron() {
    try {
      const { WeeklyReportsCronService } = await import(
        '../../cron/weeklyReports.cron'
      );

      const cronService = new WeeklyReportsCronService(
        this.reportsService,
        this.prisma,
      );

      await cronService.generateWeeklyReports();

      return {
        success: true,
        message: 'Weekly reports generation triggered successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error triggering weekly reports cron:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
