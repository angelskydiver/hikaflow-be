import { InvoiceStatus, SubscriptionPlanType } from '@prisma/client';

// No longer needed as TRIAL is now part of the enum in Prisma
// type ExtendedSubscriptionPlanType = SubscriptionPlanType | 'TRIAL';

export interface IPricingPlan {
  id: string;
  name: string;
  planType: SubscriptionPlanType; // Use the proper enum type
  basePrice: number;
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
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  customBasePrice?: number;
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
  total: number;
  status: InvoiceStatus;
  dueDate: Date;
  paidDate?: Date;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  description?: string;
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
  type: string; // PROJECT or EVALUATION
  createdAt: Date;
  updatedAt: Date;
}

export interface IUsageLog {
  id: string;
  subscriptionId: string;
  organizationId: string;
  repositoryId?: string;
  type: string;
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
    planType: SubscriptionPlanType;
    startDate: Date;
    endDate: Date;
  };
  currentMonthUsage: {
    startDate: Date;
    endDate: Date;
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
        proratedCost: number;
      }>;
    };
    totalEvaluations: number;
    totalCost: number;
    costBreakdown: {
      repositoryCost: number;
      evaluationCost: number;
    };
  };
  invoices: IInvoice[];
}
