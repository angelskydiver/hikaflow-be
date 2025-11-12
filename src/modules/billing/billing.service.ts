import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, Prisma, SubscriptionPlanType } from '@prisma/client';
import { Queue } from 'bullmq';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import Stripe from 'stripe';
import { DiscountService } from '../discount/discount.service';
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

const USER_PRICING_TIERS: Record<
  SubscriptionPlanType,
  { min: number; max: number; price: number }
> = {
  [SubscriptionPlanType.TRIAL]: { min: 0, max: Infinity, price: 0 },
  [SubscriptionPlanType.BASIC]: { min: 1, max: 49, price: 15 },
  [SubscriptionPlanType.STANDARD]: { min: 50, max: 150, price: 13 },
  [SubscriptionPlanType.PREMIUM]: { min: 151, max: Infinity, price: 10 },
  [SubscriptionPlanType.CUSTOM]: { min: 0, max: Infinity, price: 0 },
};

// Default quota constants
const DEFAULT_PR_ANALYSIS_QUOTA = 20;
const DEFAULT_ASSISTANT_QUOTA = 50;

type OrganizationMemberWithAccount = Prisma.OrganizationAccountsGetPayload<{
  include: {
    account: {
      select: {
        user: {
          select: {
            firstName: true;
            lastName: true;
            email: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class BillingService {
  private stripe: Stripe;
  private discountService: DiscountService;
  private paymentQueue: Queue;

  constructor(
    private readonly _prismaService: PrismaService,
    private readonly _configService: ConfigService,
    private readonly _mailService: MailService,
  ) {
    // Initialize Stripe with your secret key
    this.stripe = new Stripe(
      this._configService.get<string>('STRIPE_SECRET_KEY'),
      {
        apiVersion: (this._configService.get<string>('STRIPE_API_VERSION') ||
          '2023-10-16') as '2023-10-16',
      },
    );
    console.log(
      'this._configService.get<number>(REDIS_PORT): ',
      this._configService.get<number>('REDIS_PORT'),
    );
    // Initialize DiscountService
    this.discountService = new DiscountService(this._prismaService);
    this.paymentQueue = new Queue('payment-events', {
      connection: {
        host: this._configService.get<string>('REDIS_HOST') || '127.0.0.1',
        port: Number(this._configService.get<number>('REDIS_PORT')),
      },
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
      },
    });
  }

  private getPricingTier(planType: SubscriptionPlanType) {
    return (
      USER_PRICING_TIERS[planType] ||
      USER_PRICING_TIERS[SubscriptionPlanType.CUSTOM]
    );
  }

  private validatePlanForMemberCount(
    planType: SubscriptionPlanType,
    memberCount: number,
  ) {
    const tier = this.getPricingTier(planType);

    if (!tier || tier.price === 0) {
      return;
    }

    if (memberCount < tier.min) {
      throw new BadRequestException(
        `The selected plan requires at least ${tier.min} active members. Currently detected: ${memberCount}.`,
      );
    }

    if (memberCount > tier.max) {
      throw new BadRequestException(
        `The selected plan supports up to ${tier.max} active members. Currently detected: ${memberCount}.`,
      );
    }
  }

  private async getOrganizationMembers(
    organizationId: string,
  ): Promise<OrganizationMemberWithAccount[]> {
    return this._prismaService.organizationAccounts.findMany({
      where: { organizationId },
      include: {
        account: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private getMemberDisplayName(member: OrganizationMemberWithAccount) {
    const firstName = member.account?.user?.firstName?.trim();
    const lastName = member.account?.user?.lastName?.trim();
    const email = member.account?.user?.email;

    if (firstName || lastName) {
      return `${firstName || ''} ${lastName || ''}`.trim();
    }

    return email || 'Member';
  }

  // ================== PRICING PLAN METHODS ==================

  async createPricingPlan(data: CreatePricingPlanDto): Promise<IPricingPlan> {
    try {
      const {
        name,
        planType,
        basePrice,
        evaluationPrice,
        prAnalysisQuota = DEFAULT_PR_ANALYSIS_QUOTA,
        assistantQuota = DEFAULT_ASSISTANT_QUOTA,
        active = true,
      } = data;

      // Save to database
      return this._prismaService.pricingPlan.create({
        data: {
          name,
          planType,
          basePrice,
          evaluationPrice,
          prAnalysisQuota,
          assistantQuota,
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

      const organizationMembers =
        await this.getOrganizationMembers(organizationId);
      const activeMemberCount = organizationMembers.length;

      if (activeMemberCount === 0) {
        throw new BadRequestException(
          'At least one active member is required to create a subscription.',
        );
      }

      this.validatePlanForMemberCount(pricingPlan.planType, activeMemberCount);

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

      // Handle plan changes
      if (
        data.pricingPlanId &&
        data.pricingPlanId !== subscription.pricingPlanId
      ) {
        const newPlan = await this.getPricingPlanById(data.pricingPlanId);
        const organizationMembers = await this.getOrganizationMembers(
          subscription.organizationId,
        );
        this.validatePlanForMemberCount(
          newPlan.planType,
          organizationMembers.length,
        );

        const today = new Date();
        // Handle null/undefined endDate with explicit check
        const subscriptionEndDate: Date | null = subscription.endDate
          ? new Date(subscription.endDate)
          : null;
        // If subscription has no end date, consider it active if isActive is true
        const isSubscriptionActive =
          subscription.isActive &&
          (subscriptionEndDate === null || subscriptionEndDate > today);
        const isTrialSubscription =
          subscription.pricingPlan.planType === SubscriptionPlanType.TRIAL;

        // If subscription is active (not trial) and hasn't ended, queue the change
        if (isSubscriptionActive && !isTrialSubscription) {
          // Store the next plan ID in the subscription itself
          const updatedSubscription =
            await this._prismaService.subscription.update({
              where: { id: subscriptionId },
              data: {
                nextPricingPlanId: data.pricingPlanId,
              },
              include: {
                pricingPlan: true,
                nextPricingPlan: true,
              },
            });

          return {
            ...updatedSubscription,
            message:
              'Subscription change queued. It will activate when your current subscription ends.',
          } as any;
        }

        // If trial subscription or subscription has ended, allow immediate change
        // PREPAID MODEL: Charge immediately for full new period, no proration
        // Reset subscription period for plan change
        const newStartDate = new Date();
        const newEndDate = new Date();
        newEndDate.setDate(newStartDate.getDate() + 30); // 30 days from now

        console.log(
          `Resetting subscription period: ${newStartDate.toISOString()} to ${newEndDate.toISOString()}`,
        );

        // Add new dates to the update data
        data = {
          ...data,
          startDate: newStartDate,
          endDate: newEndDate,
        };

        // PREPAID: Generate and pay invoice immediately for the NEW full period
        // No need to invoice for old period - prepaid model means they've already paid
        // Generate invoice for both trial upgrades and paid plan changes
        try {
          // Generate invoice for the NEW subscription period (full 30 days)
          await this.generateInvoice({
            organizationId: subscription.organizationId,
            fromDate: newStartDate.toISOString(),
            toDate: newEndDate.toISOString(),
            isForSubscriptionUpdate: false, // This is a new prepaid period
          });
          console.log(
            `Prepaid invoice generated for ${isTrialSubscription ? 'trial upgrade' : 'plan change'}`,
          );
        } catch (invoiceError) {
          console.error(
            'Error generating prepaid invoice for new subscription:',
            invoiceError.message,
          );
          // Continue with subscription update even if invoicing fails
        }
      }

      // Handle subscription cancellation
      if (data.isActive === false && subscription.isActive) {
        // Use dedicated cancellation method
        return this.cancelSubscription(subscriptionId, {
          immediate: data.immediate || false, // Default to end of period
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

  /**
   * Cancels a subscription
   * @param subscriptionId - The subscription to cancel
   * @param options - Cancellation options
   * @param options.immediate - If true, cancel immediately. If false, cancel at end of period.
   */
  async cancelSubscription(
    subscriptionId: string,
    options: { immediate?: boolean } = {},
  ): Promise<ISubscription> {
    try {
      const { immediate = false } = options;

      const subscription = await this._prismaService.subscription.findUnique({
        where: { id: subscriptionId },
        include: { pricingPlan: true },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      if (!subscription.isActive) {
        throw new BadRequestException('Subscription is already cancelled');
      }

      const today = new Date();
      // Handle null/undefined endDate with explicit check
      const subscriptionEndDate: Date | null = subscription.endDate
        ? new Date(subscription.endDate)
        : null;

      // Clear any queued subscription changes
      if (subscription.nextPricingPlanId) {
        await this._prismaService.subscription.update({
          where: { id: subscriptionId },
          data: { nextPricingPlanId: null },
        });
        console.log(`Cleared queued subscription change for ${subscriptionId}`);
      }

      // Handle immediate cancellation
      if (immediate) {
        // PREPAID MODEL: No refund or final invoice needed
        // User has already paid for the period, cancellation just stops access
        // No need to generate invoice - they keep what they paid for

        // Cancel Stripe subscription if exists
        if (subscription.stripeSubscriptionId) {
          try {
            await this.stripe.subscriptions.cancel(
              subscription.stripeSubscriptionId,
            );
          } catch (stripeError) {
            console.error('Error cancelling Stripe subscription:', stripeError);
            // Continue with database cancellation even if Stripe fails
          }
        }

        // Deactivate subscription immediately
        return this._prismaService.subscription.update({
          where: { id: subscriptionId },
          data: {
            isActive: false,
            endDate: today,
          },
        });
      }

      // Handle end-of-period cancellation
      // Set endDate to current endDate (or today if null) - no renewal
      const cancellationDate = subscriptionEndDate || today;

      // Update subscription to not renew (keep active until endDate)
      // Mark as cancelled so cron knows not to renew
      return this._prismaService.subscription.update({
        where: { id: subscriptionId },
        data: {
          endDate: cancellationDate,
          cancelledAt: today, // Mark as cancelled - prevents renewal
          // Keep isActive = true until endDate arrives
          // Daily cron will handle deactivation when endDate arrives
        },
      });
    } catch (error) {
      console.error('Error cancelling subscription:', error);
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
      const usageLog = await this._prismaService.usageLog.create({
        data: {
          subscriptionId: activeSubscriptionId,
          organizationId,
          repositoryId,
          type: type as any,
          description,
          counted: false,
        },
      });
      return usageLog as IUsageLog;
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

    const usageLogs = await this._prismaService.usageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { repository: true },
    });
    return usageLogs as IUsageLog[];
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

      // Get uncounted usage logs (for record keeping)
      const usageLogs = await this._prismaService.usageLog.findMany({
        where: {
          organizationId: data.organizationId,
          subscriptionId: subscription.id,
          counted: false,
          ...(options.fromDate && { createdAt: { gte: options.fromDate } }),
          ...(options.toDate && { createdAt: { lte: options.toDate } }),
        },
      });

      const organizationMembers = await this.getOrganizationMembers(
        data.organizationId,
      );

      // Skip invoicing if there are no members and no usage logs
      if (organizationMembers.length === 0 && usageLogs.length === 0) {
        return {
          message: 'No active members or usage logs to generate invoice',
          success: false,
        };
      }

      // Calculate prorated amounts for each member - AT INVOICE CREATION TIME
      let totalMemberAmount = 0;
      const memberLineItems = [];

      // Calculate amounts based on pricing plan - use CURRENT pricing
      const planType = subscription.pricingPlan.planType;
      this.validatePlanForMemberCount(planType, organizationMembers.length);

      let basePrice =
        planType === SubscriptionPlanType.CUSTOM
          ? subscription.customBasePrice
          : subscription.pricingPlan.basePrice;

      basePrice = basePrice ?? 0;

      const memberDailyRate = basePrice / totalDaysInPeriod;

      for (const member of organizationMembers) {
        const memberStartDate = new Date(
          Math.max(member.createdAt.getTime(), options.fromDate.getTime()),
        );

        let daysActive;
        if (isForSubscriptionUpdate) {
          daysActive = Math.ceil(
            (options.toDate.getTime() - options.fromDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
        } else {
          daysActive = Math.ceil(
            (options.toDate.getTime() - memberStartDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
        }

        const effectiveDaysActive = Math.max(
          1,
          Math.min(daysActive, totalDaysInPeriod),
        );

        const proratedAmount = memberDailyRate * effectiveDaysActive;
        totalMemberAmount += proratedAmount;

        memberLineItems.push({
          description: `Member: ${this.getMemberDisplayName(member)} (${effectiveDaysActive}/${totalDaysInPeriod} days)`,
          quantity: 1,
          unitPrice: basePrice,
          amount: proratedAmount,
          type: 'USER',
        });
      }

      // Usage-based charges are not billed under the per-seat model
      const subtotal = totalMemberAmount;

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
      let invoice = await this._prismaService.invoice.create({
        data: {
          subscriptionId: subscription.id,
          invoiceNumber,
          amount: subtotal,
          tax,
          total,
          status: InvoiceStatus.PENDING, // Initially PENDING until payment is processed
          dueDate: new Date(), // Due same day as creation
          stripeInvoiceId: '', // No Stripe invoice involved
          description: `Invoice for ${organizationMembers.length} active members and usage`,
          invoiceItems: {
            create: memberLineItems,
          },
        },
      });

      // Apply any available discounts to the invoice
      try {
        invoice = await this.discountService.applyDiscountToInvoice(
          invoice.id,
          data.organizationId,
        );
        console.log(
          `Applied discount to invoice ${invoice.id}. New total: $${invoice.total}`,
        );
      } catch (discountError) {
        console.log(
          'No discounts applied or discount error:',
          discountError.message,
        );
        // Continue without discount if there's an error
      }

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

      // Otherwise return the pending invoice
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
              pricingPlan: true,
            },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      console.log('check post 08.1: ', invoice);
      if (invoice.status === InvoiceStatus.PAID) {
        throw new BadRequestException('Invoice already paid');
      }

      let paymentIntent;

      // Check if invoice total is $0 or less due to discounts
      if (invoice.total <= 0) {
        console.log(
          `Invoice ${invoice.invoiceNumber} total is $${invoice.total} - marking as paid without payment processing`,
        );

        // Mark invoice as paid without processing payment
        const paidInvoice = await this._prismaService.invoice.update({
          where: { id: invoiceId },
          data: {
            status: InvoiceStatus.PAID,
            paidDate: new Date(),
            stripePaymentIntentId: 'DISCOUNT_COVERED', // Indicate this was covered by discount
          },
        });
        console.log('Reactivate subscription if needed');
        // Reactivate subscription if needed
        await this._prismaService.subscription.updateMany({
          where: {
            id: invoice.subscriptionId,
            isActive: false,
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
      }

      // Process normal payment for invoices with amount > $0
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

      let organizationAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            organizationId: invoice.subscription.organizationId,
            role: 'ADMIN',
          },
          include: {
            account: {
              include: {
                user: true,
              },
            },
            organization: true,
          },
        });

      if (
        !organizationAccount ||
        !organizationAccount.account ||
        !organizationAccount.account.user
      ) {
        return null; // Or throw a NotFoundException if you prefer
      }

      let email = organizationAccount.account.user.email;
      console.log('admin email: ', email);
      console.log('check post 09: ', invoice);

      if (paidInvoice.status === InvoiceStatus.PAID) {
        // Get user details for email
        const user = organizationAccount.account.user;

        await this.paymentQueue.add('payment-success', {
          email: email,
          userName: user.firstName || user.email.split('@')[0],
          transactionId: invoice.invoiceNumber,
          amount: invoice.total.toFixed(2),
          paymentMethod: 'Credit Card', // Default, can be enhanced
          paymentDate: new Date().toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
          }),
          planDetails: {
            name: invoice.subscription.pricingPlan.name,
            description: `${invoice.subscription.pricingPlan.name} Plan`,
          },
          dashboardUrl: `${process.env.HIKAFLOW_PORTAL_URL}`,
        });

        // Also send email directly as fallback
        try {
          await this._mailService.sendPaymentSuccessEmail({
            email: email,
            userName: user.firstName || user.email.split('@')[0],
            transactionId: invoice.invoiceNumber,
            amount: invoice.total.toFixed(2),
            paymentMethod: 'Credit Card',
            paymentDate: new Date().toLocaleString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZoneName: 'short',
            }),
            planDetails: {
              name: invoice.subscription.pricingPlan.name,
              description: `${invoice.subscription.pricingPlan.name} Plan`,
            },
            dashboardUrl: `${process.env.HIKAFLOW_PORTAL_URL}`,
          });
        } catch (emailError) {
          console.error(
            'Failed to send payment success email directly:',
            emailError,
          );
        }
      } else {
        // Handle payment failure
        const user = organizationAccount.account.user;

        await this.paymentQueue.add('payment-failure', {
          email: email,
          userName: user.firstName || user.email.split('@')[0],
          transactionId: invoice.invoiceNumber,
          amount: invoice.total.toFixed(2),
          paymentMethod: 'Credit Card',
          paymentDate: new Date().toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
          }),
          errorMessage: 'Payment was declined or failed to process',
          planDetails: {
            name: invoice.subscription.pricingPlan.name,
            description: `${invoice.subscription.pricingPlan.name} Plan`,
          },
          retryPaymentUrl: `${process.env.HIKAFLOW_PORTAL_URL}/billing/retry/${invoice.id}`,
          supportUrl: `${process.env.HIKAFLOW_PORTAL_URL}/support`,
        });
      }

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
          prAnalysisQuota: DEFAULT_PR_ANALYSIS_QUOTA,
          assistantQuota: DEFAULT_ASSISTANT_QUOTA,
        },
        {
          name: 'Basic',
          planType: SubscriptionPlanType.BASIC,
          basePrice: USER_PRICING_TIERS[SubscriptionPlanType.BASIC].price, // $15 per user
          evaluationPrice: 0.5, // 50 cents per evaluation
          prAnalysisQuota: 20, // PR analyses quota
          assistantQuota: 50, // Assistant questions quota
        },
        {
          name: 'Standard',
          planType: SubscriptionPlanType.STANDARD,
          basePrice: USER_PRICING_TIERS[SubscriptionPlanType.STANDARD].price, // $13 per user for 50-150 members
          evaluationPrice: 0.25, // 25 cents per evaluation
          prAnalysisQuota: 20, // PR analyses quota
          assistantQuota: 50, // Assistant questions quota
        },
        {
          name: 'Premium',
          planType: SubscriptionPlanType.PREMIUM,
          basePrice: USER_PRICING_TIERS[SubscriptionPlanType.PREMIUM].price, // $10 per user for 151+ members
          evaluationPrice: 0.1, // 10 cents per evaluation
          prAnalysisQuota: 20, // PR analyses quota
          assistantQuota: 50, // Assistant questions quota
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
            repository: {
              organizationId: subscription.organizationId,
            },
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

  // Method to check if a user can ask a question
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
      if (subscription.pricingPlan.planType === SubscriptionPlanType.TRIAL) {
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
    queuesProcessed: number;
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
            nextPricingPlan: true,
          },
        });

      console.log(
        `Found ${expiredSubscriptions.length} subscriptions ending today`,
      );

      let invoicesGenerated = 0;
      let subscriptionsRenewed = 0;
      let queuesProcessed = 0;

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

          // PRIORITY: Check if there's a queued subscription change
          if (subscription.nextPricingPlanId) {
            console.log(
              `Processing queued subscription change for ${subscription.id} (switching to plan ${subscription.nextPricingPlanId})`,
            );

            try {
              // PREPAID MODEL: No final invoice for old subscription - they've already paid
              // Deactivate old subscription
              await this._prismaService.subscription.update({
                where: { id: subscription.id },
                data: { isActive: false, nextPricingPlanId: null },
              });

              // Create new subscription with queued plan
              const newStartDate = subscription.endDate || new Date();
              const newEndDate = new Date(newStartDate);
              newEndDate.setDate(newEndDate.getDate() + 30);

              const newSubscription =
                await this._prismaService.subscription.create({
                  data: {
                    organizationId: subscription.organizationId,
                    pricingPlanId: subscription.nextPricingPlanId,
                    stripeCustomerId: subscription.stripeCustomerId,
                    startDate: newStartDate,
                    endDate: newEndDate,
                    isActive: true,
                  },
                });

              // PREPAID: Generate and pay invoice immediately for the NEW subscription period
              try {
                const newInvoiceResult = await this.generateInvoice({
                  organizationId: subscription.organizationId,
                  fromDate: newStartDate.toISOString(),
                  toDate: newEndDate.toISOString(),
                });

                if ('id' in newInvoiceResult) {
                  invoicesGenerated++;
                }
              } catch (invoiceError) {
                console.error(
                  `Error generating prepaid invoice for queued subscription:`,
                  invoiceError,
                );
                // Continue even if invoice generation fails
              }

              queuesProcessed++;
              subscriptionsRenewed++; // Count as renewal since new subscription created
              console.log(
                `Queued subscription change processed successfully for ${subscription.id} -> ${newSubscription.id}`,
              );
            } catch (queueError) {
              console.error(
                `Error processing queued subscription ${subscription.id}:`,
                queueError.message,
              );
              // Fall through to normal renewal if queue processing fails
            }
            continue; // Skip normal renewal since queue was processed
          }

          // Normal renewal flow (no queue)
          // Check if subscription was cancelled (end-of-period cancellation)
          if (subscription.cancelledAt) {
            // Subscription was cancelled at end of period - don't renew
            await this._prismaService.subscription.update({
              where: { id: subscription.id },
              data: { isActive: false },
            });
            console.log(
              `Subscription ${subscription.id} deactivated - was cancelled at end of period`,
            );
            continue;
          }

          // Check if organization has payment method - if not, subscription was likely cancelled
          const organization =
            await this._prismaService.organization.findUnique({
              where: { id: subscription.organizationId },
              select: { defaultPaymentMethodId: true },
            });

          if (!organization?.defaultPaymentMethodId) {
            // No payment method = subscription cancelled, don't renew
            await this._prismaService.subscription.update({
              where: { id: subscription.id },
              data: { isActive: false },
            });
            console.log(
              `Subscription ${subscription.id} deactivated - no payment method (cancelled)`,
            );
            continue;
          }

          // PREPAID RENEWAL: Generate invoice for NEXT period (30 days from now)
          // Charge upfront for the renewal period
          console.log(
            `Generating prepaid renewal invoice for subscription ${subscription.id}`,
          );
          const newStartDate = new Date();
          const newEndDate = new Date();
          newEndDate.setDate(newEndDate.getDate() + 30); // 30 days from now

          const invoiceResult = await this.generateInvoice({
            organizationId: subscription.organizationId,
            fromDate: newStartDate.toISOString(),
            toDate: newEndDate.toISOString(),
            isForSubscriptionUpdate: false, // This is a prepaid renewal
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
              await this._prismaService.subscription.update({
                where: { id: subscription.id },
                data: {
                  isActive: true,
                  startDate: newStartDate, // Today
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
        queuesProcessed,
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
      console.log(`\n========== SAVE PAYMENT METHOD START ==========`);
      console.log(`Organization ID: ${organizationId}`);
      console.log(`Payment Method ID: ${paymentMethodId}`);

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

      console.log(
        `Stored Payment Method ID: ${organization.defaultPaymentMethodId}`,
      );
      console.log(
        `IDs Match: ${organization.defaultPaymentMethodId === paymentMethodId}`,
      );

      // OPTIMAL SOLUTION: Check if organization already has a valid payment method
      // If yes and it's the same one, just return success (no need to reattach)
      if (
        organization.defaultPaymentMethodId &&
        organization.defaultPaymentMethodId === paymentMethodId
      ) {
        console.log(`\n--- Checking existing payment method ---`);

        try {
          // Verify the payment method is still valid and attached
          const existingPaymentMethod =
            await this.stripe.paymentMethods.retrieve(paymentMethodId);
          console.log(
            `Existing PM customer: ${existingPaymentMethod.customer || 'null (DETACHED)'}`,
          );

          if (existingPaymentMethod.customer) {
            // Payment method is already attached and valid - no need to do anything
            console.log(`✓ Payment method is valid and attached`);
            console.log(
              `========== SAVE PAYMENT METHOD END (SUCCESS) ==========\n`,
            );
            return {
              success: true,
              organizationId,
              paymentMethodId,
              message: 'Payment method already saved',
            };
          } else {
            // Payment method exists but was detached
            // AGGRESSIVE SOLUTION: Create NEW Stripe customer
            console.log(
              `✗ Payment method was DETACHED - creating NEW Stripe customer...`,
            );

            // Step 1: Create new Stripe customer
            const newCustomer = await this.stripe.customers.create({
              name: organization.name,
              metadata: {
                organizationId,
                reason: 'Recreated due to detached payment method',
              },
            });
            console.log(`✓ Created new Stripe customer: ${newCustomer.id}`);

            // Step 2: Update subscriptions
            if (
              organization.subscriptions &&
              organization.subscriptions.length > 0
            ) {
              await this._prismaService.subscription.update({
                where: { id: organization.subscriptions[0].id },
                data: { stripeCustomerId: newCustomer.id },
              });
              console.log(`✓ Updated subscription to new customer`);
            }

            // Step 3: Clear from database
            await this._prismaService.organization.update({
              where: { id: organizationId },
              data: {
                defaultPaymentMethodId: null,
              } as any,
            });
            console.log(`✓ Cleared from database`);

            // Ask user to refresh and retry with new customer
            console.log(
              `\n✓ New customer created. Refresh page and enter card again.`,
            );
            console.log(
              `========== SAVE PAYMENT METHOD END (NEW CUSTOMER CREATED) ==========\n`,
            );
            throw new BadRequestException({
              message:
                'System reset complete. Page will refresh - please enter your card again.',
              code: 'PAYMENT_METHOD_DELETED_RETRY',
              statusCode: 400,
            });
          }
        } catch (checkError: any) {
          // If it's our custom error, re-throw it
          if (checkError instanceof BadRequestException) {
            throw checkError;
          }

          // Payment method doesn't exist - clear from database
          if (checkError.code === 'resource_missing') {
            console.log(
              `Existing payment method ${paymentMethodId} doesn't exist in Stripe, clearing from database`,
            );
            await this._prismaService.organization.update({
              where: { id: organizationId },
              data: {
                defaultPaymentMethodId: null,
              } as any,
            });

            // Continue to attach - this will fail with proper error if PM was detached
            console.log('Will continue to try attaching new payment method');
          }
        }
      }

      // Get the Stripe customer ID from the active subscription or any subscription
      let stripeCustomerId: string;

      // First, determine the Stripe customer ID (get or create)
      if (organization.subscriptions && organization.subscriptions.length > 0) {
        // Use existing customer from subscription
        stripeCustomerId = organization.subscriptions[0].stripeCustomerId;

        // If no customer ID in subscription, create one
        if (!stripeCustomerId) {
          const customer = await this.stripe.customers.create({
            name: organization.name,
            metadata: {
              organizationId,
            },
          });
          stripeCustomerId = customer.id;

          // Update subscription with customer ID
          await this._prismaService.subscription.update({
            where: { id: organization.subscriptions[0].id },
            data: { stripeCustomerId: customer.id },
          });
        }
      } else {
        // If no active subscription, check for any subscription with customer ID
        const anySubscription =
          await this._prismaService.subscription.findFirst({
            where: { organizationId },
            orderBy: { createdAt: 'desc' },
          });

        if (anySubscription?.stripeCustomerId) {
          stripeCustomerId = anySubscription.stripeCustomerId;
        } else {
          // Create a new customer in Stripe
          const customer = await this.stripe.customers.create({
            name: organization.name,
            metadata: {
              organizationId,
            },
          });
          stripeCustomerId = customer.id;
        }
      }

      // Clean up old payment method if exists AND it's different from the new one
      // IMPORTANT: Don't detach if it's the same payment method we're trying to attach
      if (
        organization.defaultPaymentMethodId &&
        organization.defaultPaymentMethodId !== paymentMethodId
      ) {
        try {
          // Try to retrieve the old payment method
          const oldPaymentMethod = await this.stripe.paymentMethods.retrieve(
            organization.defaultPaymentMethodId,
          );

          // If it exists and is attached to a customer, detach it first
          if (oldPaymentMethod.customer) {
            try {
              await this.stripe.paymentMethods.detach(
                organization.defaultPaymentMethodId,
              );
              console.log(
                `Detached old payment method ${organization.defaultPaymentMethodId} from customer ${oldPaymentMethod.customer}`,
              );
            } catch (detachError) {
              console.error('Error detaching old payment method:', detachError);
              // Continue - might already be detached
            }
          }
        } catch (retrieveError) {
          // Old payment method doesn't exist or was already detached - that's fine
          console.log('Old payment method not found or already detached');
        }
      }

      // Check if new payment method is already attached or was previously detached
      console.log(`\n--- Checking payment method attachment status ---`);
      let needsAttachment = true;

      try {
        const paymentMethod =
          await this.stripe.paymentMethods.retrieve(paymentMethodId);

        console.log(`Payment Method Retrieved:`);
        console.log(`  - ID: ${paymentMethod.id}`);
        console.log(`  - Type: ${paymentMethod.type}`);
        console.log(
          `  - Customer: ${paymentMethod.customer || 'null (DETACHED)'}`,
        );
        console.log(`  - Card Last4: ${paymentMethod.card?.last4 || 'N/A'}`);

        // Check if payment method has no customer (was detached)
        if (!paymentMethod.customer) {
          // Payment method was previously detached
          // AGGRESSIVE SOLUTION: Create a NEW Stripe customer to break the link
          console.log(`\n✗ Payment method was DETACHED`);
          console.log(`→ Creating NEW Stripe customer to bypass this issue...`);

          // Step 1: Create a completely NEW Stripe customer
          const newCustomer = await this.stripe.customers.create({
            name: organization.name,
            metadata: {
              organizationId,
              reason: 'Recreated due to detached payment method',
              oldCustomer: stripeCustomerId,
            },
          });
          console.log(`✓ Created new Stripe customer: ${newCustomer.id}`);

          // Step 2: Update ALL subscriptions to use new customer ID
          await this._prismaService.subscription.updateMany({
            where: { organizationId },
            data: { stripeCustomerId: newCustomer.id },
          });
          console.log(`✓ Updated subscriptions to new customer`);

          // Step 3: Update stripeCustomerId variable for this request
          stripeCustomerId = newCustomer.id;

          // Step 4: Clear detached payment method from database
          await this._prismaService.organization.update({
            where: { id: organizationId },
            data: {
              defaultPaymentMethodId: null,
            } as any,
          });
          console.log(`✓ Cleared detached payment method from database`);

          console.log(
            `\n✓ NEW Stripe customer created. The payment method will now attach to the NEW customer.`,
          );
          console.log(
            `This completely bypasses the detached payment method issue.`,
          );
          console.log(`Proceeding with attachment...\n`);

          // DON'T throw error - continue with the flow using the NEW customer
          // The payment method will be attached to the new customer below
          needsAttachment = true;
        }

        if (paymentMethod.customer === stripeCustomerId) {
          // Already attached to the correct customer - no need to attach again
          console.log(
            `✓ Payment method is already attached to correct customer`,
          );
          console.log(`  Customer ID: ${stripeCustomerId}`);
          needsAttachment = false; // Skip attachment
        } else if (paymentMethod.customer !== stripeCustomerId) {
          // Payment method is attached to a different customer
          // This shouldn't happen in normal flow, but handle it gracefully
          console.log(`⚠ Payment method attached to DIFFERENT customer`);
          console.log(`  Current Customer: ${paymentMethod.customer}`);
          console.log(`  Expected Customer: ${stripeCustomerId}`);
          console.log(`  Will attempt to attach to correct customer`);
          // Don't detach - let Stripe handle the error if needed
          needsAttachment = true;
        }
      } catch (retrieveError: any) {
        // Check if it's the detached payment method error we threw
        if (retrieveError instanceof BadRequestException) {
          throw retrieveError; // Re-throw our custom error
        }

        // Payment method doesn't exist - this means it was never created or was deleted
        // This is fine - we'll create/attach it
        if (retrieveError.code === 'resource_missing') {
          console.log(
            `Payment method ${paymentMethodId} doesn't exist in Stripe, will be created on attach`,
          );
          needsAttachment = true;
        } else {
          console.error('Error checking payment method:', retrieveError);
          // If we can't check, try to attach anyway
          needsAttachment = true;
        }
      }

      // Attach the payment method to the Stripe customer (only if needed)
      console.log(`\n--- Attachment Decision ---`);
      console.log(`Needs Attachment: ${needsAttachment}`);

      if (needsAttachment) {
        console.log(
          `Attaching payment method to customer ${stripeCustomerId}...`,
        );
        try {
          await this.stripe.paymentMethods.attach(paymentMethodId, {
            customer: stripeCustomerId,
          });
          console.log(`✓ Successfully attached payment method`);
        } catch (attachError: any) {
          console.log(`\n✗ ATTACHMENT FAILED`);
          console.log(`Error Type: ${attachError.type}`);
          console.log(`Error Code: ${attachError.code}`);
          console.log(`Error Message: ${attachError.message}`);

          // Handle the specific error about detached payment methods
          if (
            attachError.message &&
            attachError.message.includes(
              'previously used without being attached',
            )
          ) {
            console.log(`\nThis is a DETACHED payment method error`);
            console.log(
              `========== SAVE PAYMENT METHOD END (ERROR: STRIPE ATTACH) ==========\n`,
            );
            throw new BadRequestException(
              'This card was previously removed and cannot be reused. Please use a DIFFERENT card or hard refresh your browser (Ctrl+Shift+R).',
            );
          }
          console.log(
            `========== SAVE PAYMENT METHOD END (ERROR: UNKNOWN) ==========\n`,
          );
          throw attachError;
        }
      } else {
        console.log(`Skipping attachment - already attached`);
      }

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
      console.log(`\n--- Saving to database ---`);
      await this._prismaService.organization.update({
        where: { id: organizationId },
        data: {
          defaultPaymentMethodId: paymentMethodId,
        } as any, // Using any to avoid TypeScript issues with missing schema field
      });
      console.log(`✓ Saved payment method ID to organization`);

      console.log(
        `\n========== SAVE PAYMENT METHOD END (SUCCESS) ==========\n`,
      );
      return {
        success: true,
        organizationId,
        paymentMethodId,
      };
    } catch (error) {
      console.error(
        '\n========== SAVE PAYMENT METHOD END (EXCEPTION) ==========',
      );
      console.error('Error Type:', error.constructor.name);
      console.error('Error Message:', error.message);
      console.error('Full Error:', error);
      console.error(
        '========================================================\n',
      );
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Removes a payment method from an organization
   * @param organizationId - The organization ID
   * @param options - Options for removal
   * @param options.cancelSubscription - If true, cancel subscription when removing payment method
   */
  async removeOrganizationPaymentMethod(
    organizationId: string,
    options: { cancelSubscription?: boolean } = {},
  ): Promise<any> {
    try {
      const { cancelSubscription = false } = options;

      // Get the organization with current payment method
      const organization =
        await this.getOrganizationWithPaymentMethod(organizationId);

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      // Check for active subscriptions
      const activeSubscription =
        await this._prismaService.subscription.findFirst({
          where: {
            organizationId,
            isActive: true,
          },
          include: { pricingPlan: true },
        });

      // If active subscription exists and cancelSubscription is false, warn user but allow removal
      if (activeSubscription && !cancelSubscription) {
        const isTrial =
          activeSubscription.pricingPlan.planType ===
          SubscriptionPlanType.TRIAL;

        if (!isTrial) {
          // Allow removal but warn that renewal will fail
          // Payment method will be removed, subscription will fail to renew when it ends
          console.log(
            `Warning: Removing payment method for organization ${organizationId} with active subscription. Renewal will fail.`,
          );
        }
      }

      // If cancelSubscription is true, cancel the subscription
      if (activeSubscription && cancelSubscription) {
        await this.cancelSubscription(activeSubscription.id, {
          immediate: false, // Cancel at end of period
        });
      }

      // If organization has a payment method
      if (organization.defaultPaymentMethodId) {
        try {
          // Find subscription to get customer ID (even if inactive)
          const subscription = await this._prismaService.subscription.findFirst(
            {
              where: {
                organizationId,
              },
              orderBy: { createdAt: 'desc' },
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
        subscriptionCancelled: activeSubscription && cancelSubscription,
      };
    } catch (error) {
      console.error('Error removing payment method from organization:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Gets the saved payment method details for an organization
   */
  async getOrganizationPaymentMethod(organizationId: string): Promise<any> {
    try {
      const organization =
        await this.getOrganizationWithPaymentMethod(organizationId);

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }

      if (!organization.defaultPaymentMethodId) {
        return {
          hasPaymentMethod: false,
          paymentMethod: null,
        };
      }

      // Retrieve payment method details from Stripe
      try {
        const paymentMethod = await this.stripe.paymentMethods.retrieve(
          organization.defaultPaymentMethodId,
        );

        // Check if payment method was detached (customer is null)
        if (!paymentMethod.customer) {
          // Payment method was detached, clear it from database
          await this._prismaService.organization.update({
            where: { id: organizationId },
            data: {
              defaultPaymentMethodId: null,
            } as any,
          });
          return {
            hasPaymentMethod: false,
            paymentMethod: null,
          };
        }

        // Format card details for display
        const card = paymentMethod.card;
        const maskedCardNumber = `**** **** **** ${card?.last4 || '****'}`;
        const cardBrand = card?.brand || 'card';
        const expiryMonth = card?.exp_month || 0;
        const expiryYear = card?.exp_year || 0;

        return {
          hasPaymentMethod: true,
          paymentMethod: {
            id: paymentMethod.id,
            type: paymentMethod.type,
            card: {
              brand: cardBrand,
              last4: card?.last4,
              maskedNumber: maskedCardNumber,
              expMonth: expiryMonth,
              expYear: expiryYear,
              expiryDate: `${String(expiryMonth).padStart(2, '0')}/${String(expiryYear).slice(-2)}`,
            },
          },
        };
      } catch (stripeError: any) {
        // If payment method doesn't exist in Stripe (detached or deleted), clear it from database
        if (
          stripeError.type === 'StripeInvalidRequestError' ||
          stripeError.code === 'resource_missing'
        ) {
          console.log(
            `Payment method ${organization.defaultPaymentMethodId} not found in Stripe, clearing from database`,
          );
          await this._prismaService.organization.update({
            where: { id: organizationId },
            data: {
              defaultPaymentMethodId: null,
            } as any,
          });
          return {
            hasPaymentMethod: false,
            paymentMethod: null,
          };
        }
        // Re-throw other Stripe errors
        throw stripeError;
      }
    } catch (error) {
      console.error('Error getting organization payment method:', error);
      // Don't throw error - return no payment method instead to prevent blocking pricing page
      return {
        hasPaymentMethod: false,
        paymentMethod: null,
      };
    }
  }

  /**
   * Gets queued subscriptions for an organization
   */
  async getQueuedSubscriptions(organizationId: string): Promise<any[]> {
    try {
      const subscriptionsWithNextPlan =
        await this._prismaService.subscription.findMany({
          where: {
            organizationId,
            nextPricingPlanId: { not: null },
            isActive: true,
          },
          include: {
            pricingPlan: true,
            nextPricingPlan: true,
          },
          orderBy: { updatedAt: 'desc' },
        });

      return subscriptionsWithNextPlan.map((sub) => ({
        id: sub.id,
        currentPlan: sub.pricingPlan,
        nextPlan: sub.nextPricingPlan,
        scheduledStartDate: sub.endDate,
        status: 'PENDING',
        createdAt: sub.updatedAt,
      }));
    } catch (error) {
      console.error('Error getting queued subscriptions:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Processes queued subscriptions when current subscription ends
   */
  async processQueuedSubscriptions(organizationId: string): Promise<any> {
    try {
      const today = new Date();

      // Find all subscriptions with nextPricingPlanId set
      const subscriptionsWithNextPlan =
        await this._prismaService.subscription.findMany({
          where: {
            organizationId,
            nextPricingPlanId: { not: null },
            isActive: true,
          },
          include: {
            pricingPlan: true,
            nextPricingPlan: true,
          },
        });

      const processed = [];

      for (const subscription of subscriptionsWithNextPlan) {
        if (!subscription.nextPricingPlanId) continue;

        // Handle null/undefined endDate with explicit check
        const subscriptionEndDate: Date | null = subscription.endDate
          ? new Date(subscription.endDate)
          : null;

        // If subscription has ended or is inactive, process the next plan
        if (
          !subscription.isActive ||
          (subscriptionEndDate && subscriptionEndDate <= today)
        ) {
          try {
            // Deactivate old subscription
            await this._prismaService.subscription.update({
              where: { id: subscription.id },
              data: { isActive: false },
            });

            // Create new subscription with the next plan
            const newStartDate = subscriptionEndDate || new Date();
            const newEndDate = new Date(newStartDate);
            newEndDate.setDate(newEndDate.getDate() + 30);

            const newSubscription =
              await this._prismaService.subscription.create({
                data: {
                  organizationId: subscription.organizationId,
                  pricingPlanId: subscription.nextPricingPlanId,
                  stripeCustomerId: subscription.stripeCustomerId,
                  startDate: newStartDate,
                  endDate: newEndDate,
                  isActive: true,
                },
              });

            // Generate invoice for the new subscription
            try {
              await this.generateInvoice({
                organizationId: subscription.organizationId,
                fromDate: newStartDate.toISOString(),
                toDate: newEndDate.toISOString(),
              });
            } catch (invoiceError) {
              console.error(
                'Error generating invoice for queued subscription:',
                invoiceError,
              );
              // Continue even if invoice generation fails
            }

            // Clear nextPricingPlanId from old subscription
            await this._prismaService.subscription.update({
              where: { id: subscription.id },
              data: { nextPricingPlanId: null },
            });

            processed.push(newSubscription);
          } catch (error) {
            console.error(
              `Error processing queued subscription ${subscription.id}:`,
              error,
            );
          }
        }
      }

      return {
        processed: processed.length,
        subscriptions: processed,
      };
    } catch (error) {
      console.error('Error processing queued subscriptions:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Cancels a queued subscription by clearing nextPricingPlanId
   */
  async cancelQueuedSubscription(subscriptionId: string): Promise<any> {
    try {
      const subscription = await this._prismaService.subscription.findUnique({
        where: { id: subscriptionId },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      if (!subscription.nextPricingPlanId) {
        throw new BadRequestException('No queued subscription to cancel');
      }

      await this._prismaService.subscription.update({
        where: { id: subscriptionId },
        data: { nextPricingPlanId: null },
      });

      return {
        success: true,
        message: 'Queued subscription cancelled successfully',
      };
    } catch (error) {
      console.error('Error cancelling queued subscription:', error);
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
      const startDate = subscription?.startDate
        ? subscription.startDate
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = subscription?.endDate
        ? subscription.endDate
        : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      // Get all repositories for this organization with their creation dates
      const repositories = await this._prismaService.repository.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      });

      const organizationMembers =
        await this.getOrganizationMembers(organizationId);

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

      // Handle case when there's no active subscription
      const planType = subscription?.pricingPlan?.planType || null;

      // Only validate plan if subscription exists
      if (planType) {
        this.validatePlanForMemberCount(planType, organizationMembers.length);
      }

      let basePrice = 0;
      if (subscription) {
        if (planType === SubscriptionPlanType.CUSTOM) {
          basePrice = subscription.customBasePrice ?? 0;
        } else {
          basePrice = subscription.pricingPlan?.basePrice ?? 0;
        }
      }

      const memberDailyRate = basePrice / totalDaysInPeriod;

      let totalMemberCost = 0;
      const memberUsage = organizationMembers.map((member) => {
        const memberStartDate = new Date(
          Math.max(member.createdAt.getTime(), startDate.getTime()),
        );

        const rawDaysActive = Math.ceil(
          (now.getTime() - memberStartDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        const effectiveDaysActive = Math.max(
          1,
          Math.min(rawDaysActive, totalDaysInPeriod),
        );

        const proratedCost = memberDailyRate * effectiveDaysActive;
        totalMemberCost += proratedCost;

        return {
          id: member.id,
          name: this.getMemberDisplayName(member),
          role: member.role,
          activeDays: effectiveDaysActive,
          proratedCost,
        };
      });

      // Get the quotas from the pricing plan (per user) and scale by active members
      const basePrAnalysisQuota = subscription
        ? subscription.pricingPlan.prAnalysisQuota || DEFAULT_PR_ANALYSIS_QUOTA
        : DEFAULT_PR_ANALYSIS_QUOTA;
      const baseAssistantQuota = subscription
        ? subscription.pricingPlan.assistantQuota || DEFAULT_ASSISTANT_QUOTA
        : DEFAULT_ASSISTANT_QUOTA;

      const totalPrAnalysisQuota =
        basePrAnalysisQuota * organizationMembers.length;
      const totalAssistantQuota =
        baseAssistantQuota * organizationMembers.length;

      let remainingPrQuota = totalPrAnalysisQuota;
      let remainingAssistantQuota = totalAssistantQuota;

      // Process each repository to gather usage insights (informational only)
      const repositoryUsage = repositories.map((repo) => {
        const repoStartDate = new Date(
          Math.max(repo.createdAt.getTime(), startDate.getTime()),
        );

        const daysConnected = Math.ceil(
          (now.getTime() - repoStartDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        const effectiveDaysConnected = Math.max(
          1,
          Math.min(daysConnected, totalDaysInPeriod),
        );

        const repoLogs = usageLogs.filter(
          (log) => log.repositoryId === repo.id,
        );
        const prAnalysisLogs = repoLogs.filter(
          (log) => log.type === 'PR_ANALYSIS',
        );
        const assistantLogs = repoLogs.filter(
          (log) => log.type === 'ASSISTANT_QUESTION',
        );
        const otherEvaluationLogs = repoLogs.filter(
          (log) =>
            log.type !== 'PR_ANALYSIS' && log.type !== 'ASSISTANT_QUESTION',
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
          usageBreakdown: {
            prAnalyses: prAnalysisLogs.length,
            assistantQuestions: assistantLogs.length,
            otherEvaluations: otherEvaluationLogs.length,
          },
          connectedDays: effectiveDaysConnected,
        };
      });

      const totalEvaluations = usageLogs.length;

      // No evaluation overage costs under unlimited usage
      const totalEvaluationOverageCost = 0;

      // Calculate total cost based solely on members
      const totalCost = totalMemberCost;

      // Get all invoices for this organization
      const invoices = await this._prismaService.invoice.findMany({
        where: {
          subscription: {
            organizationId: organizationId,
          },
        },
        include: {
          invoiceItems: true,
          appliedDiscount: {
            select: {
              id: true,
              name: true,
              description: true,
              type: true,
              value: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get queued subscriptions
      const queuedSubscriptions =
        await this.getQueuedSubscriptions(organizationId);

      return {
        subscription: subscription
          ? {
              id: subscription.id,
              planType: subscription.pricingPlan?.planType || null,
              startDate: subscription.startDate,
              endDate: subscription.endDate,
              status: subscription.isActive ? 'ACTIVE' : 'INACTIVE',
              pricingPlan: subscription.pricingPlan
                ? {
                    id: subscription.pricingPlan.id,
                    name: subscription.pricingPlan.name,
                    planType: subscription.pricingPlan.planType,
                    basePrice: subscription.pricingPlan.basePrice,
                  }
                : null,
            }
          : null,
        currentMonthUsage: {
          startDate: subscription?.startDate || startDate,
          endDate: subscription?.endDate || endDate,
          members: {
            total: memberUsage.length,
            list: memberUsage,
          },
          repositories: {
            total: repositories.length,
            list: repositoryUsage,
          },
          totalEvaluations,
          totalCost,
          costBreakdown: {
            memberCost: totalMemberCost,
            evaluationCost: totalEvaluationOverageCost,
          },
        },
        invoices,
        queuedSubscriptions: queuedSubscriptions.map((queue) => ({
          id: queue.id,
          pricingPlan: {
            id: queue.nextPlan.id,
            name: queue.nextPlan.name,
            planType: queue.nextPlan.planType,
            basePrice: queue.nextPlan.basePrice,
          },
          scheduledStartDate: queue.scheduledStartDate,
          status: queue.status,
          createdAt: queue.createdAt,
        })),
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

      const organizationMembers = await this.getOrganizationMembers(
        data.organizationId,
      );
      const activeMemberCount = organizationMembers.length;

      if (activeMemberCount === 0) {
        throw new BadRequestException(
          'At least one active member is required to start a subscription.',
        );
      }

      this.validatePlanForMemberCount(pricingPlan.planType, activeMemberCount);

      const effectivePerUserPrice =
        pricingPlan.planType === SubscriptionPlanType.CUSTOM
          ? (data.customBasePrice ?? pricingPlan.basePrice)
          : pricingPlan.basePrice;

      const flatAddOn =
        pricingPlan.planType !== SubscriptionPlanType.CUSTOM
          ? (data.customBasePrice ?? 0)
          : 0;

      // Calculate initial amount (first month's payment)
      const initialAmount =
        (effectivePerUserPrice ?? 0) * activeMemberCount + flatAddOn;

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
      const organizationMembers = await this.getOrganizationMembers(
        subscription.organizationId,
      );
      const activeMemberCount = organizationMembers.length;

      if (activeMemberCount === 0) {
        throw new BadRequestException(
          'At least one active member is required to change the subscription plan.',
        );
      }

      this.validatePlanForMemberCount(newPlan.planType, activeMemberCount);

      const currentPerUserPrice =
        subscription.pricingPlan.planType === SubscriptionPlanType.CUSTOM
          ? (subscription.customBasePrice ??
            subscription.pricingPlan.basePrice ??
            0)
          : (subscription.pricingPlan.basePrice ?? 0);
      const newPerUserPrice =
        newPlan.planType === SubscriptionPlanType.CUSTOM
          ? (newPlan.basePrice ?? 0)
          : (newPlan.basePrice ?? 0);

      // Calculate prorated amount for the remaining period
      const now = new Date();
      const subscriptionEndDate =
        subscription.endDate ??
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const daysRemaining = Math.max(
        0,
        Math.ceil(
          (subscriptionEndDate.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      const billingCycleLength = 30;
      const perUserDifference = newPerUserPrice - currentPerUserPrice;
      const proratedAmount =
        perUserDifference > 0 && daysRemaining > 0
          ? (perUserDifference * activeMemberCount * daysRemaining) /
            billingCycleLength
          : 0;

      if (proratedAmount > 0) {
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

  // ================== QUOTA MANAGEMENT METHODS ==================

  /**
   * Get the usage counts for PR analyses and assistant questions
   */
  async getUsageCounts(
    organizationId: string,
    repositoryId?: string,
    period?: { fromDate?: Date; toDate?: Date },
  ): Promise<{
    prAnalysisCount: number;
    assistantQuestionCount: number;
  }> {
    try {
      const whereClause: any = { organizationId };

      // Add repository filter if specified
      if (repositoryId) {
        whereClause.repositoryId = repositoryId;
      }

      if (period) {
        whereClause.createdAt = {};
        if (period.fromDate) {
          whereClause.createdAt.gte = period.fromDate;
        }
        if (period.toDate) {
          whereClause.createdAt.lte = period.toDate;
        }
      }

      // Count PR analyses
      const prAnalysisCount = await this._prismaService.usageLog.count({
        where: {
          ...whereClause,
          type: 'PR_ANALYSIS',
        },
      });

      // Count assistant questions
      const assistantQuestionCount = await this._prismaService.usageLog.count({
        where: {
          ...whereClause,
          type: 'ASSISTANT_QUESTION',
        },
      });

      return {
        prAnalysisCount,
        assistantQuestionCount,
      };
    } catch (error) {
      console.error('Error getting usage counts:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Calculate the billing rate based on current usage
   */
  async calculateBillingRate(
    organizationId: string,
    type: 'PR_ANALYSIS' | 'ASSISTANT_QUESTION',
    repositoryId?: string,
  ): Promise<{
    withinQuota: boolean;
    rate: number;
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
        throw new NotFoundException('No active subscription found');
      }

      // Get current month's date range
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

      // Get usage counts for the current month for this specific repository
      const { prAnalysisCount, assistantQuestionCount } =
        await this.getUsageCounts(organizationId, repositoryId, {
          fromDate: startDate,
          toDate: endDate,
        });

      // Determine base evaluation price
      const evaluationPrice =
        subscription.customEvalPrice ||
        subscription.pricingPlan.evaluationPrice;

      // Get the quotas from the pricing plan
      const prAnalysisQuota = subscription.pricingPlan.prAnalysisQuota;
      const assistantQuota = subscription.pricingPlan.assistantQuota;

      if (type === 'PR_ANALYSIS') {
        return {
          withinQuota: prAnalysisCount < prAnalysisQuota,
          rate: evaluationPrice, // PR analysis always uses the full evaluation rate
        };
      } else {
        // Assistant question uses 1/3 of the evaluation rate
        return {
          withinQuota: assistantQuestionCount < assistantQuota,
          rate: evaluationPrice / 3,
        };
      }
    } catch (error) {
      console.error('Error calculating billing rate:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Track usage with quota awareness
   */
  async trackUsageWithQuota(data: CreateUsageLogDto): Promise<IUsageLog> {
    try {
      const { organizationId, type, repositoryId } = data;

      // Calculate current rate based on quota for this specific repository
      const rateInfo = await this.calculateBillingRate(
        organizationId,
        type as any,
        repositoryId,
      );

      // Update description to indicate if this was within quota
      const descriptionPrefix = rateInfo.withinQuota
        ? '[Within Quota] '
        : '[Billable] ';

      // Create the usage log with updated description
      return this.createUsageLog({
        ...data,
        description: `${descriptionPrefix}${data.description}`,
      });
    } catch (error) {
      console.error('Error tracking usage with quota:', error);
      throw new BadRequestException(error.message);
    }
  }
}
