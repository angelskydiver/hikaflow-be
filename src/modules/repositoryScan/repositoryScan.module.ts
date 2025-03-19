import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { RepositoryScanController } from './repositoryScan.controller';
import { RepositoryScanService } from './repositoryScan.service';

@Module({
  imports: [PrismaModule, AccountCredentialModule],
  controllers: [RepositoryScanController],
  providers: [RepositoryScanService],
  exports: [RepositoryScanService],
})
export class RepositoryScanModule {}
