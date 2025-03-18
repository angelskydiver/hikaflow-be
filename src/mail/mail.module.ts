import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: async (config: ConfigService) => ({
        // transport: {
        //   host: config.get('MAILER_HOST'),
        //   port: config.get('MAILER_PORT'), // Add this line
        //   secure: config.get('MAILER_ENCRYPTION') === 'ssl', // true for 465, false for other ports
        //   auth: {
        //     user: config.get('MAILER_USER_EMAIL'),
        //     pass: config.get('MAILER_USER_PASSWORD'),
        //   },
        // },
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
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
