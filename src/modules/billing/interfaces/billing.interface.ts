import {
  InvoiceStatus,
  PricingModelType,
  SubscriptionPlanType,
} from '@prisma/client';
import { UsageLogType } from '../dto/billing.request.dto';

export type InvoiceItemType = 'USER' | 'PROJECT' | 'EVALUATION';

export interface IPricingPlan {
  id: string;
  name: string;
  planType: SubscriptionPlanType; // Use the proper enum type
  pricingModelType: PricingModelType; // Pricing model type
  basePrice: number; // Base price charged per active user (for USER_BASED)
  projectBasePrice?: number; // Base price charged per project (for PROJECT_BASED)
  evaluationPrice: number;
  prAnalysisQuota: number; // Number of PR analyses included in plan
  assistantQuota: number; // Number of assistant questions included in plan
  active: boolean;
  stripeProductId?: string;
  stripePriceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubscription {
  id: string;
  organizationId: string;
  pricingPlanId: string;
  pricingPlan?: IPricingPlan;
  pricingModelType: PricingModelType; // Pricing model for this subscription
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  customBasePrice?: number; // For custom user-based plans
  customProjectPrice?: number; // For custom project-based plans
  customEvalPrice?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInvoice {
  id: string;
  subscriptionId: string;
  invoiceNumber: string;
  amount: number;
  tax: number;
  discountAmount: number;
  total: number;
  status: InvoiceStatus;
  dueDate: Date;
  paidDate?: Date;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  description?: string;
  appliedDiscountId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  type: InvoiceItemType;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUsageLog {
  id: string;
  subscriptionId: string;
  organizationId: string;
  repositoryId?: string;
  type: UsageLogType;
  description: string;
  counted: boolean;
  invoiceId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStripeConfig {
  apiKey: string;
  webhookSecret: string;
}

export interface IGenerateInvoiceOptions {
  organizationId: string;
  fromDate?: Date;
  toDate?: Date;
}

export interface IInvoiceGenerationResult {
  message: string;
  success: boolean;
}

export interface IOrganization {
  id: string;
  name: string;
  logo?: string;
  defaultPaymentMethodId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMonthlyUsageReport {
  subscription: {
    id?: string;
    planType: SubscriptionPlanType;
    startDate: Date;
    endDate: Date;
    status?: string;
    pricingPlan?: {
      id: string;
      name: string;
      planType: SubscriptionPlanType;
      basePrice: number;
    };
  };
  currentMonthUsage: {
    startDate: Date;
    endDate: Date;
    members: {
      total: number;
      list: Array<{
        id: string;
        name: string;
        role: string;
        activeDays: number;
        proratedCost: number;
      }>;
    };
    repositories: {
      total: number;
      list: Array<{
        id: string;
        name: string;
        evaluations: number;
        evaluationTypes: Array<{
          type: string;
          count: number;
        }>;
        connectedDays: number;
        usageBreakdown?: {
          prAnalyses: number;
          assistantQuestions: number;
          otherEvaluations: number;
        };
      }>;
    };
    totalEvaluations: number;
    totalCost: number;
    costBreakdown: {
      memberCost: number;
      evaluationCost: number;
    };
  };
  invoices: IInvoice[];
  queuedSubscriptions?: Array<{
    id: string;
    pricingPlan: {
      id: string;
      name: string;
      planType: SubscriptionPlanType;
      basePrice: number;
    };
    scheduledStartDate: Date | null;
    status: string;
    createdAt: Date;
  }>;
}
