import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommentStatus, CommentType, Prisma } from '@prisma/client';
import { Gemini } from '../../config/helpers/ai/gemini.ai.helper';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenerateWeeklyReportDto,
  GetWeeklyReportDto,
  ReportType,
} from './reports.dtos';

export interface ContributorMetrics {
  commits: {
    total: number;
    merged: number;
    additions: number;
    deletions: number;
    filesChanged: number;
  };
  modules: {
    primary: string[];
    all: { name: string; commits: number; changes: number }[];
  };
  issues: {
    fixed: number;
    opened: number;
    stillOpen: number; // Issues that remain open at the end of the period
    closed: number; // Issues closed during the period (fixed + resolved)
    categories: { [category: string]: number };
    avgResolutionTime: number;
  };
  pullRequests: {
    created: number;
    merged: number;
    reviewed: number;
  };
  codeQuality: {
    commentsAddressed: number;
    securityFixes: number;
    codeSmellFixes: number;
    commentsOnPRs: number;
  };
}

export interface ContributorReport {
  contributor: {
    id: string;
    name: string;
    email: string;
    role: string;
    team: string;
  };
  period: { start: Date; end: Date };
  metrics: ContributorMetrics;
  suggestions: string[];
  insights: string[];
}

export interface TeamReport {
  team: { id: string; name: string };
  period: { start: Date; end: Date };
  summary: {
    totalContributors: number;
    totalCommits: number;
    totalIssuesFixed: number;
    totalPRsMerged: number;
    topPerformers: string[];
    modulesCovered: string[];
  };
  contributors: ContributorReport[];
  teamHealth: {
    velocity: number;
    backlog: number;
    quality: 'excellent' | 'good' | 'needs_attention';
  };
  insights: string[];
  recommendations: string[];
}

@Injectable()
export class ReportsService {
  private readonly gemini: Gemini;

  constructor(private readonly prisma: PrismaService) {
    this.gemini = new Gemini();
  }

