import { SubscriptionPlanType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreatePricingPlanDto {
  @IsString()
  name: string;

  @IsEnum(SubscriptionPlanType)
  planType: SubscriptionPlanType;

  @IsNumber()
  basePrice: number; // Base price per active user

  @IsNumber()
  evaluationPrice: number; // Price per evaluation

  @IsNumber()
  @IsOptional()
  prAnalysisQuota?: number = 20; // Number of PR analyses included in plan

  @IsNumber()
  @IsOptional()
  assistantQuota?: number = 50; // Number of assistant questions included in plan

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class UpdatePricingPlanDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  basePrice?: number;

  @IsNumber()
  @IsOptional()
  evaluationPrice?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

export class CreateSubscriptionDto {
  @IsUUID()
  organizationId: string;

  @IsUUID()
  pricingPlanId: string;

  @IsNumber()
  @IsOptional()
  customBasePrice?: number;

  @IsNumber()
  @IsOptional()
  customEvalPrice?: number;
}

export class UpdateSubscriptionDto {
  @IsUUID()
  @IsOptional()
  pricingPlanId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  immediate?: boolean; // For cancellation: true = immediate, false = end of period

  @IsNumber()
  @IsOptional()
  customBasePrice?: number;

  @IsNumber()
  @IsOptional()
  customEvalPrice?: number;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;
}

export class CreateInvoiceDto {
  @IsUUID()
  subscriptionId: string;

  @IsString()
  description?: string;

  @IsNumber()
  @IsOptional()
  tax?: number;
}

export class CreateUsageLogDto {
  @IsUUID()
  @IsOptional()
  subscriptionId?: string;

  @IsUUID()
  organizationId: string;

  @IsUUID()
  @IsOptional()
  repositoryId?: string;

  @IsString()
  type: string; // PR_ANALYSIS, ASSISTANT_QUESTION, etc.

  @IsString()
  description: string;
}

export class PayInvoiceDto {
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

export class GenerateInvoiceDto {
  @IsUUID()
  organizationId: string;

  @IsString()
  @IsOptional()
  fromDate?: string;

  @IsString()
  @IsOptional()
  toDate?: string;

  @IsBoolean()
  @IsOptional()
  isForSubscriptionUpdate?: boolean;
}
