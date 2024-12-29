import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PullRequestController } from './pullRequest.controller';
import { PullRequestService } from './pullRequest.service';

@Module({
  imports: [PrismaModule],
  controllers: [PullRequestController],
  providers: [PullRequestService],
  exports: [PullRequestService],
})
export class PullRequestModule {}
