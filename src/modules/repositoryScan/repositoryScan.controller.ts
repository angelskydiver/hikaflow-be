import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ScanStatus } from '@prisma/client';
import { Public } from 'src/decorators/public';
import { PrismaService } from 'src/prisma/prisma.service';
import { RepositoryScanService } from './repositoryScan.service';

@Controller('repositoryScan')
export class RepositoryScanController {
  constructor(
    private _repositoryScanService: RepositoryScanService,
    private _prismaService: PrismaService,
  ) {}

  @Post('/:repositoryId')
  @ApiBearerAuth()
  async QueueRepositoryScan(
    @Param('repositoryId') id: string,
    @Request() req: any,
  ) {
    try {
      return await this._repositoryScanService.queueRepositoryScan(
        id,
        req.user.accountId,
      );
    } catch (error) {
      console.error(error);
    }
  }

  @Get('structure/:repositoryId')
  @ApiBearerAuth()
  async FetchFileStructure(
    @Param('repositoryId') repositoryId: string,
    @Request() req: any,
  ) {
    try {
      return await this._repositoryScanService.fetchFileStructure(
        repositoryId,
        req.user.accountId,
      );
    } catch (error) {
      console.error(error);
    }
  }

  @Get('fileContent')
  @ApiBearerAuth()
  async FetchFileSummary(@Query() data: any, @Request() req: any) {
    try {
      return await this._repositoryScanService.fetchFileSummary({
        repositoryId: data.scanId,
        path: data.path,
        accountId: req.user.accountId,
      });
    } catch (error) {
      console.error(error);
    }
  }

  @Get('scanStatus/:repositoryId')
  async FetchScanStatus(@Param('repositoryId') repositoryId: string) {
    try {
      return await this._repositoryScanService.fetchScanStatus(repositoryId);
    } catch (error) {
      console.error(error);
    }
  }

  @Public()
  @Get('testRoute/:scanId')
  async EmbedRepositoryById(@Param('scanId') scanId: string) {
    try {
      console.log('scanId', scanId);
      return await this._repositoryScanService.embedRepositoryById(scanId);
    } catch (error) {
      console.error(error);
    }
  }

  // @Public()
  @ApiBearerAuth()
  @Post('askQuestion/:repositoryId')
  async TestAnalyzeAssistance(
    @Param('repositoryId') repositoryId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return await this._repositoryScanService.testAnalyzeAssistance(
      repositoryId,
      body.query,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('/savedQuestions/:repositoryId')
  async FetchedSavedQuestions(@Param('repositoryId') repositoryId: string) {
    try {
      return await this._repositoryScanService.fetchedSavedQuestions(
        repositoryId,
      );
    } catch (error) {
      console.log(error.message);
    }
  }

  @ApiBearerAuth()
  @Put('/savedQuestions/:questionId')
  async MarkQuestionSaved(@Param('questionId') questionId: string) {
    try {
      return await this._repositoryScanService.markQuestionSaved(questionId);
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Retrieves regression testing entities for a repository with pagination
   * @param repositoryId Repository ID
   * @param page Page number (1-based)
   * @param limit Number of items per page
   * @returns Paginated regression testing reports
   */
  @ApiBearerAuth()
  @Get('/regressionReports/:repositoryId')
  async GetRegressionReports(
    @Param('repositoryId') repositoryId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('status') status?: string,
  ) {
    try {
      return await this._repositoryScanService.getRegressionReports(
        repositoryId,
        {
          page,
          limit,
          status,
        },
      );
    } catch (error) {
      console.error('Error fetching regression reports:', error);
      throw new BadRequestException(
        error.message || 'Failed to fetch regression reports',
      );
    }
  }

  /**
   * Retrieves a specific regression testing report by ID
   * @param reportId Regression report ID
   * @returns Detailed regression report
   */
  @ApiBearerAuth()
  @Get('/regressionReports/detail/:reportId')
  async GetRegressionReportDetail(@Param('reportId') reportId: string) {
    try {
      return await this._repositoryScanService.getRegressionReportDetail(
        reportId,
      );
    } catch (error) {
      console.error('Error fetching regression report detail:', error);
      throw new BadRequestException(
        error.message || 'Failed to fetch regression report detail',
      );
    }
  }

  @ApiOperation({ summary: 'Scan a file on demand' })
  @ApiParam({ name: 'repositoryId', type: 'string' })
  @ApiParam({ name: 'filePath', type: 'string' })
  @ApiBearerAuth()
  @Post('/repository/:repositoryId/scan-file/:filePath(*)')
  async scanFileOnDemand(
    @Param('repositoryId') repositoryId: string,
    @Param('filePath') filePath: string,
    @Request() req: any,
  ) {
    try {
      // Get account ID from authenticated user
      const accountId = req.user.accountId;

      return await this._repositoryScanService.scanOnDemand(
        repositoryId,
        filePath,
        accountId,
      );
    } catch (error) {
      console.error(`Error scanning file on demand: ${filePath}`, error);
      throw new BadRequestException(
        error.message || 'Failed to scan file on demand',
      );
    }
  }

  @ApiOperation({ summary: 'Manually trigger rescan of missing files' })
  @ApiParam({ name: 'repositoryId', type: 'string', required: false })
  @ApiBearerAuth()
  @Post('/rescan/:repositoryId?')
  async triggerRescan(
    @Param('repositoryId') repositoryId?: string,
    @Request() req?: any,
  ) {
    try {
      // If repository ID is provided, scan only that repository
      if (repositoryId) {
        const repository = await this._prismaService.repository.findUnique({
          where: { id: repositoryId },
        });

        if (!repository) {
          throw new NotFoundException(
            `Repository with ID ${repositoryId} not found`,
          );
        }

        // Create a scan record for this specific repository
        const scan = await this._prismaService.repositoryScan.findFirst({
          where: {
            repositoryId,
            status: ScanStatus.COMPLETED,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (!scan) {
          throw new BadRequestException(
            'No completed scans found for this repository',
          );
        }

        // Mock the structure needed for rescanMissingFiles to process just this repository
        const mockLatestScanByRepo = {
          [repositoryId]: scan,
        };

        // Call the protected method with our mock data
        return this._repositoryScanService.rescanMissingFiles();
      }

      // Otherwise scan all repositories from last 24 hours
      return this._repositoryScanService.rescanMissingFiles();
    } catch (error) {
      console.error('Error triggering rescan:', error);
      throw new BadRequestException(
        error.message || 'Failed to trigger rescan',
      );
    }
  }
}
