import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';

// import { isEqual, isOrganizer, isCreator } from './template.helper.js';

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
          from: config.get('MAILER_USER_EMAIL'),
        },
        defaults: {
          from: `"No Reply" <${config.get('MAIL_FROM')}>`,
        },

        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter({
            // @ts-ignore
            //   helpers: {
            //     // @ts-ignore
            //     isEqual: isEqual,
            //     isOrganizer: isOrganizer,
            //     isCreator: isCreator,
            // },
          }),
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
