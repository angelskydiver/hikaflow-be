import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PrTrackerController } from './prTracker.controller';
import { PrTrackerService } from './prTracker.service';

@Module({
  imports: [PrismaModule, forwardRef(() => WebhooksModule)],
  providers: [PrTrackerService],
  controllers: [PrTrackerController],
  exports: [PrTrackerService],
})
export class PrTrackerModule {}
