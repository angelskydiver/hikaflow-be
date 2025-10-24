import { Controller, Get } from '@nestjs/common';
import { Public } from 'src/decorators/public';
import { PrTrackerService } from './prTracker.service';

@Controller('pr-tracker')
export class PrTrackerController {
  constructor(private _prTrackerService: PrTrackerService) {}

  @Public()
  @Get('track-prs')
  async trackPrs() {
    return await this._prTrackerService.trackPrs();
  }
}
