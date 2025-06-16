import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DiscountStatus, DiscountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateDiscountDto {
  name: string;
  description?: string;
  type: DiscountType;
  value: number;
  organizationId: string;
  durationMonths?: number;
  isAutoApplied?: boolean;
  maxUsageCount?: number;
}

export interface ClaimDiscountDto {
  organizationId: string;
  discountId: string;
}

@Injectable()
export class DiscountService {
  constructor(private prisma: PrismaService) {}

  async createDiscount(data: CreateDiscountDto) {
    // Validate discount value
    if (
      data.type === DiscountType.PERCENTAGE &&
      (data.value < 0 || data.value > 100)
    ) {
      throw new BadRequestException(
        'Percentage discount must be between 0 and 100',
      );
    }

    if (data.type === DiscountType.FIXED && data.value < 0) {
      throw new BadRequestException('Fixed discount amount must be positive');
    }

    return this.prisma.discount.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        value: data.value,
        organizationId: data.organizationId,
        durationMonths: data.durationMonths || 1,
        isAutoApplied: data.isAutoApplied || false,
        maxUsageCount: data.maxUsageCount || 1,
        status: DiscountStatus.ACTIVE,
      },
      include: {
        organization: true,
      },
    });
  }

  async createTaskCompletionDiscount(organizationId: string) {
    // Check if organization already has a task completion discount
    const existingDiscount = await this.prisma.discount.findFirst({
      where: {
        organizationId,
        name: 'Task Completion Bonus',
        status: {
          in: [DiscountStatus.ACTIVE, DiscountStatus.CLAIMED],
        },
      },
    });

    if (existingDiscount) {
      throw new BadRequestException(
        'Task completion discount already exists for this organization',
      );
    }

    return this.createDiscount({
      name: 'Task Completion Bonus',
      description:
        'Congratulations! You completed all onboarding tasks and earned a $20 discount.',
      type: DiscountType.FIXED,
      value: 20,
      organizationId,
      durationMonths: 1,
      isAutoApplied: true,
      maxUsageCount: 1,
    });
  }

  async claimDiscount(data: ClaimDiscountDto) {
    const discount = await this.prisma.discount.findUnique({
      where: { id: data.discountId },
      include: { organization: true },
    });

    if (!discount) {
      throw new NotFoundException('Discount not found');
    }

    if (discount.organizationId !== data.organizationId) {
      throw new BadRequestException(
        'Discount does not belong to this organization',
      );
    }

    if (discount.status !== DiscountStatus.ACTIVE) {
      throw new BadRequestException('Discount is not active');
    }

    if (discount.usedCount >= discount.maxUsageCount) {
      throw new BadRequestException('Discount usage limit exceeded');
    }

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + discount.durationMonths);

    return this.prisma.discount.update({
      where: { id: data.discountId },
      data: {
        status: DiscountStatus.CLAIMED,
        claimedAt: new Date(),
        expiresAt,
      },
      include: {
        organization: true,
      },
    });
  }

  async getOrganizationDiscounts(organizationId: string) {
    return this.prisma.discount.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        organization: true,
        appliedInvoices: {
          select: {
            id: true,
            invoiceNumber: true,
            amount: true,
            discountAmount: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getActiveDiscounts(organizationId: string) {
    const now = new Date();

    const discounts = await this.prisma.discount.findMany({
      where: {
        organizationId,
        status: DiscountStatus.CLAIMED,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { claimedAt: 'asc' }, // Apply oldest discounts first
    });

    // Filter discounts that haven't exceeded their usage limit
    return discounts.filter(
      (discount) => discount.usedCount < discount.maxUsageCount,
    );
  }

  async applyDiscountToInvoice(invoiceId: string, organizationId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    // Get active discounts for the organization
    const activeDiscounts = await this.getActiveDiscounts(organizationId);

    if (activeDiscounts.length === 0) {
      return invoice; // No discounts to apply
    }

    // Apply the first available discount
    const discount = activeDiscounts[0];
    let discountAmount = 0;

    if (discount.type === DiscountType.PERCENTAGE) {
      discountAmount = (invoice.amount * discount.value) / 100;
    } else {
      // For fixed discounts, use the full discount amount even if it exceeds invoice
      // This ensures the discount is fully consumed and marked as used
      discountAmount = discount.value;
    }

    // Calculate new total (can be negative/zero if discount exceeds invoice amount)
    const newTotal = Math.max(0, invoice.amount + invoice.tax - discountAmount);

    console.log(
      `Applying discount: Invoice amount: $${invoice.amount}, Discount: $${discountAmount}, New total: $${newTotal}`,
    );

    // Update invoice with discount
    const updatedInvoice = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        discountAmount,
        total: newTotal,
        appliedDiscountId: discount.id,
      },
    });

    // Update discount usage count and mark as inactive since it's been used
    await this.prisma.discount.update({
      where: { id: discount.id },
      data: {
        usedCount: { increment: 1 },
        status:
          discount.usedCount + 1 >= discount.maxUsageCount
            ? DiscountStatus.INACTIVE
            : discount.status,
      },
    });

    return updatedInvoice;
  }

  async expireDiscounts() {
    const now = new Date();

    return this.prisma.discount.updateMany({
      where: {
        status: DiscountStatus.CLAIMED,
        expiresAt: { lt: now },
      },
      data: {
        status: DiscountStatus.EXPIRED,
      },
    });
  }

  async getDiscountById(id: string) {
    return this.prisma.discount.findUnique({
      where: { id },
      include: {
        organization: true,
        appliedInvoices: {
          select: {
            id: true,
            invoiceNumber: true,
            amount: true,
            discountAmount: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async deleteDiscount(id: string, organizationId: string) {
    const discount = await this.prisma.discount.findUnique({
      where: { id },
    });

    if (!discount) {
      throw new NotFoundException('Discount not found');
    }

    if (discount.organizationId !== organizationId) {
      throw new BadRequestException(
        'Discount does not belong to this organization',
      );
    }

    if (discount.usedCount > 0) {
      throw new BadRequestException(
        'Cannot delete discount that has been used',
      );
    }

    return this.prisma.discount.delete({
      where: { id },
    });
  }
}
