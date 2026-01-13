import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeWebhookController } from './billing.webhook.controller';
import { FeatureAccessService } from './feature-access.service';

@Module({
  imports: [ConfigModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService, FeatureAccessService, PrismaService],
  exports: [BillingService, FeatureAccessService],
})
export class BillingModule {}
