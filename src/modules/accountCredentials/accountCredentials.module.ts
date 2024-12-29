import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountCredentialController } from './accountCredentials.controller';
import { AccountCredentialService } from './accountCredentials.service';

@Module({
  imports: [PrismaModule],
  controllers: [AccountCredentialController],
  providers: [AccountCredentialService],
  exports: [AccountCredentialService],
})
export class AccountCredentialModule {}
