import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingService } from 'src/modules/billing/billing.service';

@Injectable()
export class BillingCronService {
  constructor(private _billingService: BillingService) {}
  @Cron(CronExpression.EVERY_DAY_AT_4PM) // Or you can pass a custom cron expression like "0 0 * * *"
  async trackPrs() {
    console.log('Cron job is running every day 4pm!');
    // Your custom logic here
    await this._billingService.runDailySubscriptionCheck();
  }
}
