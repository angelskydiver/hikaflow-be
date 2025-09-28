import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as handlebars from 'handlebars';
import { join } from 'path';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MailService } from './mail.service';

// Register Handlebars helpers
handlebars.registerHelper('eq', function (arg1, arg2) {
  return arg1 === arg2;
});

@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: async (config: ConfigService) => ({
        transport: {
          host: config.get('MAILER_HOST'),
          secure: false,
          auth: {
            user: config.get('MAILER_USER_EMAIL'),
            pass: config.get('MAILER_USER_PASSWORD'),
          },
        },
        defaults: {
          from: `"No Reply" <${config.get('MAILER_USER_EMAIL')}>`, // Use MAILER_USER_EMAIL here
        },
        template: {
          dir: join(process.cwd(), 'src', 'mail', 'templates'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
