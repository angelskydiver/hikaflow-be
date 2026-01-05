import { ForbiddenException, Injectable } from '@nestjs/common';
import { PricingModelType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

export enum FeatureType {
  WEEKLY_REPORTS = 'WEEKLY_REPORTS',
  COLLABORATOR_ANALYSIS = 'COLLABORATOR_ANALYSIS',
  EXECUTIVE_REPORTS = 'EXECUTIVE_REPORTS',
  TEAM_REPORTS = 'TEAM_REPORTS',
  ORGANIZATION_REPORTS = 'ORGANIZATION_REPORTS',
}

@Injectable()
export class FeatureAccessService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Check if organization can access a specific feature
   * Project-based plans cannot access reporting features
   */
  async canAccessFeature(
    organizationId: string,
    feature: FeatureType,
  ): Promise<boolean> {
    const subscription = await this.prismaService.subscription.findFirst({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        pricingPlan: true,
      },
    });

    if (!subscription) {
      return false;
    }

    // Determine pricing model type (default to USER_BASED for backward compatibility)
    const pricingModelType =
      subscription.pricingModelType || PricingModelType.USER_BASED;

    // Project-based plans cannot access reporting features
    if (pricingModelType === PricingModelType.PROJECT_BASED) {
      const restrictedFeatures = [
        FeatureType.WEEKLY_REPORTS,
        FeatureType.COLLABORATOR_ANALYSIS,
        FeatureType.EXECUTIVE_REPORTS,
        FeatureType.TEAM_REPORTS,
        FeatureType.ORGANIZATION_REPORTS,
      ];
      return !restrictedFeatures.includes(feature);
    }

    // User-based plans have full access
    return true;
  }

  /**
   * Throw ForbiddenException if feature is not accessible
   */
  async ensureFeatureAccess(
    organizationId: string,
    feature: FeatureType,
  ): Promise<void> {
    const hasAccess = await this.canAccessFeature(organizationId, feature);
    if (!hasAccess) {
      throw new ForbiddenException(
        `${feature} is not available for project-based plans. Please upgrade to a user-based plan to access this feature.`,
      );
    }
  }

  /**
   * Get pricing model type for an organization
   */
  async getPricingModelType(organizationId: string): Promise<PricingModelType> {
    const subscription = await this.prismaService.subscription.findFirst({
      where: {
        organizationId,
        isActive: true,
      },
    });

    if (!subscription) {
      return PricingModelType.USER_BASED; // Default
    }

    return subscription.pricingModelType || PricingModelType.USER_BASED;
  }
}

