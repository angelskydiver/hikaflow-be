import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CommitSummaryController } from './commitSummary.controller';
import { CommitSummaryService } from './commitSummary.service';

@Module({
  imports: [PrismaModule],
  providers: [CommitSummaryService],
  controllers: [CommitSummaryController],
  exports: [CommitSummaryService],
})
export class CommitSummaryModule {}
