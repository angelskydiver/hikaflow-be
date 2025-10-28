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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ScanStatus } from '@prisma/client';
import { Response } from 'express';
import { Public } from 'src/decorators/public';
import { PrismaService } from 'src/prisma/prisma.service';
import { RepositoryAnalysisV2Service } from './repositoryAnalysisV2.service';
import { RepositoryScanService } from './repositoryScan.service';

@Controller('repositoryScan')
export class RepositoryScanController {
  constructor(
    private _repositoryScanService: RepositoryScanService,
    private _prismaService: PrismaService,
    private _repositoryAnalysisV2Service: RepositoryAnalysisV2Service,
  ) {}

  /**
   * Enhanced flush mechanism for production streaming
   * Handles multiple flush methods and production environments
   */
  private forceFlush(res: Response): void {
    try {
      // Method 1: Standard Express flush
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }

      // Method 2: Flush headers (if available)
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      // Method 3: Force socket flush (Node.js internal)
      if (res.socket && typeof (res.socket as any).flush === 'function') {
        (res.socket as any).flush();
      }

      // Method 4: Write empty data to force flush
      if (typeof res.write === 'function') {
        res.write(''); // Empty write to force flush
      }
    } catch (flushError) {
      console.warn('Flush operation failed:', flushError);
      // Continue execution - don't throw as this is not critical
    }
  }

  @Post('/:repositoryId')
  @ApiBearerAuth()
  async QueueRepositoryScan(
    @Param('repositoryId') id: string,
    @Request() req: any,
  ) {
    try {
      if (!req.user || !req.user.accountId) {
        throw new BadRequestException('User authentication required');
      }

      return await this._repositoryScanService.queueRepositoryScan(
        id,
        req.user.accountId,
      );
    } catch (error) {
      console.error('Error in QueueRepositoryScan:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        error.message || 'Failed to queue repository scan',
      );
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
    @Res() res: Response,
  ) {
    // Set headers for Server-Sent Events with production optimizations
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'no-cache, no-store, must-revalidate, private',
    );
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Disable buffering for reverse proxies (critical for HTTPS production)
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Additional production-specific headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Last-Modified', new Date().toUTCString());

    // Force immediate flush for production
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }

    try {
      // Stream progress updates with enhanced production handling
      const streamProgress = (step: string, message: string, data?: any) => {
        try {
          const eventData = {
            step,
            message,
            timestamp: new Date().toISOString(),
            thinking: true,
            ...(data && { data }),
          };

          // Safely stringify the data
          const jsonString = JSON.stringify(eventData);
          const sseData = `data: ${jsonString}\n\n`;

          // Write with error handling
          res.write(sseData);

          // Enhanced flush mechanism for production
          this.forceFlush(res);

          // Log for debugging in production
          console.log(
            `[STREAM] Progress: ${step} - ${message.substring(0, 50)}...`,
          );
        } catch (stringifyError) {
          console.error('Error stringifying progress data:', stringifyError);
          // Send minimal data
          const minimalData = {
            step,
            message,
            timestamp: new Date().toISOString(),
            thinking: true,
          };
          res.write(`data: ${JSON.stringify(minimalData)}\n\n`);
          this.forceFlush(res);
        }
      };

      // Stream text chunks for real-time response with enhanced production handling
      const streamTextChunk = (chunk: string) => {
        try {
          // Ensure chunk is not empty and properly formatted
          if (!chunk || chunk.trim() === '') return;

          const eventData = {
            step: 'text_chunk',
            chunk: chunk.trim(),
            timestamp: new Date().toISOString(),
            streaming: true,
          };

          const jsonString = JSON.stringify(eventData);
          const sseData = `data: ${jsonString}\n\n`;

          // Write with error handling
          res.write(sseData);

          // Enhanced flush mechanism for production
          this.forceFlush(res);

          // Log for debugging in production
          console.log(`[STREAM] Text chunk: ${chunk.substring(0, 30)}...`);
        } catch (stringifyError) {
          console.error('Error stringifying text chunk:', stringifyError);
          // Try to send minimal chunk data
          try {
            res.write(
              `data: ${JSON.stringify({ step: 'text_chunk', chunk: chunk.substring(0, 100), timestamp: new Date().toISOString() })}\n\n`,
            );
            this.forceFlush(res);
          } catch (fallbackError) {
            console.error('Fallback chunk streaming failed:', fallbackError);
          }
        }
      };

      // Start analysis in background with streaming support
      const analysisPromise =
        this._repositoryScanService.analyzeRepositoryRefactored(
          repositoryId,
          body.query,
          req.user.accountId,
          body.threadId,
          body.analysisMode,
          streamProgress,
          streamTextChunk, // Pass the text chunk streaming function
        );

      // Send initial thinking events immediately
      streamProgress('thinking', 'Analyzing your question...');
      streamProgress(
        'thinking',
        'Understanding the context and requirements...',
      );
      streamProgress(
        'thinking',
        'Scanning repository structure and codebase...',
      );
      streamProgress('initializing', 'Setting up AI analysis pipeline...');

      // Wait for analysis to complete
      const result = await analysisPromise;

      // Send final events with enhanced production handling
      streamProgress('finalizing', 'Finalizing analysis results...');

      // Clean up large objects to prevent memory issues
      delete result.codeInsights;
      delete result.resourceAnalysis;
      delete result.architecturalGuidance;

      // Send completion with final flush
      streamProgress('completed', 'Analysis completed successfully', result);

      // Force final flush before ending
      this.forceFlush(res);

      // End the stream with proper SSE format
      res.write('event: end\ndata: {}\n\n');
      this.forceFlush(res);

      // Close the response
      res.end();

      console.log('[STREAM] Analysis completed and stream closed');
    } catch (error) {
      console.error('Error in streaming analysis:', error);

      try {
        const errorData = {
          step: 'error',
          message: error.message || 'An error occurred during analysis',
          timestamp: new Date().toISOString(),
        };

        res.write(`data: ${JSON.stringify(errorData)}\n\n`);
        this.forceFlush(res);

        res.write('event: end\ndata: {}\n\n');
        this.forceFlush(res);

        res.end();

        console.log('[STREAM] Error handled and stream closed');
      } catch (endError) {
        console.error('Error closing stream after error:', endError);
        // Force close the response
        try {
          res.end();
        } catch (forceCloseError) {
          console.error('Force close failed:', forceCloseError);
        }
      }
    }
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
  async triggerRescan(@Param('repositoryId') repositoryId?: string) {
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

        // Call the protected method
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

  @ApiBearerAuth()
  @Get('/threads/:repositoryId')
  async GetThreads(@Param('repositoryId') repositoryId: string) {
    try {
      // Get all threads for the repository
      const threads = await this._prismaService.thread.findMany({
        where: { repositoryId },
        orderBy: { updatedAt: 'desc' },
        include: {
          questions: {
            orderBy: { createdAt: 'desc' },
            take: 1, // Include only the most recent question for each thread
          },
        },
      });

      return threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastQuestion: thread.questions[0]?.question || null,
        lastQuestionDate: thread.questions[0]?.createdAt || null,
      }));
    } catch (error) {
      console.error('Error getting threads:', error);
      throw new BadRequestException(error.message || 'Failed to get threads');
    }
  }

  @ApiBearerAuth()
  @Get('/thread/:threadId')
  async GetThreadDetails(@Param('threadId') threadId: string) {
    try {
      // Get thread with all its questions
      const thread = await this._prismaService.thread.findUnique({
        where: { id: threadId },
        include: {
          questions: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!thread) {
        throw new NotFoundException(`Thread with ID ${threadId} not found`);
      }

      return {
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        questions: thread.questions.map((q) => ({
          id: q.id,
          isStarred: q.saved,
          question: q.question,
          answer: q.answer,
          summary: q.summary,
          createdAt: q.createdAt,
        })),
      };
    } catch (error) {
      console.error('Error getting thread details:', error);
      throw new BadRequestException(
        error.message || 'Failed to get thread details',
      );
    }
  }

  /**
   * Get collaborator table data for an organization
   */
  @Get('collaborators/:organizationId')
  async GetCollaboratorTableData(
    @Param('organizationId') organizationId: string,
  ) {
    return await this._repositoryScanService.fetchCollaboratorTableData(
      organizationId,
    );
  }

  /**
   * Get detailed collaborator profile with comparative analysis
   */
  @Get('collaborator-profile/:collaboratorId/:organizationId')
  async GetCollaboratorProfile(
    @Param('collaboratorId') collaboratorId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return await this._repositoryScanService.fetchCollaboratorProfile(
      collaboratorId,
      organizationId,
    );
  }

  /**
   * Get comprehensive impact analytics for dashboard
   */
  @ApiBearerAuth()
  @Get('/impactAnalytics/:repositoryId')
  async GetImpactAnalytics(
    @Param('repositoryId') repositoryId: string,
    @Query('timeframe') timeframe: string = '30d',
    @Query('includeRecommendations') includeRecommendations: boolean = true,
  ) {
    try {
      return await this._repositoryScanService.getImpactAnalytics(
        repositoryId,
        timeframe,
        includeRecommendations,
      );
    } catch (error) {
      console.error('Error fetching impact analytics:', error);
      throw new BadRequestException(
        error.message || 'Failed to fetch impact analytics',
      );
    }
  }

  /**
   * Get real-time impact insights for active PRs
   */
  @ApiBearerAuth()
  @Get('/realtimeInsights/:repositoryId')
  async GetRealtimeInsights(
    @Param('repositoryId') repositoryId: string,
    @Request() req: any,
  ) {
    try {
      return await this._repositoryScanService.getRealtimeInsights(
        repositoryId,
        req.user.accountId,
      );
    } catch (error) {
      console.error('Error fetching realtime insights:', error);
      throw new BadRequestException(
        error.message || 'Failed to fetch realtime insights',
      );
    }
  }

  /**
   * Get impact trends and patterns analysis
   */
  @ApiBearerAuth()
  @Get('/impactTrends/:repositoryId')
  async GetImpactTrends(
    @Param('repositoryId') repositoryId: string,
    @Query('period') period: string = '3m',
  ) {
    try {
      return await this._repositoryScanService.getImpactTrends(
        repositoryId,
        period,
      );
    } catch (error) {
      console.error('Error fetching impact trends:', error);
      throw new BadRequestException(
        error.message || 'Failed to fetch impact trends',
      );
    }
  }

  /**
   * Get flow dependency visualization data
   */
  @ApiBearerAuth()
  @Get('/flowDependencies/:repositoryId')
  async GetFlowDependencies(
    @Param('repositoryId') repositoryId: string,
    @Query('depth') depth: number = 3,
  ) {
    try {
      return await this._repositoryScanService.getFlowDependencies(
        repositoryId,
        depth,
      );
    } catch (error) {
      console.error('Error fetching flow dependencies:', error);
      throw new BadRequestException(
        error.message || 'Failed to fetch flow dependencies',
      );
    }
  }
}
