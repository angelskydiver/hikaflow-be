import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvoiceStatus,
  PricingModelType,
  Prisma,
  SubscriptionPlanType,
} from '@prisma/client';
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

  /**
   * Get active projects (repositories) for an organization
   * Uses Repository.createdAt for billing tracking (when project was added to organization)
   */
  private async getOrganizationProjects(organizationId: string) {
    return this._prismaService.repository.findMany({
      where: {
        organizationId,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ================== PRICING PLAN METHODS ==================

  async createPricingPlan(data: CreatePricingPlanDto): Promise<IPricingPlan> {
    try {
      const {
        name,
        planType,
        pricingModelType = PricingModelType.USER_BASED,
        basePrice = 0,
        projectBasePrice = 0,
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
          pricingModelType,
          basePrice,
          projectBasePrice,
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
      where: {
        active: true,
        OR: [
          { basePrice: { gt: 0 } }, // User-based plans
          { projectBasePrice: { gt: 0 } }, // Project-based plans
        ],
      },
      // Note: Frontend handles sorting by pricing model type
      orderBy: { createdAt: 'asc' },
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
      // 🔍 DEBUG: Log incoming request data
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log('🆕 CREATE SUBSCRIPTION REQUEST');
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log('📥 INCOMING DATA:');
      console.log('   - Organization ID:', data.organizationId);
      console.log('   - Requested Plan ID:', data.pricingPlanId);
      console.log(
        '   - Requested Pricing Model Type:',
        data.pricingModelType || 'NOT PROVIDED',
      );
      console.log('   - Custom Base Price:', data.customBasePrice || 'NONE');
      console.log(
        '   - Custom Project Price:',
        data.customProjectPrice || 'NONE',
      );

      const {
        organizationId,
        pricingPlanId,
        pricingModelType,
        customBasePrice,
        customProjectPrice,
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

      // 🔍 DEBUG: Log fetched plan details
      console.log('📦 PLAN DETAILS FROM DATABASE:');
      console.log('   - Plan ID:', pricingPlan.id);
      console.log('   - Plan Name:', pricingPlan.name);
      console.log('   - Plan Type:', pricingPlan.planType);
      console.log('   - Plan Pricing Model:', pricingPlan.pricingModelType);
      console.log('   - Base Price (User):', pricingPlan.basePrice);
      console.log('   - Project Base Price:', pricingPlan.projectBasePrice);

      // Determine pricing model type (use from plan if not specified, default to USER_BASED)
      const finalPricingModelType =
        pricingModelType ||
        pricingPlan.pricingModelType ||
        PricingModelType.USER_BASED;

      // 🔍 DEBUG: Log final pricing model type
      console.log('💰 FINAL PRICING MODEL TYPE:');
      console.log('   - Requested:', pricingModelType || 'NOT PROVIDED');
      console.log('   - From Plan:', pricingPlan.pricingModelType);
      console.log('   - Final Decision:', finalPricingModelType);

      // Check if this is a custom plan
      if (pricingPlan.planType === SubscriptionPlanType.CUSTOM) {
        if (finalPricingModelType === PricingModelType.USER_BASED) {
          if (!customBasePrice || !customEvalPrice) {
            throw new BadRequestException(
              'Custom user-based pricing requires customBasePrice and customEvalPrice',
            );
          }
        } else if (finalPricingModelType === PricingModelType.PROJECT_BASED) {
          if (!customProjectPrice || !customEvalPrice) {
            throw new BadRequestException(
              'Custom project-based pricing requires customProjectPrice and customEvalPrice',
            );
          }
        }
      }

      // Validate based on pricing model type
      if (finalPricingModelType === PricingModelType.USER_BASED) {
        const organizationMembers =
          await this.getOrganizationMembers(organizationId);
        const activeMemberCount = organizationMembers.length;

        if (activeMemberCount === 0) {
          throw new BadRequestException(
            'At least one active member is required to create a user-based subscription.',
          );
        }

        this.validatePlanForMemberCount(
          pricingPlan.planType,
          activeMemberCount,
        );
      } else if (finalPricingModelType === PricingModelType.PROJECT_BASED) {
        const organizationProjects =
          await this.getOrganizationProjects(organizationId);
        const activeProjectCount = organizationProjects.length;

        if (activeProjectCount === 0) {
          throw new BadRequestException(
            'At least one active project is required to create a project-based subscription.',
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
          include: {
            pricingPlan: true,
          },
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

      // CRITICAL: Deactivate ALL existing active subscriptions for this organization
      // This ensures we don't have multiple active subscriptions causing invoice issues
      const allActiveSubscriptions =
        await this._prismaService.subscription.findMany({
          where: {
            organizationId,
            isActive: true,
          },
          include: {
            pricingPlan: true,
          },
        });

      if (allActiveSubscriptions.length > 0) {
        console.log(
          `🗑️ Deactivating ${allActiveSubscriptions.length} existing active subscription(s):`,
        );
        for (const sub of allActiveSubscriptions) {
          console.log(
            `   - Subscription ${sub.id}: Plan ${sub.pricingPlan?.name || 'N/A'} (${sub.pricingPlanId})`,
          );

          // Cancel in Stripe if exists
          if (sub.stripeSubscriptionId) {
            try {
              await this.stripe.subscriptions.cancel(sub.stripeSubscriptionId);
            } catch (stripeError) {
              console.warn(
                'Could not cancel Stripe subscription:',
                stripeError,
              );
            }
          }
        }

        // Deactivate all of them at once
        await this._prismaService.subscription.updateMany({
          where: {
            organizationId,
            isActive: true,
          },
          data: {
            isActive: false,
            endDate: new Date(),
          },
        });
        console.log('✅ All old active subscriptions deactivated');
      }

      // Keep the existingSubscription reference for logging purposes
      if (existingSubscription) {
        // Already handled above, but log for reference
        console.log(
          '   - Primary subscription reference:',
          existingSubscription.id,
        );
      }

      const subscriptionEndDate = new Date();
      subscriptionEndDate.setDate(subscriptionEndDate.getDate() + 30);

      // 🔍 DEBUG: Log new subscription creation
      console.log('🆕 Creating NEW subscription:');
      console.log('   - Organization ID:', organizationId);
      console.log('   - Plan ID:', pricingPlanId);
      console.log('   - Plan Name:', pricingPlan.name);
      console.log('   - Pricing Model Type:', finalPricingModelType);
      console.log('   - Base Price (User):', pricingPlan.basePrice);
      console.log('   - Project Base Price:', pricingPlan.projectBasePrice);
      console.log('   - Is Active: true');

      // Create subscription in database
      const newSubscription = await this._prismaService.subscription.create({
        data: {
          organizationId,
          pricingPlanId,
          pricingModelType: finalPricingModelType,
          stripeCustomerId,
          stripeSubscriptionId, // Will be null by default
          startDate: new Date(),
          endDate: subscriptionEndDate,
          isActive: true,
          customBasePrice,
          customProjectPrice,
          customEvalPrice,
        },
        include: {
          pricingPlan: true,
        },
      });

      // 🔍 DEBUG: Verify subscription was created correctly
      console.log('✅ NEW subscription created:');
      console.log('   - Subscription ID:', newSubscription.id);
      console.log('   - Plan ID:', newSubscription.pricingPlanId);
      console.log('   - Plan Name:', newSubscription.pricingPlan.name);
      console.log('   - Pricing Model:', newSubscription.pricingModelType);
      console.log('   - Is Active:', newSubscription.isActive);

      return newSubscription;
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw new BadRequestException(error.message);
    }
  }

  async getSubscriptionByOrganizationId(
    organizationId: string,
  ): Promise<ISubscription> {
    // 🔍 DEBUG: Log subscription lookup
    console.log('🔍 Looking up subscription for organization:', organizationId);

    // CRITICAL: Order by updatedAt first, then createdAt to get the most recently modified subscription
    // This ensures we get the NEW subscription if multiple exist
    const subscription = await this._prismaService.subscription.findFirst({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        pricingPlan: true,
      },
      orderBy: [
        { updatedAt: 'desc' }, // First priority: most recently updated (new subscriptions are updated when created)
        { createdAt: 'desc' }, // Second priority: most recently created
      ],
    });

    if (!subscription) {
      console.error(
        '❌ No active subscription found for organization:',
        organizationId,
      );
      throw new NotFoundException(
        'No active subscription found for this organization',
      );
    }

    // 🔍 DEBUG: Log found subscription details
    console.log('✅ Found subscription:');
    console.log('   - Subscription ID:', subscription.id);
    console.log('   - Plan ID:', subscription.pricingPlanId);
    console.log('   - Plan Name:', subscription.pricingPlan?.name || 'N/A');
    console.log('   - Plan Type:', subscription.pricingPlan?.planType || 'N/A');
    console.log(
      '   - Pricing Model:',
      subscription.pricingModelType || 'USER_BASED',
    );
    console.log(
      '   - Base Price (User):',
      subscription.pricingPlan?.basePrice || 'N/A',
    );
    console.log(
      '   - Project Base Price:',
      subscription.pricingPlan?.projectBasePrice || 'N/A',
    );
    console.log('   - Is Active:', subscription.isActive);
    console.log('   - Created At:', subscription.createdAt);
    console.log('   - Updated At:', subscription.updatedAt);

    // 🔍 DEBUG: Also check if there are multiple active subscriptions
    const allActiveSubscriptions =
      await this._prismaService.subscription.findMany({
        where: {
          organizationId,
          isActive: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          pricingPlanId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

    if (allActiveSubscriptions.length > 1) {
      console.warn('⚠️ WARNING: Multiple active subscriptions found!');
      console.warn(
        '   - Total active subscriptions:',
        allActiveSubscriptions.length,
      );
      allActiveSubscriptions.forEach((sub, index) => {
        console.warn(
          `   - Subscription ${index + 1}:`,
          sub.id,
          'Plan:',
          sub.pricingPlanId,
          'Created:',
          sub.createdAt,
          'Updated:',
          sub.updatedAt,
        );
      });
      console.warn(
        '   - Using most recent one (by createdAt):',
        subscription.id,
      );
    }

    return subscription;
  }

  async updateSubscription(
    subscriptionId: string,
    data: UpdateSubscriptionDto,
  ): Promise<ISubscription> {
    try {
      // 🔍 DEBUG: Log incoming request data
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log('🔄 UPDATE SUBSCRIPTION REQUEST');
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log('📥 INCOMING DATA:');
      console.log('   - Subscription ID:', subscriptionId);
      console.log(
        '   - Requested Plan ID:',
        data.pricingPlanId || 'NOT PROVIDED',
      );
      console.log(
        '   - Requested Pricing Model Type:',
        data.pricingModelType || 'NOT PROVIDED',
      );
      console.log('   - Immediate Change:', data.immediateChange);
      console.log('   - Is Active:', data.isActive);

      const subscription = await this._prismaService.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          pricingPlan: true,
          nextPricingPlan: true, // Include queued plan if exists
        },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      // 🔍 DEBUG: Log current subscription state
      console.log('📋 CURRENT SUBSCRIPTION STATE:');
      console.log('   - Current Plan ID:', subscription.pricingPlanId);
      console.log(
        '   - Current Plan Name:',
        subscription.pricingPlan?.name || 'N/A',
      );
      console.log(
        '   - Current Plan Type:',
        subscription.pricingPlan?.planType || 'N/A',
      );
      console.log(
        '   - Current Pricing Model:',
        subscription.pricingModelType || 'USER_BASED',
      );
      console.log('   - Is Active:', subscription.isActive);
      console.log(
        '   - Queued Plan ID:',
        subscription.nextPricingPlanId || 'NONE',
      );

      // Check if there's an existing queued subscription change
      const hasQueuedChange = !!subscription.nextPricingPlanId;
      if (hasQueuedChange) {
        console.log(
          `📋 Found existing queued subscription change: ${subscription.nextPricingPlanId}`,
        );
      }

      // Handle pricing model type changes
      const currentPricingModelType =
        subscription.pricingModelType || PricingModelType.USER_BASED;
      const newPricingModelType =
        data.pricingModelType ||
        (data.pricingPlanId
          ? (await this.getPricingPlanById(data.pricingPlanId)).pricingModelType
          : null) ||
        currentPricingModelType;

      // Check if pricing model is changing
      const isPricingModelChanging =
        newPricingModelType !== currentPricingModelType;

      // Handle plan changes
      const isPlanChanging =
        data.pricingPlanId && data.pricingPlanId !== subscription.pricingPlanId;

      if (isPlanChanging || isPricingModelChanging) {
        // 🔍 DEBUG: Log plan change detection
        console.log('🔄 PLAN CHANGE DETECTED:');
        console.log('   - Plan Changing:', isPlanChanging);
        console.log('   - Pricing Model Changing:', isPricingModelChanging);
        console.log('   - Current Plan ID:', subscription.pricingPlanId);
        console.log('   - New Plan ID (requested):', data.pricingPlanId);
        console.log('   - Current Pricing Model:', currentPricingModelType);
        console.log('   - New Pricing Model:', newPricingModelType);

        const newPlan = data.pricingPlanId
          ? await this.getPricingPlanById(data.pricingPlanId)
          : subscription.pricingPlan;

        // 🔍 DEBUG: Log new plan details
        console.log('📦 NEW PLAN DETAILS:');
        console.log('   - Plan ID:', newPlan.id);
        console.log('   - Plan Name:', newPlan.name);
        console.log('   - Plan Type:', newPlan.planType);
        console.log('   - Plan Pricing Model:', newPlan.pricingModelType);
        console.log('   - Base Price (User):', newPlan.basePrice);
        console.log('   - Project Base Price:', newPlan.projectBasePrice);

        // Validate based on pricing model type
        if (newPricingModelType === PricingModelType.USER_BASED) {
          const organizationMembers = await this.getOrganizationMembers(
            subscription.organizationId,
          );
          this.validatePlanForMemberCount(
            newPlan.planType,
            organizationMembers.length,
          );
        } else if (newPricingModelType === PricingModelType.PROJECT_BASED) {
          const organizationProjects = await this.getOrganizationProjects(
            subscription.organizationId,
          );
          // Allow 0 projects - user can add projects later
          console.log(
            `Project-based plan selected with ${organizationProjects.length} projects`,
          );
        }

        // Calculate current and new plan prices to determine upgrade/downgrade
        const getCurrentPlanPrice = () => {
          if (currentPricingModelType === PricingModelType.PROJECT_BASED) {
            return (
              subscription.customProjectPrice ??
              subscription.pricingPlan.projectBasePrice ??
              0
            );
          } else {
            return (
              subscription.customBasePrice ??
              subscription.pricingPlan.basePrice ??
              0
            );
          }
        };

        const getNewPlanPrice = () => {
          if (newPricingModelType === PricingModelType.PROJECT_BASED) {
            return newPlan.projectBasePrice ?? 0;
          } else {
            return newPlan.basePrice ?? 0;
          }
        };

        // Get unit counts for accurate price comparison
        let currentUnitCount = 0;
        let newUnitCount = 0;

        if (currentPricingModelType === PricingModelType.PROJECT_BASED) {
          const projects = await this.getOrganizationProjects(
            subscription.organizationId,
          );
          currentUnitCount = projects.length;
        } else {
          const members = await this.getOrganizationMembers(
            subscription.organizationId,
          );
          currentUnitCount = members.length;
        }

        if (newPricingModelType === PricingModelType.PROJECT_BASED) {
          const projects = await this.getOrganizationProjects(
            subscription.organizationId,
          );
          newUnitCount = projects.length;
        } else {
          const members = await this.getOrganizationMembers(
            subscription.organizationId,
          );
          newUnitCount = members.length;
        }

        const currentTotalPrice =
          getCurrentPlanPrice() * Math.max(currentUnitCount, 1);
        const newTotalPrice = getNewPlanPrice() * Math.max(newUnitCount, 1);

        const isUpgrade = newTotalPrice > currentTotalPrice;
        const isDowngrade = newTotalPrice < currentTotalPrice;

        // 🔍 DEBUG: Detailed price comparison
        console.log('💰 PRICE CALCULATION:');
        console.log('   - Current Plan Price Calculation:');
        console.log(
          '     * Unit Price:',
          `$${getCurrentPlanPrice().toFixed(2)}`,
        );
        console.log(
          '     * Unit Count:',
          currentUnitCount,
          currentPricingModelType === PricingModelType.PROJECT_BASED
            ? 'projects'
            : 'members',
        );
        console.log(
          '     * Total Current Price:',
          `$${currentTotalPrice.toFixed(2)}`,
        );
        console.log('   - New Plan Price Calculation:');
        console.log('     * Unit Price:', `$${getNewPlanPrice().toFixed(2)}`);
        console.log(
          '     * Unit Count:',
          newUnitCount,
          newPricingModelType === PricingModelType.PROJECT_BASED
            ? 'projects'
            : 'members',
        );
        console.log('     * Total New Price:', `$${newTotalPrice.toFixed(2)}`);
        console.log(
          '   - Change Type:',
          isUpgrade ? 'UPGRADE' : isDowngrade ? 'DOWNGRADE' : 'SAME PRICE',
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

        // Determine if change should be immediate
        // CRITICAL: If user explicitly requests immediate change (data.immediateChange === true),
        // honor it regardless of upgrade/downgrade/same-price
        // - Explicit immediate request: ALWAYS apply immediately (even for downgrades)
        // - Downgrades without explicit immediate: Queue for next billing cycle
        // - Upgrades: Apply immediately with credit (default behavior)
        // - Same price: Queue by default (unless user explicitly wants immediate)
        let immediateChange = false;

        // PRIORITY 1: If user explicitly requests immediate change, honor it ALWAYS
        if (data.immediateChange === true) {
          immediateChange = true;
          console.log(
            `⚡ User explicitly requested immediate change - honoring request regardless of upgrade/downgrade`,
          );
        } else if (isDowngrade) {
          // Downgrades are queued by default (unless user explicitly wants immediate)
          immediateChange = false;
          console.log(
            `⏭️ Downgrade detected - will be queued for next billing cycle (NO payment will be charged)`,
          );
        } else if (isUpgrade) {
          // Upgrades are immediate by default (with credit)
          immediateChange = data.immediateChange !== false; // Default to true unless explicitly false
          console.log(
            `⬆️ Upgrade detected - will be applied immediately with credit`,
          );
        } else {
          // Same price - queue by default unless user explicitly wants immediate
          immediateChange = !!data.immediateChange;
        }

        // 🔍 DEBUG: Log immediate change decision
        console.log('⚡ IMMEDIATE CHANGE DECISION:');
        console.log('   - Is Downgrade:', isDowngrade);
        console.log('   - Is Upgrade:', isUpgrade);
        console.log(
          '   - User Requested Immediate Change:',
          data.immediateChange,
        );
        console.log('   - Final Immediate Change:', immediateChange);
        console.log('   - Has Queued Plan:', hasQueuedChange);
        if (immediateChange && isDowngrade) {
          console.log(
            '   - ⚠️ NOTE: User explicitly requested immediate change for downgrade - will be honored',
          );
        }

        // CRITICAL: Only queue downgrades if user did NOT explicitly request immediate change
        // If user explicitly requests immediate, honor it even for downgrades
        if (isDowngrade && !immediateChange) {
          console.log(
            `🔄 Processing downgrade - queuing for next billing cycle (skipping immediate change path)`,
          );

          // Queue the downgrade - NO payment charged
          const updateData: any = {
            nextPricingPlanId: isPlanChanging ? data.pricingPlanId : null,
          };

          // If pricing model is changing, store that too
          if (isPricingModelChanging) {
            if (isPlanChanging) {
              updateData.nextPricingPlanId = data.pricingPlanId;
            }
          }

          // Clear any existing queued plan if user is changing to a different plan
          if (hasQueuedChange && isPlanChanging) {
            console.log(
              `🔄 Updating queued subscription from ${subscription.nextPricingPlanId} to ${data.pricingPlanId}`,
            );
          }

          const updatedSubscription =
            await this._prismaService.subscription.update({
              where: { id: subscriptionId },
              data: updateData,
              include: {
                pricingPlan: true,
                nextPricingPlan: true,
              },
            });

          return {
            ...updatedSubscription,
            message:
              'Your subscription downgrade will be automatically implemented at the start of your next billing cycle. You can continue using your current plan features until then.',
            queued: true,
            isDowngrade: true,
          } as any;
        }

        // If subscription is active (not trial) and hasn't ended, queue the change
        // This happens for upgrades/same-price when user doesn't want immediate change
        // IMPORTANT: Only queue - NO payment is charged here
        // CRITICAL: If subscription is cancelled (not active), skip queuing and activate immediately
        // CRITICAL: If user requests immediate change, skip queuing and activate immediately
        if (
          isSubscriptionActive &&
          !isTrialSubscription &&
          !immediateChange &&
          subscription.isActive
        ) {
          // If there's already a queued change, update it instead of creating a new one
          // This syncs the queued plan with the new request
          const updateData: any = {
            nextPricingPlanId: isPlanChanging ? data.pricingPlanId : null,
          };

          // 🔍 DEBUG: Log queued plan update
          if (hasQueuedChange && isPlanChanging) {
            console.log('🔄 Updating queued plan:');
            console.log(
              '   - Old Queued Plan ID:',
              subscription.nextPricingPlanId,
            );
            console.log('   - New Queued Plan ID:', data.pricingPlanId);
          } else if (isPlanChanging) {
            console.log(
              '📋 Queuing new plan for next billing cycle:',
              data.pricingPlanId,
            );
          }

          // If pricing model is changing, store that too
          if (isPricingModelChanging) {
            // We need to store the new pricing model type somehow
            // For now, we'll update nextPricingPlanId and handle model type in the queued plan
            if (isPlanChanging) {
              updateData.nextPricingPlanId = data.pricingPlanId;
            }
          }

          // Clear any existing queued plan if user is changing to a different plan
          if (hasQueuedChange && isPlanChanging) {
            console.log(
              `🔄 Updating queued subscription from ${subscription.nextPricingPlanId} to ${data.pricingPlanId}`,
            );
          }

          const updatedSubscription =
            await this._prismaService.subscription.update({
              where: { id: subscriptionId },
              data: updateData,
              include: {
                pricingPlan: true,
                nextPricingPlan: true,
              },
            });

          const message = isDowngrade
            ? 'Your subscription downgrade will be automatically implemented at the start of your next billing cycle. You can continue using your current plan features until then.'
            : hasQueuedChange
              ? 'Your queued subscription change has been updated. It will activate when your current subscription ends.'
              : 'Subscription change queued. It will activate when your current subscription ends. You can continue using your current plan until then.';

          console.log(
            `✅ Subscription change queued (NO payment charged). Plan will change at next billing cycle.`,
          );

          return {
            ...updatedSubscription,
            message,
            queued: true,
            isDowngrade,
          } as any;
        }

        // If trial subscription, subscription has ended, or user requested immediate change
        // Calculate credit for unused time and apply to new invoice
        // Fix: Start date should be TODAY, end date should be 30 days from TODAY
        const newStartDate = new Date();
        newStartDate.setHours(0, 0, 0, 0); // Start of today
        const newEndDate = new Date(newStartDate);
        newEndDate.setDate(newEndDate.getDate() + 30); // 30 days from today
        newEndDate.setHours(23, 59, 59, 999); // End of that day

        // Calculate credit for unused time from current subscription
        let creditAmount = 0;
        if (
          !isTrialSubscription &&
          subscriptionEndDate &&
          subscriptionEndDate > today
        ) {
          const daysRemaining = Math.ceil(
            (subscriptionEndDate.getTime() - today.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          const totalDaysInPeriod = 30;

          // Calculate what was paid for current subscription
          // Use the already calculated values from above
          const currentPlanPrice =
            currentPricingModelType === PricingModelType.PROJECT_BASED
              ? (subscription.customProjectPrice ??
                subscription.pricingPlan.projectBasePrice ??
                0)
              : (subscription.customBasePrice ??
                subscription.pricingPlan.basePrice ??
                0);

          // Use the unit count already calculated above
          // (currentUnitCount is already available from the upgrade/downgrade detection)

          // Calculate prorated credit for unused time
          const totalPaid = currentPlanPrice * Math.max(currentUnitCount, 1);
          creditAmount = (totalPaid / totalDaysInPeriod) * daysRemaining;

          console.log(
            `Calculated credit: $${creditAmount.toFixed(2)} for ${daysRemaining} unused days (${currentUnitCount} ${currentPricingModelType === PricingModelType.PROJECT_BASED ? 'projects' : 'members'} × $${currentPlanPrice.toFixed(2)})`,
          );
        }

        console.log(
          `Immediate change: ${newStartDate.toISOString()} to ${newEndDate.toISOString()}`,
        );

        // Update subscription first
        console.log(
          `🔄 Updating subscription: Plan=${isPlanChanging ? data.pricingPlanId : 'unchanged'}, Model=${newPricingModelType}, Credit=$${creditAmount.toFixed(2)}`,
        );
        console.log(
          `📋 Current subscription: Plan=${subscription.pricingPlanId} (${subscription.pricingPlan.name}), Model=${currentPricingModelType}`,
        );

        // Prepare update data - always include pricingPlanId if plan is changing
        // Also clear any queued subscription since we're applying change immediately
        // CRITICAL: If subscription is cancelled (not active), reactivate it immediately
        // CRITICAL: When user requests immediate change, clear any queued plans and charge for the NEW plan
        const updateData: any = {
          pricingModelType: newPricingModelType,
          startDate: newStartDate,
          endDate: newEndDate,
          nextPricingPlanId: null, // CRITICAL: Clear any queued subscription when applying immediate change
          isActive: true, // Reactivate if subscription was cancelled
        };

        // 🔍 DEBUG: Log queued plan clearing for immediate changes
        // CRITICAL: Always clear queued plan when immediate change is requested
        if (hasQueuedChange) {
          console.log('🗑️ IMMEDIATE CHANGE REQUESTED - CLEARING QUEUED PLAN:');
          console.log(
            '   - Previous Queued Plan ID:',
            subscription.nextPricingPlanId,
          );
          console.log('   - New Plan ID (to be charged):', data.pricingPlanId);
          console.log(
            '   - Reason: User requested immediate change - queued plan will be removed',
          );
          console.log(
            '   - ⚠️ IMPORTANT: Will charge for NEW plan, NOT queued plan',
          );
        } else {
          console.log(
            '✅ No queued plan to clear - proceeding with immediate change',
          );
        }

        // CRITICAL: Ensure nextPricingPlanId is ALWAYS null for immediate changes
        // This removes any queued plan when user selects immediate change
        if (updateData.nextPricingPlanId !== null) {
          console.warn(
            '⚠️ WARNING: nextPricingPlanId should be null for immediate change, forcing it to null',
          );
          updateData.nextPricingPlanId = null;
        }

        if (isPlanChanging && data.pricingPlanId) {
          updateData.pricingPlanId = data.pricingPlanId;
          console.log(`📝 Setting new pricingPlanId: ${data.pricingPlanId}`);
        }

        // Log if we're reactivating a cancelled subscription
        if (!subscription.isActive) {
          console.log(
            `🔄 Reactivating cancelled subscription and applying new plan immediately`,
          );
        }

        // Store original subscription state for potential rollback
        const originalSubscription = {
          pricingPlanId: subscription.pricingPlanId,
          pricingModelType: subscription.pricingModelType,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        };

        // 🔍 DEBUG: Log what we're updating
        console.log('📝 UPDATING SUBSCRIPTION WITH:');
        console.log(
          '   - Pricing Plan ID:',
          updateData.pricingPlanId || 'UNCHANGED',
        );
        console.log('   - Pricing Model Type:', updateData.pricingModelType);
        console.log('   - Start Date:', updateData.startDate);
        console.log('   - End Date:', updateData.endDate);
        console.log('   - Is Active:', updateData.isActive);

        const updatedSubscription =
          await this._prismaService.subscription.update({
            where: { id: subscriptionId },
            data: updateData,
            include: {
              pricingPlan: true,
            },
          });

        // 🔍 DEBUG: Verify what was actually saved
        console.log('✅ SUBSCRIPTION UPDATED - VERIFICATION:');
        console.log('   - Saved Plan ID:', updatedSubscription.pricingPlanId);
        console.log(
          '   - Saved Plan Name:',
          updatedSubscription.pricingPlan.name,
        );
        console.log(
          '   - Saved Plan Type:',
          updatedSubscription.pricingPlan.planType,
        );
        console.log(
          '   - Saved Pricing Model:',
          updatedSubscription.pricingModelType,
        );
        console.log('   - Saved Is Active:', updatedSubscription.isActive);

        // Verify plan ID matches what was requested
        if (
          isPlanChanging &&
          updatedSubscription.pricingPlanId !== data.pricingPlanId
        ) {
          console.error('❌ PLAN ID MISMATCH!');
          console.error('   - Expected Plan ID:', data.pricingPlanId);
          console.error(
            '   - Actual Plan ID:',
            updatedSubscription.pricingPlanId,
          );
        } else if (isPlanChanging) {
          console.log('✅ Plan ID matches request:', data.pricingPlanId);
        }

        // Verify the subscription was actually updated
        if (
          isPlanChanging &&
          updatedSubscription.pricingPlanId !== data.pricingPlanId
        ) {
          console.error(
            `❌ Subscription plan update failed! Expected: ${data.pricingPlanId}, Got: ${updatedSubscription.pricingPlanId}`,
          );
          throw new BadRequestException(
            'Failed to update subscription plan. Please try again.',
          );
        }

        // Generate invoice for the NEW subscription period with credit applied
        // IMPORTANT: Payment is charged here when plan actually changes
        try {
          // 🔍 DEBUG: Log invoice generation details
          console.log(
            '═══════════════════════════════════════════════════════════',
          );
          console.log('💰 GENERATING INVOICE FOR IMMEDIATE CHANGE');
          console.log(
            '═══════════════════════════════════════════════════════════',
          );
          console.log('📊 INVOICE DETAILS:');
          console.log('   - Organization ID:', subscription.organizationId);
          console.log('   - Subscription ID:', updatedSubscription.id);
          console.log(
            '   - Plan ID (from subscription - THIS IS THE PLAN BEING CHARGED):',
            updatedSubscription.pricingPlanId,
          );
          console.log('   - Plan Name:', updatedSubscription.pricingPlan.name);
          console.log(
            '   - Plan Type:',
            updatedSubscription.pricingPlan.planType,
          );
          console.log(
            '   - Pricing Model:',
            updatedSubscription.pricingModelType,
          );
          console.log(
            '   - Base Price (User):',
            updatedSubscription.pricingPlan.basePrice,
          );
          console.log(
            '   - Project Base Price:',
            updatedSubscription.pricingPlan.projectBasePrice,
          );
          console.log('   - Credit Amount:', `$${creditAmount.toFixed(2)}`);
          console.log(
            '   - Period:',
            `${newStartDate.toISOString()} to ${newEndDate.toISOString()}`,
          );
          console.log('   - Is For Subscription Update: true');
          if (hasQueuedChange) {
            console.log(
              '   - ⚠️ IMPORTANT: Previous queued plan cleared - charging for NEW plan only',
            );
            console.log(
              '   - Previous Queued Plan ID:',
              subscription.nextPricingPlanId,
            );
            console.log(
              '   - New Plan ID (being charged):',
              updatedSubscription.pricingPlanId,
            );
          }

          const invoiceResult = await this.generateInvoice({
            organizationId: subscription.organizationId,
            fromDate: newStartDate.toISOString(),
            toDate: newEndDate.toISOString(),
            isForSubscriptionUpdate: true,
            creditAmount: creditAmount > 0 ? creditAmount : undefined, // Apply credit if available
          });

          // Check if invoice was created and if payment is required
          let invoice: any = null;
          if (invoiceResult && typeof invoiceResult === 'object') {
            if ('id' in invoiceResult) {
              invoice = invoiceResult;
            } else if ('success' in invoiceResult && invoiceResult.success) {
              // Invoice generation returned success but no payment needed (e.g., $0 after credit)
              console.log(
                `✅ Invoice generated successfully. ${invoiceResult.message || 'No payment required.'}`,
              );
              return {
                ...updatedSubscription,
                message:
                  creditAmount > 0
                    ? `Subscription changed immediately. Credit of $${creditAmount.toFixed(2)} for unused time has been applied. ${invoiceResult.message || ''}`
                    : `Subscription changed immediately. ${invoiceResult.message || ''}`,
                creditApplied: creditAmount,
              } as any;
            }
          }

          // If invoice was created, check if payment was successful
          if (invoice) {
            console.log(
              `📄 Invoice created: ${invoice.id}, Total: $${invoice.total}, Status: ${invoice.status}`,
            );

            // Check if invoice requires payment and if it was paid
            if (invoice.total > 0) {
              // Check if invoice was automatically paid
              if (invoice.status === InvoiceStatus.PAID) {
                console.log(
                  `✅ Payment successful. Subscription change completed.`,
                );
                return {
                  ...updatedSubscription,
                  message:
                    creditAmount > 0
                      ? `Subscription changed immediately. Credit of $${creditAmount.toFixed(2)} for unused time has been applied to your invoice. Payment processed successfully.`
                      : 'Subscription changed immediately. Payment processed successfully.',
                  creditApplied: creditAmount,
                } as any;
              } else if (invoice.status === InvoiceStatus.PENDING) {
                // Payment is pending - subscription is updated but payment needs to be processed
                console.log(
                  `⏳ Payment pending. Subscription updated but payment needs to be processed.`,
                );
                return {
                  ...updatedSubscription,
                  message:
                    creditAmount > 0
                      ? `Subscription changed immediately. Credit of $${creditAmount.toFixed(2)} for unused time has been applied. Please complete payment for invoice ${invoice.invoiceNumber}.`
                      : `Subscription changed immediately. Please complete payment for invoice ${invoice.invoiceNumber}.`,
                  creditApplied: creditAmount,
                  invoiceId: invoice.id,
                  requiresPayment: true,
                } as any;
              } else if (invoice.status === InvoiceStatus.FAILED) {
                // Payment failed - REVERT subscription change
                console.error(
                  `❌ Payment failed. Reverting subscription change...`,
                );
                await this._prismaService.subscription.update({
                  where: { id: subscriptionId },
                  data: {
                    pricingPlanId: originalSubscription.pricingPlanId,
                    pricingModelType: originalSubscription.pricingModelType,
                    startDate: originalSubscription.startDate,
                    endDate: originalSubscription.endDate,
                    nextPricingPlanId: hasQueuedChange
                      ? subscription.nextPricingPlanId
                      : null, // Restore queued plan if it existed
                  },
                });
                throw new BadRequestException(
                  `Payment failed. Subscription change has been reverted. Please update your payment method and try again.`,
                );
              }
            } else {
              // Invoice total is $0 (credit covered everything)
              console.log(
                `✅ Invoice total is $0 (credit covered full amount). Subscription change completed.`,
              );
              return {
                ...updatedSubscription,
                message:
                  creditAmount > 0
                    ? `Subscription changed immediately. Credit of $${creditAmount.toFixed(2)} for unused time covered the full amount. No payment required.`
                    : 'Subscription changed immediately. No payment required.',
                creditApplied: creditAmount,
              } as any;
            }
          }

          console.log(
            `Invoice generated for immediate ${isTrialSubscription ? 'trial upgrade' : 'plan/model change'}${creditAmount > 0 ? ` with $${creditAmount.toFixed(2)} credit applied` : ''}`,
          );

          return {
            ...updatedSubscription,
            message:
              creditAmount > 0
                ? `Subscription changed immediately. Credit of $${creditAmount.toFixed(2)} for unused time has been applied to your new invoice.`
                : 'Subscription changed immediately.',
            creditApplied: creditAmount,
          } as any;
        } catch (invoiceError) {
          console.error(
            '❌ Error generating invoice for subscription change:',
            invoiceError.message,
          );

          // REVERT subscription change if invoice generation fails
          console.error(
            `🔄 Reverting subscription change due to invoice generation failure...`,
          );
          try {
            await this._prismaService.subscription.update({
              where: { id: subscriptionId },
              data: {
                pricingPlanId: originalSubscription.pricingPlanId,
                pricingModelType: originalSubscription.pricingModelType,
                startDate: originalSubscription.startDate,
                endDate: originalSubscription.endDate,
                nextPricingPlanId: hasQueuedChange
                  ? subscription.nextPricingPlanId
                  : null, // Restore queued plan if it existed
              },
            });
            console.log(`✅ Subscription reverted to original state.`);
          } catch (revertError) {
            console.error(
              `❌ Failed to revert subscription: ${revertError.message}`,
            );
            // Still throw the original error
          }

          throw new BadRequestException(
            `Failed to process subscription change: ${invoiceError.message}. Subscription has been reverted to its previous state.`,
          );
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

      // Prepare update data
      const updateData: any = { ...data };

      // Include pricingModelType if provided
      if (data.pricingModelType) {
        updateData.pricingModelType = data.pricingModelType;
      }

      return this._prismaService.subscription.update({
        where: { id: subscriptionId },
        data: updateData,
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

      // Handle immediate cancellation
      if (immediate) {
        // For immediate cancellation, clear any queued subscription changes
        // (user won't need the queued plan if they're cancelling immediately)
        if (subscription.nextPricingPlanId) {
          await this._prismaService.subscription.update({
            where: { id: subscriptionId },
            data: { nextPricingPlanId: null },
          });
          console.log(
            `Cleared queued subscription change for immediate cancellation: ${subscriptionId}`,
          );
        }
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

      // IMPORTANT: For end-of-period cancellations, preserve the queued plan (nextPricingPlanId)
      // The queued plan should activate when the subscription ends
      const hasQueuedPlan = !!subscription.nextPricingPlanId;
      if (hasQueuedPlan) {
        console.log(
          `📋 Preserving queued plan ${subscription.nextPricingPlanId} for end-of-period cancellation of ${subscriptionId}`,
        );
      }

      // Update subscription to not renew (keep active until endDate)
      // Mark as cancelled so cron knows not to renew
      // NOTE: We do NOT clear nextPricingPlanId here - it should remain for the queued plan
      return this._prismaService.subscription.update({
        where: { id: subscriptionId },
        data: {
          endDate: cancellationDate,
          cancelledAt: today, // Mark as cancelled - prevents renewal
          // Keep isActive = true until endDate arrives
          // Daily cron will handle deactivation when endDate arrives
          // Keep nextPricingPlanId if it exists (queued plan)
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
      // 🔍 DEBUG: Log invoice generation request
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log('💰 GENERATE INVOICE REQUEST');
      console.log(
        '═══════════════════════════════════════════════════════════',
      );
      console.log('📥 INVOICE REQUEST DATA:');
      console.log('   - Organization ID:', data.organizationId);
      console.log('   - From Date:', data.fromDate);
      console.log('   - To Date:', data.toDate);
      console.log(
        '   - Is For Subscription Update:',
        data.isForSubscriptionUpdate || false,
      );
      console.log('   - Credit Amount:', data.creditAmount || 0);

      const options: IGenerateInvoiceOptions = {
        organizationId: data.organizationId,
      };

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

      // Pass credit amount to options if provided
      if (data.creditAmount !== undefined && data.creditAmount > 0) {
        options.creditAmount = data.creditAmount;
        console.log(`Credit amount to apply: $${data.creditAmount.toFixed(2)}`);
      }

      const totalDaysInPeriod = 30;

      console.log(`Total days in billing period: ${totalDaysInPeriod}`);

      // Get active subscription
      // CRITICAL: If subscriptionId is provided, use it directly to avoid race conditions
      // Otherwise, look up by organizationId
      let subscription: any;
      if ((data as any).subscriptionId) {
        console.log(
          '🔍 Using provided subscription ID:',
          (data as any).subscriptionId,
        );
        subscription = await this._prismaService.subscription.findUnique({
          where: {
            id: (data as any).subscriptionId,
            organizationId: data.organizationId,
          },
          include: {
            pricingPlan: true,
          },
        });

        if (!subscription) {
          console.error(
            '❌ Subscription not found with provided ID, falling back to organization lookup',
          );
          subscription = await this.getSubscriptionByOrganizationId(
            data.organizationId,
          );
        } else if (!subscription.isActive) {
          console.error(
            '❌ Provided subscription is not active, falling back to organization lookup',
          );
          console.error('   - Subscription ID:', subscription.id);
          console.error('   - Is Active:', subscription.isActive);
          console.error('   - Plan ID:', subscription.pricingPlanId);
          console.error('   - Plan Name:', subscription.pricingPlan?.name);
          // Try to find the most recently created active subscription
          subscription = await this.getSubscriptionByOrganizationId(
            data.organizationId,
          );
        } else {
          console.log(
            '✅ Using provided subscription ID - found active subscription',
          );
          console.log('   - Subscription ID:', subscription.id);
          console.log('   - Plan ID:', subscription.pricingPlanId);
          console.log('   - Plan Name:', subscription.pricingPlan?.name);
          console.log('   - Pricing Model:', subscription.pricingModelType);
        }
      } else {
        subscription = await this.getSubscriptionByOrganizationId(
          data.organizationId,
        );
      }

      // 🔍 DEBUG: Log subscription details used for invoice
      console.log('📋 SUBSCRIPTION USED FOR INVOICE:');
      console.log('   - Subscription ID:', subscription.id);
      console.log('   - Plan ID:', subscription.pricingPlanId);
      console.log('   - Plan Name:', subscription.pricingPlan?.name || 'N/A');
      console.log(
        '   - Plan Type:',
        subscription.pricingPlan?.planType || 'N/A',
      );
      console.log(
        '   - Pricing Model Type:',
        subscription.pricingModelType || 'USER_BASED',
      );
      console.log(
        '   - Base Price (User):',
        subscription.pricingPlan?.basePrice || 'N/A',
      );
      console.log(
        '   - Project Base Price:',
        subscription.pricingPlan?.projectBasePrice || 'N/A',
      );
      console.log(
        '   - Custom Base Price:',
        subscription.customBasePrice || 'NONE',
      );
      console.log(
        '   - Custom Project Price:',
        subscription.customProjectPrice || 'NONE',
      );
      console.log('   - Is Active:', subscription.isActive);

      // Skip invoicing for TRIAL plans since they're free, but return a message instead of throwing an error
      if (subscription.pricingPlan.planType === SubscriptionPlanType.TRIAL) {
        return {
          message: 'Trial plans are free and not invoiced',
          success: false,
        };
      }

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

      // Determine pricing model type (default to USER_BASED for backward compatibility)
      const pricingModelType =
        subscription.pricingModelType || PricingModelType.USER_BASED;

      // 🔍 DEBUG: Log pricing model decision
      console.log('💰 PRICING MODEL DECISION:');
      console.log(
        '   - Subscription Pricing Model:',
        subscription.pricingModelType || 'NOT SET',
      );
      console.log('   - Final Pricing Model:', pricingModelType);
      console.log(
        '   - Will use:',
        pricingModelType === PricingModelType.PROJECT_BASED
          ? 'PROJECT_BASED invoice'
          : 'USER_BASED invoice',
      );

      // Branch based on pricing model type
      if (pricingModelType === PricingModelType.PROJECT_BASED) {
        return this.generateProjectBasedInvoice(
          subscription,
          options,
          usageLogs,
          data.organizationId,
          isForSubscriptionUpdate,
        );
      } else {
        return this.generateUserBasedInvoice(
          subscription,
          options,
          usageLogs,
          data.organizationId,
          isForSubscriptionUpdate,
        );
      }
    } catch (error) {
      console.error('Error generating invoice:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Generate invoice for user-based pricing model
   */
  private async generateUserBasedInvoice(
    subscription: any,
    options: IGenerateInvoiceOptions,
    usageLogs: any[],
    organizationId: string,
    isForSubscriptionUpdate: boolean,
  ): Promise<IInvoice | IInvoiceGenerationResult> {
    // 🔍 DEBUG: Log user-based invoice generation
    console.log('═══════════════════════════════════════════════════════════');
    console.log('👥 GENERATING USER-BASED INVOICE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 PLAN DETAILS FOR PRICING:');
    console.log('   - Plan ID:', subscription.pricingPlanId);
    console.log('   - Plan Name:', subscription.pricingPlan?.name || 'N/A');
    console.log('   - Plan Type:', subscription.pricingPlan?.planType || 'N/A');
    console.log(
      '   - Base Price from Plan:',
      subscription.pricingPlan?.basePrice || 'N/A',
    );
    console.log(
      '   - Custom Base Price:',
      subscription.customBasePrice || 'NONE',
    );

    const totalDaysInPeriod = 30;

    const organizationMembers =
      await this.getOrganizationMembers(organizationId);

    console.log('   - Member Count:', organizationMembers.length);

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

    console.log('   - Final Base Price Used:', `$${basePrice.toFixed(2)}`);
    console.log(
      '   - Daily Rate:',
      `$${(basePrice / totalDaysInPeriod).toFixed(4)}`,
    );

    const memberDailyRate = basePrice / totalDaysInPeriod;

    for (const member of organizationMembers) {
      const memberStartDate = new Date(
        Math.max(member.createdAt.getTime(), options.fromDate.getTime()),
      );

      let daysActive;
      if (isForSubscriptionUpdate) {
        // For subscription updates (plan changes), charge for the FULL new period
        // Credit will be applied separately to the subtotal
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

      // For subscription updates, use full period price (not prorated)
      // Credit will be applied to subtotal later
      const memberAmount = isForSubscriptionUpdate
        ? basePrice // Full period price for new plan
        : memberDailyRate * effectiveDaysActive; // Prorated for normal invoices

      totalMemberAmount += memberAmount;

      memberLineItems.push({
        description: isForSubscriptionUpdate
          ? `Member: ${this.getMemberDisplayName(member)} (Full period - new plan)`
          : `Member: ${this.getMemberDisplayName(member)} (${effectiveDaysActive}/${totalDaysInPeriod} days)`,
        quantity: 1,
        unitPrice: basePrice,
        amount: memberAmount,
        type: 'USER',
      });
    }

    // Usage-based charges are not billed under the per-seat model
    let subtotal = totalMemberAmount;

    // Apply credit if provided (from unused subscription time)
    const creditAmount = options.creditAmount || 0;
    if (creditAmount > 0) {
      console.log(`Applying credit of $${creditAmount.toFixed(2)} to invoice`);
      console.log(`Subtotal before credit: $${subtotal.toFixed(2)}`);

      // Add credit as a negative line item for transparency
      memberLineItems.push({
        description: `Credit for unused subscription time`,
        quantity: 1,
        unitPrice: -creditAmount,
        amount: -creditAmount,
        type: 'USER', // Using USER type for credit line items
      });

      subtotal = Math.max(0, subtotal - creditAmount); // Ensure subtotal doesn't go negative
      console.log(`Subtotal after credit: $${subtotal.toFixed(2)}`);
    }

    console.log(
      'check post 06: ',
      subtotal,
      creditAmount > 0 ? `(after $${creditAmount.toFixed(2)} credit)` : '',
    );

    // If total amount is zero or negative after credit, skip creating an invoice
    if (subtotal <= 0) {
      return {
        message:
          creditAmount > 0
            ? `Total invoice amount is zero after applying $${creditAmount.toFixed(2)} credit. No payment required.`
            : 'Total invoice amount is zero',
        success: true,
        creditApplied: creditAmount,
      };
    }

    // Standard tax rate (e.g., 8.25%)
    // const taxRate = 0.0825;
    const taxRate = 0;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    console.log('check post 07');

    // Generate invoice number
    const invoiceNumber = `INV-${Math.floor(Date.now() / 1000)}-${organizationId.substring(0, 6)}`;

    // Check if organization has a default payment method on file
    const organization =
      await this.getOrganizationWithPaymentMethod(organizationId);

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
        description:
          creditAmount > 0
            ? `Invoice for ${organizationMembers.length} active members (Credit of $${creditAmount.toFixed(2)} applied)`
            : `Invoice for ${organizationMembers.length} active members and usage`,
        invoiceItems: {
          create: memberLineItems,
        },
      },
    });

    // Apply any available discounts to the invoice
    try {
      invoice = await this.discountService.applyDiscountToInvoice(
        invoice.id,
        organizationId,
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
  }

  /**
   * Generate invoice for project-based pricing model
   */
  private async generateProjectBasedInvoice(
    subscription: any,
    options: IGenerateInvoiceOptions,
    usageLogs: any[],
    organizationId: string,
    isForSubscriptionUpdate: boolean,
  ): Promise<IInvoice | IInvoiceGenerationResult> {
    // 🔍 DEBUG: Log project-based invoice generation
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📁 GENERATING PROJECT-BASED INVOICE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 PLAN DETAILS FOR PRICING:');
    console.log('   - Plan ID:', subscription.pricingPlanId);
    console.log('   - Plan Name:', subscription.pricingPlan?.name || 'N/A');
    console.log('   - Plan Type:', subscription.pricingPlan?.planType || 'N/A');
    console.log(
      '   - Project Base Price from Plan:',
      subscription.pricingPlan?.projectBasePrice || 'N/A',
    );
    console.log(
      '   - Custom Project Price:',
      subscription.customProjectPrice || 'NONE',
    );

    const totalDaysInPeriod = 30;

    const organizationProjects =
      await this.getOrganizationProjects(organizationId);

    console.log('   - Project Count:', organizationProjects.length);

    // Skip invoicing if there are no projects and no usage logs
    if (organizationProjects.length === 0 && usageLogs.length === 0) {
      return {
        message: 'No active projects or usage logs to generate invoice',
        success: false,
      };
    }

    // Calculate prorated amounts for each project - AT INVOICE CREATION TIME
    let totalProjectAmount = 0;
    const projectLineItems = [];

    // Calculate amounts based on pricing plan - use CURRENT pricing
    const planType = subscription.pricingPlan.planType;

    let projectBasePrice =
      planType === SubscriptionPlanType.CUSTOM
        ? subscription.customProjectPrice
        : subscription.pricingPlan.projectBasePrice;

    projectBasePrice = projectBasePrice ?? 0;

    console.log(
      '   - Final Project Base Price Used:',
      `$${projectBasePrice.toFixed(2)}`,
    );
    console.log(
      '   - Daily Rate:',
      `$${(projectBasePrice / totalDaysInPeriod).toFixed(4)}`,
    );

    const projectDailyRate = projectBasePrice / totalDaysInPeriod;

    for (const project of organizationProjects) {
      const projectStartDate = new Date(
        Math.max(project.createdAt.getTime(), options.fromDate.getTime()),
      );

      let daysActive;
      if (isForSubscriptionUpdate) {
        daysActive = Math.ceil(
          (options.toDate.getTime() - options.fromDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );
      } else {
        daysActive = Math.ceil(
          (options.toDate.getTime() - projectStartDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );
      }

      const effectiveDaysActive = Math.max(
        1,
        Math.min(daysActive, totalDaysInPeriod),
      );

      // For subscription updates, use full period price (not prorated)
      // Credit will be applied to subtotal later
      const projectAmount = isForSubscriptionUpdate
        ? projectBasePrice // Full period price for new plan
        : projectDailyRate * effectiveDaysActive; // Prorated for normal invoices

      totalProjectAmount += projectAmount;

      projectLineItems.push({
        description: isForSubscriptionUpdate
          ? `Project: ${project.name} (Full period - new plan)`
          : `Project: ${project.name} (${effectiveDaysActive}/${totalDaysInPeriod} days)`,
        quantity: 1,
        unitPrice: projectBasePrice,
        amount: projectAmount,
        type: 'PROJECT',
      });
    }

    // Usage-based charges are not billed under the per-seat model
    let subtotal = totalProjectAmount;

    // Apply credit if provided (from unused subscription time)
    const creditAmount = options.creditAmount || 0;
    if (creditAmount > 0) {
      console.log(`Applying credit of $${creditAmount.toFixed(2)} to invoice`);
      console.log(`Subtotal before credit: $${subtotal.toFixed(2)}`);

      // Add credit as a negative line item for transparency
      projectLineItems.push({
        description: `Credit for unused subscription time`,
        quantity: 1,
        unitPrice: -creditAmount,
        amount: -creditAmount,
        type: 'PROJECT', // Using PROJECT type for credit line items
      });

      subtotal = Math.max(0, subtotal - creditAmount); // Ensure subtotal doesn't go negative
      console.log(`Subtotal after credit: $${subtotal.toFixed(2)}`);
    }

    console.log(
      'check post 06 (project-based): ',
      subtotal,
      creditAmount > 0 ? `(after $${creditAmount.toFixed(2)} credit)` : '',
    );

    // If total amount is zero or negative after credit, skip creating an invoice
    if (subtotal <= 0) {
      return {
        message:
          creditAmount > 0
            ? `Total invoice amount is zero after applying $${creditAmount.toFixed(2)} credit. No payment required.`
            : 'Total invoice amount is zero',
        success: true,
        creditApplied: creditAmount,
      };
    }

    // Standard tax rate (e.g., 8.25%)
    // const taxRate = 0.0825;
    const taxRate = 0;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    console.log('check post 07 (project-based)');

    // Generate invoice number
    const invoiceNumber = `INV-${Math.floor(Date.now() / 1000)}-${organizationId.substring(0, 6)}`;

    // Check if organization has a default payment method on file
    const organization =
      await this.getOrganizationWithPaymentMethod(organizationId);

    console.log('check post 08 (project-based)');

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
        description:
          creditAmount > 0
            ? `Invoice for ${organizationProjects.length} active projects (Credit of $${creditAmount.toFixed(2)} applied)`
            : `Invoice for ${organizationProjects.length} active projects and usage`,
        invoiceItems: {
          create: projectLineItems,
        },
      },
    });

    // Apply any available discounts to the invoice
    try {
      invoice = await this.discountService.applyDiscountToInvoice(
        invoice.id,
        organizationId,
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

      // Create the default pricing plans (user-based)
      // User-based plans have unlimited quotas (set to 0, but treated as unlimited in code)
      const userBasedPlans = [
        {
          name: 'Trial',
          planType: SubscriptionPlanType.TRIAL,
          pricingModelType: PricingModelType.USER_BASED,
          basePrice: 0, // Free
          projectBasePrice: 0,
          evaluationPrice: 0, // Free
          prAnalysisQuota: 0, // Unlimited for user-based (not used)
          assistantQuota: 0, // Unlimited for user-based (not used)
        },
        {
          name: 'Basic',
          planType: SubscriptionPlanType.BASIC,
          pricingModelType: PricingModelType.USER_BASED,
          basePrice: USER_PRICING_TIERS[SubscriptionPlanType.BASIC].price, // $15 per user
          projectBasePrice: 0,
          evaluationPrice: 0.5, // 50 cents per evaluation
          prAnalysisQuota: 0, // Unlimited for user-based (not used)
          assistantQuota: 0, // Unlimited for user-based (not used)
        },
        {
          name: 'Standard',
          planType: SubscriptionPlanType.STANDARD,
          pricingModelType: PricingModelType.USER_BASED,
          basePrice: USER_PRICING_TIERS[SubscriptionPlanType.STANDARD].price, // $13 per user for 50-150 members
          projectBasePrice: 0,
          evaluationPrice: 0.25, // 25 cents per evaluation
          prAnalysisQuota: 0, // Unlimited for user-based (not used)
          assistantQuota: 0, // Unlimited for user-based (not used)
        },
        {
          name: 'Premium',
          planType: SubscriptionPlanType.PREMIUM,
          pricingModelType: PricingModelType.USER_BASED,
          basePrice: USER_PRICING_TIERS[SubscriptionPlanType.PREMIUM].price, // $10 per user for 151+ members
          projectBasePrice: 0,
          evaluationPrice: 0.1, // 10 cents per evaluation
          prAnalysisQuota: 0, // Unlimited for user-based (not used)
          assistantQuota: 0, // Unlimited for user-based (not used)
        },
      ];

      // Create project-based pricing plans
      const projectBasedPlans = [
        {
          name: 'Project Basic',
          planType: SubscriptionPlanType.BASIC,
          pricingModelType: PricingModelType.PROJECT_BASED,
          basePrice: 0,
          projectBasePrice: 30, // $30 per project
          evaluationPrice: 0.5, // 50 cents per evaluation
          prAnalysisQuota: 100, // 100 PR analyses per project
          assistantQuota: 300, // 300 assistant questions per project
        },
        {
          name: 'Project Standard',
          planType: SubscriptionPlanType.STANDARD,
          pricingModelType: PricingModelType.PROJECT_BASED,
          basePrice: 0,
          projectBasePrice: 30, // $30 per project
          evaluationPrice: 0.25, // 25 cents per evaluation
          prAnalysisQuota: 100, // 100 PR analyses per project
          assistantQuota: 300, // 300 assistant questions per project
        },
        {
          name: 'Project Premium',
          planType: SubscriptionPlanType.PREMIUM,
          pricingModelType: PricingModelType.PROJECT_BASED,
          basePrice: 0,
          projectBasePrice: 30, // $30 per project
          evaluationPrice: 0.1, // 10 cents per evaluation
          prAnalysisQuota: 100, // 100 PR analyses per project
          assistantQuota: 300, // 300 assistant questions per project
        },
      ];

      const plans = [...userBasedPlans, ...projectBasedPlans];

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
   * Includes both active subscriptions with queued plans and cancelled subscriptions
   * that still have a queued plan (cancelled at end of period)
   */
  async getQueuedSubscriptions(organizationId: string): Promise<any[]> {
    try {
      // First, try to find active subscriptions with queued plans
      // This includes:
      // - Active subscriptions with queued plans (normal case)
      // - Subscriptions cancelled at end of period (cancelledAt set, but isActive=true until endDate)
      const activeSubscriptionsWithQueue =
        await this._prismaService.subscription.findMany({
          where: {
            organizationId,
            nextPricingPlanId: { not: null },
            isActive: true,
            // Include both regular active subscriptions and those cancelled at end of period
            // (cancelledAt being set doesn't affect isActive until endDate arrives)
          },
          include: {
            pricingPlan: true,
            nextPricingPlan: true,
          },
          orderBy: { updatedAt: 'desc' },
        });

      // Also find cancelled subscriptions with queued plans
      // Include both those with future endDate and those without (recently cancelled)
      const cancelledSubscriptionsWithQueue =
        await this._prismaService.subscription.findMany({
          where: {
            organizationId,
            nextPricingPlanId: { not: null },
            isActive: false,
            // Include cancelled subscriptions that either:
            // 1. Have an endDate in the future (cancelled but still running)
            // 2. Have no endDate or endDate in past but were recently updated (just cancelled with queued plan)
            OR: [
              { endDate: { gte: new Date() } },
              {
                AND: [
                  {
                    OR: [{ endDate: null }, { endDate: { lt: new Date() } }],
                  },
                  // Include if updated in the last 30 days (recently cancelled with queued plan)
                  {
                    updatedAt: {
                      gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                    },
                  },
                ],
              },
            ],
          },
          include: {
            pricingPlan: true,
            nextPricingPlan: true,
          },
          orderBy: { updatedAt: 'desc' },
        });

      // Combine both lists
      const allSubscriptionsWithQueue = [
        ...activeSubscriptionsWithQueue,
        ...cancelledSubscriptionsWithQueue,
      ];

      return allSubscriptionsWithQueue.map((sub) => ({
        id: sub.id,
        currentPlan: sub.pricingPlan,
        nextPlan: sub.nextPricingPlan,
        scheduledStartDate: sub.endDate,
        status: sub.isActive ? 'PENDING' : 'CANCELLED_PENDING',
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
      const pricingModelType =
        subscription?.pricingModelType || PricingModelType.USER_BASED;

      // Only validate member count for user-based plans
      // Project-based plans don't have member count requirements
      if (planType && pricingModelType === PricingModelType.USER_BASED) {
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

      // pricingModelType already determined above

      // User-based plans have unlimited quotas
      // Project-based plans use quotas from pricing plan
      let totalPrAnalysisQuota = Infinity; // Unlimited for user-based
      let totalAssistantQuota = Infinity; // Unlimited for user-based

      if (pricingModelType === PricingModelType.PROJECT_BASED) {
        // Project-based plans: use quotas from pricing plan
        const basePrAnalysisQuota = subscription
          ? subscription.pricingPlan.prAnalysisQuota ||
            DEFAULT_PR_ANALYSIS_QUOTA
          : DEFAULT_PR_ANALYSIS_QUOTA;
        const baseAssistantQuota = subscription
          ? subscription.pricingPlan.assistantQuota || DEFAULT_ASSISTANT_QUOTA
          : DEFAULT_ASSISTANT_QUOTA;

        // For project-based, quotas are per project, not per user
        const organizationProjects =
          await this.getOrganizationProjects(organizationId);
        totalPrAnalysisQuota =
          basePrAnalysisQuota * organizationProjects.length;
        totalAssistantQuota = baseAssistantQuota * organizationProjects.length;
      }

      // For user-based plans, quotas are unlimited (Infinity)
      // For project-based plans, calculate remaining quota
      let remainingPrQuota =
        totalPrAnalysisQuota === Infinity ? Infinity : totalPrAnalysisQuota;
      let remainingAssistantQuota =
        totalAssistantQuota === Infinity ? Infinity : totalAssistantQuota;

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
            basePrice: queue.nextPlan.basePrice || 0,
            projectBasePrice: queue.nextPlan.projectBasePrice || null,
            pricingModelType: queue.nextPlan.pricingModelType || 'USER_BASED',
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
      const pricingModelType =
        data.pricingModelType ||
        pricingPlan.pricingModelType ||
        PricingModelType.USER_BASED;

      let activeMemberCount = 0;
      let activeProjectCount = 0;

      // Only validate member count for user-based plans
      if (pricingModelType === PricingModelType.USER_BASED) {
        const organizationMembers = await this.getOrganizationMembers(
          data.organizationId,
        );
        activeMemberCount = organizationMembers.length;

        if (activeMemberCount === 0) {
          throw new BadRequestException(
            'At least one active member is required to start a user-based subscription.',
          );
        }

        this.validatePlanForMemberCount(
          pricingPlan.planType,
          activeMemberCount,
        );
      } else if (pricingModelType === PricingModelType.PROJECT_BASED) {
        const organizationProjects = await this.getOrganizationProjects(
          data.organizationId,
        );
        activeProjectCount = organizationProjects.length;
      }

      const effectivePerUserPrice =
        pricingPlan.planType === SubscriptionPlanType.CUSTOM
          ? (data.customBasePrice ?? pricingPlan.basePrice)
          : pricingPlan.basePrice;

      const effectivePerProjectPrice =
        pricingModelType === PricingModelType.PROJECT_BASED
          ? (data.customProjectPrice ?? pricingPlan.projectBasePrice ?? 0)
          : 0;

      const flatAddOn =
        pricingPlan.planType !== SubscriptionPlanType.CUSTOM
          ? (data.customBasePrice ?? 0)
          : 0;

      // Calculate initial amount (first month's payment)
      const initialAmount =
        pricingModelType === PricingModelType.PROJECT_BASED
          ? (effectivePerProjectPrice ?? 0) * Math.max(activeProjectCount, 1) +
            flatAddOn
          : (effectivePerUserPrice ?? 0) * activeMemberCount + flatAddOn;

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
      const pricingModelType =
        subscription.pricingModelType ||
        newPlan.pricingModelType ||
        PricingModelType.USER_BASED;

      let activeMemberCount = 0;
      let activeProjectCount = 0;

      // Only validate member count for user-based plans
      if (pricingModelType === PricingModelType.USER_BASED) {
        const organizationMembers = await this.getOrganizationMembers(
          subscription.organizationId,
        );
        activeMemberCount = organizationMembers.length;

        if (activeMemberCount === 0) {
          throw new BadRequestException(
            'At least one active member is required to change to a user-based subscription plan.',
          );
        }

        this.validatePlanForMemberCount(newPlan.planType, activeMemberCount);
      } else if (pricingModelType === PricingModelType.PROJECT_BASED) {
        const organizationProjects = await this.getOrganizationProjects(
          subscription.organizationId,
        );
        activeProjectCount = organizationProjects.length;
      }

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
      const newPerProjectPrice =
        pricingModelType === PricingModelType.PROJECT_BASED
          ? (newPlan.projectBasePrice ?? 0)
          : 0;

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
      const perProjectDifference =
        pricingModelType === PricingModelType.PROJECT_BASED
          ? newPerProjectPrice -
            (subscription.customProjectPrice ??
              subscription.pricingPlan.projectBasePrice ??
              0)
          : 0;

      const proratedAmount =
        pricingModelType === PricingModelType.PROJECT_BASED
          ? perProjectDifference > 0 && daysRemaining > 0
            ? (perProjectDifference *
                Math.max(activeProjectCount, 1) *
                daysRemaining) /
              billingCycleLength
            : 0
          : perUserDifference > 0 && daysRemaining > 0
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

      // Update subscription with immediate change to apply upgrade now
      return this.updateSubscription(subscriptionId, {
        pricingPlanId: newPlanId,
        immediateChange: true, // Apply upgrade immediately
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
   * User-based plans have unlimited quotas (always withinQuota = true)
   * Project-based plans respect quotas
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

      // Determine pricing model type (default to USER_BASED for backward compatibility)
      const pricingModelType =
        subscription.pricingModelType || PricingModelType.USER_BASED;

      // Determine base evaluation price
      const evaluationPrice =
        subscription.customEvalPrice ||
        subscription.pricingPlan.evaluationPrice;

      // User-based plans have unlimited quotas - always within quota
      if (pricingModelType === PricingModelType.USER_BASED) {
        if (type === 'PR_ANALYSIS') {
          return {
            withinQuota: true, // Unlimited for user-based plans
            rate: evaluationPrice,
          };
        } else {
          return {
            withinQuota: true, // Unlimited for user-based plans
            rate: evaluationPrice / 3,
          };
        }
      }

      // Project-based plans: check quotas
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

      // Get the quotas from the pricing plan (only used for project-based)
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
