import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { BillingModule } from '../billing/billing.module';
import { CommitSummaryController } from './commitSummary.controller';
import { CommitSummaryService } from './commitSummary.service';

@Module({
  imports: [PrismaModule, BillingModule, AccountCredentialModule],
  providers: [CommitSummaryService],
  controllers: [CommitSummaryController],
  exports: [CommitSummaryService],
})
export class CommitSummaryModule {}
