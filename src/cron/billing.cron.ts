import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { BillingService } from 'src/modules/billing/billing.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BillingCronService {
  private readonly logger = new Logger(BillingCronService.name);
  private readonly lockQueue: Queue;
  private readonly lockKey = 'billing:cron:processQueuedSubscriptions:lock';
  private readonly lockTtl = 3600; // 1 hour in seconds

  constructor(
    private _billingService: BillingService,
    private _prismaService: PrismaService,
    private _configService: ConfigService,
  ) {
    // Initialize Redis connection for distributed locking using Queue
    this.lockQueue = new Queue('billing-lock', {
      connection: {
        host: this._configService.get<string>('REDIS_HOST') || '127.0.0.1',
        port: Number(this._configService.get<number>('REDIS_PORT')) || 6379,
      },
    });
  }

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
   * Uses distributed locking to prevent concurrent execution across multiple instances
   */
  @Cron(CronExpression.EVERY_HOUR)
  async processQueuedSubscriptions() {
    // Try to acquire distributed lock
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      this.logger.warn(
        'Could not acquire lock for processQueuedSubscriptions. Another instance may be processing.',
      );
      return;
    }

    try {
      this.logger.log('Processing queued subscriptions...');

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
    } finally {
      // Always release the lock
      await this.releaseLock();
    }
  }

  /**
   * Acquire distributed lock using Redis SETNX
   * @returns true if lock acquired, false otherwise
   */
  private async acquireLock(): Promise<boolean> {
    try {
      const redis = await this.lockQueue.client;
      if (!redis) {
        this.logger.warn('Redis client not available, proceeding without lock');
        return true;
      }
      const result = await redis.set(
        this.lockKey,
        'locked',
        'EX',
        this.lockTtl,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      this.logger.error('Error acquiring lock:', error);
      // If Redis fails, allow execution to proceed (fail-open)
      return true;
    }
  }

  /**
   * Release distributed lock
   */
  private async releaseLock(): Promise<void> {
    try {
      const redis = await this.lockQueue.client;
      if (redis) {
        await redis.del(this.lockKey);
      }
    } catch (error) {
      this.logger.error('Error releasing lock:', error);
    }
  }
}
