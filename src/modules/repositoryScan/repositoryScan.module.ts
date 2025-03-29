import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialModule } from '../accountCredentials/accountCredentials.module';
import { CommentModule } from '../comment/comment.module';
import { RepositoryScanController } from './repositoryScan.controller';
import { RepositoryScanService } from './repositoryScan.service';

@Module({
  imports: [PrismaModule, AccountCredentialModule, CommentModule],
  controllers: [RepositoryScanController],
  providers: [RepositoryScanService],
  exports: [RepositoryScanService],
})
export class RepositoryScanModule {}
