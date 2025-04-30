import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import Stripe from 'stripe';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private stripe: Stripe;

  constructor(
    private readonly _prismaService: PrismaService,
    private readonly _configService: ConfigService,
  ) {
    this.stripe = new Stripe(
      this._configService.get<string>('STRIPE_SECRET_KEY'),
      {
        apiVersion: '2023-10-16',
      },
    );
  }

  @Post()
  async handleStripeWebhook(
    @Body() payload: any,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    try {
      // Verify and construct the webhook event
      const event = this.stripe.webhooks.constructEvent(
        JSON.stringify(payload),
        signature,
        this._configService.get<string>('STRIPE_WEBHOOK_SECRET'),
      );

      // Handle the event based on its type
      switch (event.type) {
        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      console.error('Error processing webhook:', error);
      throw new BadRequestException(`Webhook Error: ${error.message}`);
    }
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    // Find the invoice in our database using the Stripe invoice ID
    const dbInvoice = await this._prismaService.invoice.findFirst({
      where: { stripeInvoiceId: invoice.id },
    });

    if (dbInvoice) {
      // Update invoice status to PAID
      await this._prismaService.invoice.update({
        where: { id: dbInvoice.id },
        data: {
          status: InvoiceStatus.PAID,
          paidDate: new Date(),
          stripePaymentIntentId: invoice.payment_intent as string,
        },
      });
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    // Find the invoice in our database using the Stripe invoice ID
    const dbInvoice = await this._prismaService.invoice.findFirst({
      where: { stripeInvoiceId: invoice.id },
    });

    if (dbInvoice) {
      // Update invoice status to FAILED
      await this._prismaService.invoice.update({
        where: { id: dbInvoice.id },
        data: {
          status: InvoiceStatus.FAILED,
        },
      });
    }
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    // Find the subscription in our database
    const dbSubscription = await this._prismaService.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (dbSubscription) {
      // Update subscription data
      await this._prismaService.subscription.update({
        where: { id: dbSubscription.id },
        data: {
          isActive: subscription.status === 'active',
          // Add other fields you want to update
        },
      });
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    // Find the subscription in our database
    const dbSubscription = await this._prismaService.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (dbSubscription) {
      // Update subscription as inactive
      await this._prismaService.subscription.update({
        where: { id: dbSubscription.id },
        data: {
          isActive: false,
          endDate: new Date(),
        },
      });
    }
  }
}
