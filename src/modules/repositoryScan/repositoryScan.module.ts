import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { BillingModule } from '../billing/billing.module';
import { CommentModule } from '../comment/comment.module';
import { RepositoryScanController } from './repositoryScan.controller';
import { RepositoryScanService } from './repositoryScan.service';

@Module({
  imports: [
    PrismaModule,
    CommentModule,
    AccountCredentialModule,
    BillingModule,
  ],
  controllers: [RepositoryScanController],
  providers: [RepositoryScanService],
  exports: [RepositoryScanService],
})
export class RepositoryScanModule {}
