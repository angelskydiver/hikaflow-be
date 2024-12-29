import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { VerificationCodeController } from './verificationCode.controller';
import { VerificationCodeService } from './verificationCode.service';

@Module({
  imports: [PrismaModule],
  exports: [VerificationCodeService],
  controllers: [VerificationCodeController],
  providers: [VerificationCodeService],
})
export class VerificationCodeModule {}
