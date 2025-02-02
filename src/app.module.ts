import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MailModule } from './mail/mail.module';
import { AccountModule } from './modules/account/account.module';
import { AccountCredentialModule } from './modules/accountCredentials/accountCredentials.module';
import { CodeOverviewModule } from './modules/codeOverview/codeOverview.module';
import { CommentModule } from './modules/comment/comment.module';
import { ExecutiveReportModule } from './modules/executiveReport/executiveReport.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PullRequestModule } from './modules/pullRequest/pullRequest.module';
import { RepositoryModule } from './modules/repository/repository.module';
import { UsersModule } from './modules/user/user.module';
import { VerificationCodeModule } from './modules/verificationCode/verificationCode.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { JwtAuthGuard } from './passport/guards/jwt.guard';
import { JwtStrategy } from './passport/strategies/jwt.strategy';
import { LocalStrategy } from './passport/strategies/local.strategy';
import { PrismaModule } from './prisma/prisma.module'; // Import PrismaModule
// import { UsersModule } from './users/users.module'; // Your Users module

@Module({
  imports: [
    ConfigModule.forRoot({
      // load: [setupConfig],
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    MailModule,
    PassportModule,
    PrismaModule, // Register PrismaModule
    UsersModule,
    AccountModule,
    VerificationCodeModule,
    RepositoryModule,
    AccountCredentialModule,
    WebhooksModule,
    PullRequestModule,
    CommentModule,
    ExecutiveReportModule,
    OrganizationModule,
    CodeOverviewModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    LocalStrategy,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