  async generateWeeklyReport(dto: GenerateWeeklyReportDto, accountId: string) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    // Verify organization access
    const orgAccess = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: dto.organizationId,
        accountId,
        // role: 'ADMIN'
      },
    });

    if (!orgAccess) {
      throw new NotFoundException('Organization access not found');
    }

    switch (dto.reportType) {
      case ReportType.CONTRIBUTOR:
        if (!dto.accountId) {
          throw new BadRequestException(
            'accountId required for contributor reports',
          );
        }
        return await this.generateContributorReport(
          dto.organizationId,
          dto.accountId,
          startDate,
          endDate,
        );

      case ReportType.TEAM:
        if (!dto.teamId) {
          throw new BadRequestException('teamId required for team reports');
        }
        return await this.generateTeamReport(
          dto.organizationId,
          dto.teamId,
          startDate,
          endDate,
        );

      case ReportType.PROJECT:
        if (!dto.repositoryId) {
          throw new BadRequestException(
            'repositoryId required for project reports',
          );
        }
        return await this.generateProjectReport(
          dto.organizationId,
          dto.repositoryId,
          startDate,
          endDate,
        );

      case ReportType.ORGANIZATION:
        return await this.generateOrganizationReport(
          dto.organizationId,
          startDate,
          endDate,
        );

      default:
        throw new BadRequestException('Invalid report type');
    }
  }

  private async generateContributorReport(
    organizationId: string,
    accountId: string,
    startDate: Date,
    endDate: Date,
  ) {
    console.log(
      `[ReportsService] Generating contributor report for accountId: ${accountId}, organizationId: ${organizationId}, period: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    // Get account and user info (even if not in team)
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: {
        user: true,
      },
    });

    if (!account) {
      console.warn(`[ReportsService] Account ${accountId} not found`);
      throw new NotFoundException('Account not found');
    }

    // Get all Git contributor names for this account
    const gitContributorNames = await this.prisma.gitContributorName.findMany({
      where: { accountId },
      select: { name: true },
    });

    // Check if any gitContributorName is set - required for generating contributor reports
    if (!gitContributorNames || gitContributorNames.length === 0) {
      console.warn(
        `[ReportsService] Account ${accountId} does not have any Git contributor names set. Skipping contributor report generation.`,
      );
      throw new BadRequestException(
        'Git contributor name is required to generate personal contribution reports. Please add your Git contributor name in your profile settings.',
      );
    }

    // Get user full name for matching
    const userFullName =
      `${account.user.firstName} ${account.user.lastName}`.trim();
    const userEmail = account.user.email;
    const gitContributorNameList = gitContributorNames.map((n) =>
      n.name.trim(),
    );

    console.log(
      `[ReportsService] Processing contributor: ${userFullName} (${userEmail})`,
    );

    // Get team member info (optional - user may not be in a team)
    const teamMember = await this.prisma.teamMember.findFirst({
      where: {
        accountId,
        team: { organizationId },
      },
      include: {
        team: true,
        organizationRole: true,
      },
    });

    let repositoryIds: string[] = [];
    let teamName: string | null = null;
    let roleName: string | null = null;

    // Option 1: Get repositories linked to team (if user is in a team)
    if (teamMember) {
      console.log(
        `[ReportsService] User is in team: ${teamMember.team.name}, role: ${teamMember.organizationRole?.name || 'N/A'}`,
      );
      teamName = teamMember.team.name;
      roleName = teamMember.organizationRole?.name || null;

      const teamRepositories = await this.prisma.teamRepository.findMany({
        where: {
          teamId: teamMember.teamId,
        },
        include: {
          repository: {
            select: { repositoryId: true },
          },
        },
      });

      repositoryIds = teamRepositories.map((tr) => tr.repository.repositoryId);

      console.log(
        `[ReportsService] Found ${repositoryIds.length} repositories from team ${teamMember.team.name}`,
      );
    } else {
      console.log(
        `[ReportsService] User ${accountId} is not in any team for organization ${organizationId}`,
      );
    }

    // Option 2: Get repositories the user has direct access to via AccountRepository
    const accountRepositories = await this.prisma.accountRepository.findMany({
      where: {
        accountId,
        organizationId, // Only repos for this organization
      },
      include: {
        repository: {
          select: { repositoryId: true },
        },
      },
    });

    const accountRepoIds = accountRepositories.map(
      (ar) => ar.repository.repositoryId,
    );

    console.log(
      `[ReportsService] Found ${accountRepoIds.length} repositories via direct account access (not linked to any team)`,
    );

    // Combine both sets of repository IDs (remove duplicates)
    const allRepositoryIds = [
      ...new Set([...repositoryIds, ...accountRepoIds]),
    ];

    console.log(
      `[ReportsService] Total repositories to analyze: ${allRepositoryIds.length} (${repositoryIds.length} from team, ${accountRepoIds.length} from direct access)`,
    );

    if (allRepositoryIds.length === 0) {
      console.warn(
        `[ReportsService] No repositories found for user ${userFullName} (neither team-linked nor direct access)`,
      );
      // Return empty report
      return {
        contributor: {
          id: accountId,
          name: userFullName,
          email: userEmail,
          role: roleName || 'Member',
          team: teamName || 'No Team',
        },
        period: { start: startDate, end: endDate },
        metrics: {
          commits: {
            total: 0,
            merged: 0,
            additions: 0,
            deletions: 0,
            filesChanged: 0,
          },
          modules: { primary: [], all: [] },
          issues: {
            fixed: 0,
            opened: 0,
            stillOpen: 0,
            closed: 0,
            categories: {},
            avgResolutionTime: 0,
          },
          pullRequests: { created: 0, merged: 0, reviewed: 0 },
          codeQuality: {
            commentsAddressed: 0,
            securityFixes: 0,
            codeSmellFixes: 0,
            commentsOnPRs: 0,
          },
        },
        insights: [
          'No repositories found - user may need to be added to a team or have repositories linked',
        ],
        suggestions: [
          'Link repositories to your account or join a team with linked repositories',
        ],
      };
    }

    // Fetch commits by this contributor strictly within the period
    // Match by any of the gitContributorNames (primary) or user full name (fallback)
    const committerMatchConditions = [
      { committer: userFullName }, // Fallback: match by full name
      { committer: { contains: account.user.firstName } }, // Fallback: partial match by first name
      { committer: { contains: account.user.lastName } }, // Fallback: partial match by last name
    ];

    // Add conditions for each Git contributor name
    gitContributorNameList.forEach((name) => {
      committerMatchConditions.push(
        { committer: name }, // Exact match
        { committer: { contains: name } }, // Partial match
      );
    });

    const commits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId: { in: allRepositoryIds },
        createdAt: { gte: startDate, lte: endDate },
        OR: committerMatchConditions,
      },
      include: {
        report: {
          select: {
            repositoryId: true,
            prNumber: true,
          },
        },
      },
    });

    console.log(
      `[ReportsService] Found ${commits.length} commits for contributor ${userFullName} (${commits.filter((c) => c.isMerged).length} merged)`,
    );

    // Calculate commit metrics
    const commitMetrics = {
      total: commits.length,
      merged: commits.filter((c) => c.isMerged).length,
      additions: commits.reduce((sum, c) => sum + c.additions, 0),
      deletions: commits.reduce((sum, c) => sum + c.deletions, 0),
      filesChanged: commits.reduce((sum, c) => sum + c.totalFiles, 0),
    };

    // Extract modules
    const moduleMap = new Map<string, { commits: number; changes: number }>();
    commits.forEach((commit) => {
      if (commit.moduleChanges && Array.isArray(commit.moduleChanges)) {
        commit.moduleChanges.forEach((modulePath: string) => {
          const moduleName = this.extractModuleName(modulePath);
          const existing = moduleMap.get(moduleName) || {
            commits: 0,
            changes: 0,
          };
          moduleMap.set(moduleName, {
            commits: existing.commits + 1,
            changes: existing.changes + commit.additions + commit.deletions,
          });
        });
      }
    });

    const modules = Array.from(moduleMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.commits - a.commits);
    const primaryModules = modules.slice(0, 3).map((m) => m.name);

    // Prepare issue categorization helpers
    let fixedIssues: Array<any> = [];
    let openedIssues: Array<any> = [];
    let stillOpenIssues: Array<any> = [];
    let issueCategories: { [key: string]: number } = {};
    let avgResolutionTime = 0;

    // Find PRs from commits via ExecutiveReport relationship
    const commitsWithReports = commits.filter((c) => c.reportId);
    const uniqueReportIds = [
      ...new Set(
        commitsWithReports
          .map((c) => c.reportId)
          .filter((id): id is string => id !== null),
      ),
    ];

    // Get ExecutiveReports to find PR numbers
    const executiveReports = await this.prisma.executiveReport.findMany({
      where: {
        id: { in: uniqueReportIds },
        repositoryId: { in: repositoryIds },
      },
      select: {
        repositoryId: true,
        prNumber: true,
      },
    });

    // Find PullRequests matching these PR numbers
    const prNumbers = executiveReports.map((er) => er.prNumber);
    const relatedPRs = await this.prisma.pullRequest.findMany({
      where: {
        repositoryId: { in: allRepositoryIds },
        prNumber: { in: prNumbers },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        prNumber: true,
        createdAt: true,
      },
    });

    const prIds = relatedPRs.map((pr) => pr.id);

    // After determining PRs touched by this contributor in period, load issues tied to these PRs
    fixedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: allRepositoryIds },
        type: CommentType.PULL_REQUEST,
        status: CommentStatus.OUTDATED,
        prId: { in: prIds },
        updatedAt: { gte: startDate, lte: endDate },
      },
    });

    openedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: allRepositoryIds },
        type: CommentType.PULL_REQUEST,
        status: CommentStatus.OPEN,
        prId: { in: prIds },
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    stillOpenIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: allRepositoryIds },
        type: CommentType.PULL_REQUEST,
        status: CommentStatus.OPEN,
        prId: { in: prIds },
        createdAt: { lte: endDate },
      },
    });

    // Categorize issues
    issueCategories = {};
    fixedIssues.forEach((issue) => {
      const category = issue.issueCategory || 'Other';
      issueCategories[category] = (issueCategories[category] || 0) + 1;
    });

    // Calculate average resolution time (simplified - using updatedAt - createdAt)
    const resolvedIssuesWithTime = fixedIssues.filter((issue) => {
      const resolutionTime =
        issue.updatedAt.getTime() - issue.createdAt.getTime();
      return resolutionTime > 0;
    });

    avgResolutionTime =
      resolvedIssuesWithTime.length > 0
        ? resolvedIssuesWithTime.reduce((sum, issue) => {
            const resolutionTime =
              issue.updatedAt.getTime() - issue.createdAt.getTime();
            return sum + resolutionTime / (1000 * 60 * 60); // Convert to hours
          }, 0) / resolvedIssuesWithTime.length
        : 0;

    // Get PRs created by this contributor: not tracked (no author field) -> 0 to avoid over-counting
    const prsCreated = 0;

    // Get PRs merged (PR numbers with at least one merged commit by this contributor in the period)
    const mergedPRNumberSet = new Set<number>();
    commitsWithReports.forEach((c) => {
      if (c.isMerged && c.report?.prNumber) {
        mergedPRNumberSet.add(c.report.prNumber);
      }
    });
    const prsMerged = mergedPRNumberSet.size;
    // Open PRs touched by the contributor in this period (created any time)
    const distinctTouchedPRNumbers = new Set<number>(prNumbers);
    const prsOpen = Math.max(
      distinctTouchedPRNumbers.size - mergedPRNumberSet.size,
      0,
    );

    // Get PRs reviewed (PRs where contributor commented) - limited to PRs touched by contributor
    // Comment.prId stores PullRequest.id (UUID), not prNumber
    const prsReviewed = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: allRepositoryIds },
        type: CommentType.PULL_REQUEST,
        prId: { in: prIds },
        createdAt: { gte: startDate, lte: endDate },
      },
      distinct: ['prId'],
    });

    // Get comments on PRs related to contributor's commits
    // Find comments on PRs where contributor's commits are part of
    const prComments = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: allRepositoryIds },
        prId: { in: prIds },
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    // Code quality metrics
    const commentsAddressed = fixedIssues.filter(
      (issue) => issue.status === CommentStatus.OUTDATED,
    ).length;

    // Count comments on contributor's PRs
    const commentsOnContributorPRs = prComments.length;

    const securityFixes = fixedIssues.filter(
      (issue) =>
        issue.issueCategory?.toLowerCase().includes('security') ||
        issue.severity === 'HIGH',
    ).length;

    const codeSmellFixes = fixedIssues.filter(
      (issue) =>
        issue.issueCategory?.toLowerCase().includes('codesmell') ||
        issue.issueCategory?.toLowerCase().includes('smell'),
    ).length;

    const metrics: ContributorMetrics = {
      commits: commitMetrics,
      modules: {
        primary: primaryModules,
        all: modules,
      },
      issues: {
        fixed: fixedIssues.length,
        opened: openedIssues.length,
        stillOpen: stillOpenIssues.length,
        closed: fixedIssues.length, // Fixed issues are considered closed
        categories: issueCategories,
        avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
      },
      pullRequests: {
        created: prsCreated,
        merged: prsMerged,
        reviewed: prsReviewed.length,
      },
      codeQuality: {
        commentsAddressed,
        securityFixes,
        codeSmellFixes,
        commentsOnPRs: commentsOnContributorPRs,
      },
    };

    // Generate AI insights and suggestions
    let insights: string[];
    let suggestions: string[];
    try {
      insights = await this.gemini.generateContributorInsights(
        metrics,
        {
          name: userFullName,
          role: teamMember.organizationRole?.name || 'Member',
          team: teamMember.team.name,
        },
        { start: startDate, end: endDate },
      );
      suggestions = await this.gemini.generateContributorSuggestions(metrics, {
        name: userFullName,
        role: teamMember.organizationRole?.name || 'Member',
      });
    } catch (error) {
      console.error(
        'Error generating AI insights/suggestions, using fallback:',
        error,
      );
      insights = this.generateFallbackContributorInsights(metrics);
      suggestions = this.generateFallbackContributorSuggestions(metrics);
    }

    const report: ContributorReport = {
      contributor: {
        id: accountId,
        name: userFullName,
        email: userEmail,
        role: roleName || 'Member',
        team: teamName || 'No Team',
      },
      period: { start: startDate, end: endDate },
      metrics,
      insights,
      suggestions,
    };

    // Only save contributor report if committer is matched to a user
    // (This check is done in generateContributorReportForCommits when called from team report)
    // For standalone contributor report requests, save it
    if (teamMember) {
      await this.saveReport({
        reportType: ReportType.CONTRIBUTOR,
        organizationId,
        accountId,
        teamId: teamMember.teamId,
        startDate,
        endDate,
        reportData: report as any,
      });
    }

    return report;
  }

  /**
   * Generate contributor report from specific commits (used when matching commits to team members)
   * This is called internally from generateTeamReport after analyzing all commits
   */
  private async generateContributorReportForCommits(
    organizationId: string,
    accountId: string,
    commits: any[],
    repositoryIds: string[],
    startDate: Date,
    endDate: Date,
    teamMember: any,
  ): Promise<ContributorReport> {
    console.log(
      `[ReportsService] Generating contributor report for ${accountId} from ${commits.length} matched commits`,
    );

    const userFullName =
      `${teamMember.account.user.firstName} ${teamMember.account.user.lastName}`.trim();
    const userEmail = teamMember.account.user.email;

    // Calculate commit metrics from provided commits
    const commitMetrics = {
      total: commits.length,
      merged: commits.filter((c) => c.isMerged).length,
      additions: commits.reduce((sum, c) => sum + c.additions, 0),
      deletions: commits.reduce((sum, c) => sum + c.deletions, 0),
      filesChanged: commits.reduce((sum, c) => sum + c.totalFiles, 0),
    };

    // Extract modules from commits
    const moduleMap = new Map<string, { commits: number; changes: number }>();
    commits.forEach((commit) => {
      if (commit.moduleChanges && Array.isArray(commit.moduleChanges)) {
        commit.moduleChanges.forEach((modulePath: string) => {
          const moduleName = this.extractModuleName(modulePath);
          const existing = moduleMap.get(moduleName) || {
            commits: 0,
            changes: 0,
          };
          moduleMap.set(moduleName, {
            commits: existing.commits + 1,
            changes: existing.changes + commit.additions + commit.deletions,
          });
        });
      }
    });

    const modules = Array.from(moduleMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.commits - a.commits);
    const primaryModules = modules.slice(0, 3).map((m) => m.name);

    // Get issues fixed in period
    const fixedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        type: CommentType.ISSUE,
        status: CommentStatus.OUTDATED,
        updatedAt: { gte: startDate, lte: endDate },
      },
    });

    const openedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        type: CommentType.ISSUE,
        status: CommentStatus.OPEN,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    // Get issues that are still open (created before or during period, still open at end)
    const stillOpenIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        type: CommentType.ISSUE,
        status: CommentStatus.OPEN,
        createdAt: { lte: endDate }, // Created before or during period
      },
    });

    // Categorize issues
    const issueCategories: { [key: string]: number } = {};
    fixedIssues.forEach((issue) => {
      const category = issue.issueCategory || 'Other';
      issueCategories[category] = (issueCategories[category] || 0) + 1;
    });

    // Calculate average resolution time
    const resolvedIssuesWithTime = fixedIssues.filter((issue) => {
      const resolutionTime =
        issue.updatedAt.getTime() - issue.createdAt.getTime();
      return resolutionTime > 0;
    });

    const avgResolutionTime =
      resolvedIssuesWithTime.length > 0
        ? resolvedIssuesWithTime.reduce((sum, issue) => {
            const resolutionTime =
              issue.updatedAt.getTime() - issue.createdAt.getTime();
            return sum + resolutionTime / (1000 * 60 * 60); // Convert to hours
          }, 0) / resolvedIssuesWithTime.length
        : 0;

    // Find PRs from commits
    const commitsWithReports = commits.filter((c) => c.reportId);
    const uniqueReportIds = [
      ...new Set(commitsWithReports.map((c) => c.reportId).filter(Boolean)),
    ];

    const executiveReports = await this.prisma.executiveReport.findMany({
      where: {
        id: { in: uniqueReportIds },
      },
      select: {
        repositoryId: true,
        prNumber: true,
      },
    });

    const prNumbers = executiveReports.map((er) => er.prNumber);
    const relatedPRs = await this.prisma.pullRequest.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        prNumber: { in: prNumbers },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        prNumber: true,
        createdAt: true,
      },
    });

    const prIds = relatedPRs.map((pr) => pr.id);

    const prsCreated = uniqueReportIds.length;
    const prsMerged = commitsWithReports.filter((c) => c.isMerged).length;

    // Get PRs reviewed
    const prsReviewed = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        type: CommentType.PULL_REQUEST,
        prId: { in: prIds },
        createdAt: { gte: startDate, lte: endDate },
      },
      distinct: ['prId'],
    });

    // Get comments on PRs
    const prComments = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        prId: { in: prIds },
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const commentsAddressed = fixedIssues.filter(
      (issue) => issue.status === CommentStatus.OUTDATED,
    ).length;

    const commentsOnContributorPRs = prComments.length;

    const securityFixes = fixedIssues.filter(
      (issue) =>
        issue.issueCategory?.toLowerCase().includes('security') ||
        issue.severity === 'HIGH',
    ).length;

    const codeSmellFixes = fixedIssues.filter(
      (issue) =>
        issue.issueCategory?.toLowerCase().includes('codesmell') ||
        issue.issueCategory?.toLowerCase().includes('smell'),
    ).length;

    const metrics: ContributorMetrics = {
      commits: commitMetrics,
      modules: {
        primary: primaryModules,
        all: modules,
      },
      issues: {
        fixed: fixedIssues.length,
        opened: openedIssues.length,
        stillOpen: stillOpenIssues.length,
        closed: fixedIssues.length,
        categories: issueCategories,
        avgResolutionTime,
      },
      pullRequests: {
        created: prsCreated,
        merged: prsMerged,
        reviewed: prsReviewed.length,
      },
      codeQuality: {
        commentsAddressed,
        securityFixes,
        codeSmellFixes,
        commentsOnPRs: commentsOnContributorPRs,
      },
    };

    // Generate AI insights and suggestions
    let insights: string[];
    let suggestions: string[];
    try {
      insights = await this.gemini.generateContributorInsights(
        metrics,
        {
          name: userFullName,
          role: teamMember.organizationRole?.name || 'Member',
          team: teamMember.team.name,
        },
        { start: startDate, end: endDate },
      );
      suggestions = await this.gemini.generateContributorSuggestions(metrics, {
        name: userFullName,
        role: teamMember.organizationRole?.name || 'Member',
      });
    } catch (error) {
      console.error(
        'Error generating AI insights/suggestions, using fallback:',
        error,
      );
      insights = this.generateFallbackContributorInsights(metrics);
      suggestions = this.generateFallbackContributorSuggestions(metrics);
    }

    return {
      contributor: {
        id: accountId,
        name: userFullName,
        email: userEmail,
        role: teamMember.organizationRole?.name || 'Member',
        team: teamMember.team.name,
      },
      period: { start: startDate, end: endDate },
      metrics,
      insights,
      suggestions,
    };
  }

  private async generateTeamReport(
    organizationId: string,
    teamId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            account: {
              include: { user: true },
            },
            organizationRole: true,
          },
        },
        repositories: {
          include: {
            repository: {
              select: { repositoryId: true },
            },
          },
        },
      },
    });

    if (!team || team.organizationId !== organizationId) {
      throw new NotFoundException('Team not found');
    }

    const repositoryIds = team.repositories.map(
      (tr) => tr.repository.repositoryId,
    );

    if (repositoryIds.length === 0) {
      return this.createEmptyTeamReport(team, startDate, endDate);
    }

    console.log(
      `[ReportsService] Generating team report for team: ${team.name} (${team.members.length} members), period: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    // Track last 15 days of activity (extend startDate for better tracking)
    const activityStartDate = new Date(startDate);
    activityStartDate.setDate(activityStartDate.getDate() - 15);

    // STEP 1: Analyze ALL commits in team repositories during the period (regardless of committer matching)
    console.log(
      `[ReportsService] Step 1: Analyzing ALL commits in team repositories from ${activityStartDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const allTeamCommits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        createdAt: { gte: activityStartDate, lte: endDate },
      },
      include: {
        report: {
          select: {
            repositoryId: true,
            prNumber: true,
          },
        },
      },
    });

    console.log(
      `[ReportsService] Found ${allTeamCommits.length} total commits in team repositories (${allTeamCommits.filter((c) => c.isMerged).length} merged)`,
    );

    // Calculate team totals from ALL commits
    const totalCommits = allTeamCommits.length;
    const totalMergedCommits = allTeamCommits.filter((c) => c.isMerged).length;
    const totalAdditions = allTeamCommits.reduce(
      (sum, c) => sum + c.additions,
      0,
    );
    const totalDeletions = allTeamCommits.reduce(
      (sum, c) => sum + c.deletions,
      0,
    );

    // Get issues from all team repositories
    const allFixedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        type: CommentType.ISSUE,
        status: CommentStatus.OUTDATED,
        updatedAt: { gte: startDate, lte: endDate },
      },
    });

    const allOpenedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        type: CommentType.ISSUE,
        status: CommentStatus.OPEN,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const totalIssuesFixed = allFixedIssues.length;

    // Get PR metrics from all commits
    const commitsWithReports = allTeamCommits.filter((c) => c.reportId);
    const uniqueReportIds = [
      ...new Set(commitsWithReports.map((c) => c.reportId).filter(Boolean)),
    ];

    // Get executive reports to find PR numbers
    const executiveReports = await this.prisma.executiveReport.findMany({
      where: {
        id: { in: uniqueReportIds },
      },
      select: {
        repositoryId: true,
        prNumber: true,
      },
    });

    const prNumbers = executiveReports.map((er) => er.prNumber);
    const relatedPRs = await this.prisma.pullRequest.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        prNumber: { in: prNumbers },
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    const totalPRsCreated = uniqueReportIds.length;
    const totalPRsMerged = commitsWithReports.filter((c) => c.isMerged).length;

    // Extract modules from all commits
    const allModulesSet = new Set<string>();
    allTeamCommits.forEach((commit) => {
      if (commit.moduleChanges && Array.isArray(commit.moduleChanges)) {
        commit.moduleChanges.forEach((modulePath: string) => {
          const moduleName = this.extractModuleName(modulePath);
          allModulesSet.add(moduleName);
        });
      }
    });

    console.log(
      `[ReportsService] Team totals: ${totalCommits} commits, ${totalIssuesFixed} issues fixed, ${totalPRsMerged} PRs merged, ${allModulesSet.size} modules covered`,
    );

    // STEP 2: Try to match commits to team members and generate contributor reports
    console.log(
      `[ReportsService] Step 2: Matching commits to team members and generating contributor reports`,
    );

    const contributorReports: ContributorReport[] = [];
    const matchedCommitIds = new Set<string>();

    // Create a map of team members for quick lookup
    const teamMemberMap = new Map<string, (typeof team.members)[0]>();
    team.members.forEach((member) => {
      const fullName =
        `${member.account.user.firstName} ${member.account.user.lastName}`.trim();
      teamMemberMap.set(member.accountId, member);
      // Also try to match by name variations
      if (member.account.user.firstName) {
        teamMemberMap.set(member.account.user.firstName.toLowerCase(), member);
      }
      if (fullName) {
        teamMemberMap.set(fullName.toLowerCase(), member);
      }
    });

    // Try to match commits to team members
    for (const member of team.members) {
      const userFullName =
        `${member.account.user.firstName} ${member.account.user.lastName}`.trim();

      // Get all Git contributor names for this member
      const memberGitNames = await this.prisma.gitContributorName.findMany({
        where: { accountId: member.accountId },
        select: { name: true },
      });

      // Skip members without any gitContributorName set
      if (!memberGitNames || memberGitNames.length === 0) {
        console.log(
          `[ReportsService] Skipping member ${userFullName} - no Git contributor names set`,
        );
        continue;
      }

      const memberGitNameList = memberGitNames.map((n) => n.name.trim());

      // Find commits by this contributor
      // Primary: match by any gitContributorName, fallback to name matching
      const memberCommits = allTeamCommits.filter((c) => {
        // Check against all Git contributor names
        const matchesGitName = memberGitNameList.some(
          (name) => c.committer === name || c.committer.includes(name),
        );
        // Fallback to name matching
        const matchesName =
          c.committer === userFullName ||
          c.committer.includes(member.account.user.firstName) ||
          c.committer.includes(member.account.user.lastName);

        return matchesGitName || matchesName;
      });

      if (memberCommits.length > 0) {
        console.log(
          `[ReportsService] Matched ${memberCommits.length} commits to team member ${userFullName}`,
        );

        // Mark these commits as matched
        memberCommits.forEach((c) => matchedCommitIds.add(c.id));

        try {
          // Generate contributor report for matched commits
          const memberReport = await this.generateContributorReportForCommits(
            organizationId,
            member.accountId,
            memberCommits,
            repositoryIds,
            startDate,
            endDate,
            member,
          );
          contributorReports.push(memberReport);

          // Save contributor report since committer is matched
          await this.saveReport({
            reportType: ReportType.CONTRIBUTOR,
            organizationId,
            accountId: member.accountId,
            teamId: team.id,
            startDate,
            endDate,
            reportData: memberReport as any,
          });

          console.log(
            `[ReportsService] Saved contributor report for ${userFullName}`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.warn(
            `[ReportsService] Failed to generate contributor report for ${userFullName}: ${errorMessage}`,
          );
        }
      }
    }

    const unmatchedCommits = allTeamCommits.filter(
      (c) => !matchedCommitIds.has(c.id),
    );

    console.log(
      `[ReportsService] Step 2 complete: ${contributorReports.length} contributor reports generated, ${unmatchedCommits.length} commits unmatched`,
    );

    // Calculate top performers from matched contributors only
    const topPerformers = contributorReports
      .sort((a, b) => b.metrics.commits.total - a.metrics.commits.total)
      .slice(0, 3)
      .map((r) => r.contributor.name);

    // Calculate team health based on ALL commits
    const velocity = totalCommits;
    const openIssues = await this.prisma.comment.count({
      where: {
        repositoryId: { in: repositoryIds },
        type: CommentType.ISSUE,
        status: CommentStatus.OPEN,
      },
    });

    let quality: 'excellent' | 'good' | 'needs_attention' = 'good';
    if (totalIssuesFixed > totalIssuesFixed * 0.8 && velocity > 10) {
      quality = 'excellent';
    } else if (velocity < 5 || openIssues > 20) {
      quality = 'needs_attention';
    }

    const report: TeamReport = {
      team: { id: teamId, name: team.name },
      period: { start: startDate, end: endDate },
      summary: {
        totalContributors: contributorReports.length,
        totalCommits, // Based on ALL commits, not just matched
        totalIssuesFixed,
        totalPRsMerged,
        topPerformers,
        modulesCovered: Array.from(allModulesSet),
      },
      contributors: contributorReports,
      teamHealth: {
        velocity,
        backlog: openIssues,
        quality,
      },
      insights: await this.gemini
        .generateTeamInsights(
          {
            totalCommits,
            totalIssuesFixed,
            velocity,
            backlog: openIssues,
            contributors: contributorReports.length,
          },
          team.name,
          { start: startDate, end: endDate },
        )
        .catch(() =>
          this.generateFallbackTeamInsights({
            totalCommits,
            totalIssuesFixed,
            velocity,
            backlog: openIssues,
            contributors: contributorReports.length,
          }),
        ),
      recommendations: await this.gemini
        .generateTeamRecommendations(
          {
            quality,
            velocity,
            backlog: openIssues,
            contributors: contributorReports,
          },
          team.name,
        )
        .catch(() =>
          this.generateFallbackTeamRecommendations({
            quality,
            velocity,
            backlog: openIssues,
            contributors: contributorReports,
          }),
        ),
    };

    // Don't save team reports - only contributor reports are saved
    console.log(
      `[ReportsService] Team report generated for ${team.name}. Not saving to database (team reports are not persisted).`,
    );

    return report;
  }

  private async generateProjectReport(
    organizationId: string,
    repositoryId: string,
    startDate: Date,
    endDate: Date,
  ) {
    console.log(
      `[ReportsService] Generating project report for repositoryId: ${repositoryId}, organizationId: ${organizationId}, period: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository || repository.organizationId !== organizationId) {
      console.warn(
        `[ReportsService] Repository ${repositoryId} not found or doesn't belong to organization ${organizationId}`,
      );
      throw new NotFoundException('Repository not found');
    }

    // Use only the actual report period (last 7 days) - no extended window
    console.log(
      `[ReportsService] Tracking repository activity from ${startDate.toISOString()} to ${endDate.toISOString()} (exact period only)`,
    );

    // Get commits only in the actual report period
    const commits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId: repository.repositoryId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    console.log(
      `[ReportsService] Found ${commits.length} commits in report period for repository ${repository.name}`,
    );

    // Get issues fixed in period (only within the actual period)
    console.log('comments where: ', {
      repositoryId: repository.repositoryId,
      type: CommentType.ISSUE,
      status: CommentStatus.OUTDATED,
      updatedAt: { gte: startDate, lte: endDate },
    });

    const fixedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: repository.repositoryId,
        type: CommentType.PULL_REQUEST,
        status: CommentStatus.OUTDATED,
        updatedAt: { gte: startDate, lte: endDate },
      },
    });

    console.log('fixedIssues: ', fixedIssues);

    // Get issues opened during the report period only
    const openedIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: repository.repositoryId,
        type: CommentType.ISSUE,
        status: CommentStatus.OPEN,
        createdAt: { gte: startDate, lte: endDate },
      },
    });
    console.log('openedIssues (opened in period): ', openedIssues);

    // Get issues that are still open (created before or during period, still open at end)
    const stillOpenIssues = await this.prisma.comment.findMany({
      where: {
        repositoryId: repository.repositoryId,
        type: CommentType.ISSUE,
        status: CommentStatus.OPEN,
        createdAt: { lte: endDate }, // Created before or during period
      },
    });
    console.log('stillOpenIssues: ', stillOpenIssues.length);

    console.log(
      `[ReportsService] Found ${fixedIssues.length} fixed issues, ${openedIssues.length} opened in period, and ${stillOpenIssues.length} still open`,
    );

    // Get PRs created in period
    const prs = await this.prisma.pullRequest.findMany({
      where: {
        repositoryId: repository.repositoryId,
        createdAt: { gte: startDate, lte: endDate },
      },
    });

    // Determine PR status: merged = has merged commits, open = no merged commits
    const prNumbers = prs.map((pr) => pr.prNumber);
    // Use commits from the period for PR matching
    const commitsWithReports = commits.filter((c) => c.reportId);

    // Get ExecutiveReports to find PR numbers
    const executiveReports = await this.prisma.executiveReport.findMany({
      where: {
        repositoryId: repository.repositoryId,
        prNumber: { in: prNumbers },
      },
      select: {
        prNumber: true,
        id: true,
      },
    });

    const mergedPRNumbers = new Set<number>();
    executiveReports.forEach((er) => {
      // Use commits from the period for PR matching
      const relatedCommits = commits.filter(
        (c) => c.reportId === er.id && c.isMerged,
      );
      if (relatedCommits.length > 0) {
        mergedPRNumbers.add(er.prNumber);
      }
    });

    const openPRs = prs.filter(
      (pr) => !mergedPRNumbers.has(pr.prNumber),
    ).length;
    const mergedPRs = mergedPRNumbers.size;

    // Extract modules from both moduleChanges and commit summary
    // Use commits from the period for module/feature analysis
    const moduleMap = new Map<string, number>();
    const featureMap = new Map<string, number>();

    commits.forEach((commit) => {
      // Extract from moduleChanges (file paths)
      if (commit.moduleChanges && Array.isArray(commit.moduleChanges)) {
        commit.moduleChanges.forEach((modulePath: string) => {
          const moduleName = this.extractModuleName(modulePath);
          moduleMap.set(moduleName, (moduleMap.get(moduleName) || 0) + 1);
        });
      }

      // Extract from commit summary (JSON) - look for features/modules
      if (commit.summary && typeof commit.summary === 'object') {
        try {
          const summary =
            typeof commit.summary === 'string'
              ? JSON.parse(commit.summary)
              : commit.summary;

          // Look for module/feature mentions in summary fields
          if (summary.features && Array.isArray(summary.features)) {
            summary.features.forEach((feature: string) => {
              if (feature) {
                featureMap.set(feature, (featureMap.get(feature) || 0) + 1);
              }
            });
          }

          if (summary.modules && Array.isArray(summary.modules)) {
            summary.modules.forEach((module: string) => {
              if (module) {
                moduleMap.set(module, (moduleMap.get(module) || 0) + 1);
              }
            });
          }

          // Extract from summary text if available
          if (summary.summary && typeof summary.summary === 'string') {
            const summaryText = summary.summary.toLowerCase();
            // Try to extract module/feature names from summary text
            const modulePatterns = [
              /(?:module|feature|component|service):\s*([a-z0-9_\/\-]+)/gi,
              /(?:working on|implemented|added|updated)\s+([a-z0-9_\/\-]+)/gi,
            ];

            modulePatterns.forEach((pattern) => {
              const matches = summaryText.matchAll(pattern);
              for (const match of matches) {
                if (match[1]) {
                  const moduleName = match[1].trim();
                  if (moduleName.length > 2) {
                    moduleMap.set(
                      moduleName,
                      (moduleMap.get(moduleName) || 0) + 1,
                    );
                  }
                }
              }
            });
          }
        } catch (error) {
          // Silently fail if summary parsing fails
        }
      }
    });

    // Combine modules and features, prioritizing features
    const allModules = new Map(moduleMap);
    featureMap.forEach((count, feature) => {
      allModules.set(feature, (allModules.get(feature) || 0) + count);
    });

    // Group commits by committer (for contributor analysis)
    const committerMap = new Map<
      string,
      {
        name: string;
        commits: typeof commits;
        totalCommits: number;
        mergedCommits: number;
        additions: number;
        deletions: number;
        modules: Map<string, number>;
      }
    >();

    commits.forEach((commit) => {
      const committerName = commit.committer || 'Unknown';
      if (!committerMap.has(committerName)) {
        committerMap.set(committerName, {
          name: committerName,
          commits: [],
          totalCommits: 0,
          mergedCommits: 0,
          additions: 0,
          deletions: 0,
          modules: new Map(),
        });
      }

      const committerData = committerMap.get(committerName)!;
      committerData.commits.push(commit);
      committerData.totalCommits++;
      if (commit.isMerged) {
        committerData.mergedCommits++;
      }
      committerData.additions += commit.additions;
      committerData.deletions += commit.deletions;

      // Track modules for this committer
      if (commit.moduleChanges && Array.isArray(commit.moduleChanges)) {
        commit.moduleChanges.forEach((modulePath: string) => {
          const moduleName = this.extractModuleName(modulePath);
          committerData.modules.set(
            moduleName,
            (committerData.modules.get(moduleName) || 0) + 1,
          );
        });
      }
    });

    // Build detailed module activity map (module -> contributors)
    const moduleActivityMap = new Map<
      string,
      {
        name: string;
        totalCommits: number;
        contributors: Map<
          string,
          {
            name: string;
            commits: number;
            mergedCommits: number;
            additions: number;
            deletions: number;
            filesChanged: number;
          }
        >;
      }
    >();

    // Build contributor reports and module activity simultaneously
    const contributors = Array.from(committerMap.values())
      .map((committerData) => {
        // Get PRs created by this committer (commits with reports)
        const committerPRs = committerData.commits.filter((c) => c.reportId);
        const prsCreated = committerPRs.length;
        const prsMerged = committerPRs.filter((c) => c.isMerged).length;

        // Build detailed module breakdown for this contributor
        const contributorModules = Array.from(
          committerData.modules.entries(),
        ).map(([moduleName, commitCount]) => {
          // Find all commits for this contributor in this module
          const moduleCommits = committerData.commits.filter((commit) => {
            if (!commit.moduleChanges || !Array.isArray(commit.moduleChanges)) {
              return false;
            }
            return commit.moduleChanges.some(
              (path) => this.extractModuleName(String(path)) === moduleName,
            );
          });

          const moduleAdditions = moduleCommits.reduce(
            (sum, c) => sum + c.additions,
            0,
          );
          const moduleDeletions = moduleCommits.reduce(
            (sum, c) => sum + c.deletions,
            0,
          );
          const moduleFilesChanged = moduleCommits.reduce(
            (sum, c) => sum + c.totalFiles,
            0,
          );

          // Update module activity map
          if (!moduleActivityMap.has(moduleName)) {
            moduleActivityMap.set(moduleName, {
              name: moduleName,
              totalCommits: 0,
              contributors: new Map(),
            });
          }

          const moduleActivity = moduleActivityMap.get(moduleName)!;
          moduleActivity.totalCommits += commitCount;
          moduleActivity.contributors.set(committerData.name, {
            name: committerData.name,
            commits: commitCount,
            mergedCommits: moduleCommits.filter((c) => c.isMerged).length,
            additions: moduleAdditions,
            deletions: moduleDeletions,
            filesChanged: moduleFilesChanged,
          });

          return {
            name: moduleName,
            commits: commitCount,
            changes: moduleAdditions + moduleDeletions,
            additions: moduleAdditions,
            deletions: moduleDeletions,
            filesChanged: moduleFilesChanged,
            mergedCommits: moduleCommits.filter((c) => c.isMerged).length,
          };
        });

        return {
          contributor: {
            name: committerData.name,
            email: null, // Committer name only, no email available
            id: null, // Not matched to a user
          },
          metrics: {
            commits: {
              total: committerData.totalCommits,
              merged: committerData.mergedCommits,
              additions: committerData.additions,
              deletions: committerData.deletions,
              filesChanged: committerData.commits.reduce(
                (sum, c) => sum + c.totalFiles,
                0,
              ),
            },
            modules: {
              primary: contributorModules
                .sort((a, b) => b.commits - a.commits)
                .slice(0, 3)
                .map((m) => m.name),
              all: contributorModules.sort((a, b) => b.commits - a.commits),
            },
            issues: {
              fixed: 0, // Can't reliably attribute issues to specific committers
              opened: 0,
              stillOpen: 0,
              closed: 0,
              categories: {},
              avgResolutionTime: 0,
            },
            pullRequests: {
              created: prsCreated,
              merged: prsMerged,
              reviewed: 0, // Can't determine without user account
            },
            codeQuality: {
              commentsAddressed: 0,
              securityFixes: 0,
              codeSmellFixes: 0,
              commentsOnPRs: 0,
            },
          },
        };
      })
      .sort((a, b) => b.metrics.commits.total - a.metrics.commits.total);

    // Convert module activity map to array format
    const moduleActivity = Array.from(moduleActivityMap.values())
      .map((module) => ({
        name: module.name,
        totalCommits: module.totalCommits,
        contributors: Array.from(module.contributors.values())
          .sort((a, b) => b.commits - a.commits)
          .map((contrib) => ({
            name: contrib.name,
            commits: contrib.commits,
            mergedCommits: contrib.mergedCommits,
            additions: contrib.additions,
            deletions: contrib.deletions,
            filesChanged: contrib.filesChanged,
            contributionPercentage: Math.round(
              (contrib.commits / module.totalCommits) * 100,
            ),
          })),
      }))
      .sort((a, b) => b.totalCommits - a.totalCommits);

    console.log(
      `[ReportsService] Generated contributor analysis for ${contributors.length} contributors`,
    );
    console.log(
      `[ReportsService] Generated module activity for ${moduleActivity.length} modules`,
    );

    // Analyze commit summaries to extract features, fixes, improvements
    const commitAnalysis = this.analyzeCommitSummaries(commits);

    // Prepare full commit list with all details for frontend
    const commitList = commits.map((commit) => ({
      id: commit.id,
      commitId: commit.commitId,
      commitMessage: commit.commitMessage,
      committer: commit.committer,
      summary: commit.summary,
      additions: commit.additions,
      deletions: commit.deletions,
      totalFiles: commit.totalFiles,
      isMerged: commit.isMerged,
      moduleChanges: commit.moduleChanges,
      createdAt: commit.createdAt,
      mergedAt: commit.mergedAt,
      commitUrl: commit.commitUrl,
      module:
        commit.moduleChanges &&
        Array.isArray(commit.moduleChanges) &&
        commit.moduleChanges.length > 0
          ? this.extractModuleName(String(commit.moduleChanges[0]))
          : undefined,
    }));

    // Generate project status using AI analysis of commits
    const projectStatus = await this.gemini
      .generateProjectStatus(commitList, repository.name, {
        start: startDate,
        end: endDate,
      })
      .catch(() => ({
        status: 'active',
        mainFeatures: [],
        modules: [],
        summary: 'Project is in active development.',
      }));

    const report = {
      repository: {
        id: repositoryId,
        name: repository.name,
        organizationId,
      },
      period: { start: startDate, end: endDate },
      metrics: {
        totalCommits: commits.length,
        mergedCommits: commits.filter((c) => c.isMerged).length,
        openCommits: commits.filter((c) => !c.isMerged).length,
        totalLines: {
          additions: commits.reduce((sum, c) => sum + c.additions, 0),
          deletions: commits.reduce((sum, c) => sum + c.deletions, 0),
        },
        issuesFixed: fixedIssues.length,
        issuesOpened: openedIssues.length,
        issuesStillOpen: stillOpenIssues.length,
        issuesClosed: fixedIssues.length, // Fixed issues are considered closed
        openIssuesBacklog: stillOpenIssues.length, // Total open issues at end of period
        pullRequests: prs.length,
        prsOpen: openPRs,
        prsMerged: mergedPRs,
        modules: Array.from(allModules.entries())
          .map(([name, count]) => ({ name, commits: count }))
          .sort((a, b) => b.commits - a.commits),
      },
      moduleActivity, // Detailed module activity breakdown
      contributors, // Add contributor analysis
      commitAnalysis, // Features, fixes, improvements extracted from commits
      commitList, // Full list of all commits with details
      projectStatus, // AI-generated project status analysis
      insights: await this.gemini
        .generateProjectInsights(
          {
            commits: commits.length,
            mergedCommits: commits.filter((c) => c.isMerged).length,
            openCommits: commits.filter((c) => !c.isMerged).length,
            issuesFixed: fixedIssues.length,
            openIssues: openedIssues.length, // Use openIssues for AI compatibility
            prsOpen: openPRs,
            prsMerged: mergedPRs,
            modules: Array.from(allModules.entries())
              .slice(0, 5)
              .map(([name]) => name),
            commitAnalysis, // Pass commit analysis to AI
          },
          repository.name,
          { start: startDate, end: endDate },
        )
        .catch(() =>
          this.generateFallbackProjectInsights({
            commits: commits.length,
            issuesFixed: fixedIssues.length,
            openIssues: openedIssues.length, // Use openIssues for AI compatibility
            modules: Array.from(allModules.entries())
              .slice(0, 5)
              .map(([name]) => name),
            commitAnalysis, // Include commit analysis in fallback
          }),
        ),
      recommendations: await this.gemini
        .generateProjectRecommendations(
          {
            issuesFixed: fixedIssues.length,
            openIssues: openedIssues.length, // Use openIssues for AI compatibility
            commits: commits.length,
            prsOpen: openPRs,
            prsMerged: mergedPRs,
            modules: Array.from(allModules.entries())
              .slice(0, 5)
              .map(([name]) => name),
          },
          repository.name,
        )
        .catch(() =>
          this.generateFallbackProjectRecommendations({
            issuesFixed: fixedIssues.length,
            openIssues: openedIssues.length, // Use openIssues for AI compatibility
            modules: Array.from(allModules.entries())
              .slice(0, 5)
              .map(([name]) => name),
          }),
        ),
    };

    await this.saveReport({
      reportType: ReportType.PROJECT,
      organizationId,
      repositoryId,
      startDate,
      endDate,
      reportData: report as any,
    });

    return report;
  }

  private async generateOrganizationReport(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ) {
    console.log(
      `[ReportsService] Generating organization report for organizationId: ${organizationId}, period: ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    // Track last 15 days of activity
    const activityStartDate = new Date(startDate);
    activityStartDate.setDate(activityStartDate.getDate() - 15);

    // STEP 1: Get all repositories in the organization (both team-linked and standalone)
    const allRepositories = await this.prisma.repository.findMany({
      where: { organizationId },
      select: {
        id: true,
        repositoryId: true,
        name: true,
      },
    });

    console.log(
      `[ReportsService] Found ${allRepositories.length} total repositories in organization ${organizationId}`,
    );

    // STEP 2: Get all team repositories
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      include: {
        repositories: {
          include: {
            repository: {
              select: { repositoryId: true },
            },
          },
        },
      },
    });

    const teamRepositoryIds = new Set<string>();
    teams.forEach((team) => {
      team.repositories.forEach((tr) => {
        teamRepositoryIds.add(tr.repository.repositoryId);
      });
    });

    // STEP 3: Find repositories not linked to any team
    const standaloneRepositoryIds = allRepositories
      .map((r) => r.repositoryId)
      .filter((id) => !teamRepositoryIds.has(id));

    console.log(
      `[ReportsService] Organization has ${teams.length} teams with ${teamRepositoryIds.size} linked repositories, ${standaloneRepositoryIds.length} standalone repositories`,
    );

    // STEP 4: Analyze ALL commits across organization (from all repositories)
    console.log(
      `[ReportsService] Analyzing ALL commits across organization from ${activityStartDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const allOrgCommits = await this.prisma.commitSummary.findMany({
      where: {
        repositoryId: { in: allRepositories.map((r) => r.repositoryId) },
        createdAt: { gte: activityStartDate, lte: endDate },
      },
    });

    console.log(
      `[ReportsService] Found ${allOrgCommits.length} total commits across organization (${allOrgCommits.filter((c) => c.isMerged).length} merged)`,
    );

    // STEP 5: Generate team reports (each team report now analyzes ALL commits in team repos)
    const teamReports = [];
    for (const team of teams) {
      try {
        console.log(
          `[ReportsService] Processing team ${team.name} (${team.id}) for organization report`,
        );
        const teamReport = await this.generateTeamReport(
          organizationId,
          team.id,
          startDate,
          endDate,
        );
        teamReports.push({
          teamId: team.id,
          teamName: team.name,
          performance: this.calculatePerformance(teamReport.teamHealth),
          keyMetrics: {
            commits: teamReport.summary.totalCommits,
            issuesFixed: teamReport.summary.totalIssuesFixed,
            prsMerged: teamReport.summary.totalPRsMerged,
            velocity: teamReport.teamHealth.velocity,
          },
        });
        console.log(
          `[ReportsService] Successfully processed team ${team.name} for organization report`,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(
          `[ReportsService] Skipping team ${team.id} (${team.name}): ${errorMessage}`,
        );
      }
    }

    console.log(
      `[ReportsService] Generated reports for ${teamReports.length}/${teams.length} teams in organization ${organizationId}`,
    );

    // STEP 6: Analyze standalone repositories (not linked to any team)
    let standaloneMetrics = {
      commits: 0,
      issuesFixed: 0,
      prsCreated: 0,
      prsMerged: 0,
    };

    if (standaloneRepositoryIds.length > 0) {
      console.log(
        `[ReportsService] Analyzing ${standaloneRepositoryIds.length} standalone repositories`,
      );

      const standaloneCommits = allOrgCommits.filter((c) =>
        standaloneRepositoryIds.includes(c.repositoryId),
      );
      standaloneMetrics.commits = standaloneCommits.length;
      standaloneMetrics.prsMerged = standaloneCommits.filter(
        (c) => c.isMerged,
      ).length;

      const standaloneFixedIssues = await this.prisma.comment.findMany({
        where: {
          repositoryId: { in: standaloneRepositoryIds },
          type: CommentType.ISSUE,
          status: CommentStatus.OUTDATED,
          updatedAt: { gte: startDate, lte: endDate },
        },
      });
      standaloneMetrics.issuesFixed = standaloneFixedIssues.length;

      // Get PRs from standalone repos
      const standaloneCommitsWithReports = standaloneCommits.filter(
        (c) => c.reportId,
      );
      const standaloneReportIds = [
        ...new Set(
          standaloneCommitsWithReports.map((c) => c.reportId).filter(Boolean),
        ),
      ];
      standaloneMetrics.prsCreated = standaloneReportIds.length;

      console.log(
        `[ReportsService] Standalone repositories: ${standaloneMetrics.commits} commits, ${standaloneMetrics.issuesFixed} issues fixed`,
      );
    }

    // Calculate organization totals (from all commits across all repositories)
    const orgTotalCommits = allOrgCommits.length;
    const orgTotalIssuesFixed =
      teamReports.reduce((sum, tr) => sum + tr.keyMetrics.issuesFixed, 0) +
      standaloneMetrics.issuesFixed;
    const orgTotalPRsMerged =
      teamReports.reduce((sum, tr) => sum + (tr.keyMetrics.prsMerged || 0), 0) +
      standaloneMetrics.prsMerged;

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const report = {
      organization: { id: organizationId },
      period: { start: startDate, end: endDate },
      teams: teamReports,
      summary: {
        totalTeams: teams.length,
        totalCommits: orgTotalCommits,
        totalIssuesFixed: orgTotalIssuesFixed,
        totalPRsMerged: orgTotalPRsMerged,
        standaloneRepositories: standaloneRepositoryIds.length,
        standaloneMetrics,
      },
      highlights: await this.gemini
        .generateOrganizationHighlights(
          teamReports,
          organization?.name || organizationId,
          { start: startDate, end: endDate },
        )
        .catch(() => this.generateFallbackOrganizationHighlights(teamReports)),
      recommendations: await this.gemini
        .generateOrganizationRecommendations(
          teamReports,
          organization?.name || organizationId,
        )
        .catch(() =>
          this.generateFallbackOrganizationRecommendations(teamReports),
        ),
    };

    // Don't save organization reports - only contributor reports are saved
    console.log(
      `[ReportsService] Organization report generated for ${organization?.name || organizationId}. Not saving to database (organization reports are not persisted).`,
    );

    return report;
  }

  private calculatePerformance(health: {
    velocity: number;
    backlog: number;
    quality: string;
  }): 'excellent' | 'good' | 'average' | 'needs_attention' {
    if (health.quality === 'excellent' && health.velocity > 15) {
      return 'excellent';
    }
    if (health.quality === 'needs_attention' || health.backlog > 30) {
      return 'needs_attention';
    }
    if (health.velocity > 10) {
      return 'good';
    }
    return 'average';
  }

  private analyzeCommitSummaries(commits: any[]) {
    const features: Array<{
      description: string;
      module?: string;
      committer: string;
      commitCount: number;
    }> = [];
    const fixes: Array<{
      description: string;
      module?: string;
      committer: string;
      commitCount: number;
    }> = [];
    const improvements: Array<{
      description: string;
      module?: string;
      committer: string;
      commitCount: number;
    }> = [];
    const otherTasks: Array<{
      description: string;
      module?: string;
      committer: string;
      commitCount: number;
    }> = [];

    const featureMap = new Map<string, number>();
    const fixMap = new Map<string, number>();
    const improvementMap = new Map<string, number>();
    const taskMap = new Map<string, number>();

    commits.forEach((commit) => {
      const committer = commit.committer || 'Unknown';
      let moduleName: string | undefined;

      // Extract module from moduleChanges
      if (
        commit.moduleChanges &&
        Array.isArray(commit.moduleChanges) &&
        commit.moduleChanges.length > 0
      ) {
        moduleName = this.extractModuleName(String(commit.moduleChanges[0]));
      }

      // Skip commits without meaningful content
      if (!commit.summary && !commit.commitMessage) {
        return;
      }

      // Parse commit summary (JSON)
      let summary: any = {};
      if (commit.summary && typeof commit.summary === 'object') {
        try {
          summary =
            typeof commit.summary === 'string'
              ? JSON.parse(commit.summary)
              : commit.summary;
        } catch (e) {
          // If parsing fails, try to extract from commit message
          summary = { summary: commit.commitMessage || '' };
        }
      } else if (commit.commitMessage) {
        summary = { summary: commit.commitMessage };
      }

      // Extract description from summary (prioritize detailed summaries)
      let description =
        summary.summary ||
        summary.description ||
        summary.changes ||
        summary.detailedSummary ||
        commit.commitMessage ||
        'Code changes';

      // Skip merge commits - they're not meaningful work items
      const lowerCommitMsg = (commit.commitMessage || '').toLowerCase();
      if (
        lowerCommitMsg.includes('merge pull request') ||
        lowerCommitMsg.includes('merge branch') ||
        lowerCommitMsg.startsWith('merge ') ||
        lowerCommitMsg.includes('merged ')
      ) {
        // For merge commits, try to extract meaningful info from PR summary or skip
        if (summary.summary && summary.summary.length > 20) {
          description = summary.summary;
        } else if (summary.changes && summary.changes.length > 20) {
          description = summary.changes;
        } else {
          // Skip merge commits that don't have meaningful content
          return;
        }
      }

      // If summary has a structured format, try to extract more details
      if (
        summary.features &&
        Array.isArray(summary.features) &&
        summary.features.length > 0
      ) {
        description = `${summary.features.join(', ')}`;
      } else if (
        summary.fixes &&
        Array.isArray(summary.fixes) &&
        summary.fixes.length > 0
      ) {
        description = `Fixed: ${summary.fixes.join(', ')}`;
      } else if (
        summary.improvements &&
        Array.isArray(summary.improvements) &&
        summary.improvements.length > 0
      ) {
        description = `Improved: ${summary.improvements.join(', ')}`;
      }

      // Clean up description - remove PR numbers, common prefixes
      description = description
        .replace(/merge pull request #\d+/gi, '')
        .replace(/merge branch .+ into .+/gi, '')
        .replace(/^feat\/.+\s*:?\s*/i, '')
        .replace(/^fix\/.+\s*:?\s*/i, '')
        .replace(/^(.+?):\s*/, '$1: ')
        .trim();

      // Skip if description is too short or just whitespace
      if (description.length < 10) {
        return;
      }

      // Categorize based on commit message and summary content
      const lowerDesc = description.toLowerCase();

      // Determine category
      let category: 'feature' | 'fix' | 'improvement' | 'other' = 'other';
      // Use a normalized key to group similar commits (first 100 chars + module)
      let key: string = `${description.substring(0, 100).toLowerCase()}_${moduleName || 'unknown'}`;

      if (
        lowerDesc.includes('fix') ||
        lowerDesc.includes('bug') ||
        lowerDesc.includes('error') ||
        lowerDesc.includes('issue') ||
        lowerDesc.includes('resolve') ||
        lowerDesc.includes('correct') ||
        lowerDesc.includes('patch') ||
        lowerDesc.includes('hotfix') ||
        lowerDesc.startsWith('fix:')
      ) {
        category = 'fix';
        if (!fixMap.has(key)) {
          fixes.push({
            description: description.substring(0, 200),
            module: moduleName,
            committer,
            commitCount: 0,
          });
          fixMap.set(key, fixes.length - 1);
        }
        fixes[fixMap.get(key)!].commitCount++;
      } else if (
        lowerDesc.includes('add') ||
        lowerDesc.includes('implement') ||
        lowerDesc.includes('feature') ||
        lowerDesc.includes('new') ||
        lowerDesc.includes('create') ||
        lowerDesc.includes('introduce') ||
        lowerDesc.includes('feat') ||
        lowerDesc.startsWith('feat:') ||
        lowerDesc.startsWith('add:')
      ) {
        category = 'feature';
        if (!featureMap.has(key)) {
          features.push({
            description: description.substring(0, 200),
            module: moduleName,
            committer,
            commitCount: 0,
          });
          featureMap.set(key, features.length - 1);
        }
        features[featureMap.get(key)!].commitCount++;
      } else if (
        lowerDesc.includes('improve') ||
        lowerDesc.includes('enhance') ||
        lowerDesc.includes('optimize') ||
        lowerDesc.includes('refactor') ||
        lowerDesc.includes('update') ||
        lowerDesc.includes('upgrade') ||
        lowerDesc.includes('performance') ||
        lowerDesc.includes('refactor') ||
        lowerDesc.startsWith('refactor:') ||
        lowerDesc.startsWith('perf:') ||
        lowerDesc.startsWith('chore:')
      ) {
        category = 'improvement';
        if (!improvementMap.has(key)) {
          improvements.push({
            description: description.substring(0, 200),
            module: moduleName,
            committer,
            commitCount: 0,
          });
          improvementMap.set(key, improvements.length - 1);
        }
        improvements[improvementMap.get(key)!].commitCount++;
      } else {
        category = 'other';
        if (!taskMap.has(key)) {
          otherTasks.push({
            description: description.substring(0, 200),
            module: moduleName,
            committer,
            commitCount: 0,
          });
          taskMap.set(key, otherTasks.length - 1);
        }
        otherTasks[taskMap.get(key)!].commitCount++;
      }
    });

    // Sort by commit count (most active first)
    features.sort((a, b) => b.commitCount - a.commitCount);
    fixes.sort((a, b) => b.commitCount - a.commitCount);
    improvements.sort((a, b) => b.commitCount - a.commitCount);
    otherTasks.sort((a, b) => b.commitCount - a.commitCount);

    return {
      features: features.slice(0, 10), // Top 10 features
      fixes: fixes.slice(0, 10), // Top 10 fixes
      improvements: improvements.slice(0, 10), // Top 10 improvements
      otherTasks: otherTasks.slice(0, 10), // Top 10 other tasks
      summary: {
        totalFeatures: features.length,
        totalFixes: fixes.length,
        totalImprovements: improvements.length,
        totalOtherTasks: otherTasks.length,
      },
    };
  }

  private extractModuleName(path: string): string {
    if (!path) return 'root';

    // Remove common prefixes
    let cleanedPath = path
      .replace(/^src\//, '')
      .replace(/^backend\//, '')
      .replace(/^frontend\//, '')
      .replace(/^app\//, '')
      .replace(/^lib\//, '');

    // Split and extract meaningful parts
    const parts = cleanedPath
      .split('/')
      .filter((p) => p && p !== '.' && p !== '..');

    // If we have parts, return the first 2 levels for better feature identification
    // e.g., "modules/auth" or "components/forms"
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    } else if (parts.length === 1) {
      return parts[0];
    }

    return 'root';
  }

  private generateFallbackContributorInsights(
    metrics: ContributorMetrics,
  ): string[] {
    const insights: string[] = [];

    if (metrics.commits.total > 20) {
      insights.push(
        '🔥 High commit activity this week - excellent productivity!',
      );
    }

    if (metrics.modules.primary.length >= 3) {
      insights.push(
        `📦 Worked across ${metrics.modules.primary.length} primary modules - great versatility`,
      );
    }

    if (metrics.issues.fixed > metrics.issues.opened) {
      insights.push(
        `✅ Fixed more issues than opened (${metrics.issues.fixed} fixed vs ${metrics.issues.opened} opened) - reducing technical debt`,
      );
    }

    if (metrics.codeQuality.securityFixes > 0) {
      insights.push(
        `🔒 Addressed ${metrics.codeQuality.securityFixes} security issues - critical contributions`,
      );
    }

    if (metrics.pullRequests.reviewed > 0) {
      insights.push(
        `👥 Reviewed ${metrics.pullRequests.reviewed} pull requests - active team collaboration`,
      );
    }

    return insights;
  }

  private generateFallbackContributorSuggestions(
    metrics: ContributorMetrics,
  ): string[] {
    const suggestions: string[] = [];

    if (metrics.commits.total < 5) {
      suggestions.push(
        '💡 Consider increasing commit frequency to improve project velocity',
      );
    }

    if (metrics.issues.opened > metrics.issues.fixed) {
      suggestions.push(
        `⚠️ Focus on resolving existing issues (${metrics.issues.opened - metrics.issues.fixed} more opened than fixed)`,
      );
    }

    if (metrics.modules.all.length < 2) {
      suggestions.push(
        '💡 Consider exploring other modules to broaden your impact across the codebase',
      );
    }

    if (metrics.pullRequests.reviewed === 0) {
      suggestions.push(
        '👥 Increase PR review participation to support team collaboration',
      );
    }

    if (metrics.codeQuality.commentsAddressed < 3 && metrics.issues.fixed > 0) {
      suggestions.push(
        '🎯 Focus on addressing code review comments to improve code quality',
      );
    }

    return suggestions;
  }

  private generateFallbackTeamInsights(data: {
    totalCommits: number;
    totalIssuesFixed: number;
    velocity: number;
    backlog: number;
    contributors: number;
  }): string[] {
    const insights: string[] = [];

    if (data.totalCommits > 50) {
      insights.push(
        '🚀 Team showing high velocity with strong commit activity',
      );
    }

    if (data.totalIssuesFixed > 20) {
      insights.push(
        `✅ Excellent issue resolution rate - ${data.totalIssuesFixed} issues fixed this week`,
      );
    }

    if (data.backlog < 10) {
      insights.push(
        '📉 Low issue backlog - team is maintaining clean codebase',
      );
    } else if (data.backlog > 30) {
      insights.push(
        `⚠️ High issue backlog (${data.backlog}) - consider prioritizing fixes`,
      );
    }

    return insights;
  }

  private generateFallbackTeamRecommendations(data: {
    quality: string;
    velocity: number;
    backlog: number;
    contributors: ContributorReport[];
  }): string[] {
    const recommendations: string[] = [];

    if (data.quality === 'needs_attention') {
      recommendations.push(
        '🎯 Team needs attention - focus on increasing commit velocity and reducing issue backlog',
      );
    }

    if (data.backlog > 20) {
      recommendations.push(
        `📋 Consider dedicating time to resolve the ${data.backlog} open issues`,
      );
    }

    const avgCommits =
      data.contributors.length > 0
        ? data.contributors.reduce(
            (sum, c) => sum + c.metrics.commits.total,
            0,
          ) / data.contributors.length
        : 0;

    if (avgCommits < 5) {
      recommendations.push(
        '💪 Encourage team members to increase individual contribution levels',
      );
    }

    return recommendations;
  }

  private generateFallbackProjectInsights(data: {
    commits: number;
    issuesFixed: number;
    openIssues: number;
    modules?: string[];
    commitAnalysis?: {
      features: Array<{
        description: string;
        module?: string;
        committer: string;
      }>;
      fixes: Array<{ description: string; module?: string; committer: string }>;
      improvements: Array<{
        description: string;
        module?: string;
        committer: string;
      }>;
      summary: {
        totalFeatures: number;
        totalFixes: number;
        totalImprovements: number;
      };
    };
  }): string[] {
    const insights: string[] = [];

    // Lead with actual work completed
    if (data.commitAnalysis) {
      const ca = data.commitAnalysis;

      if (ca.features.length > 0) {
        const topFeatures = ca.features
          .slice(0, 2)
          .map((f) => {
            const desc =
              f.description.length > 50
                ? f.description.substring(0, 50) + '...'
                : f.description;
            return desc;
          })
          .join(', ');
        insights.push(
          `Team implemented ${ca.summary.totalFeatures} feature${ca.summary.totalFeatures > 1 ? 's' : ''} including: ${topFeatures}`,
        );
      }

      if (ca.fixes.length > 0) {
        const topFixes = ca.fixes
          .slice(0, 2)
          .map((f) => {
            const desc =
              f.description.length > 50
                ? f.description.substring(0, 50) + '...'
                : f.description;
            return desc;
          })
          .join(', ');
        insights.push(
          `Fixed ${ca.summary.totalFixes} bug${ca.summary.totalFixes > 1 ? 's' : ''} including: ${topFixes}`,
        );
      }

      if (ca.improvements.length > 0) {
        insights.push(
          `Made ${ca.summary.totalImprovements} improvement${ca.summary.totalImprovements > 1 ? 's' : ''} to codebase`,
        );
      }
    }

    if (data.modules && data.modules.length > 0 && !data.commitAnalysis) {
      insights.push(
        `Team focused on these modules this week: ${data.modules.slice(0, 3).join(', ')}`,
      );
    }

    if (data.commits > 30) {
      insights.push(
        'High commit activity indicates active development and strong velocity',
      );
    }

    if (data.issuesFixed > data.openIssues) {
      insights.push(
        'Positive issue resolution trend - fixing more than opening',
      );
    }

    return insights;
  }

  private generateFallbackProjectRecommendations(data: {
    issuesFixed: number;
    openIssues: number;
    modules?: string[];
  }): string[] {
    const recommendations: string[] = [];

    if (data.openIssues > 15) {
      recommendations.push(
        `High number of open issues (${data.openIssues}) - consider prioritizing bug fixes`,
      );
    }

    if (data.modules && data.modules.length > 0) {
      recommendations.push(
        `Review and improve code quality in these modules: ${data.modules.slice(0, 3).join(', ')}`,
      );
    }

    return recommendations;
  }

  private generateFallbackOrganizationHighlights(teams: any[]): string[] {
    const highlights: string[] = [];

    const topTeam = teams.sort(
      (a, b) => b.keyMetrics.commits - a.keyMetrics.commits,
    )[0];

    if (topTeam) {
      highlights.push(
        `🏆 ${topTeam.teamName} leading with ${topTeam.keyMetrics.commits} commits this week`,
      );
    }

    const excellentTeams = teams.filter(
      (t) => t.performance === 'excellent',
    ).length;

    if (excellentTeams > 0) {
      highlights.push(
        `⭐ ${excellentTeams} team(s) performing excellently this week`,
      );
    }

    return highlights;
  }

  private generateFallbackOrganizationRecommendations(teams: any[]): string[] {
    const recommendations: string[] = [];

    const needsAttention = teams.filter(
      (t) => t.performance === 'needs_attention',
    );

    if (needsAttention.length > 0) {
      recommendations.push(
        `🎯 ${needsAttention.length} team(s) need attention - consider additional support or resources`,
      );
    }

    return recommendations;
  }

  private createEmptyTeamReport(team: any, startDate: Date, endDate: Date) {
    return {
      team: { id: team.id, name: team.name },
      period: { start: startDate, end: endDate },
      summary: {
        totalContributors: 0,
        totalCommits: 0,
        totalIssuesFixed: 0,
        totalPRsMerged: 0,
        topPerformers: [],
        modulesCovered: [],
      },
      contributors: [],
      teamHealth: {
        velocity: 0,
        backlog: 0,
        quality: 'needs_attention' as const,
      },
      insights: [
        'Team has no repositories linked - link repositories to track activity',
      ],
      recommendations: [
        'Link repositories to this team in Settings to start tracking',
      ],
    };
  }

  private async saveReport(data: {
    reportType: ReportType;
    organizationId: string;
    teamId?: string;
    accountId?: string;
    repositoryId?: string;
    startDate: Date;
    endDate: Date;
    reportData: any;
  }) {
    // Only save CONTRIBUTOR and PROJECT reports - team and organization reports are not persisted
    if (
      data.reportType !== ReportType.CONTRIBUTOR &&
      data.reportType !== ReportType.PROJECT
    ) {
      console.log(
        `[ReportsService] Skipping save for report type ${data.reportType} - only CONTRIBUTOR and PROJECT reports are saved`,
      );
      return;
    }

    console.log(
      `[ReportsService] Saving ${data.reportType} report for organization ${data.organizationId}${data.accountId ? `, accountId: ${data.accountId}` : ''}${data.repositoryId ? `, repositoryId: ${data.repositoryId}` : ''}`,
    );

    const savedReport = await this.prisma.weeklyReport.create({
      data: {
        reportType: data.reportType,
        organizationId: data.organizationId,
        teamId: data.teamId,
        accountId: data.accountId,
        repositoryId: data.repositoryId,
        periodStart: data.startDate,
        periodEnd: data.endDate,
        reportData: data.reportData as Prisma.InputJsonValue,
      },
    });

    console.log(
      `[ReportsService] Successfully saved ${data.reportType} report with ID: ${savedReport.id}`,
    );
  }

  async getWeeklyReportById(reportId: string, accountId: string) {
    const report = await this.prisma.weeklyReport.findUnique({
      where: { id: reportId },
      include: {
        organization: true,
      },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    // Verify access
    const orgAccess = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: report.organizationId,
        accountId,
      },
    });

    if (!orgAccess) {
      throw new NotFoundException('Organization access not found');
    }

    return {
      reportData: report.reportData,
      id: report.id,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      reportType: report.reportType, // Include reportType so frontend knows what type of report this is
    };
  }

  async getWeeklyReport(dto: GetWeeklyReportDto, accountId: string) {
    // Verify access
    const orgAccess = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: dto.organizationId,
        accountId,
      },
    });

    if (!orgAccess) {
      throw new NotFoundException('Organization access not found');
    }

    const where: Prisma.WeeklyReportWhereInput = {
      reportType: dto.reportType,
      organizationId: dto.organizationId,
      ...(dto.teamId && { teamId: dto.teamId }),
      ...(dto.accountId && { accountId: dto.accountId }),
      ...(dto.repositoryId && { repositoryId: dto.repositoryId }),
      ...(dto.startDate && {
        periodStart: { lte: new Date(dto.startDate) },
        periodEnd: { gte: new Date(dto.startDate) },
      }),
    };

    console.log('where', where);

    const report = await this.prisma.weeklyReport.findFirst({
      where,
      orderBy: { periodStart: 'desc' },
    });
    console.log('report', report);

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report.reportData;
  }

  async listWeeklyReports(
    dto: GetWeeklyReportDto,
    accountId: string,
  ): Promise<{
    reports: Array<{
      id: string;
      periodStart: Date;
      periodEnd: Date;
      duration: number; // Duration in days
      createdAt: Date; // When the report was created
      metrics?: {
        totalCommits?: number;
        prsMerged?: number;
        issuesFixed?: number;
        openIssues?: number;
        topModule?: string;
        codeQualityScore?: number;
      };
    }>;
    total: number;
    hasMore: boolean;
    skip: number;
    take: number;
  }> {
    // Verify access
    const orgAccess = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId: dto.organizationId,
        accountId,
      },
    });

    if (!orgAccess) {
      throw new NotFoundException('Organization access not found');
    }

    const where: Prisma.WeeklyReportWhereInput = {
      reportType: dto.reportType,
      organizationId: dto.organizationId,
      ...(dto.teamId && { teamId: dto.teamId }),
      ...(dto.accountId && { accountId: dto.accountId }),
      ...(dto.repositoryId && { repositoryId: dto.repositoryId }),
    };

    // Pagination support: default to 5 per page if take is not specified
    const skip = dto.skip ?? 0;
    const take = dto.take ?? 5;

    // Get total count for pagination
    const total = await this.prisma.weeklyReport.count({ where });

    const reports = await this.prisma.weeklyReport.findMany({
      where,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        reportData: true, // Include reportData to extract metrics
        createdAt: true, // Include createdAt for display
      },
      orderBy: { periodStart: 'desc' },
      skip,
      take,
    });

    // Extract summary metrics from reportData
    const reportList = reports.map((report) => {
      const duration =
        Math.ceil(
          (new Date(report.periodEnd).getTime() -
            new Date(report.periodStart).getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1; // +1 to include both start and end days

      let metrics: {
        totalCommits?: number;
        prsMerged?: number;
        issuesFixed?: number;
        openIssues?: number;
        topModule?: string;
        codeQualityScore?: number;
      } = {};

      try {
        const reportData =
          typeof report.reportData === 'string'
            ? JSON.parse(report.reportData)
            : report.reportData;

        if (reportData && reportData.metrics) {
          // Handle different report structures
          const m = reportData.metrics;

          // Extract totalCommits (different structure for contributor vs project reports)
          const totalCommits = m.commits?.total || m.totalCommits || 0;

          // Extract prsMerged (handle both object and number formats)
          let prsMerged = 0;
          if (typeof m.pullRequests === 'object' && m.pullRequests !== null) {
            prsMerged = m.pullRequests.merged || 0;
          } else if (typeof m.prsMerged === 'object' && m.prsMerged !== null) {
            prsMerged = m.prsMerged.merged || 0;
          } else {
            prsMerged = m.pullRequests || m.prsMerged || 0;
          }

          // Extract issuesFixed (different structure for contributor vs project reports)
          const issuesFixed = m.issues?.fixed || m.issuesFixed || 0;
          const openIssues = m.issues?.opened ?? m.openIssues ?? 0;

          // Extract topModule (handle both array formats)
          let topModule: string | undefined;
          if (
            m.modules?.primary &&
            Array.isArray(m.modules.primary) &&
            m.modules.primary.length > 0
          ) {
            topModule = m.modules.primary[0];
          } else if (
            m.modules?.all &&
            Array.isArray(m.modules.all) &&
            m.modules.all.length > 0
          ) {
            topModule = m.modules.all[0].name || m.modules.all[0];
          } else if (Array.isArray(m.modules) && m.modules.length > 0) {
            topModule =
              typeof m.modules[0] === 'string'
                ? m.modules[0]
                : m.modules[0].name;
          }

          // Simple code quality score for table view if available
          let codeQualityScore: number | undefined;
          if (m.codeQuality) {
            const cq = m.codeQuality;
            codeQualityScore =
              (cq.commentsAddressed || 0) +
              (cq.securityFixes || 0) +
              (cq.codeSmellFixes || 0);
          }

          metrics = {
            totalCommits,
            prsMerged,
            issuesFixed,
            openIssues,
            topModule,
            codeQualityScore,
          };
        }
      } catch (error) {
        // If parsing fails, metrics remain empty
        console.warn('Failed to parse reportData for report', report.id, error);
      }

      return {
        id: report.id,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        duration,
        metrics,
        createdAt: report.createdAt || report.periodEnd, // Use actual createdAt if available
      };
    });

    return {
      reports: reportList,
      total,
      hasMore: skip + take < total,
      skip,
      take,
    };
  }

  async getTeamsActivitySummary(organizationId: string, accountId: string) {
    // Verify access
    const orgAccess = await this.prisma.organizationAccounts.findFirst({
      where: {
        organizationId,
        accountId,
      },
    });

    if (!orgAccess) {
      throw new NotFoundException('Organization access not found');
    }

    // Get all teams in organization
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      include: {
        members: {
          include: {
            account: {
              include: { user: true },
            },
            organizationRole: true,
          },
        },
        repositories: {
          include: {
            repository: {
              select: { repositoryId: true },
            },
          },
        },
      },
    });

    // Calculate last week's date range
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);

    // Track 15 days for better metrics
    const activityStartDate = new Date(startDate);
    activityStartDate.setDate(activityStartDate.getDate() - 15);

    const teamsSummary = await Promise.all(
      teams.map(async (team) => {
        const repositoryIds = team.repositories.map(
          (tr) => tr.repository.repositoryId,
        );

        if (repositoryIds.length === 0) {
          return {
            teamId: team.id,

            teamName: team.name,
            memberCount: team.members.length,
            repositoryCount: 0,
            totalCommits: 0,
            mergedCommits: 0,
            issuesFixed: 0,
            prsMerged: 0,
            velocity: 0,
            health: 'needs_attention',
            lastActivity: null,
          };
        }

        // Get commits from last 15 days
        const commits = await this.prisma.commitSummary.findMany({
          where: {
            repositoryId: { in: repositoryIds },
            createdAt: { gte: activityStartDate, lte: endDate },
          },
        });

        const totalCommits = commits.length;
        const mergedCommits = commits.filter((c) => c.isMerged).length;

        // Get issues fixed in last week
        const fixedIssues = await this.prisma.comment.findMany({
          where: {
            repositoryId: { in: repositoryIds },
            type: CommentType.ISSUE,
            status: CommentStatus.OUTDATED,
            updatedAt: { gte: startDate, lte: endDate },
          },
        });

        // Get PR metrics
        const commitsWithReports = commits.filter((c) => c.reportId);
        const uniqueReportIds = [
          ...new Set(commitsWithReports.map((c) => c.reportId).filter(Boolean)),
        ];

        const prsMerged = commitsWithReports.filter((c) => c.isMerged).length;

        // Calculate velocity (commits in last week)
        const weekCommits = commits.filter(
          (c) => c.createdAt >= startDate && c.createdAt <= endDate,
        );
        const velocity = weekCommits.length;

        // Get open issues
        const openIssues = await this.prisma.comment.count({
          where: {
            repositoryId: { in: repositoryIds },
            type: CommentType.ISSUE,
            status: CommentStatus.OPEN,
          },
        });

        // Determine health
        let health: 'excellent' | 'good' | 'needs_attention' = 'good';
        if (velocity > 20 && fixedIssues.length > 5 && openIssues < 10) {
          health = 'excellent';
        } else if (velocity < 5 || openIssues > 20) {
          health = 'needs_attention';
        }

        // Get last activity date
        const lastCommit = commits.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )[0];
        const lastActivity = lastCommit?.createdAt || null;

        return {
          teamId: team.id,
          teamName: team.name,
          memberCount: team.members.length,
          repositoryCount: repositoryIds.length,
          totalCommits,
          mergedCommits,
          issuesFixed: fixedIssues.length,
          prsMerged,
          velocity,
          openIssues,
          health,
          lastActivity,
        };
      }),
    );

    return teamsSummary;
  }

  async getReportHistory(
    organizationId: string,
    reportType: ReportType,
    teamId?: string,
    accountId?: string,
    repositoryId?: string,
    limit: number = 10,
  ) {
    const where: Prisma.WeeklyReportWhereInput = {
      organizationId,
      reportType,
      ...(teamId && { teamId }),
      ...(accountId && { accountId }),
      ...(repositoryId && { repositoryId }),
    };

    return await this.prisma.weeklyReport.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      take: limit,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        reportData: true,
      },
    });
  }
}
