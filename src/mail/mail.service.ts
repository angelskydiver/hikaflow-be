import { MailerService } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Injectable, Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { join } from 'path';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private paymentWorker: Worker;

  constructor(
    private mailerService: MailerService,
    private prismaService: PrismaService,
  ) {
    // Create a separate MailerService instance for the payment worker
    // to ensure it uses the correct template directory
    const paymentMailerService = new MailerService(
      {
        transport: {
          host: process.env.MAILER_HOST,
          secure: false,
          auth: {
            user: process.env.MAILER_USER_EMAIL,
            pass: process.env.MAILER_USER_PASSWORD,
          },
        },
        defaults: {
          from: `"No Reply" <${process.env.MAILER_USER_EMAIL}>`,
        },
        template: {
          dir: join(process.cwd(), 'dist', 'src', 'mail', 'templates'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      },
      null,
    );
    this.paymentWorker = new Worker(
      'payment-events',
      async (job) => {
        this.logger.log(job.name, job.data);
        if (job.name === 'payment-success') {
          // Send payment success email using the dedicated mailer service
          await this.sendEmailWithRetry(
            {
              to: job.data.email,
              subject: '[Codedeno] Payment Successful',
              template: 'payment-success',
              context: job.data,
            },
            3,
            paymentMailerService,
          );
        } else if (job.name === 'payment-failure') {
          // Send payment failure email using the dedicated mailer service
          await this.sendEmailWithRetry(
            {
              to: job.data.email,
              subject: '[Codedeno] Payment Failed',
              template: 'payment-failure',
              context: job.data,
            },
            3,
            paymentMailerService,
          );
        } else if (job.name === 'verification-complete') {
          // Send verification email using the dedicated mailer service
          await this.sendEmailWithRetry(
            {
              to: job.data.email,
              subject: '[Codedeno] Verification Complete',
              template: 'verification-complete',
              context: job.data,
            },
            3,
            paymentMailerService,
          );
        } else if (job.name === 'reversal-complete') {
          // Send reversal email using the dedicated mailer service
          await this.sendEmailWithRetry(
            {
              to: job.data.email,
              subject:
                '[Codedeno] Account Balance Verification Reversal Complete',
              template: 'reversal-complete',
              context: job.data,
            },
            3,
            paymentMailerService,
          );
        }
      },
      {
        concurrency: 10,
        connection: {
          host: 'localhost',
          port: parseInt(process.env.REDIS_PORT),
        },
      }, // Configure the message queue connection (adjust as needed)
    );

    this.paymentWorker.on('completed', (job) => {
      this.logger.log(`${job.name} has completed!`);
    });

    this.paymentWorker.on('failed', (job, err) => {
      this.logger.error(`${job.name} has failed with ${err.message}`);
    });
  }

  private async sendEmailWithRetry(
    options: {
      to: string;
      subject: string;
      template: string;
      context: any;
      from?: string;
    },
    retries = 3,
    mailerService?: MailerService,
  ): Promise<boolean> {
    try {
      this.logger.log(
        `Attempting to send email with template: ${options.template}`,
      );
      this.logger.log(
        `Email context: ${JSON.stringify(options.context, null, 2)}`,
      );

      const serviceToUse = mailerService || this.mailerService;
      await serviceToUse.sendMail({
        to: options.to,
        subject: options.subject,
        template: options.template,
        context: options.context,
        from: options.from || '"Hikaflow" <noreply@hikaflow.com>',
      });

      this.logger.log(`Email sent successfully to: ${options.to}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`, error.stack);
      this.logger.error(`Template: ${options.template}, To: ${options.to}`);

      if (retries > 0) {
        this.logger.log(
          `Retrying email send... (${retries} attempts remaining)`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
        return this.sendEmailWithRetry(options, retries - 1, mailerService);
      }
      throw error;
    }
  }

  // need to remove. not
  async rejectCreatorEmail(data) {
    try {
      await this.mailerService.sendMail({
        to: data.to,
        subject: `Update on Your Creator Application" sets the context.`,
        from: '"Support Team" <discoursefy@gmail.com>', // override default from
        template: './creator-rejection', // `.hbs` extension is appended automatically
        context: data,
      });
    } catch (error) {
      console.log(error.message);
      throw new Error(error.message);
    }
  }

  async becomeCreatorEmail(data) {
    try {
      await this.mailerService.sendMail({
        to: data.to,
        subject: `Congratulations! You've Been Selected as a ${data.category} Category Creator" is eye-catching and congratulatory`,
        from: '"Support Team" <discoursefy@gmail.com>', // override default from
        template: './become-creator', // `.hbs` extension is appended automatically
        context: data,
      });
    } catch (error) {
      console.log(error.message);
      throw new Error(error.message);
    }
  }

  // need to remove.
  async updateMeetingStatusEmail(data) {
    await this.mailerService.sendMail({
      to: data.to,
      subject: `Meeting: ${data.title}`,
      // from: '"Support Team" <support@example.com>', // override default from
      template: './meeting-status-updated', // `.hbs` extension is appended automatically
      context: data,
    });
  }

  // need to remove.
  async addCommentToMeetingEmail(data) {
    await this.mailerService.sendMail({
      to: data.to,
      // from: '"Support Team" <support@example.com>', // override default from
      subject: `Meeting: ${data.title}`,
      template: './meeting-comment', // `.hbs` extension is appended automatically
      context: data,
    });
  }

  // need to remove.
  async sendMeetingEmail(data) {
    await this.mailerService.sendMail({
      to: data.Email,
      // from: '"Support Team" <support@example.com>', // override default from
      subject: `Meeting: ${data.title}`,
      template: './meeting-created', // `.hbs` extension is appended automatically
      context: data,
    });
  }

  // need to remove.
  async sendDiscussionReminder(user: any, token: string = '') {
    const url = `example.com/auth/confirm?token=${token}`;

    await this.mailerService.sendMail({
      to: user.email,
      // from: '"Support Team" <support@example.com>', // override default from
      subject: `Discussion: ${user.discussionTitle}`,
      template: './discussion-reminder', // `.hbs` extension is appended automatically
      context: {
        // ✏️ filling curly brackets with content
        name: user.name,
        url,
        ...user,
      },
    });
  }

  // need to remove.
  async sendDiscussionConfirmation(user: any) {
    await this.mailerService.sendMail({
      to: user.email,
      // from: '"Support Team" <support@example.com>', // override default from
      subject: `Discussion: ${user.discussionTitle}`,
      template: './discussion-created', // `.hbs` extension is appended automatically
      context: {
        // ✏️ filling curly brackets with content
        creatorName: user.name,
        discussionTitle: user.discussionTitle,
        discussionDescription: user.discussionDescription,
        discussionScheduleTime: user.discussionScheduleTime,
        discussionUrl: user.discussionUrl,
      },
    });
  }

  async verifyEmail(user: any) {
    try {
      console.log('CP# 02: ', user);
      await this.mailerService.sendMail({
        to: user.email,
        // from: '"Support Team" <support@example.com>', // override default from
        subject: 'Welcome to Hikaflow! Confirm your Email 🚀',
        template: './verify-email', // `.hbs` extension is appended automatically
        context: {
          // ✏️ filling curly brackets with content
          userName: user.name,
          otp: user.otp,
        },
      });
    } catch (error) {
      console.log('*** ERROR: ', error);
      console.log(error.message);
    }
  }

  async prCreatedNotification(data: {
    email: string;
    adminName: string;
    repositoryName: string;
    authorName: string;
    prUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: `[Hikaflow] 🔔New Pull Request Created`,
        template: './pr-created-notification',
        context: {
          adminName: data.adminName,
          repositoryName: data.repositoryName,
          authorName: data.authorName,
          prUrl: data.prUrl,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send PR created notification: ${error.message}`,
      );
      // Don't throw to prevent disrupting the PR workflow
    }
  }

  async organizationInvitation(data: {
    email: string;
    userName: string;
    organizationName: string;
    inviterName: string;
    signupLink: string;
    role: string;
  }) {
    const { email, userName, organizationName, inviterName, signupLink, role } =
      data;
    try {
      await this.mailerService.sendMail({
        to: data.email,
        // from: `Hikaflow`, // override default from
        subject: `Invitation to Join ${organizationName} on Hikaflow`,
        template: './organization-invitation', // `.hbs` extension is appended automatically
        context: {
          email,
          userName,
          organizationName,
          inviterName,
          signupLink,
          role,
        },
      });
    } catch (error) {
      console.error(error.message);
      throw new Error(error.message);
    }
  }

  async prClosedNotification(data: {
    email: string;
    adminName: string;
    repositoryName: string;
    authorName: string;
    reportUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: `[Hikaflow] Pull Request Closed`,
        template: './pr-closed-notification',
        context: {
          adminName: data.adminName,
          repositoryName: data.repositoryName,
          authorName: data.authorName,
          reportUrl: data.reportUrl,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send PR closed notification: ${error.message}`,
      );
      // Don't throw to prevent disrupting the PR workflow
    }
  }

  async prUpdatedNotification(data: {
    email: string;
    adminName: string;
    repositoryName: string;
    authorName: string;
    prUrl: string;
    prNumber: string;
    changesSummary?: {
      filesChanged: number;
      additions: number;
      deletions: number;
      fixedIssues?: number;
    };
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: `[Hikaflow] 🔄 Pull Request Updated`,
        template: './pr-updated-notification',
        context: {
          adminName: data.adminName,
          repositoryName: data.repositoryName,
          authorName: data.authorName,
          prUrl: data.prUrl,
          prNumber: data.prNumber,
          changesSummary: data.changesSummary,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send PR updated notification: ${error.message}`,
      );
      // Don't throw to prevent disrupting the PR workflow
    }
  }

  async sendRegressionTestingNotification(data: {
    accountId: string;
    authorName: string;
    repositoryInfo: {
      repositoryName: string;
    };
    regressionData: {
      summary: string;
      impactedFlows: any[];
      changedBehavior: any[];
      potentialBreakages: any[];
      testCases: any[];
    };
    prNumber?: string | number;
  }) {
    try {
      const account = await this.prismaService.account.findUnique({
        where: { id: data.accountId },
        include: { user: true },
      });

      if (!account || !account.user) {
        throw new Error(`Account not found for ID: ${data.accountId}`);
      }

      const email = account.user.email;
      const prNumber = data.prNumber || 'N/A';

      await this.sendEmailWithRetry({
        to: email,
        subject: `[Hikaflow] Regression Testing Report: ${data.repositoryInfo.repositoryName}`,
        template: './regression-testing-notification',
        context: {
          adminName: account.user.firstName,
          repositoryName: data.repositoryInfo.repositoryName,
          prNumber,
          regressionData: data.regressionData,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send regression testing notification: ${error.message}`,
      );
      // Don't throw to prevent disrupting the PR workflow
    }
  }

  async referralEmail(data: any) {
    try {
      await this.mailerService.sendMail({
        to: data.email,
        text: `Your Friend ${data.referrerName} Invites You to Unlock Career Opportunities with Discoursefy!`,
        // from: '"Support Team" <support@example.com>', // override default from
        subject: `Your Friend ${data.referrerName} Invites You to Unlock Career Opportunities with Discoursefy!`,
        template: './referral-invitation', // `.hbs` extension is appended automatically
        context: {
          // ✏️ filling curly brackets with content
          userName: data.name,
          referrerName: data.referrerName,
        },
      });
    } catch (error) {
      console.log('*** ERROR: ', error);
      console.log(error.message);
    }
  }

  async repositoryScanCompleteNotification(data: {
    email: string;
    adminName: string;
    repositoryName: string;
    reportUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry(
        {
          to: data.email,
          subject: `[Hikaflow] Repository Scan Complete: ${data.repositoryName}`,
          template: './repository-scan-complete',
          context: {
            adminName: data.adminName,
            repositoryName: data.repositoryName,
            reportUrl: data.reportUrl,
          },
        },
        3,
        this.mailerService,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send repository scan notification: ${error.message}`,
      );
      // Don't throw to prevent disrupting the scan workflow
    }
  }

  // Payment-related email methods
  async sendPaymentSuccessEmail(data: {
    email: string;
    userName: string;
    transactionId: string;
    amount: string;
    paymentMethod: string;
    paymentDate: string;
    planDetails?: {
      name: string;
      description: string;
    };
    dashboardUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: '[Codedeno] Payment Successful',
        template: 'payment-success',
        context: data,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send payment success email: ${error.message}`,
      );
      // Don't throw to prevent disrupting the payment workflow
    }
  }

  async sendPaymentFailureEmail(data: {
    email: string;
    userName: string;
    transactionId: string;
    amount: string;
    paymentMethod: string;
    paymentDate: string;
    errorMessage: string;
    planDetails?: {
      name: string;
      description: string;
    };
    retryPaymentUrl: string;
    supportUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: '[Codedeno] Payment Failed',
        template: 'payment-failure',
        context: data,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send payment failure email: ${error.message}`,
      );
      // Don't throw to prevent disrupting the payment workflow
    }
  }

  async sendVerificationCompleteEmail(data: {
    email: string;
    userName: string;
    verificationType: string;
    verificationDate: string;
    verificationDetails?: string;
    dashboardUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: '[Codedeno] Verification Complete',
        template: 'verification-complete',
        context: data,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send verification complete email: ${error.message}`,
      );
      // Don't throw to prevent disrupting the verification workflow
    }
  }

  async sendReversalCompleteEmail(data: {
    email: string;
    userName: string;
    reversalId: string;
    originalAmount: string;
    reversalDate: string;
    reversalDetails?: string;
    nextSteps?: string;
    dashboardUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: '[Codedeno] Account Balance Verification Reversal Complete',
        template: 'reversal-complete',
        context: data,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send reversal complete email: ${error.message}`,
      );
      // Don't throw to prevent disrupting the reversal workflow
    }
  }

  // Test method to verify template compilation
  async testPaymentEmail() {
    try {
      const testData = {
        email: 'test@example.com',
        userName: 'Test User',
        transactionId: 'TEST-123',
        amount: '10.00',
        paymentMethod: 'Credit Card',
        paymentDate: new Date().toISOString(),
        planDetails: {
          name: 'Test Plan',
          description: 'Test Plan Description',
        },
        dashboardUrl: 'http://localhost:3001/dashboard',
      };

      this.logger.log('Testing payment success email template...');
      await this.sendEmailWithRetry({
        to: testData.email,
        subject: '[Codedeno] Test Payment Email',
        template: 'payment-success',
        context: testData,
      });
      this.logger.log('Test email sent successfully!');
    } catch (error) {
      this.logger.error(`Test email failed: ${error.message}`, error.stack);
    }
  }

  async sendContributorReportEmail(data: {
    email: string;
    userName: string;
    periodStart: Date;
    periodEnd: Date;
    metrics: {
      totalCommits: number;
      issuesFixed: number;
      prsMerged: number;
    };
    profileUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: `[Hikaflow] Your Weekly Performance Report - ${new Date(data.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${new Date(data.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        template: 'contributor-report-notification',
        context: {
          userName: data.userName,
          periodStart: new Date(data.periodStart).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          periodEnd: new Date(data.periodEnd).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          totalCommits: data.metrics.totalCommits,
          issuesFixed: data.metrics.issuesFixed,
          prsMerged: data.metrics.prsMerged,
          profileUrl: data.profileUrl,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to send contributor report email: ${error.message}`,
      );
      // Don't throw to prevent disrupting the report generation workflow
    }
  }

  async sendProjectReportEmail(data: {
    email: string;
    managerName: string;
    repositoryName: string;
    organizationName: string;
    periodStart: Date;
    periodEnd: Date;
    metrics: {
      totalCommits: number;
      issuesFixed: number;
      issuesOpened: number;
      prsMerged: number;
    };
    projectUrl: string;
  }) {
    try {
      await this.sendEmailWithRetry({
        to: data.email,
        subject: `[Hikaflow] Weekly Project Report: ${data.repositoryName} - ${new Date(data.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${new Date(data.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        template: 'project-report-notification',
        context: {
          managerName: data.managerName,
          repositoryName: data.repositoryName,
          organizationName: data.organizationName,
          periodStart: new Date(data.periodStart).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          periodEnd: new Date(data.periodEnd).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }),
          totalCommits: data.metrics.totalCommits,
          issuesFixed: data.metrics.issuesFixed,
          issuesOpened: data.metrics.issuesOpened,
          prsMerged: data.metrics.prsMerged,
          projectUrl: data.projectUrl,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to send project report email: ${error.message}`);
      // Don't throw to prevent disrupting the report generation workflow
    }
  }
}
