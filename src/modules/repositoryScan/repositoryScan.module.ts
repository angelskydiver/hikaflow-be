import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { BillingModule } from '../billing/billing.module';
import { CommentModule } from '../comment/comment.module';
import { QueryParserService } from './queryParser.service';
import { RepositoryAnalysisService } from './repositoryAnalysis.service';
import { RepositoryAnalysisV2Service } from './repositoryAnalysisV2.service';
import { RepositoryScanController } from './repositoryScan.controller';
import { RepositoryScanService } from './repositoryScan.service';
import { SafeQueryExecutorService } from './safeQueryExecutor.service';
import { SeniorEngineerAnalysisService } from './seniorEngineerAnalysis.service';

@Module({
  imports: [
    PrismaModule,
    CommentModule,
    AccountCredentialModule,
    BillingModule,
  ],
  controllers: [RepositoryScanController],
  providers: [
    RepositoryScanService,
    RepositoryAnalysisService,
    SeniorEngineerAnalysisService,
    QueryParserService,
    SafeQueryExecutorService,
    RepositoryAnalysisV2Service,
  ],
  exports: [RepositoryScanService],
})
export class RepositoryScanModule {}
