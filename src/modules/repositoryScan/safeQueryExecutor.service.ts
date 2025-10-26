import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Safe Query Executor
 * Executes database queries with type safety and error handling
 */

interface QueryFilter {
  table: string;
  field: string;
  operator: 'equals' | 'contains' | 'gte' | 'lte' | 'in' | 'not';
  value: any;
  dataType: 'string' | 'number' | 'date' | 'boolean';
  logicalOperator?: 'AND' | 'OR';
}

interface QueryParams {
  queryType: string;
  tables: string[];
  filters: QueryFilter[];
  timeRange?: {
    startDate: Date;
    endDate: Date;
  };
  orderBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

@Injectable()
export class SafeQueryExecutorService {
  constructor(private prisma: PrismaService) {}

  /**
   * Execute query safely with type validation
   */
  async executeQuery(params: QueryParams, repositoryId: string): Promise<any> {
    console.log(
      `[SafeQueryExecutor] Executing ${params.queryType} query for repository ${repositoryId}`,
    );

    try {
      // Route to appropriate handler based on query type
      switch (params.queryType) {
        case 'pr_analysis':
          return await this.executePRAnalysis(params, repositoryId);

        case 'committer_analysis':
          return await this.executeCommitterAnalysis(params, repositoryId);

        case 'time_range_analysis':
          return await this.executeTimeRangeAnalysis(params, repositoryId);

        case 'feature_verification':
          return await this.executeFeatureVerification(params, repositoryId);

        case 'cross_pr':
          return await this.executeCrossPRAnalysis(params, repositoryId);

        case 'module_analysis':
          return await this.executeModuleAnalysis(params, repositoryId);

        default:
          return await this.executeGenericQuery(params, repositoryId);
      }
    } catch (error) {
      console.error('[SafeQueryExecutor] Query execution failed:', error);
      return await this.executeFallbackQuery(repositoryId);
    }
  }

