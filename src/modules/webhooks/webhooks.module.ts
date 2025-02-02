import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { CodeOverviewModule } from '../codeOverview/codeOverview.module';
import { CommentModule } from '../comment/comment.module';
import { ExecutiveReportModule } from '../executiveReport/executiveReport.module';
import { PullRequestModule } from '../pullRequest/pullRequest.module';
import { RepositoryModule } from '../repository/repository.module';
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
  ],
  providers: [WebhooksService],
  controllers: [WebhooksController],
  exports: [WebhooksService],
})
export class WebhooksModule {}
