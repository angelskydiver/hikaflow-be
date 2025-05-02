import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, SubscriptionPlanType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import Stripe from 'stripe';
import {
  CreatePricingPlanDto,
  CreateSubscriptionDto,
  CreateUsageLogDto,
  GenerateInvoiceDto,
  PayInvoiceDto,
  UpdatePricingPlanDto,
  UpdateSubscriptionDto,
} from './dto/billing.request.dto';
import {
  IGenerateInvoiceOptions,
  IInvoice,
  IInvoiceGenerationResult,
  IMonthlyUsageReport,
  IPricingPlan,
  ISubscription,
  IUsageLog,
} from './interfaces/billing.interface';

@Injectable()
export class BillingService {
  private stripe: Stripe;

  constructor(
    private readonly _prismaService: PrismaService,
    private readonly _configService: ConfigService,
  ) {
    // Initialize Stripe with your secret key
    this.stripe = new Stripe(
      this._configService.get<string>('STRIPE_SECRET_KEY'),
      {
        apiVersion: '2023-10-16', // Use the latest API version
      },
    );
  }

  // ================== PRICING PLAN METHODS ==================

  async createPricingPlan(data: CreatePricingPlanDto): Promise<IPricingPlan> {
    try {
      const {
        name,
        planType,
        basePrice,
        evaluationPrice,
        active = true,
      } = data;

      // Create a product in Stripe
      // const stripeProduct = await this.stripe.products.create({
      //   name,
      //   description: `${name} Plan - $${basePrice}/project + $${evaluationPrice}/evaluation`,
      //   active,
      // });

      // // Create a price in Stripe (base price is per project)
      // const stripePrice = await this.stripe.prices.create({
      //   unit_amount: Math.round(basePrice * 100), // Convert to cents
      //   currency: 'usd',
      //   product: stripeProduct.id,
      //   recurring: {
      //     interval: 'month',
      //   },
      // });

      // Save to database
      return this._prismaService.pricingPlan.create({
        data: {
          name,
          planType,
          basePrice,
          evaluationPrice,
          active,
          stripeProductId: '',
          stripePriceId: '',
        },
      });
    } catch (error) {
      console.error('Error creating pricing plan:', error);
      throw new BadRequestException(error.message);
    }
  }

  async getAllPricingPlans(): Promise<IPricingPlan[]> {
    return this._prismaService.pricingPlan.findMany({
      where: { active: true, basePrice: { gt: 0 } },
      orderBy: { basePrice: 'asc' },
    });
  }

  async getPricingPlanById(planId: string): Promise<IPricingPlan> {
    const plan = await this._prismaService.pricingPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException('Pricing plan not found');
    }

