import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { BillingModule } from '../billing/billing.module';
import { CodeOverviewModule } from '../codeOverview/codeOverview.module';
import { CommentModule } from '../comment/comment.module';
import { CommitSummaryModule } from '../commitSummary/commitSummary.module';
import { ExecutiveReportModule } from '../executiveReport/executiveReport.module';
import { ImpactAnalysisModule } from '../impactAnalysis/impact-analysis.module';
import { PrTrackerModule } from '../prTracker/prTracker.module';
import { PullRequestModule } from '../pullRequest/pullRequest.module';
import { RepositoryModule } from '../repository/repository.module';
import { RepositoryScanModule } from '../repositoryScan/repositoryScan.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    PrismaModule,
    PullRequestModule,
    RepositoryModule,
    CommentModule,
    ExecutiveReportModule,
    AccountCredentialModule,
    CodeOverviewModule,
    CommitSummaryModule,
    BillingModule,
    forwardRef(() => PrTrackerModule),
    forwardRef(() => RepositoryScanModule),
    ImpactAnalysisModule,
  ],
  providers: [WebhooksService],
  controllers: [WebhooksController],
  exports: [WebhooksService],
})
export class WebhooksModule {}
