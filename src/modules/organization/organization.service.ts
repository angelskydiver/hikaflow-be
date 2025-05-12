import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationalAccountRole, Prisma } from '@prisma/client';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import {
  CreateOrganizationRequestDto,
  InviteUserToOrganizationRequestDTO,
  OrganizationInsightsQueryDto,
} from './dto/organization.request.dto';

@Injectable()
export class OrganizationService {
  constructor(
    private _prismaService: PrismaService,
    private _mailService: MailService,
    private _billingService: BillingService,
  ) {}

  async createOrganization(
    data: CreateOrganizationRequestDto,
    accountId: string,
  ) {
    try {
      const { organizationExist } = await this.organizationExist(accountId);
      if (organizationExist) {
        throw new BadRequestException('Organization already exists');
      }

      let createdOrganization;

      await this._prismaService.$transaction(async () => {
        // Create the organization
        createdOrganization = await this._prismaService.organization.create({
          data: data,
        });

        // Create the organization-account relationship
        await this._prismaService.organizationAccounts.create({
          data: {
            accountId: accountId,
            organizationId: createdOrganization.id,
            role: 'ADMIN',
          },
        });
      });

      // Create a 15-day trial subscription for the new organization
      if (createdOrganization) {
        try {
          await this._billingService.createTrialSubscription(
            createdOrganization.id,
          );
        } catch (subError) {
          console.error('Error creating trial subscription:', subError);
          // Don't throw error here - organization was created successfully
        }
      }

      return {
        Success: true,
        organizationId: createdOrganization?.id,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async inviteUserToOrganization(
    data: InviteUserToOrganizationRequestDTO,
    accountId: string,
  ) {
    try {
      const organization = await this._prismaService.organization.findUnique({
        where: { id: data.organizationId },
      });
      if (!organization) throw new NotFoundException('Organization not found');

      const account = await this._prismaService.account.findUnique({
        where: { id: accountId },
        include: { user: true },
      });
      if (!account) throw new NotFoundException('Account not found');

      let invitationAlreadyExist =
        await this._prismaService.organizationInvitation.findMany({
          where: {
            organizationId: data.organizationId,
            email: { in: data.users.map((user) => user.email) },
          },
        });
      console.log(invitationAlreadyExist);

      const newUsers = data.users.filter(
        (user) =>
          !invitationAlreadyExist.some(
            (invitation) => invitation.email === user.email,
          ),
      );

      const invitationPayloads = newUsers.map((user) => {
        const invitationData: Prisma.OrganizationInvitationCreateInput = {
          organization: { connect: { id: data.organizationId } },
          role: user.role as OrganizationalAccountRole,
          email: user.email,
          name: user.name,
          inviter: { connect: { id: account.user.id } },
        };

        return this._prismaService.organizationInvitation.create({
          data: invitationData,
        });
      });

      await Promise.all(invitationPayloads);

      // send email with invitation link
      const sendEmailMapping = data.users.map((user) => {
        return this._mailService.organizationInvitation({
          email: user.email,
          userName: user.name,
          organizationName: organization.name,
          inviterName:
            account.user.firstName +
            (account.user.lastName ? ' ' + account.user.lastName : ''),
          signupLink: `${process.env.HIKAFLOW_PORTAL_URL}/organization/invitation/${organization.id}`,
          role: user.role,
        });
      });
      await Promise.all(sendEmailMapping);
      return { Success: true };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async getOrganizationInvitations(organizationId: string, accountId: string) {
    try {
      const isValidAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            organizationId: organizationId,
            accountId: accountId,
          },
        });
      if (!isValidAccount) throw new NotFoundException('Invalid account');
      const invitations =
        await this._prismaService.organizationInvitation.findMany({
          where: {
            organizationId: organizationId,
          },
          include: {
            organization: true,
            inviter: true,
          },
        });
      return invitations;
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async organizationExist(accountId: string) {
    try {
      const organization =
        await this._prismaService.organizationAccounts.findFirst({
          where: { accountId: accountId },
        });
      if (organization) {
        return {
          organizationExist: true,
          organizationId: organization.organizationId,
          isAdmin:
            organization.role === 'ADMIN' || organization.role === 'MANAGER',
          role: organization.role,
        };
      } else {
        return { organizationExist: false };
      }
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async organizationInfo(organizationId: string) {
    try {
      const organizationAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            role: 'ADMIN',
            organizationId: organizationId,
          },
          include: {
            account: true,
            organization: true,
          },
        });

      const accountUser = await this._prismaService.account.findFirst({
        where: {
          id: organizationAccount.accountId,
        },
        include: {
          user: true,
        },
      });

      return { ...organizationAccount, user: accountUser.user };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async acceptInvitation(organizationId: string, accountId: string) {
    try {
      const account = await this._prismaService.account.findUnique({
        where: { id: accountId },
        include: { user: true },
      });

      if (!account) {
        throw new NotFoundException('Account not found');
      }

      const organizationAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            role: 'ADMIN',
            organizationId: organizationId,
          },
        });

      if (!organizationAccount) {
        throw new NotFoundException(
          'No admin account found for the organization',
        );
      }

      if (organizationAccount.accountId == accountId) {
        throw new BadRequestException('You are already an admin');
      }

      const memberAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            accountId: accountId,
            organizationId: organizationId,
          },
        });

      if (memberAccount) {
        throw new BadRequestException(
          'You are already a member of this organization',
        );
      }

      const invitation =
        await this._prismaService.organizationInvitation.findFirst({
          where: {
            organizationId: organizationId,
            email: account.user.email,
          },
        });

      if (!invitation) {
        throw new NotFoundException(
          'Invitation not found ask your administrator to resend the invitation',
        );
      }

      await this._prismaService.organizationAccounts.create({
        data: {
          accountId: accountId,
          organizationId: organizationId,
          role: invitation.role,
        },
      });

      await this._prismaService.organizationInvitation.update({
        where: {
          id: invitation.id,
        },
        data: { status: 'accepted' },
      });

      return {
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getOrganizationInsights(
    organizationId: string,
    query: OrganizationInsightsQueryDto,
    accountId: string,
  ) {
    try {
      const { repositoryId, daysLimit = 30 } = query;
      const startDate = new Date(Date.now() - daysLimit * 24 * 60 * 60 * 1000);

      // Verify user has access to organization
      const orgAccess =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            organizationId: organizationId,
            accountId: accountId,
          },
        });

      if (!orgAccess) {
        throw new NotFoundException('Organization access not found');
      }

      // Get repositories for the organization
      const repositories = await this._prismaService.repository.findMany({
        where: repositoryId ? { id: repositoryId } : { organizationId },
        select: {
          id: true,
          repositoryId: true,
          name: true,
          language: true,
        },
      });

      const repoIds = repositories.map((r) => r.repositoryId);

      // 1. Repository Activity Summary
      const pullRequests = await this._prismaService.pullRequest.findMany({
        where: {
          repositoryId: { in: repoIds },
          createdAt: { gte: startDate },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Calculate PR frequency for last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentPRs = await this._prismaService.pullRequest.findMany({
        where: {
          repositoryId: { in: repoIds },
          createdAt: { gte: sevenDaysAgo },
        },
        select: {
          createdAt: true,
          repositoryId: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // 2. Issue Statistics
      const issues = await this._prismaService.comment.findMany({
        where: {
          repositoryId: { in: repoIds },
          type: 'ISSUE',
          createdAt: { gte: startDate },
        },
        select: {
          severity: true,
          issueCategory: true,
          status: true,
          createdAt: true,
        },
      });

      // 3. Code Quality Metrics
      const codeQuality = await this._prismaService.codeOverview.findMany({
        where: {
          repositoryId: { in: repoIds },
          createdAt: { gte: startDate },
        },
        select: {
          summary: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // 4. Repository Usage Stats
      const usageLogs = await this._prismaService.usageLog.findMany({
        where: {
          organizationId,
          createdAt: { gte: startDate },
        },
        select: {
          type: true,
          createdAt: true,
          repository: {
            select: {
              name: true,
            },
          },
        },
      });

      // Process and return insights
      return {
        repositoryStats: {
          totalRepositories: repositories.length,
          byLanguage: this._groupByLanguage(repositories),
          recentActivity: this._processRecentActivity(pullRequests, issues),
          prFrequency: {
            last7Days: this._calculatePRFrequency(recentPRs),
            totalPRs: recentPRs.length,
            dailyAverage: +(recentPRs.length / 7).toFixed(2),
          },
        },
        issueMetrics: {
          total: issues.length,
          bySeverity: this._groupBySeverity(issues),
          byCategory: this._groupByCategory(issues),
          trend: this._calculateTrend(issues, daysLimit),
        },
        codeQualityTrend: codeQuality.map((q) => ({
          date: q.createdAt,
          metrics: q.summary,
        })),
        usageAnalytics: {
          totalUsage: usageLogs.length,
          byType: this._groupByType(usageLogs),
          byRepository: this._groupByRepository(usageLogs),
        },
      };
    } catch (error) {
      console.error('Error fetching organization insights:', error);
      throw new BadRequestException(error.message);
    }
  }

  private _groupByLanguage(repositories: any[]) {
    return repositories.reduce((acc, repo) => {
      const lang = repo.language || 'Unknown';
      acc[lang] = (acc[lang] || 0) + 1;
      return acc;
    }, {});
  }

  private _processRecentActivity(pullRequests: any[], issues: any[]) {
    const timeline = [...pullRequests, ...issues]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map((item) => ({
        type: 'prNumber' in item ? 'PR' : 'Issue',
        date: item.createdAt,
        details: 'prNumber' in item ? item.prTitle : item.issueCategory,
      }));
    return timeline;
  }

  private _groupBySeverity(issues: any[]) {
    return issues.reduce((acc, issue) => {
      acc[issue.severity] = (acc[issue.severity] || 0) + 1;
      return acc;
    }, {});
  }

  private _groupByCategory(issues: any[]) {
    return issues.reduce((acc, issue) => {
      acc[issue.issueCategory] = (acc[issue.issueCategory] || 0) + 1;
      return acc;
    }, {});
  }

  private _calculateTrend(issues: any[], daysLimit: number) {
    const trend = {};
    const days = [...Array(daysLimit)].map((_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return date.toISOString().split('T')[0];
    });

    days.forEach((day) => {
      trend[day] = 0;
    });

    issues.forEach((issue) => {
      const day = issue.createdAt.toISOString().split('T')[0];
      if (trend[day] !== undefined) {
        trend[day]++;
      }
    });

    return trend;
  }

  private _groupByType(logs: any[]) {
    return logs.reduce((acc, log) => {
      acc[log.type] = (acc[log.type] || 0) + 1;
      return acc;
    }, {});
  }

  private _groupByRepository(logs: any[]) {
    return logs.reduce((acc, log) => {
      const repoName = log.repository?.name || 'Unknown';
      acc[repoName] = (acc[repoName] || 0) + 1;
      return acc;
    }, {});
  }

  private _calculatePRFrequency(prs: any[]) {
    const frequency = {
      Monday: 0,
      Tuesday: 0,
      Wednesday: 0,
      Thursday: 0,
      Friday: 0,
      Saturday: 0,
      Sunday: 0,
    };

    const days = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];

    prs.forEach((pr) => {
      const dayName = days[pr.createdAt.getDay()];
      frequency[dayName]++;
    });

    return frequency;
  }
}
