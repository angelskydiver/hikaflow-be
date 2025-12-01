import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { CallsiteDetectorService } from './callsite-detector.service';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { ImpactAnalysisService } from './impact-analysis.service';
import { ImpactClassifierService } from './impact-classifier.service';
import { RemoteCodeSearchService } from './remote-code-search.service';

@Module({
  imports: [PrismaModule, AccountCredentialModule],
  providers: [
    ImpactAnalysisService,
    CallsiteDetectorService,
    DependencyAnalyzerService,
    ImpactClassifierService,
    RemoteCodeSearchService,
  ],
  exports: [
    ImpactAnalysisService,
    CallsiteDetectorService,
    DependencyAnalyzerService,
    ImpactClassifierService,
    RemoteCodeSearchService,
  ],
})
export class ImpactAnalysisModule {}
