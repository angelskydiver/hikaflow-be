import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CommitSummaryService } from './commitSummary.service';

@Module({
  imports: [PrismaModule],
  providers: [CommitSummaryService],
  controllers: [],
  exports: [CommitSummaryService],
})
export class CommitSummaryModule {}
