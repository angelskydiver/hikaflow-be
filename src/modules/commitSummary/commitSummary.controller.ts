import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/passport/guards/jwt.guard';
import { CommitSummaryService } from './commitSummary.service';

@Controller('commits')
@UseGuards(JwtAuthGuard)
export class CommitSummaryController {
  constructor(private readonly _commitSummaryService: CommitSummaryService) {}

  /**
   * Get commits for a repository with pagination and filtering
   */
  @Get()
  async getCommits(
    @Query('repositoryId') repositoryId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('branchName') branchName?: string,
    @Query('committer') committer?: string,
    @Query('isMerged') isMerged?: boolean,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return await this._commitSummaryService.getCommits(
      repositoryId,
      page,
      limit,
      branchName,
      committer,
      isMerged,
      startDate,
      endDate,
    );
  }

  /**
   * Get daily progress analytics for a repository
   */
  @Get('analytics/daily')
  async getDailyAnalytics(
    @Query('repositoryId') repositoryId: string,
    @Query('days') days: number = 30,
  ) {
    const analytics =
      await this._commitSummaryService.getDailyProgressAnalytics(
        repositoryId,
        days,
      );

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * Get commits by date range
   */
  @Get('date-range')
  async getCommitsByDateRange(
    @Query('repositoryId') repositoryId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const commits = await this._commitSummaryService.getCommitsByDateRange(
      repositoryId,
      new Date(startDate),
      new Date(endDate),
    );

    return {
      success: true,
      data: commits,
    };
  }

  /**
   * Get commit statistics for standup meetings
   */
  @Get('standup')
  async getStandupData(
    @Query('repositoryId') repositoryId: string,
    @Query('days') days: number = 1,
  ) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const commits = await this._commitSummaryService.getCommitsByDateRange(
      repositoryId,
      startDate,
      endDate,
    );

    const standupData = {
      totalCommits: commits.length,
      contributors: Array.from(new Set(commits.map((c) => c.committer))),
      moduleChanges: commits.reduce(
        (acc: Record<string, number>, commit: any) => {
          const moduleChanges = commit.moduleChanges || [];
          if (Array.isArray(moduleChanges)) {
            moduleChanges.forEach((module: string) => {
              acc[module] = (acc[module] || 0) + 1;
            });
          }
          return acc;
        },
        {},
      ),
      commits: commits.map((commit: any) => ({
        id: commit.commitId,
        message: commit.commitMessage,
        committer: commit.committer,
        additions: commit.additions,
        deletions: commit.deletions,
        modules: commit.moduleChanges || [],
        isMerged: commit.isMerged || false,
        createdAt: commit.createdAt,
        commitUrl: commit.commitUrl || null,
      })),
    };

    return {
      success: true,
      data: standupData,
    };
  }

  /**
   * Get module activity analytics
   */
  @Get('modules/activity')
  async getModuleActivity(
    @Query('repositoryId') repositoryId: string,
    @Query('days') days: number = 30,
  ) {
    const analytics =
      await this._commitSummaryService.getDailyProgressAnalytics(
        repositoryId,
        days,
      );

    return {
      success: true,
      data: {
        mostActiveModules: analytics.summary?.mostActiveModules || [],
        moduleTimeline: (analytics.dailyProgress || []).map((day: any) => ({
          date: day?.date || '',
          modules: day?.modules || [],
        })),
      },
    };
  }

  /**
   * Search commits using semantic search
   */
  @Get('search')
  async searchCommits(
    @Query('repositoryId') repositoryId: string,
    @Query('query') query: string,
    @Query('limit') limit: number = 10,
  ) {
    const results = await this._commitSummaryService.searchCommitsBySemantic(
      query,
      repositoryId,
      limit,
    );

    return {
      success: true,
      data: results,
    };
  }
}
