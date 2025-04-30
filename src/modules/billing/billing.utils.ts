import { PrismaService } from 'src/prisma/prisma.service';
import { BillingService } from './billing.service';

/**
 * Track usage for PR analysis, assistant questions or other evaluations
 * @param prismaService - PrismaService instance
 * @param billingService - BillingService instance
 * @param organizationId - ID of the organization
 * @param repositoryId - ID of the repository (optional)
 * @param type - Type of usage (PR_ANALYSIS, ASSISTANT_QUESTION, etc.)
 * @param description - Description of the usage
 */
export async function trackUsage(
  prismaService: PrismaService,
  billingService: BillingService,
  organizationId: string,
  repositoryId?: string,
  type = 'EVALUATION',
  description = 'Code evaluation',
): Promise<void> {
  try {
    // Find active subscription for this organization
    const subscription = await prismaService.subscription.findFirst({
      where: {
        organizationId,
        isActive: true,
      },
    });

    if (!subscription) {
      console.warn(
        `No active subscription found for organization ${organizationId}`,
      );
      return;
    }

    // Log usage
    await billingService.createUsageLog({
      subscriptionId: subscription.id,
      organizationId,
      repositoryId,
      type,
      description,
    });

    console.log(
      `Usage tracked for organization ${organizationId}, type: ${type}`,
    );
  } catch (error) {
    console.error('Failed to track usage:', error);
    // Don't throw to prevent disrupting the main flow
  }
}