  /**
   * Execute PR-specific analysis
   */
  private async executePRAnalysis(
    params: QueryParams,
    repositoryId: string,
  ): Promise<any> {
    const prNumberFilter = params.filters.find(
      (f) => f.field === 'prNumber' || f.field === 'prId',
    );
    const prNumber = prNumberFilter ? parseInt(prNumberFilter.value) : null;

    if (!prNumber) {
      throw new Error('PR number not found in filters');
    }

    console.log(`[SafeQueryExecutor] Fetching PR #${prNumber}`);

    const [prReport, commits, comments] = await Promise.all([
      // Get PR report
      this.prisma.executiveReport.findFirst({
        where: {
          repositoryId,
          prNumber,
        },
        include: {
          codeOverview: true,
        },
      }),

      // Get commits for this PR
      this.prisma.commitSummary.findMany({
        where: {
          repositoryId,
          report: {
            prNumber,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // Get comments for this PR
      this.prisma.comment.findMany({
        where: {
          repositoryId,
          prId: prNumber.toString(),
        },
      }),
    ]);

    return {
      queryType: 'pr_analysis',
      prNumber,
      data: {
        prReport,
        commits,
        comments,
        summary: this.generatePRSummary(prReport, commits, comments),
      },
    };
  }

  /**
   * Execute committer-specific analysis
   */
  private async executeCommitterAnalysis(
    params: QueryParams,
    repositoryId: string,
  ): Promise<any> {
    const committerFilter = params.filters.find((f) => f.field === 'committer');
    const committer = committerFilter ? committerFilter.value : null;

    if (!committer) {
      throw new Error('Committer name not found in filters');
    }

    console.log(`[SafeQueryExecutor] ========================================`);
    console.log(`[SafeQueryExecutor] COMMITTER ANALYSIS QUERY`);
    console.log(`[SafeQueryExecutor] Committer: ${committer}`);
    console.log(`[SafeQueryExecutor] Repository ID: ${repositoryId}`);

    // Build where clause
    const where: any = {
      repositoryId,
      committer: {
        contains: committer,
        mode: 'insensitive',
      },
    };

    // Add time range if provided
    if (params.timeRange) {
      console.log(`[SafeQueryExecutor] Time Range Applied:`);
      console.log(
        `[SafeQueryExecutor]   Start: ${params.timeRange.startDate.toISOString()}`,
      );
      console.log(
        `[SafeQueryExecutor]   End: ${params.timeRange.endDate.toISOString()}`,
      );

      where.createdAt = {
        gte: params.timeRange.startDate,
        lte: params.timeRange.endDate,
      };
    } else {
      console.log(`[SafeQueryExecutor] WARNING: No time range provided!`);
    }

    console.log(
      `[SafeQueryExecutor] Full WHERE clause:`,
      JSON.stringify(where, null, 2),
    );
    console.log(`[SafeQueryExecutor] Executing Prisma query...`);

    const commits = await this.prisma.commitSummary.findMany({
      where,
      include: {
        report: true,
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50,
    });

    console.log(`[SafeQueryExecutor] Query Results:`);
    console.log(`[SafeQueryExecutor]   Total commits found: ${commits.length}`);
    if (commits.length > 0) {
      console.log(
        `[SafeQueryExecutor]   Oldest commit: ${commits[commits.length - 1].createdAt}`,
      );
      console.log(
        `[SafeQueryExecutor]   Newest commit: ${commits[0].createdAt}`,
      );
      console.log(
        `[SafeQueryExecutor]   Committers found: ${[...new Set(commits.map((c) => c.committer))].join(', ')}`,
      );
    }
    console.log(`[SafeQueryExecutor] ========================================`);

    return {
      queryType: 'committer_analysis',
      committer,
      data: {
        commits,
        metrics: this.calculateCommitterMetrics(commits),
      },
    };
  }

  /**
   * Execute time range analysis
   */
  private async executeTimeRangeAnalysis(
    params: QueryParams,
    repositoryId: string,
  ): Promise<any> {
    const timeRange = params.timeRange || {
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: new Date(),
    };

    console.log(
      `[SafeQueryExecutor] Analyzing time range: ${timeRange.startDate} to ${timeRange.endDate}`,
    );

    const [commits, prs, comments] = await Promise.all([
      // Get commits in time range
      this.prisma.commitSummary.findMany({
        where: {
          repositoryId,
          createdAt: {
            gte: timeRange.startDate,
            lte: timeRange.endDate,
          },
        },
        include: {
          report: true,
        },
        orderBy: { createdAt: 'desc' },
      }),

      // Get PRs in time range
      this.prisma.executiveReport.findMany({
        where: {
          repositoryId,
        },
        include: {
          commitSummary: {
            where: {
              createdAt: {
                gte: timeRange.startDate,
                lte: timeRange.endDate,
              },
            },
          },
        },
      }),

      // Get comments in time range
      this.prisma.comment.findMany({
        where: {
          repositoryId,
          createdAt: {
            gte: timeRange.startDate,
            lte: timeRange.endDate,
          },
        },
      }),
    ]);

    return {
      queryType: 'time_range_analysis',
      timeRange,
      data: {
        commits,
        prs: prs.filter((pr) => pr.commitSummary.length > 0),
        comments,
        metrics: this.calculateTimeRangeMetrics(commits, prs, comments),
      },
    };
  }

  /**
   * Execute feature verification
   */
  private async executeFeatureVerification(
    params: QueryParams,
    repositoryId: string,
  ): Promise<any> {
    const featureFilter = params.filters.find((f) =>
      ['feature', 'module', 'functionality'].includes(f.field.toLowerCase()),
    );
    const featureName = featureFilter ? featureFilter.value : null;

    if (!featureName) {
      throw new Error('Feature name not found in filters');
    }

    console.log(`[SafeQueryExecutor] Verifying feature: ${featureName}`);

    // Search in commits
    const commits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId,
        OR: [
          {
            commitMessage: {
              contains: featureName,
              mode: 'insensitive',
            },
          },
          {
            summary: {
              path: ['Summary'],
              string_contains: featureName,
            },
          },
        ],
      },
      include: {
        report: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Get latest PR
    const latestPR = await this.prisma.executiveReport.findFirst({
      where: { repositoryId },
      include: {
        commitSummary: true,
      },
    });

    return {
      queryType: 'feature_verification',
      feature: featureName,
      data: {
        found: commits.length > 0,
        commits,
        latestPR,
      },
    };
  }

  /**
   * Execute cross-PR analysis
   */
  private async executeCrossPRAnalysis(
    params: QueryParams,
    repositoryId: string,
  ): Promise<any> {
    console.log('[SafeQueryExecutor] Executing cross-PR analysis');

    const prs = await this.prisma.executiveReport.findMany({
      where: { repositoryId },
      include: {
        commitSummary: true,
      },
      take: params.limit || 10,
    });

    return {
      queryType: 'cross_pr',
      data: {
        prs,
        relationships: this.analyzePRRelationships(prs),
      },
    };
  }

  /**
   * Execute module analysis
   */
  private async executeModuleAnalysis(
    params: QueryParams,
    repositoryId: string,
  ): Promise<any> {
    const moduleFilter = params.filters.find((f) => f.field === 'module');
    const moduleName = moduleFilter ? moduleFilter.value : null;

    console.log(`[SafeQueryExecutor] Analyzing module: ${moduleName}`);

    const commits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId,
        ...(moduleName && {
          moduleChanges: {
            path: [],
            array_contains: [moduleName],
          },
        }),
      },
      include: {
        report: true,
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50,
    });

    return {
      queryType: 'module_analysis',
      module: moduleName,
      data: {
        commits,
        metrics: this.calculateModuleMetrics(commits),
      },
    };
  }

  /**
   * Execute generic query
   */
  private async executeGenericQuery(
    params: QueryParams,
    repositoryId: string,
  ): Promise<any> {
    console.log('[SafeQueryExecutor] Executing generic query');

    const commits = await this.prisma.commitSummary.findMany({
      where: { repositoryId },
      include: { report: true },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 20,
    });

    return {
      queryType: 'generic',
      data: { commits },
    };
  }

  /**
   * Fallback query when everything fails
   */
  private async executeFallbackQuery(repositoryId: string): Promise<any> {
    console.log('[SafeQueryExecutor] Executing fallback query');

    const commits = await this.prisma.commitSummary.findMany({
      where: { repositoryId },
      include: { report: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      queryType: 'fallback',
      data: { commits },
      warning: 'Using fallback query due to parsing errors',
    };
  }

  /**
   * Helper: Generate PR summary
   */
  private generatePRSummary(prReport: any, commits: any[], comments: any[]) {
    return {
      totalCommits: commits.length,
      totalComments: comments.length,
      linesAdded: commits.reduce((sum, c) => sum + (c.additions || 0), 0),
      linesDeleted: commits.reduce((sum, c) => sum + (c.deletions || 0), 0),
      filesChanged: commits.reduce((sum, c) => sum + (c.totalFiles || 0), 0),
      contributors: [...new Set(commits.map((c) => c.committer))],
    };
  }

  /**
   * Helper: Calculate committer metrics
   */
  private calculateCommitterMetrics(commits: any[]) {
    return {
      totalCommits: commits.length,
      totalAdditions: commits.reduce((sum, c) => sum + (c.additions || 0), 0),
      totalDeletions: commits.reduce((sum, c) => sum + (c.deletions || 0), 0),
      filesModified: commits.reduce((sum, c) => sum + (c.totalFiles || 0), 0),
      uniquePRs: [...new Set(commits.map((c) => c.reportId).filter(Boolean))]
        .length,
      timeRange: {
        earliest: commits[commits.length - 1]?.createdAt,
        latest: commits[0]?.createdAt,
      },
    };
  }

  /**
   * Helper: Calculate time range metrics
   */
  private calculateTimeRangeMetrics(
    commits: any[],
    prs: any[],
    comments: any[],
  ) {
    return {
      totalCommits: commits.length,
      totalPRs: prs.length,
      totalComments: comments.length,
      totalAdditions: commits.reduce((sum, c) => sum + (c.additions || 0), 0),
      totalDeletions: commits.reduce((sum, c) => sum + (c.deletions || 0), 0),
      uniqueContributors: [...new Set(commits.map((c) => c.committer))].length,
      mostActiveContributor: this.getMostActiveContributor(commits),
    };
  }

  /**
   * Helper: Get most active contributor
   */
  private getMostActiveContributor(commits: any[]) {
    const contributorCounts = commits.reduce((acc, commit) => {
      acc[commit.committer] = (acc[commit.committer] || 0) + 1;
      return acc;
    }, {});

    const sorted = Object.entries(contributorCounts).sort(
      (a: any, b: any) => b[1] - a[1],
    );
    return sorted[0] ? sorted[0][0] : null;
  }

  /**
   * Helper: Calculate module metrics
   */
  private calculateModuleMetrics(commits: any[]) {
    return {
      totalCommits: commits.length,
      totalChanges:
        commits.reduce((sum, c) => sum + (c.additions || 0), 0) +
        commits.reduce((sum, c) => sum + (c.deletions || 0), 0),
      contributors: [...new Set(commits.map((c) => c.committer))],
      recentActivity: commits.slice(0, 5),
    };
  }

  /**
   * Helper: Analyze PR relationships
   */
  private analyzePRRelationships(prs: any[]) {
    // Simple relationship analysis based on commit overlap
    const relationships = [];

    for (let i = 0; i < prs.length - 1; i++) {
      for (let j = i + 1; j < prs.length; j++) {
        const pr1Commits = new Set(prs[i].commitSummary.map((c) => c.id));
        const pr2Commits = new Set(prs[j].commitSummary.map((c) => c.id));

        const overlap = [...pr1Commits].filter((x) => pr2Commits.has(x));

        if (overlap.length > 0) {
          relationships.push({
            pr1: prs[i].prNumber,
            pr2: prs[j].prNumber,
            sharedCommits: overlap.length,
            relationship: 'related',
          });
        }
      }
    }

    return relationships;
  }
}
