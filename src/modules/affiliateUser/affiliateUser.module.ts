import { Module } from '@nestjs/common';
import { MailModule } from 'src/mail/mail.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { VerificationCodeModule } from '../verificationCode/verificationCode.module';
import { AffiliateUserController } from './affiliateUser.controller';
import { AffiliateUserService } from './affiliateUser.service';

@Module({
  imports: [VerificationCodeModule, MailModule, PrismaModule],
  providers: [AffiliateUserService],
  controllers: [AffiliateUserController],
  exports: [AffiliateUserService],
})
export class AffiliateUserModule {}
