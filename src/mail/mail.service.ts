import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MailService {
  constructor(
    private mailerService: MailerService,
    private prismaService: PrismaService,
  ) {}

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

  async updateMeetingStatusEmail(data) {
    await this.mailerService.sendMail({
      to: data.to,
      subject: `Meeting: ${data.title}`,
      // from: '"Support Team" <support@example.com>', // override default from
      template: './meeting-status-updated', // `.hbs` extension is appended automatically
      context: data,
    });
  }

  async addCommentToMeetingEmail(data) {
    await this.mailerService.sendMail({
      to: data.to,
      // from: '"Support Team" <support@example.com>', // override default from
      subject: `Meeting: ${data.title}`,
      template: './meeting-comment', // `.hbs` extension is appended automatically
      context: data,
    });
  }

  async sendMeetingEmail(data) {
    await this.mailerService.sendMail({
      to: data.Email,
      // from: '"Support Team" <support@example.com>', // override default from
      subject: `Meeting: ${data.title}`,
      template: './meeting-created', // `.hbs` extension is appended automatically
      context: data,
    });
  }

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
      await this.mailerService.sendMail({
        to: data.email,
        // from: `${data.authorName} [Hikaflow]`, // override default from
        subject: `[Hikaflow] 🔔New Pull Request Created`,
        template: './pr-created-notification', // `.hbs` extension is appended automatically
        context: {
          // ✏️ filling curly brackets with content
          adminName: data.adminName,
          repositoryName: data.repositoryName,
          authorName: data.authorName,
          prUrl: data.prUrl,
        },
      });
    } catch (error) {
      console.error(error.message);
      throw new Error(error.message);
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
        template: './organization-invitation.hbs', // `.hbs` extension is appended automatically
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
      await this.mailerService.sendMail({
        to: data.email,
        // from: `${data.authorName} [Hikaflow]`, // override default from
        subject: `[Hikaflow] Pull Request Closed`,
        template: './pr-closed-notification', // `.hbs` extension is appended automatically
        context: {
          // ✏️ filling curly brackets with content
          adminName: data.adminName,
          repositoryName: data.repositoryName,
          authorName: data.authorName,
          reportUrl: data.reportUrl,
        },
      });
    } catch (error) {
      console.error(error.message);
      throw new Error(error.message);
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
      console.log('need to send email from here');
      // Get email from accountId
      const account = await this.prismaService.account.findUnique({
        where: { id: data.accountId },
        include: { user: true },
      });

      if (!account || !account.user) {
        throw new Error(`Account not found for ID: ${data.accountId}`);
      }

      const email = account.user.email;
      const prNumber = data.prNumber || 'N/A';

      await this.mailerService.sendMail({
        to: email,
        subject: `[Hikaflow] Regression Testing Report: ${data.repositoryInfo.repositoryName}`,
        template: './regression-testing-notification',
        context: {
          authorName: data.authorName,
          repositoryName: data.repositoryInfo.repositoryName,
          prNumber,
          regressionData: data.regressionData,
        },
      });
    } catch (error) {
      console.error('Error sending regression testing notification:', error);
      // Don't throw the error to prevent disrupting the PR workflow
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
    totalFiles: number;
    issuesFound: number;
    securityIssues: number;
    codeSmells: number;
    topSecurityIssues: Array<{
      severity: string;
      title: string;
      description: string;
    }>;
    topCodeIssues: Array<{
      severity: string;
      title: string;
      description: string;
    }>;
    reportUrl: string;
  }) {
    try {
      await this.mailerService.sendMail({
        to: data.email,
        subject: 'Repository Scan Complete',
        template: 'repository-scan-complete',
        context: {
          adminName: data.adminName,
          repositoryName: data.repositoryName,
          totalFiles: data.totalFiles,
          issuesFound: data.issuesFound,
          securityIssues: data.securityIssues,
          codeSmells: data.codeSmells,
          topSecurityIssues: data.topSecurityIssues,
          topCodeIssues: data.topCodeIssues,
          reportUrl: data.reportUrl,
        },
      });
    } catch (error) {
      console.error(
        'Error sending repository scan complete notification:',
        error,
      );
      throw error;
    }
  }
}
