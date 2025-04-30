import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/decorators/public';
import { JwtAuthGuard } from '../../passport/guards/jwt.guard';
import { BillingService } from './billing.service';
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
  IInvoice,
  IInvoiceGenerationResult,
  IMonthlyUsageReport,
  IPricingPlan,
  ISubscription,
  IUsageLog,
} from './interfaces/billing.interface';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly _billingService: BillingService) {}

  @Public()
  @Get('invoices/initialize-pricing-plans')
  async InitializePricingPlans() {
    return await this._billingService.initializePricingPlans();
  }

  // Pricing Plan endpoints
  @ApiBearerAuth()
  @Post('pricing-plans')
  async createPricingPlan(
    @Body() data: CreatePricingPlanDto,
  ): Promise<IPricingPlan> {
    return this._billingService.createPricingPlan(data);
  }

  @Get('pricing-plans')
  async getAllPricingPlans(): Promise<IPricingPlan[]> {
    return this._billingService.getAllPricingPlans();
  }

  @Get('pricing-plans/:id')
  async getPricingPlanById(@Param('id') id: string): Promise<IPricingPlan> {
    return this._billingService.getPricingPlanById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('pricing-plans/:id')
  async updatePricingPlan(
    @Param('id') id: string,
    @Body() data: UpdatePricingPlanDto,
  ): Promise<IPricingPlan> {
    return this._billingService.updatePricingPlan(id, data);
  }

  // Subscription endpoints
  // @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('subscriptions')
  async createSubscription(
    @Body() data: CreateSubscriptionDto,
  ): Promise<ISubscription> {
    return this._billingService.createSubscription(data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscriptions/organization/:organizationId')
  async getSubscriptionByOrganizationId(
    @Param('organizationId') organizationId: string,
  ): Promise<ISubscription> {
    return this._billingService.getSubscriptionByOrganizationId(organizationId);
  }

  @ApiBearerAuth()
  @Put('subscriptions/:id')
  async updateSubscription(
    @Param('id') id: string,
    @Body() data: UpdateSubscriptionDto,
  ): Promise<ISubscription> {
    return this._billingService.updateSubscription(id, data);
  }

  // Usage Log endpoints
  @UseGuards(JwtAuthGuard)
  @Post('usage-logs')
  async createUsageLog(@Body() data: CreateUsageLogDto): Promise<IUsageLog> {
    return this._billingService.createUsageLog(data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('usage-logs/:organizationId')
  async getOrganizationUsageLogs(
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ): Promise<IUsageLog[]> {
    const options: any = {};
    if (fromDate) options.fromDate = new Date(fromDate);
    if (toDate) options.toDate = new Date(toDate);
    return this._billingService.getOrganizationUsageLogs(
      organizationId,
      options,
    );
  }

  // Invoice endpoints
  @UseGuards(JwtAuthGuard)
  @Post('invoices/generate')
  async generateInvoice(
    @Body() data: GenerateInvoiceDto,
  ): Promise<IInvoice | IInvoiceGenerationResult> {
    return this._billingService.generateInvoice(data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('invoices/:id/finalize')
  async finalizeInvoice(@Param('id') id: string): Promise<IInvoice> {
    return this._billingService.finalizeInvoice(id);
  }

  @ApiBearerAuth()
  @Post('invoices/:id/pay')
  async payInvoice(
    @Param('id') id: string,
    @Body() data: PayInvoiceDto,
  ): Promise<IInvoice> {
    return this._billingService.payInvoice(id, data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('invoices/:id')
  async getInvoiceById(@Param('id') id: string): Promise<IInvoice> {
    return this._billingService.getInvoiceById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('invoices/organization/:organizationId')
  async getOrganizationInvoices(
    @Param('organizationId') organizationId: string,
  ): Promise<IInvoice[]> {
    return this._billingService.getOrganizationInvoices(organizationId);
  }

  // Cron job endpoints (these should usually be triggered by a cron service)
  @UseGuards(JwtAuthGuard)
  @Post('cron/daily-subscription-check')
  async runDailySubscriptionCheck() {
    return this._billingService.runDailySubscriptionCheck();
  }

  @UseGuards(JwtAuthGuard)
  @Post('cron/monthly-invoice-generation')
  async runMonthlyInvoiceGeneration() {
    return this._billingService.runMonthlyInvoiceGeneration();
  }

  // Subscription status check
  @UseGuards(JwtAuthGuard)
  @Get('subscriptions/status/:organizationId')
  async getOrganizationSubscriptionStatus(
    @Param('organizationId') organizationId: string,
  ) {
    return this._billingService.getOrganizationSubscriptionStatus(
      organizationId,
    );
  }

  // Payment method management
  @UseGuards(JwtAuthGuard)
  @Post('payment-methods/organization/:organizationId')
  async saveOrganizationPaymentMethod(
    @Param('organizationId') organizationId: string,
    @Body() data: { paymentMethodId: string },
  ) {
    return this._billingService.saveOrganizationPaymentMethod(
      organizationId,
      data.paymentMethodId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete('payment-methods/organization/:organizationId')
  async removeOrganizationPaymentMethod(
    @Param('organizationId') organizationId: string,
  ) {
    return this._billingService.removeOrganizationPaymentMethod(organizationId);
  }

  @Get('monthly-usage/:organizationId')
  @ApiOperation({ summary: 'Get current month usage report' })
  @ApiResponse({
    status: 200,
    description: 'Current month usage report retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        subscription: {
          type: 'object',
          properties: {
            planType: { type: 'string' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
          },
        },
        currentMonthUsage: {
          type: 'object',
          properties: {
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            repositories: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                list: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      evaluations: { type: 'number' },
                      evaluationTypes: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            type: { type: 'string' },
                            count: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            totalEvaluations: { type: 'number' },
            totalCost: { type: 'number' },
          },
        },
        previousMonthInvoices: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              amount: { type: 'number' },
              status: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiBearerAuth()
  async getMonthlyUsageReport(
    @Param('organizationId') organizationId: string,
  ): Promise<IMonthlyUsageReport> {
    return this._billingService.getMonthlyUsageReport(organizationId);
  }
}
