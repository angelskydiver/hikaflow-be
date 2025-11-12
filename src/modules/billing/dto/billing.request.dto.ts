import { SubscriptionPlanType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export enum UsageLogType {
  PR_ANALYSIS = 'PR_ANALYSIS',
  ASSISTANT_QUESTION = 'ASSISTANT_QUESTION',
  EVALUATION = 'EVALUATION',
  REPOSITORY_REGISTRATION = 'REPOSITORY_REGISTRATION',
  ISSUE_ANALYSIS = 'ISSUE_ANALYSIS',
}

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
  prAnalysisQuota?: number; // Number of PR analyses included in plan

  @IsNumber()
  @IsOptional()
  assistantQuota?: number; // Number of assistant questions included in plan

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
  @IsDate()
  @Type(() => Date)
  startDate?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
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

  @IsEnum(UsageLogType)
  type: UsageLogType;

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

  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @IsDateString()
  @IsOptional()
  toDate?: string;

  @IsBoolean()
  @IsOptional()
  isForSubscriptionUpdate?: boolean;
}
