import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CodeOverviewService } from './codeOverview.service';

@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [CodeOverviewService],
  exports: [CodeOverviewService],
})
export class CodeOverviewModule {}