    return plan;
  }

  async updatePricingPlan(
    planId: string,
    data: UpdatePricingPlanDto,
  ): Promise<IPricingPlan> {
    try {
      const plan = await this.getPricingPlanById(planId);

      // Update Stripe product if needed
      if (data.name || typeof data.active !== 'undefined') {
        await this.stripe.products.update(plan.stripeProductId, {
          name: data.name || plan.name,
          active:
            typeof data.active !== 'undefined' ? data.active : plan.active,
        });
      }

      // If base price changed, create a new price in Stripe (prices can't be updated)
      if (data.basePrice && data.basePrice !== plan.basePrice) {
        const stripePrice = await this.stripe.prices.create({
          unit_amount: Math.round(data.basePrice * 100), // Convert to cents
          currency: 'usd',
          product: plan.stripeProductId,
          recurring: {
            interval: 'month',
          },
        });

        // Deactivate old price
        await this.stripe.prices.update(plan.stripePriceId, { active: false });

        // Update with new price ID
        data['stripePriceId'] = stripePrice.id;
      }

      return this._prismaService.pricingPlan.update({
        where: { id: planId },
        data,
      });
    } catch (error) {
      console.error('Error updating pricing plan:', error);
      throw new BadRequestException(error.message);
    }
  }

  // ================== SUBSCRIPTION METHODS ==================

  async createTrialSubscription(
    organizationId: string,
  ): Promise<ISubscription> {
    try {
      // Find the TRIAL plan to use for trials
      const trialPlan = await this._prismaService.pricingPlan.findFirst({
        where: { planType: SubscriptionPlanType.TRIAL },
      });

      if (!trialPlan) {
        throw new Error('Trial pricing plan not found');
      }

      // Get the organization
      const organization = await this._prismaService.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Create Stripe customer
      const customer = await this.stripe.customers.create({
        name: organization.name,
        metadata: {
          organizationId,
        },
      });

      // Trial period is 15 days from now
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 15);

      // Create subscription in database (without Stripe subscription - only customer)
      return this._prismaService.subscription.create({
        data: {
          organizationId,
          pricingPlanId: trialPlan.id,
          stripeCustomerId: customer.id,
          // No stripeSubscriptionId needed for trial
          startDate: new Date(),
          endDate: trialEndDate, // Trial ends in 15 days
          isActive: true,
        },
      });
    } catch (error) {
      console.error('Error creating trial subscription:', error);
      throw new BadRequestException(error.message);
    }
  }

  async createSubscription(
    data: CreateSubscriptionDto,
  ): Promise<ISubscription> {
    try {
      const {
        organizationId,
        pricingPlanId,
        customBasePrice,
        customEvalPrice,
      } = data;

      // Get the organization
      const organization = await this._prismaService.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Get the pricing plan
      const pricingPlan = await this.getPricingPlanById(pricingPlanId);

      // Check if this is a custom plan
      if (pricingPlan.planType === SubscriptionPlanType.CUSTOM) {
        if (!customBasePrice || !customEvalPrice) {
          throw new BadRequestException(
            'Custom pricing requires customBasePrice and customEvalPrice',
          );
        }
      }

      // Create or get Stripe customer
      let stripeCustomerId: string;
      const organizationsCustomerId = (
        await this._prismaService.subscription.findFirst({
          where: { organizationId },
          select: {
            stripeCustomerId: true,
          },
        })
      )?.stripeCustomerId;
      const existingSubscription =
        await this._prismaService.subscription.findFirst({
          where: { organizationId, isActive: true },
        });

      if (organizationsCustomerId) {
        stripeCustomerId = organizationsCustomerId;
      } else {
        // Create new customer in Stripe
        const customer = await this.stripe.customers.create({
          name: organization.name,
          metadata: {
            organizationId,
          },
        });
        stripeCustomerId = customer.id;
      }

      // For our usage-based billing model, we don't strictly need a Stripe subscription
      // The Stripe Customer is all we need for invoicing
      const stripeSubscriptionId = null;

      // However, if you want to track the subscription in Stripe for reporting purposes,
      // you can optionally create a Stripe subscription (commented out by default)
      /*
      const stripeSubscription = await this.stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [
          {
            price: pricingPlan.stripePriceId,
          },
        ],
        metadata: {
          organizationId,
          pricingPlanId,
          planType: pricingPlan.planType.toString(),
          basePrice: pricingPlan.basePrice.toString(),
          evaluationPrice: pricingPlan.evaluationPrice.toString(),
          customBasePrice: customBasePrice?.toString() || '',
          customEvalPrice: customEvalPrice?.toString() || '',
        },
      });
      stripeSubscriptionId = stripeSubscription.id;
      */

      // Deactivate any existing subscriptions for this organization
      if (existingSubscription) {
        await this._prismaService.subscription.update({
          where: { id: existingSubscription.id },
          data: { isActive: false, endDate: new Date() },
        });

        // Also cancel in Stripe if exists
        if (existingSubscription.stripeSubscriptionId) {
          await this.stripe.subscriptions.cancel(
            existingSubscription.stripeSubscriptionId,
          );
        }
      }

      const subscriptionEndDate = new Date();
      subscriptionEndDate.setDate(subscriptionEndDate.getDate() + 30);

      // Create subscription in database
      return this._prismaService.subscription.create({
        data: {
          organizationId,
          pricingPlanId,
          stripeCustomerId,
          stripeSubscriptionId, // Will be null by default
          startDate: new Date(),
          endDate: subscriptionEndDate,
          isActive: true,
          customBasePrice,
          customEvalPrice,
        },
      });
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw new BadRequestException(error.message);
    }
  }

  async getSubscriptionByOrganizationId(
    organizationId: string,
  ): Promise<ISubscription> {
    const subscription = await this._prismaService.subscription.findFirst({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        pricingPlan: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!subscription) {
      throw new NotFoundException(
        'No active subscription found for this organization',
      );
    }

    return subscription;
  }

  async updateSubscription(
    subscriptionId: string,
    data: UpdateSubscriptionDto,
  ): Promise<ISubscription> {
    try {
      const subscription = await this._prismaService.subscription.findUnique({
        where: { id: subscriptionId },
        include: { pricingPlan: true },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      // Only process final invoice for plan changes, and only for non-TRIAL plans
      if (
        data.pricingPlanId &&
        data.pricingPlanId !== subscription.pricingPlanId &&
        subscription.pricingPlan.planType !== SubscriptionPlanType.TRIAL
      ) {
        try {
          // Generate a final invoice for the current subscription period
          console.log(
            `Generating final invoice for subscription ${subscriptionId} before plan change`,
          );

          // Calculate the exact number of days the current subscription has been active
          const today = new Date();
          const startDate = subscription.startDate;
          const daysActive = Math.ceil(
            (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
          );

          console.log(
            `Subscription was active for ${daysActive} days before change`,
          );

          await this.generateInvoice({
            organizationId: subscription.organizationId,
            fromDate: subscription.startDate.toISOString(),
            toDate: today.toISOString(), // Invoice up to current date
            isForSubscriptionUpdate: true,
          });

          // After generating the invoice, we can set up the new subscription period
          const newStartDate = today;
          const newEndDate = new Date(today);
          newEndDate.setDate(today.getDate() + 30); // 30 days from now

          // Add new dates to the update data
          data = {
            ...data,
            startDate: newStartDate,
            endDate: newEndDate,
          };
        } catch (invoiceError) {
          console.error(
            'Error generating final invoice for old subscription:',
            invoiceError.message,
          );
          // Continue with subscription update even if invoicing fails
        }
      }

      // Handle subscription cancellation
      if (data.isActive === false && subscription.isActive) {
        // Add endDate to the data object
        const updateData = {
          ...data,
          endDate: new Date(),
        };

        return this._prismaService.subscription.update({
          where: { id: subscriptionId },
          data: updateData,
        });
      }

      console.log('check post 08: ', data);

      return this._prismaService.subscription.update({
        where: { id: subscriptionId },
        data,
      });
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw new BadRequestException(error.message);
    }
  }

  // ================== USAGE LOG METHODS ==================

  async createUsageLog(data: CreateUsageLogDto): Promise<IUsageLog> {
    try {
      const {
        subscriptionId,
        organizationId,
        repositoryId,
        type,
        description,
      } = data;

      let activeSubscriptionId = subscriptionId;

      // If no subscriptionId provided, find the active subscription for the organization
      if (!activeSubscriptionId) {
        const activeSubscription =
          await this._prismaService.subscription.findFirst({
            where: {
              organizationId,
              isActive: true,
            },
          });

        if (!activeSubscription) {
          throw new NotFoundException(
            'No active subscription found for this organization',
          );
        }

        activeSubscriptionId = activeSubscription.id;
      } else {
        // Validate subscription exists and is active
        const subscription = await this._prismaService.subscription.findFirst({
          where: {
            id: subscriptionId,
            organizationId,
            isActive: true,
          },
          include: { pricingPlan: true },
        });

        if (!subscription) {
          throw new NotFoundException(
            'No active subscription found with this ID',
          );
        }
      }

      // Create the usage log
      return this._prismaService.usageLog.create({
        data: {
          subscriptionId: activeSubscriptionId,
          organizationId,
          repositoryId,
          type,
          description,
          counted: false,
        },
      });
    } catch (error) {
      console.error('Error creating usage log:', error);
      throw new BadRequestException(error.message);
    }
  }

  async getOrganizationUsageLogs(
    organizationId: string,
    options?: { fromDate?: Date; toDate?: Date },
  ): Promise<IUsageLog[]> {
    const where: any = { organizationId };

    if (options) {
      if (options.fromDate) {
        where.createdAt = { ...(where.createdAt || {}), gte: options.fromDate };
      }
      if (options.toDate) {
        where.createdAt = { ...(where.createdAt || {}), lte: options.toDate };
      }
    }

    return this._prismaService.usageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { repository: true },
    });
  }

  // ================== INVOICE METHODS ==================

  async generateInvoice(
    data: GenerateInvoiceDto,
  ): Promise<IInvoice | IInvoiceGenerationResult> {
    try {
      const options: IGenerateInvoiceOptions = {
        organizationId: data.organizationId,
      };

      console.log('check post 01: ', data.fromDate, !data.toDate);

      // Set default date range to the current month if not provided
      if (!data.fromDate && !data.toDate) {
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDayOfMonth = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        );

        options.fromDate = firstDayOfMonth;
        options.toDate = lastDayOfMonth;
      } else {
        if (data.fromDate) options.fromDate = new Date(data.fromDate);
        if (data.toDate) options.toDate = new Date(data.toDate);
      }
      console.log('check post 02: ', options.fromDate, options.toDate);

      // Flag to indicate if this is for a subscription update
      const isForSubscriptionUpdate = data.isForSubscriptionUpdate || false;
      if (isForSubscriptionUpdate) {
        console.log(
          'Generating invoice for subscription update - prorating repositories',
        );
      }

      // Calculate the total days in the billing period
      // const totalDaysInPeriod = Math.ceil(
      //   (options.toDate.getTime() - options.fromDate.getTime()) /
      //     (1000 * 60 * 60 * 24),
      // );

      const totalDaysInPeriod = 30;

      console.log(`Total days in billing period: ${totalDaysInPeriod}`);

      // Get active subscription
      const subscription = await this.getSubscriptionByOrganizationId(
        data.organizationId,
      );

      // Skip invoicing for TRIAL plans since they're free, but return a message instead of throwing an error
      if (subscription.pricingPlan.planType === SubscriptionPlanType.TRIAL) {
        return {
          message: 'Trial plans are free and not invoiced',
          success: false,
        };
      }

      console.log('check post 03');

      // Get uncounted usage logs
      const usageLogs = await this._prismaService.usageLog.findMany({
        where: {
          organizationId: data.organizationId,
          subscriptionId: subscription.id,
          counted: false,
          ...(options.fromDate && { createdAt: { gte: options.fromDate } }),
          ...(options.toDate && { createdAt: { lte: options.toDate } }),
        },
      });

      // Get all repositories for this organization with their creation dates
      const organizationRepositories =
        await this._prismaService.repository.findMany({
          where: {
            organizationId: data.organizationId,
          },
          select: {
            id: true,
            name: true,
            createdAt: true,
          },
        });

      console.log('check post 04');

      // Skip invoicing if there are no repositories and no usage logs
      if (organizationRepositories.length === 0 && usageLogs.length === 0) {
        return {
          message: 'No repositories or usage logs to generate invoice',
          success: false,
        };
      }

      // Calculate prorated amounts for each repository - AT INVOICE CREATION TIME
      let totalRepositoryAmount = 0;
      const repositoryLineItems = [];

      // Calculate amounts based on pricing plan - use CURRENT pricing
      const planType = subscription.pricingPlan.planType;
      let basePrice: number, evalPrice: number;

      if (planType === SubscriptionPlanType.CUSTOM) {
        basePrice = subscription.customBasePrice;
        evalPrice = subscription.customEvalPrice;
      } else {
        basePrice = subscription.pricingPlan.basePrice;
        evalPrice = subscription.pricingPlan.evaluationPrice;
      }

      console.log('check post 05');

      // Process each repository to calculate prorated costs
      for (const repo of organizationRepositories) {
        // When we're called from updateSubscription, we're explicitly calculating
        // for the exact period from subscription start to today

        // For normal billing, determine when the repository was connected during the billing period
        const repoStartDate = new Date(
          Math.max(repo.createdAt.getTime(), options.fromDate.getTime()),
        );

        // Calculate how many days the repository was connected in this period
        let daysConnected;
        if (isForSubscriptionUpdate) {
          daysConnected = Math.ceil(
            (options.toDate.getTime() - options.fromDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
        } else {
          daysConnected = Math.ceil(
            (options.toDate.getTime() - repoStartDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
        }

        // Ensure we don't have negative days or zero days (minimum 1 day)
        const effectiveDaysConnected = Math.max(
          1,
          Math.min(daysConnected, totalDaysInPeriod),
        );

        console.log(
          `Repository ${repo.name} connected for ${effectiveDaysConnected}/${totalDaysInPeriod} days`,
        );

        // Calculate prorated amount - if connected for full period, charge full amount
        const proratedFactor = effectiveDaysConnected / totalDaysInPeriod;
        const proratedAmount = basePrice * proratedFactor;

        console.log(
          `Repository ${repo.name} prorated amount: $${proratedAmount.toFixed(2)}`,
        );

        // Add to total and create line item
        totalRepositoryAmount += proratedAmount;

        repositoryLineItems.push({
          description: `Repository: ${repo.name} (${effectiveDaysConnected}/${totalDaysInPeriod} days)`,
          quantity: 1,
          unitPrice: proratedAmount,
          amount: proratedAmount,
          type: 'PROJECT',
        });
      }

      // Count evaluations
      const evaluations = usageLogs.length;
      const evaluationsAmount = evaluations * evalPrice;

      // Calculate final amounts AT INVOICE TIME
      const subtotal = totalRepositoryAmount + evaluationsAmount;

      console.log('check post 06: ', subtotal);

      // If total amount is zero, skip creating an invoice
      if (subtotal === 0) {
        return {
          message: 'Total invoice amount is zero',
          success: false,
        };
      }

      // Standard tax rate (e.g., 8.25%)
      // const taxRate = 0.0825;
      const taxRate = 0;
      const tax = subtotal * taxRate;
      const total = subtotal + tax;

      console.log('check post 07');

      // Generate invoice number
      const invoiceNumber = `INV-${Math.floor(Date.now() / 1000)}-${data.organizationId.substring(0, 6)}`;

      // Check if organization has a default payment method on file
      const organization = await this.getOrganizationWithPaymentMethod(
        data.organizationId,
      );

      console.log('check post 08');

      // Create initial invoice in database with PENDING status
      const invoice = await this._prismaService.invoice.create({
        data: {
          subscriptionId: subscription.id,
          invoiceNumber,
          amount: subtotal,
          tax,
          total,
          status: InvoiceStatus.PENDING, // Initially PENDING until payment is processed
          dueDate: new Date(), // Due same day as creation
          stripeInvoiceId: '', // No Stripe invoice involved
          description: `Invoice for ${organizationRepositories.length} projects (prorated) and ${evaluations} evaluations`,
          invoiceItems: {
            create: [
              ...repositoryLineItems,
              ...(evaluations > 0
                ? [
                    {
                      description: `Evaluations (${evaluations})`,
                      quantity: evaluations,
                      unitPrice: evalPrice,
                      amount: evaluationsAmount,
                      type: 'EVALUATION',
                    },
                  ]
                : []),
            ],
          },
        },
      });

      // Mark usage logs as counted and update with invoice ID
      if (usageLogs.length > 0) {
        await this._prismaService.usageLog.updateMany({
          where: { id: { in: usageLogs.map((log) => log.id) } },
          data: { counted: true, invoiceId: invoice.id },
        });
      }

      console.log('organization?.defaultPaymentMethodId:', organization);

      // Try to automatically pay the invoice if payment method is on file
      if (organization?.defaultPaymentMethodId) {
        try {
          return await this.payInvoice(invoice.id, {
            paymentMethodId: organization.defaultPaymentMethodId,
          });
        } catch (error) {
          console.log('Automatic payment failed:', error.message);
          // Return the pending invoice if payment fails
          return invoice;
        }
      }

      return invoice;
    } catch (error) {
      console.error('Error generating invoice:', error);
      throw new BadRequestException(error.message);
    }
  }

  async finalizeInvoice(invoiceId: string): Promise<IInvoice> {
    try {
      const invoice = await this._prismaService.invoice.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException('Only draft invoices can be finalized');
      }

      // Update invoice status without touching Stripe
      return this._prismaService.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.PENDING },
      });
    } catch (error) {
      console.error('Error finalizing invoice:', error);
      throw new BadRequestException(error.message);
    }
  }

  async payInvoice(invoiceId: string, data: PayInvoiceDto): Promise<IInvoice> {
    try {
      console.log(invoiceId, data.paymentMethodId);
      const invoice = await this._prismaService.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          subscription: {
            include: {
              organization: true,
            },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      if (invoice.status === InvoiceStatus.PAID) {
        throw new BadRequestException('Invoice already paid');
      }

      let paymentIntent;
      data.paymentMethodId =
        data.paymentMethodId ||
        invoice.subscription.organization.defaultPaymentMethodId;
      if (data.paymentMethodId) {
        // Create a direct payment intent without using invoices
        paymentIntent = await this.stripe.paymentIntents.create({
          amount: Math.round(invoice.total * 100),
          currency: 'usd',
          customer: invoice.subscription.stripeCustomerId,
          payment_method: data.paymentMethodId,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          description: `Payment for invoice ${invoice.invoiceNumber}`,
          metadata: {
            invoiceId: invoice.id,
          },
        });
      } else {
        throw new BadRequestException('Payment method is required');
      }

      // Update invoice status to PAID
      const paidInvoice = await this._prismaService.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.PAID,
          paidDate: new Date(),
          stripePaymentIntentId:
            typeof paymentIntent === 'string'
              ? paymentIntent
              : paymentIntent.id,
        },
      });

      // Check if subscription was automatically disabled due to pending payment
      // If so, reactivate the subscription
      await this._prismaService.subscription.updateMany({
        where: {
          id: invoice.subscriptionId,
          isActive: false,
          // Only update if there are no other pending invoices
          NOT: {
            invoices: {
              some: {
                id: { not: invoiceId },
                status: InvoiceStatus.PENDING,
                dueDate: { lt: new Date() },
              },
            },
          },
        },
        data: {
          isActive: true,
        },
      });

      return paidInvoice;
    } catch (error) {
      console.error('Error paying invoice:', error);

      // Update invoice status to failed
      await this._prismaService.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.FAILED },
      });

      throw new BadRequestException(error.message);
    }
  }

  async getInvoiceById(invoiceId: string): Promise<IInvoice> {
    const invoice = await this._prismaService.invoice.findUnique({
      where: { id: invoiceId },
      include: { invoiceItems: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  async getOrganizationInvoices(organizationId: string): Promise<IInvoice[]> {
    const subscription =
      await this.getSubscriptionByOrganizationId(organizationId);

    return this._prismaService.invoice.findMany({
      where: { subscriptionId: subscription.id },
      include: { invoiceItems: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ================== SYSTEM INITIALIZATION METHODS ==================

  async initializePricingPlans(): Promise<IPricingPlan[]> {
    try {
      // Check if plans already exist
      const existingPlans = await this._prismaService.pricingPlan.findMany();
      if (existingPlans.length > 0) {
        return existingPlans; // Return properly typed plans
      }

      // Create the default pricing plans
      const plans = [
        {
          name: 'Trial',
          planType: SubscriptionPlanType.TRIAL,
          basePrice: 0, // Free
          evaluationPrice: 0, // Free
        },
        {
          name: 'Basic',
          planType: SubscriptionPlanType.BASIC,
          basePrice: 20, // $20 per project
          evaluationPrice: 0.5, // 50 cents per evaluation
        },
        {
          name: 'Standard',
          planType: SubscriptionPlanType.STANDARD,
          basePrice: 30, // $30 per project
          evaluationPrice: 0.25, // 25 cents per evaluation
        },
        {
          name: 'Premium',
          planType: SubscriptionPlanType.PREMIUM,
          basePrice: 50, // $50 per project
          evaluationPrice: 0.1, // 10 cents per evaluation
        },
      ];

      const createdPlans = [];
      for (const plan of plans) {
        createdPlans.push(await this.createPricingPlan(plan));
      }

      return createdPlans;
    } catch (error) {
      console.error('Error initializing pricing plans:', error);
      throw new BadRequestException(error.message);
    }
  }

  async migrateExistingAccountsToBasicPlan(): Promise<number> {
    try {
      // Find the trial plan
      const trialPlan = await this._prismaService.pricingPlan.findFirst({
        where: { planType: SubscriptionPlanType.TRIAL },
      });

      if (!trialPlan) {
        throw new Error('Trial pricing plan not found');
      }

      // Find all organizations that don't have an active subscription
      const organizations = await this._prismaService.organization.findMany({
        include: {
          subscriptions: {
            where: { isActive: true },
          },
        },
      });

      let migratedCount = 0;

      for (const org of organizations) {
        // Skip if organization already has an active subscription
        if (org.subscriptions.length > 0) continue;

        // Create a trial subscription for the organization
        await this.createTrialSubscription(org.id);
        migratedCount++;
      }

      return migratedCount;
    } catch (error) {
      console.error('Error migrating accounts to trial plan:', error);
      throw new BadRequestException(error.message);
    }
  }

  // ================== USAGE LIMITS METHODS ==================

  async getTrialLimits(subscriptionId: string): Promise<{
    maxProjects: number;
    maxQuestionsPerDay: number;
    projectCount: number;
    questionsToday: number;
    isTrialExpired: boolean;
  }> {
    try {
      // Get the subscription with organization
      const subscription = await this._prismaService.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          pricingPlan: true,
          organization: {
            include: {
              repositories: {
                select: { id: true },
              },
            },
          },
        },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      // Constants for trial accounts
      const TRIAL_MAX_PROJECTS =
        this._configService.get<number>('TRIAL_MAX_PROJECTS');
      const TRIAL_MAX_QUESTIONS_PER_DAY = this._configService.get<number>(
        'TRIAL_MAX_QUESTIONS_PER_DAY',
      );

      // Only TRIAL plans have limits
      const isTrial =
        subscription.pricingPlan.planType === SubscriptionPlanType.TRIAL;

      // Check if this is still in trial period (has endDate and is not past it)
      const isTrialExpired =
        isTrial && subscription.endDate
          ? new Date() > subscription.endDate
          : false;

      // Get question count for today (only needed for trial plans)
      let questionsToday = 0;
      if (isTrial) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        questionsToday = await this._prismaService.assistedQuestions.count({
          where: {
            organizationId: subscription.organizationId,
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        });
      }

      return {
        maxProjects: isTrial ? TRIAL_MAX_PROJECTS : Infinity,
        maxQuestionsPerDay: isTrial ? TRIAL_MAX_QUESTIONS_PER_DAY : Infinity,
        projectCount: subscription.organization.repositories.length,
        questionsToday,
        isTrialExpired,
      };
    } catch (error) {
      console.error('Error getting trial limits:', error);
      throw new BadRequestException(error.message);
    }
  }

  // Method to check if we can add a project to a trial subscription
  async canAddProjectToTrial(organizationId: string): Promise<{
    canAdd: boolean;
    reason?: string;
  }> {
    try {
      // Get active subscription
      const subscription = await this._prismaService.subscription.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          pricingPlan: true,
        },
      });

      if (!subscription) {
        return { canAdd: false, reason: 'No active subscription found' };
      }

      // Only apply limits for TRIAL plans
      if (subscription.pricingPlan.planType !== SubscriptionPlanType.TRIAL) {
        return { canAdd: true }; // No limits for non-trial plans
      }

      // Get the limits
      const limits = await this.getTrialLimits(subscription.id);

      if (limits.isTrialExpired) {
        return { canAdd: false, reason: 'Trial period has expired' };
      }

      if (limits.projectCount >= limits.maxProjects) {
        return {
          canAdd: false,
          reason: `Trial accounts are limited to ${limits.maxProjects} projects`,
        };
      }

      return { canAdd: true };
    } catch (error) {
      console.error('Error checking if can add project to trial:', error);
      throw new BadRequestException(error.message);
    }
  }

  // ================== SUBSCRIPTION STATUS CHECKS ==================

  async checkSubscriptionStatus(organizationId: string): Promise<{
    isActive: boolean;
    hasPendingInvoices: boolean;
    message?: string;
  }> {
    try {
      // Get active subscription
      const subscription = await this._prismaService.subscription.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          pricingPlan: true,
        },
      });

      if (!subscription) {
        return {
          isActive: false,
          hasPendingInvoices: false,
          message: 'No active subscription found for this organization',
        };
      }

      // If subscription has an end date and it's passed
      if (subscription.endDate && new Date() > subscription.endDate) {
        return {
          isActive: false,
          hasPendingInvoices: false,
          message: 'Subscription has expired',
        };
      }

      // Check for pending invoices that are past due
      const pendingOrFailedInvoices =
        await this._prismaService.invoice.findMany({
          where: {
            subscriptionId: subscription.id,
            status: { in: [InvoiceStatus.PENDING, InvoiceStatus.FAILED] },
            dueDate: {
              lt: new Date(), // Past due
            },
          },
        });

      if (pendingOrFailedInvoices.length > 0) {
        return {
          isActive: false,
          hasPendingInvoices: true,
          message: 'Subscription is inactive due to pending payments',
        };
      }

      // All good
      return { isActive: true, hasPendingInvoices: false };
    } catch (error) {
      console.error('Error checking subscription status:', error);
      throw new BadRequestException(error.message);
    }
  }

  // Method to check if PR evaluation is allowed
  async canEvaluatePullRequest(organizationId: string): Promise<{
    allowed: boolean;
    message?: string;
  }> {
    const status = await this.checkSubscriptionStatus(organizationId);

    if (!status.isActive) {
      return {
        allowed: false,
        message: status.message || 'Subscription is not active',
      };
    }

    return { allowed: true };
  }

  async canAskQuestion(organizationId: string): Promise<{
    canAsk: boolean;
    reason?: string;
  }> {
    try {
      // First check overall subscription status
      const status = await this.checkSubscriptionStatus(organizationId);

      if (!status.isActive) {
        return {
          canAsk: false,
          reason: status.message || 'Subscription is not active',
        };
      }

      // Get active subscription for trial limits check
      const subscription = await this._prismaService.subscription.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          pricingPlan: true,
        },
      });

      // Only apply limits for TRIAL plans
      if (subscription.pricingPlan.planType !== SubscriptionPlanType.TRIAL) {
        return { canAsk: true }; // No limits for non-trial plans
      }

      // Get the limits
      const limits = await this.getTrialLimits(subscription.id);

      if (limits.isTrialExpired) {
        return { canAsk: false, reason: 'Trial period has expired' };
      }

      if (limits.questionsToday >= limits.maxQuestionsPerDay) {
        return {
          canAsk: false,
          reason: `Trial accounts are limited to ${limits.maxQuestionsPerDay} questions per day`,
        };
      }

      return { canAsk: true };
    } catch (error) {
      console.error('Error checking if can ask question:', error);
      throw new BadRequestException(error.message);
    }
  }

  // Get organization with payment method information
  async getOrganizationWithPaymentMethod(organizationId: string): Promise<any> {
    try {
      const organization = await this._prismaService.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          defaultPaymentMethodId: true,
          // Using any to bypass TypeScript limitations since defaultPaymentMethodId
          // may be added to the schema but not yet in the generated types
        } as any,
      });

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      return organization;
    } catch (error) {
      console.error('Error getting organization with payment method:', error);
      throw new BadRequestException(error.message);
    }
  }

  // Get organization subscription status
  async getOrganizationSubscriptionStatus(organizationId: string): Promise<{
    isActive: boolean;
    planType?: SubscriptionPlanType;
    expirationDate?: Date;
    message?: string;
  }> {
    try {
      const subscription = await this._prismaService.subscription.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          pricingPlan: true,
        },
      });

      if (!subscription) {
        return {
          isActive: false,
          message: 'No active subscription found',
        };
      }

      // Check if subscription has expired
      if (subscription.endDate && new Date() > subscription.endDate) {
        return {
          isActive: false,
          planType: subscription.pricingPlan.planType,
          expirationDate: subscription.endDate,
          message: 'Subscription has expired',
        };
      }

      // Check for pending invoices that are past due
      const pendingInvoices = await this._prismaService.invoice.findMany({
        where: {
          subscriptionId: subscription.id,
          status: InvoiceStatus.PENDING,
          dueDate: { lt: new Date() }, // Past due
        },
      });

      if (pendingInvoices.length > 0) {
        // If there are past due invoices, mark subscription as inactive
        await this._prismaService.subscription.update({
          where: { id: subscription.id },
          data: { isActive: false },
        });

        return {
          isActive: false,
          planType: subscription.pricingPlan.planType,
          expirationDate: subscription.endDate,
          message: 'Subscription is inactive due to pending invoices',
        };
      }

      // All good - subscription is active
      return {
        isActive: true,
        planType: subscription.pricingPlan.planType,
        expirationDate: subscription.endDate,
      };
    } catch (error) {
      console.error('Error getting organization subscription status:', error);
      throw new BadRequestException(error.message);
    }
  }

  // ================== CRON JOBS ==================

  /**
   * Daily cron job to check subscriptions ending today,
   * generate invoices, and handle subscription renewal.
   * This should be scheduled to run once per day.
   */
  async runDailySubscriptionCheck(): Promise<{
    processed: number;
    invoicesGenerated: number;
    subscriptionsRenewed: number;
  }> {
    try {
      console.log('Starting daily subscription check and invoice generation');

      const today = new Date();
      console.log('Today:', today);
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Find all subscriptions ending today
      const expiredSubscriptions =
        await this._prismaService.subscription.findMany({
          where: {
            endDate: {
              gte: today,
              lt: tomorrow,
            },
            isActive: true,
          },
          include: {
            organization: true,
            pricingPlan: true,
          },
        });

      console.log(
        `Found ${expiredSubscriptions.length} subscriptions ending today`,
      );

      let invoicesGenerated = 0;
      let subscriptionsRenewed = 0;

      // Process each expiring subscription
      for (const subscription of expiredSubscriptions) {
        try {
          // Skip trial plans
          if (
            subscription.pricingPlan.planType === SubscriptionPlanType.TRIAL
          ) {
            await this._prismaService.subscription.update({
              where: { id: subscription.id },
              data: { isActive: false },
            });
            console.log(
              `Skipping invoice generation for trial subscription ${subscription.id}`,
            );
            continue;
          }

          // Generate invoice - this will already attempt payment if payment method exists
          console.log(`Generating invoice for subscription ${subscription.id}`);
          const invoiceResult = await this.generateInvoice({
            organizationId: subscription.organizationId,
            fromDate: subscription.startDate.toISOString(),
            toDate: subscription.endDate
              ? subscription.endDate.toISOString()
              : new Date().toISOString(),
            isForSubscriptionUpdate: false,
          });

          // If invoice was successfully generated
          if ('id' in invoiceResult) {
            invoicesGenerated++;

            // Check if invoice is already paid (payment would have been processed in generateInvoice)
            const invoice = await this._prismaService.invoice.findUnique({
              where: { id: invoiceResult.id },
            });

            if (invoice.status === InvoiceStatus.PAID) {
              // Payment was successful, create new subscription period
              const newEndDate = new Date();
              newEndDate.setDate(newEndDate.getDate() + 30); // 30 days from now

              await this._prismaService.subscription.update({
                where: { id: subscription.id },
                data: {
                  isActive: true,
                  startDate: new Date(), // Today
                  endDate: newEndDate,
                },
              });

              subscriptionsRenewed++;
              console.log(
                `Subscription ${subscription.id} was renewed successfully`,
              );
            } else {
              // Deactivate subscription since payment was not successful
              await this._prismaService.subscription.update({
                where: { id: subscription.id },
                data: { isActive: false },
              });
              console.log(
                `Subscription ${subscription.id} deactivated due to unpaid invoice`,
              );
            }
          }
        } catch (subError) {
          console.error(
            `Error processing subscription ${subscription.id}:`,
            subError.message,
          );
        }
      }

      return {
        processed: expiredSubscriptions.length,
        invoicesGenerated,
        subscriptionsRenewed,
      };
    } catch (error) {
      console.error('Error running daily subscription check:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Monthly cron job to generate invoices for active subscriptions based on usage.
   *
   * This job runs on a monthly basis (typically on the 1st of each month) and generates
   * invoices for all active subscriptions for the previous month's usage. Unlike the daily
   * check which handles subscription renewals, this job specifically focuses on
   * generating invoices for organizations with ongoing subscriptions, capturing all usage
   * for repositories and evaluations from the previous month.
   *
   * It's particularly useful for:
   * 1. Organizations with long-term subscriptions (beyond 30 days)
   * 2. Ensuring all monthly usage is properly billed regardless of subscription renewal dates
   * 3. Creating a predictable monthly billing cycle separate from subscription renewals
   */
  async runMonthlyInvoiceGeneration(): Promise<{
    processed: number;
    invoicesGenerated: number;
  }> {
    try {
      console.log(
        'Starting monthly invoice generation for all active subscriptions',
      );

      // Find all active subscriptions that are not trials
      const activeSubscriptions =
        await this._prismaService.subscription.findMany({
          where: {
            isActive: true,
            pricingPlan: {
              planType: {
                not: SubscriptionPlanType.TRIAL,
              },
            },
          },
          include: {
            organization: true,
          },
        });

      console.log(
        `Found ${activeSubscriptions.length} active non-trial subscriptions`,
      );

      // Calculate date range for previous month
      const today = new Date();
      const firstDayPrevMonth = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1,
      );
      const lastDayPrevMonth = new Date(
        today.getFullYear(),
        today.getMonth(),
        0,
        23,
        59,
        59,
        999,
      );

      let invoicesGenerated = 0;

      // Process each subscription
      for (const subscription of activeSubscriptions) {
        try {
          // Generate invoice for the previous month - this already handles payment attempts
          console.log(
            `Generating monthly invoice for subscription ${subscription.id}`,
          );
          const invoiceResult = await this.generateInvoice({
            organizationId: subscription.organizationId,
            fromDate: firstDayPrevMonth.toISOString(),
            toDate: lastDayPrevMonth.toISOString(),
            isForSubscriptionUpdate: false,
          });

          // If invoice was successfully generated
          if ('id' in invoiceResult) {
            invoicesGenerated++;
            console.log(
              `Invoice generated for subscription ${subscription.id}`,
            );
          } else {
            console.log(
              `No invoice generated for subscription ${subscription.id}: ${invoiceResult.message}`,
            );
          }
        } catch (subError) {
          console.error(
            `Error processing subscription ${subscription.id}:`,
            subError.message,
          );
        }
      }

      return {
        processed: activeSubscriptions.length,
        invoicesGenerated,
      };
    } catch (error) {
      console.error('Error running monthly invoice generation:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Saves a payment method to an organization for future automatic payments
   */
  async saveOrganizationPaymentMethod(
    organizationId: string,
    paymentMethodId: string,
  ): Promise<any> {
    try {
      // Get the organization
      const organization = await this._prismaService.organization.findUnique({
        where: { id: organizationId },
        include: {
          subscriptions: {
            where: { isActive: true },
            take: 1,
          },
        },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Get the Stripe customer ID from the active subscription
      let stripeCustomerId: string;

      if (organization.subscriptions && organization.subscriptions.length > 0) {
        stripeCustomerId = organization.subscriptions[0].stripeCustomerId;
      } else {
        // If no active subscription, create a customer in Stripe
        const customer = await this.stripe.customers.create({
          name: organization.name,
          metadata: {
            organizationId,
          },
        });
        stripeCustomerId = customer.id;
      }

      // Attach the payment method to the Stripe customer
      await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: stripeCustomerId,
      });

      // Validate card has minimum $5 USD
      try {
        const paymentIntent = await this.stripe.paymentIntents.create({
          amount: 500, // $5 USD in cents
          currency: 'usd',
          payment_method: paymentMethodId,
          customer: stripeCustomerId,
          confirm: true,
          capture_method: 'manual', // Don't actually capture the payment
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
        });

        // Cancel the test payment intent
        await this.stripe.paymentIntents.cancel(paymentIntent.id);
      } catch (error) {
        if (error.type === 'StripeCardError') {
          throw new BadRequestException(
            'Card validation failed. Please ensure your card has at least $5 USD available.',
          );
        }
        throw new BadRequestException(error.message);
      }

      // Set as default payment method for the customer
      await this.stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });

      // Save payment method ID to organization
      await this._prismaService.organization.update({
        where: { id: organizationId },
        data: {
          defaultPaymentMethodId: paymentMethodId,
        } as any, // Using any to avoid TypeScript issues with missing schema field
      });

      return {
        success: true,
        organizationId,
        paymentMethodId,
      };
    } catch (error) {
      console.error('Error saving payment method to organization:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Removes a payment method from an organization
   */
  async removeOrganizationPaymentMethod(organizationId: string): Promise<any> {
    try {
      // Get the organization with current payment method
      const organization =
        await this.getOrganizationWithPaymentMethod(organizationId);

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // If organization has a payment method
      if (organization.defaultPaymentMethodId) {
        try {
          // Find active subscription to get customer ID
          const subscription = await this._prismaService.subscription.findFirst(
            {
              where: {
                organizationId,
                isActive: true,
              },
            },
          );

          if (subscription?.stripeCustomerId) {
            // Remove default payment method from customer
            await this.stripe.customers.update(subscription.stripeCustomerId, {
              invoice_settings: { default_payment_method: '' },
            });

            // Detach payment method from Stripe
            await this.stripe.paymentMethods.detach(
              organization.defaultPaymentMethodId,
            );
          }
        } catch (stripeError) {
          console.error(
            'Error removing payment method from Stripe:',
            stripeError,
          );
          // Continue with database update even if Stripe operations fail
        }
      }

      // Remove payment method ID from organization
      await this._prismaService.organization.update({
        where: { id: organizationId },
        data: {
          defaultPaymentMethodId: null,
        } as any, // Using any to avoid TypeScript issues with missing schema field
      });

      return {
        success: true,
        organizationId,
      };
    } catch (error) {
      console.error('Error removing payment method from organization:', error);
      throw new BadRequestException(error.message);
    }
  }

  async getMonthlyUsageReport(
    organizationId: string,
  ): Promise<IMonthlyUsageReport> {
    try {
      // Get active subscription if it exists
      const subscription = await this._prismaService.subscription.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          pricingPlan: true,
        },
      });

      // Calculate current month's date range
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );

      // Get all repositories for this organization with their creation dates
      const repositories = await this._prismaService.repository.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      });

      // Get usage logs for the current month
      const usageLogs = await this._prismaService.usageLog.findMany({
        where: {
          organizationId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          repositoryId: true,
          type: true,
        },
      });

      // For monthly plans, use 30 days as the total period
      const totalDaysInPeriod = 30;

      // Calculate prorated repository costs
      let totalRepositoryCost = 0;
      const repositoryUsage = repositories.map((repo) => {
        // Calculate when the repository was connected during the current month
        const repoStartDate = new Date(
          Math.max(repo.createdAt.getTime(), startDate.getTime()),
        );

        // Calculate how many days the repository was connected in this period
        const daysConnected = Math.ceil(
          (endDate.getTime() - repoStartDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        // Ensure we don't have negative days or zero days (minimum 1 day)
        const effectiveDaysConnected = Math.max(
          1,
          Math.min(daysConnected, totalDaysInPeriod),
        );

        // Calculate prorated amount - if connected for full period, charge full amount
        const proratedFactor = effectiveDaysConnected / totalDaysInPeriod;
        const basePrice = subscription
          ? (subscription.customBasePrice ||
              subscription.pricingPlan.basePrice) / 30
          : 0;
        const proratedAmount = basePrice * proratedFactor;
        totalRepositoryCost += proratedAmount;

        // Get usage for this repository
        const repoLogs = usageLogs.filter(
          (log) => log.repositoryId === repo.id,
        );
        const typeCounts = repoLogs.reduce((acc, log) => {
          acc[log.type] = (acc[log.type] || 0) + 1;
          return acc;
        }, {});

        return {
          id: repo.id,
          name: repo.name,
          evaluations: repoLogs.length,
          evaluationTypes: Object.entries(typeCounts).map(([type, count]) => ({
            type,
            count: count as number,
          })),
          connectedDays: effectiveDaysConnected,
          proratedCost: proratedAmount,
        };
      });

      // Calculate evaluation costs
      const totalEvaluations = usageLogs.length;
      const evaluationPrice = subscription
        ? subscription.customEvalPrice ||
          subscription.pricingPlan.evaluationPrice
        : 0;
      const totalEvaluationCost = totalEvaluations * evaluationPrice;

      // Calculate total cost
      const totalCost = totalRepositoryCost + totalEvaluationCost;

      // Get all invoices for this organization
      const invoices = await this._prismaService.invoice.findMany({
        where: {
          subscription: {
            organizationId: organizationId,
          },
        },
        include: {
          invoiceItems: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        subscription: subscription
          ? {
              planType: subscription.pricingPlan.planType,
              startDate: subscription.startDate,
              endDate: subscription.endDate,
            }
          : null,
        currentMonthUsage: {
          startDate: startDate,
          endDate: endDate,
          repositories: {
            total: repositories.length,
            list: repositoryUsage,
          },
          totalEvaluations,
          totalCost,
          costBreakdown: {
            repositoryCost: totalRepositoryCost,
            evaluationCost: totalEvaluationCost,
          },
        },
        invoices,
      };
    } catch (error) {
      console.error('Error getting monthly usage report:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Validates a payment method and checks for sufficient funds
   */
  async validatePaymentMethod(
    paymentMethodId: string,
    amount: number,
  ): Promise<{
    isValid: boolean;
    message?: string;
  }> {
    try {
      // Create a test payment intent to validate the card
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: 'usd',
        payment_method: paymentMethodId,
        confirm: true,
        capture_method: 'manual', // Don't actually capture the payment
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
      });

      // If we get here, the card is valid and has sufficient funds
      // Cancel the test payment intent
      await this.stripe.paymentIntents.cancel(paymentIntent.id);

      return { isValid: true };
    } catch (error) {
      // Handle specific Stripe errors
      if (error.type === 'StripeCardError') {
        return {
          isValid: false,
          message: error.message || 'Card validation failed',
        };
      }
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Checks for pending invoices and handles subscription state
   */
  async checkAndHandlePendingInvoices(organizationId: string): Promise<void> {
    try {
      const subscription = await this._prismaService.subscription.findFirst({
        where: {
          organizationId,
          isActive: true,
        },
        include: {
          invoices: {
            where: {
              status: InvoiceStatus.PENDING,
              dueDate: { lt: new Date() }, // Past due
            },
          },
        },
      });

      if (subscription?.invoices.length > 0) {
        // Deactivate subscription if there are pending invoices
        await this._prismaService.subscription.update({
          where: { id: subscription.id },
          data: { isActive: false },
        });
      }
    } catch (error) {
      console.error('Error checking pending invoices:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Complete subscription flow with payment validation
   */
  async createSubscriptionWithPayment(
    data: CreateSubscriptionDto,
    paymentMethodId: string,
  ): Promise<ISubscription> {
    try {
      // First check for any pending invoices
      await this.checkAndHandlePendingInvoices(data.organizationId);

      // Get the pricing plan
      const pricingPlan = await this.getPricingPlanById(data.pricingPlanId);

      // Calculate initial amount (first month's payment)
      const initialAmount = pricingPlan.basePrice + (data.customBasePrice || 0);

      // Validate payment method
      const validation = await this.validatePaymentMethod(
        paymentMethodId,
        initialAmount,
      );

      if (!validation.isValid) {
        throw new BadRequestException(
          validation.message || 'Payment method validation failed',
        );
      }

      // Save payment method to organization
      await this.saveOrganizationPaymentMethod(
        data.organizationId,
        paymentMethodId,
      );

      // Create the subscription
      return this.createSubscription(data);
    } catch (error) {
      console.error('Error creating subscription with payment:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Upgrade subscription with payment validation
   */
  async upgradeSubscriptionWithPayment(
    subscriptionId: string,
    newPlanId: string,
    paymentMethodId: string,
  ): Promise<ISubscription> {
    try {
      const subscription = await this._prismaService.subscription.findUnique({
        where: { id: subscriptionId },
        include: { pricingPlan: true },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      const newPlan = await this.getPricingPlanById(newPlanId);

      // Calculate prorated amount for the remaining period
      const daysRemaining = Math.ceil(
        (subscription.endDate.getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const proratedAmount = (newPlan.basePrice / 30) * daysRemaining;

      // Validate payment method
      const validation = await this.validatePaymentMethod(
        paymentMethodId,
        proratedAmount,
      );

      if (!validation.isValid) {
        throw new BadRequestException(
          validation.message || 'Payment method validation failed',
        );
      }

      // Save payment method to organization
      await this.saveOrganizationPaymentMethod(
        subscription.organizationId,
        paymentMethodId,
      );

      // Update subscription
      return this.updateSubscription(subscriptionId, {
        pricingPlanId: newPlanId,
      });
    } catch (error) {
      console.error('Error upgrading subscription:', error);
      throw new BadRequestException(error.message);
    }
  }
}
