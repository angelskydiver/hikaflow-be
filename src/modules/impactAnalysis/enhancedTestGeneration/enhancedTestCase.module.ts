import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EnhancedTestCaseService } from './enhancedTestCase.service';
import { FlowAnalyzerService } from './flowAnalyzer.service';
import { QualityMetricsService } from './qualityMetrics.service';
import { EnhancedTestCaseController } from './enhancedTestCase.controller';

@Module({
  imports: [PrismaModule],
  providers: [
    EnhancedTestCaseService,
    FlowAnalyzerService,
    QualityMetricsService,
  ],
  controllers: [EnhancedTestCaseController],
  exports: [
    EnhancedTestCaseService,
    FlowAnalyzerService,
    QualityMetricsService,
  ],
})
export class EnhancedTestCaseModule {}
