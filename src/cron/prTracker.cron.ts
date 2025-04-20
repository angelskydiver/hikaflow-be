import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrTrackerService } from 'src/modules/prTracker/prTracker.service';

@Injectable()
export class PrTrackerCronService {
  constructor(private _prTrackerService: PrTrackerService) {}
  @Cron('*/10 * * * *') // Or you can pass a custom cron expression like "0 0 * * *"
  async trackPrs() {
    console.log('Cron job is running every 5 minute!');
    // Your custom logic here
    await this._prTrackerService.trackPrs();
  }
}
