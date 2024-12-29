import { Module } from '@nestjs/common';
import { MailModule } from 'src/mail/mail.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountModule } from '../account/account.module';
import { VerificationCodeModule } from '../verificationCode/verificationCode.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [VerificationCodeModule, MailModule, PrismaModule, AccountModule],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService],
})
export class UsersModule {}
