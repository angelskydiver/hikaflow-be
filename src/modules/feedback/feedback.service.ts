import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FeedbackService {
  constructor(private _prismaService: PrismaService) {}

  /**
   * Collect ignore feedback for AI parameter improvement
   * This data will be used by weekly cron job to update prompts
   * Note: The feedback is already stored in the Comment table when ignoreComment is called
   */
  async collectIgnoreFeedback(data: {
    commentId: string;
    issue: string;
    issueCategory: string;
    reason: string;
    repositoryId: string;
    organizationId: string;
  }) {
    try {
      // The feedback is already stored in the Comment table via ignoreComment
      // This method is kept for consistency but the actual data is in Comment.isIgnored and Comment.ignoreReason
      console.log('Ignore feedback collected:', data);
      return { success: true };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Get ignore feedback for weekly cron job
   * Gets ignored comments from the Comment table
   */
  async getIgnoreFeedbackForAnalysis(
    organizationId: string,
    daysBack: number = 1,
  ) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      // Get ignored comments from the Comment table
      const feedback = await this._prismaService.comment.findMany({
        where: {
          isIgnored: true,
          ignoreReason: {
            not: null,
          },
          repository: {
            organizationId: organizationId,
          },
          createdAt: {
            gte: startDate,
          },
        },
        include: {
          repository: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return feedback;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Disable a specific analysis rule in repository settings
   */
  async disableAnalysisRule(data: { repositoryId: string; issue: string }) {
    try {
      // Find the repository setting for this issue
      const setting = await this._prismaService.repositorySettings.findFirst({
        where: {
          repositoryId: data.repositoryId,
          key: data.issue,
        },
      });

      if (!setting) {
        throw new BadRequestException('Analysis rule not found');
      }

      // Disable the setting
      await this._prismaService.repositorySettings.update({
        where: {
          id: setting.id,
        },
        data: {
          active: false,
        },
      });

      return { success: true };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Enable a previously disabled analysis rule
   */
  async enableAnalysisRule(data: { repositoryId: string; issue: string }) {
    try {
      const setting = await this._prismaService.repositorySettings.findFirst({
        where: {
          repositoryId: data.repositoryId,
          key: data.issue,
        },
      });

      if (!setting) {
        throw new BadRequestException('Analysis rule not found');
      }

      await this._prismaService.repositorySettings.update({
        where: {
          id: setting.id,
        },
        data: {
          active: true,
        },
      });

      return { success: true };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
