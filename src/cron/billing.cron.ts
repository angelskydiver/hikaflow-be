import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from 'src/modules/billing/billing.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BillingCronService {
  private readonly logger = new Logger(BillingCronService.name);

  constructor(
    private _billingService: BillingService,
    private _prismaService: PrismaService,
  ) {}

  // CronExpression.EVERY_DAY_AT_4PM
  @Cron(CronExpression.EVERY_DAY_AT_4PM) // Or you can pass a custom cron expression like "0 0 * * *"
  async trackPrs() {
    this.logger.log('Cron job is running every day 4pm!');
    // Your custom logic here
    await this._billingService.runDailySubscriptionCheck();
  }

  /**
   * Process queued subscriptions for all organizations
   * Runs every hour to check for subscriptions that have ended
   */
  @Cron(CronExpression.EVERY_HOUR)
  async processQueuedSubscriptions() {
    this.logger.log('Processing queued subscriptions...');

    try {
      // Get all organizations with subscriptions that have nextPricingPlanId set
      const organizationsWithQueues =
        await this._prismaService.subscription.findMany({
          where: {
            nextPricingPlanId: { not: null },
            isActive: true,
          },
          select: {
            organizationId: true,
          },
          distinct: ['organizationId'],
        });

      this.logger.log(
        `Found ${organizationsWithQueues.length} organizations with queued subscriptions`,
      );

      let totalProcessed = 0;

      for (const sub of organizationsWithQueues) {
        try {
          const result = await this._billingService.processQueuedSubscriptions(
            sub.organizationId,
          );
          totalProcessed += result.processed || 0;
        } catch (error) {
          this.logger.error(
            `Error processing queued subscriptions for organization ${sub.organizationId}:`,
            error,
          );
        }
      }

      this.logger.log(
        `Successfully processed ${totalProcessed} queued subscriptions`,
      );
    } catch (error) {
      this.logger.error('Error in processQueuedSubscriptions cron:', error);
    }
  }
}
