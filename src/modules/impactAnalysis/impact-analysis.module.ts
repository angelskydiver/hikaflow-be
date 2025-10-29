import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CallsiteDetectorService } from './callsite-detector.service';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { ImpactAnalysisService } from './impact-analysis.service';
import { ImpactClassifierService } from './impact-classifier.service';

@Module({
  imports: [PrismaModule],
  providers: [
    ImpactAnalysisService,
    CallsiteDetectorService,
    DependencyAnalyzerService,
    ImpactClassifierService,
  ],
  exports: [
    ImpactAnalysisService,
    CallsiteDetectorService,
    DependencyAnalyzerService,
    ImpactClassifierService,
  ],
})
export class ImpactAnalysisModule {}
