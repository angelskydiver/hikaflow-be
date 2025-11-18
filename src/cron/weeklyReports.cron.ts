import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportType } from '../modules/reports/reports.dtos';
import { ReportsService } from '../modules/reports/reports.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WeeklyReportsCronService {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Runs every Saturday at 12:00 PM (noon) UTC
   * Cron expression: "0 12 * * 6"
   * - 0: minute (0)
   * - 12: hour (12 PM / noon)
   * - *: day of month (every day)
   * - *: month (every month)
   * - 6: day of week (Saturday, where 0=Sunday, 1=Monday, ..., 6=Saturday)
   */
  @Cron('0 12 * * 6', {
    name: 'weekly-reports',
    timeZone: 'UTC',
  })
  async generateWeeklyReports() {
    console.log(
      '🚀 Weekly Reports Cron Job Started - Generating project reports for last 7 days...',
    );

    try {
      // Get only organizations that have team hierarchy and teams created
      // An organization qualifies if:
      // 1. It has at least one OrganizationRole (hierarchy defined)
      // 2. It has at least one Team (teams created)

      // Get organizations with hierarchy (OrganizationRole exists) - for team reports
      const orgsWithHierarchy = await this.prisma.organizationRole.findMany({
        select: {
          organizationId: true,
        },
        distinct: ['organizationId'],
      });

      // Get organizations with teams - for team reports
      const orgsWithTeams = await this.prisma.team.findMany({
        select: {
          organizationId: true,
        },
        distinct: ['organizationId'],
      });

      // Find organizations that have BOTH hierarchy and teams
      const orgIdsWithHierarchy = new Set(
        orgsWithHierarchy.map((r) => r.organizationId),
      );
      const orgIdsWithTeams = new Set(
        orgsWithTeams.map((t) => t.organizationId),
      );

      // Organizations eligible for project reports (must have teams and hierarchy)
      const validOrgIds = Array.from(orgIdsWithHierarchy).filter((id) =>
        orgIdsWithTeams.has(id),
      );

      // Fetch full organization details
      let organizations = await this.prisma.organization.findMany({
        where: {
          id: {
            in: validOrgIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
      });

      console.log('NODE_ENV', process.env.NODE_ENV);

      const environment = (
        process.env.ENV ||
        process.env.ENVIRONMENT ||
        process.env.NODE_ENV ||
        ''
      ).toUpperCase();
      const developmentOrgId = '450c441a-f4dd-4357-b799-28be332c980c';

      if (environment === 'DEVELOPMENT') {
        const existingDevOrg = organizations.find(
          (org) => org.id === developmentOrgId,
        );
        console.log('existingDevOrg', existingDevOrg);
        if (existingDevOrg) {
          console.log('existingDevOrg found', existingDevOrg);
          organizations = [existingDevOrg];
        } else {
          console.log('existingDevOrg not found', existingDevOrg);
          const devOrg = await this.prisma.organization.findUnique({
            where: { id: developmentOrgId },
            select: { id: true, name: true },
          });
          console.log('devOrg', devOrg);

          if (devOrg) {
            organizations = [devOrg];
            console.log('devOrg found', devOrg);
          } else {
            console.warn(
              `Development override enabled but organization ${developmentOrgId} was not found. Skipping report generation.`,
            );
            organizations = [];
          }
        }

        if (organizations.length > 0) {
          console.log(
            `Development environment detected. Restricting weekly reports to organization ${organizations[0].name} (${organizations[0].id}).`,
          );
        }
      }

      console.log(
        `Found ${organizations.length} organizations with team hierarchy and teams to process`,
      );

      // Calculate last 7 days (not last week, just the past 7 days from today)
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // End date is yesterday at end of day (to avoid including today's partial data)
      const endDate = new Date(today);
      endDate.setDate(today.getDate() - 1); // Yesterday
      endDate.setHours(23, 59, 59, 999);

      // Start date is 7 days ago from end date
      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 6); // 7 days total (including end date)
      startDate.setHours(0, 0, 0, 0);

      console.log(
        `Generating reports for last 7 days: ${startDate.toISOString()} to ${endDate.toISOString()}`,
      );

      let successCount = 0;
      let failureCount = 0;
      let totalProjectReports = 0;
      let totalProjectReportsSuccess = 0;
      let totalProjectReportsFailed = 0;
      const errors: Array<{ orgId: string; orgName: string; error: string }> =
        [];

      if (organizations.length === 0) {
        console.log(
          'ℹ️  No organizations with team hierarchy and teams found. Skipping report generation.',
        );
        return;
      }

      // Process each organization
      for (const org of organizations) {
        try {
          console.log(
            `Processing organization: ${org.name} (${org.id}) - has hierarchy and teams`,
          );

          // Get organization admin account for authorization
          const orgAdmin = await this.prisma.organizationAccounts.findFirst({
            where: {
              organizationId: org.id,
              role: 'ADMIN',
            },
            include: {
              account: true,
            },
          });

          if (!orgAdmin) {
            console.warn(
              `⚠️  No ADMIN found for organization ${org.name}, skipping...`,
            );
            failureCount++;
            errors.push({
              orgId: org.id,
              orgName: org.name,
              error: 'No ADMIN account found',
            });
            continue;
          }

          // TEMPORARILY COMMENTED OUT: Organization and team reports
          // Only generating project reports for now
          // console.log(`  🏢 Generating organization report for ${org.name}`);
          // await this.reportsService.generateWeeklyReport(
          //   {
          //     reportType: ReportType.ORGANIZATION,
          //     organizationId: org.id,
          //     startDate: startDate.toISOString(),
          //     endDate: endDate.toISOString(),
          //   },
          //   orgAdmin.accountId,
          // );
          // console.log(`  ✅ Generated organization report for ${org.name}`);

          // Generate project reports for all repositories in the organization
          const repositories = await this.prisma.repository.findMany({
            where: {
              organizationId: org.id,
            },
            select: {
              id: true,
              name: true,
            },
          });

          console.log(
            `📦 Generating project reports for ${repositories.length} repositories in ${org.name}`,
          );

          let projectReportsSuccess = 0;
          let projectReportsFailed = 0;

          for (const repository of repositories) {
            try {
              await this.reportsService.generateWeeklyReport(
                {
                  reportType: ReportType.PROJECT,
                  organizationId: org.id,
                  repositoryId: repository.id,
                  startDate: startDate.toISOString(),
                  endDate: endDate.toISOString(),
                },
                orgAdmin.accountId,
              );
              projectReportsSuccess++;
              console.log(
                `  ✅ Generated project report for ${repository.name}`,
              );
            } catch (error) {
              projectReportsFailed++;
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              console.warn(
                `  ⚠️  Failed to generate project report for ${repository.name}: ${errorMessage}`,
              );
            }
          }

          totalProjectReports += repositories.length;
          totalProjectReportsSuccess += projectReportsSuccess;
          totalProjectReportsFailed += projectReportsFailed;

          console.log(
            `  📊 Project Reports: ${projectReportsSuccess}/${repositories.length} success, ${projectReportsFailed} failed`,
          );

          // Generate contributor reports for all accounts with Git contributor names
          console.log(
            `👤 Generating contributor reports for users in ${org.name}`,
          );

          // Get all accounts that have Git contributor names and are part of this organization
          const accountsWithGitNames =
            await this.prisma.gitContributorName.findMany({
              select: {
                accountId: true,
              },
              distinct: ['accountId'],
            });

          // Get accounts that are members of this organization
          const orgAccounts = await this.prisma.organizationAccounts.findMany({
            where: {
              organizationId: org.id,
            },
            select: {
              accountId: true,
            },
          });

          const orgAccountIds = new Set(orgAccounts.map((oa) => oa.accountId));
          const validAccountIds = accountsWithGitNames
            .map((g) => g.accountId)
            .filter((id) => orgAccountIds.has(id));

          console.log(
            `  Found ${validAccountIds.length} accounts with Git contributor names in ${org.name}`,
          );

          let contributorReportsSuccess = 0;
          let contributorReportsFailed = 0;

          for (const accountId of validAccountIds) {
            try {
              await this.reportsService.generateWeeklyReport(
                {
                  reportType: ReportType.CONTRIBUTOR,
                  organizationId: org.id,
                  accountId: accountId,
                  startDate: startDate.toISOString(),
                  endDate: endDate.toISOString(),
                },
                accountId, // Use the account's own ID for authorization
              );
              contributorReportsSuccess++;
            } catch (error) {
              contributorReportsFailed++;
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              console.warn(
                `  ⚠️  Failed to generate contributor report for account ${accountId}: ${errorMessage}`,
              );
            }
          }

          console.log(
            `  👤 Contributor Reports: ${contributorReportsSuccess}/${validAccountIds.length} success, ${contributorReportsFailed} failed`,
          );

          successCount++;
          console.log(`✅ Successfully generated all reports for ${org.name}`);
        } catch (error) {
          failureCount++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `❌ Failed to generate report for ${org.name}:`,
            errorMessage,
          );
          errors.push({
            orgId: org.id,
            orgName: org.name,
            error: errorMessage,
          });
        }
      }

      console.log('\n📊 Weekly Reports Cron Job Summary:');
      console.log(
        `✅ Organizations: ${successCount} success, ${failureCount} failed`,
      );
      console.log(
        `📦 Project Reports: ${totalProjectReportsSuccess}/${totalProjectReports} generated successfully, ${totalProjectReportsFailed} failed`,
      );
      if (errors.length > 0) {
        console.log('\n❌ Errors:');
        errors.forEach((err) => {
          console.log(`  - ${err.orgName} (${err.orgId}): ${err.error}`);
        });
      }
      console.log('✅ Weekly Reports Cron Job Completed\n');
    } catch (error) {
      console.error('❌ Weekly Reports Cron Job Failed:', error);
      throw error;
    }
  }
}
