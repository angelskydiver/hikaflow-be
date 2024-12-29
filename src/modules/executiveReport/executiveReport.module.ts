import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ExecutiveReportController } from './executiveReport.controller';
import { ExecutiveReportService } from './executiveReport.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExecutiveReportController],
  providers: [ExecutiveReportService],
  exports: [ExecutiveReportService],
})
export class ExecutiveReportModule {}
