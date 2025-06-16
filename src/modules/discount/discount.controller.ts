import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../passport/guards/jwt.guard';
import { OrganizationService } from '../organization/organization.service';
import { CreateDiscountDto, DiscountService } from './discount.service';

@Controller('discount')
@UseGuards(JwtAuthGuard)
export class DiscountController {
  constructor(
    private readonly discountService: DiscountService,
    private readonly organizationService: OrganizationService,
  ) {}

  @Post('create')
  async createDiscount(
    @Body() createDiscountDto: CreateDiscountDto,
    @Request() req,
  ) {
    // Verify user has admin access to the organization
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);
    const hasAccess = userOrganizations.some(
      (org) =>
        org.organizationId === createDiscountDto.organizationId &&
        org.role === 'ADMIN',
    );

    if (!hasAccess) {
      throw new BadRequestException(
        'You do not have admin access to this organization',
      );
    }

    return this.discountService.createDiscount(createDiscountDto);
  }

  @Post('claim-task-completion')
  async claimTaskCompletionDiscount(@Request() req) {
    // Get user's admin organizations
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);
    const adminOrganization = userOrganizations.find(
      (org) => org.role === 'ADMIN',
    );

    if (!adminOrganization) {
      throw new BadRequestException(
        'You must be an admin of an organization to claim this discount',
      );
    }

    // Create the task completion discount
    const discount = await this.discountService.createTaskCompletionDiscount(
      adminOrganization.organizationId,
    );

    // Immediately claim it
    const claimedDiscount = await this.discountService.claimDiscount({
      organizationId: adminOrganization.organizationId,
      discountId: discount.id,
    });

    return {
      message:
        'Congratulations! Your $20 discount has been claimed successfully.',
      discount: claimedDiscount,
    };
  }

  @Post('claim/:discountId')
  async claimDiscount(@Param('discountId') discountId: string, @Request() req) {
    // Get user's admin organizations
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);
    const adminOrganization = userOrganizations.find(
      (org) => org.role === 'ADMIN',
    );

    if (!adminOrganization) {
      throw new BadRequestException(
        'You must be an admin of an organization to claim discounts',
      );
    }

    return this.discountService.claimDiscount({
      organizationId: adminOrganization.organizationId,
      discountId,
    });
  }

  @Get('organization/:organizationId')
  async getOrganizationDiscounts(
    @Param('organizationId') organizationId: string,
    @Request() req,
  ) {
    // Verify user has access to the organization
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);
    const hasAccess = userOrganizations.some(
      (org) => org.organizationId === organizationId,
    );

    if (!hasAccess) {
      throw new BadRequestException(
        'You do not have access to this organization',
      );
    }

    return this.discountService.getOrganizationDiscounts(organizationId);
  }

  @Get('active/:organizationId')
  async getActiveDiscounts(
    @Param('organizationId') organizationId: string,
    @Request() req,
  ) {
    // Verify user has access to the organization
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);
    const hasAccess = userOrganizations.some(
      (org) => org.organizationId === organizationId,
    );

    if (!hasAccess) {
      throw new BadRequestException(
        'You do not have access to this organization',
      );
    }

    return this.discountService.getActiveDiscounts(organizationId);
  }

  @Get('my-discounts')
  async getMyDiscounts(@Request() req) {
    // Get user's organizations
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);

    const allDiscounts = [];
    for (const org of userOrganizations) {
      const discounts = await this.discountService.getOrganizationDiscounts(
        org.organizationId,
      );
      allDiscounts.push(...discounts);
    }

    return allDiscounts;
  }

  @Get(':id')
  async getDiscountById(@Param('id') id: string, @Request() req) {
    const discount = await this.discountService.getDiscountById(id);

    if (!discount) {
      throw new BadRequestException('Discount not found');
    }

    // Verify user has access to the organization
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);
    const hasAccess = userOrganizations.some(
      (org) => org.organizationId === discount.organizationId,
    );

    if (!hasAccess) {
      throw new BadRequestException('You do not have access to this discount');
    }

    return discount;
  }

  @Delete(':id')
  async deleteDiscount(@Param('id') id: string, @Request() req) {
    const discount = await this.discountService.getDiscountById(id);

    if (!discount) {
      throw new BadRequestException('Discount not found');
    }

    // Verify user has admin access to the organization
    const userOrganizations =
      await this.organizationService.getUserOrganizations(req.user.userId);
    const hasAccess = userOrganizations.some(
      (org) =>
        org.organizationId === discount.organizationId && org.role === 'ADMIN',
    );

    if (!hasAccess) {
      throw new BadRequestException(
        'You do not have admin access to this organization',
      );
    }

    return this.discountService.deleteDiscount(id, discount.organizationId);
  }
}
