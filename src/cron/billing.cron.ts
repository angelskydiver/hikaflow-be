import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingService } from 'src/modules/billing/billing.service';

@Injectable()
export class BillingCronService {
  constructor(private _billingService: BillingService) {}
  @Cron('*/2 * * * *') // Or you can pass a custom cron expression like "0 0 * * *"
  async trackPrs() {
    console.log('Cron job is running every 5 minute!');
    // Your custom logic here
    await this._billingService.runDailySubscriptionCheck();
  }
}
