import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { BillingModule } from '../billing/billing.module';
import { RepositoryController } from './repository.controller';
import { RepositoryService } from './repository.service';

@Module({
  imports: [AccountCredentialModule, BillingModule, PrismaModule],
  providers: [RepositoryService],
  controllers: [RepositoryController],
  exports: [RepositoryService],
})
export class RepositoryModule {}
