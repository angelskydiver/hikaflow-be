import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface QualityMetricsInput {
  testCases: any[];
  businessFlows: any[];
  impactedFlows: any[];
  potentialBreakages: any[];
  changedBehavior: any[];
}

export interface QualityMetricsResult {
  overallCoverage: number;
  happyPathCoverage: number;
  edgeCaseCoverage: number;
  errorHandlingCoverage: number;
  integrationCoverage: number;
  e2eCoverage: number;
  unitTestRatio: number;
  integrationTestRatio: number;
  e2eTestRatio: number;
  performanceTestRatio: number;
  criticalRiskCoverage: number;
  highRiskCoverage: number;
  mediumRiskCoverage: number;
  lowRiskCoverage: number;
  testQualityScore: number;
  automationScore: number;
  maintainabilityScore: number;
}

@Injectable()
export class QualityMetricsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate comprehensive quality metrics
   */
  async calculateQualityMetrics(input: QualityMetricsInput): Promise<QualityMetricsResult> {
    try {
      const metrics = {
        overallCoverage: this.calculateOverallCoverage(input),
        happyPathCoverage: this.calculateHappyPathCoverage(input),
        edgeCaseCoverage: this.calculateEdgeCaseCoverage(input),
        errorHandlingCoverage: this.calculateErrorHandlingCoverage(input),
        integrationCoverage: this.calculateIntegrationCoverage(input),
        e2eCoverage: this.calculateE2eCoverage(input),
        unitTestRatio: this.calculateUnitTestRatio(input),
        integrationTestRatio: this.calculateIntegrationTestRatio(input),
        e2eTestRatio: this.calculateE2eTestRatio(input),
        performanceTestRatio: this.calculatePerformanceTestRatio(input),
        criticalRiskCoverage: this.calculateCriticalRiskCoverage(input),
        highRiskCoverage: this.calculateHighRiskCoverage(input),
        mediumRiskCoverage: this.calculateMediumRiskCoverage(input),
        lowRiskCoverage: this.calculateLowRiskCoverage(input),
        testQualityScore: this.calculateTestQualityScore(input),
        automationScore: this.calculateAutomationScore(input),
        maintainabilityScore: this.calculateMaintainabilityScore(input),
      };

      return metrics;
    } catch (error) {
      console.error('Error calculating quality metrics:', error);
      throw new Error('Failed to calculate quality metrics');
    }
  }

  /**
   * Calculate overall test coverage
   */
  private calculateOverallCoverage(input: QualityMetricsInput): number {
    const totalFlows = input.businessFlows.length + input.impactedFlows.length;
    const coveredFlows = input.testCases.filter(testCase => 
      testCase.flowName && testCase.flowName.trim() !== ''
    ).length;

    if (totalFlows === 0) return 0;
    return Math.min((coveredFlows / totalFlows) * 100, 100);
  }

  /**
   * Calculate happy path coverage
   */
  private calculateHappyPathCoverage(input: QualityMetricsInput): number {
    const happyPathTests = input.testCases.filter(testCase => 
      testCase.category === 'HAPPY_PATH'
    ).length;

    const totalFlows = input.businessFlows.length;
    if (totalFlows === 0) return 0;
    return Math.min((happyPathTests / totalFlows) * 100, 100);
  }

  /**
   * Calculate edge case coverage
   */
  private calculateEdgeCaseCoverage(input: QualityMetricsInput): number {
    const edgeCaseTests = input.testCases.filter(testCase => 
      testCase.category === 'EDGE_CASE' || testCase.category === 'BOUNDARY_CONDITION'
    ).length;

    const totalFlows = input.businessFlows.length;
    if (totalFlows === 0) return 0;
    return Math.min((edgeCaseTests / totalFlows) * 100, 100);
  }

  /**
   * Calculate error handling coverage
   */
  private calculateErrorHandlingCoverage(input: QualityMetricsInput): number {
    const errorHandlingTests = input.testCases.filter(testCase => 
      testCase.category === 'ERROR_HANDLING'
    ).length;

    const totalBreakages = input.potentialBreakages.length;
    if (totalBreakages === 0) return 0;
    return Math.min((errorHandlingTests / totalBreakages) * 100, 100);
  }

  /**
   * Calculate integration coverage
   */
  private calculateIntegrationCoverage(input: QualityMetricsInput): number {
    const integrationTests = input.testCases.filter(testCase => 
      testCase.type === 'INTEGRATION' || testCase.category === 'INTEGRATION_FLOW'
    ).length;

    const totalFlows = input.businessFlows.length;
    if (totalFlows === 0) return 0;
    return Math.min((integrationTests / totalFlows) * 100, 100);
  }

  /**
   * Calculate E2E coverage
   */
  private calculateE2eCoverage(input: QualityMetricsInput): number {
    const e2eTests = input.testCases.filter(testCase => 
      testCase.type === 'E2E'
    ).length;

    const totalFlows = input.businessFlows.length;
    if (totalFlows === 0) return 0;
    return Math.min((e2eTests / totalFlows) * 100, 100);
  }

  /**
   * Calculate unit test ratio
   */
  private calculateUnitTestRatio(input: QualityMetricsInput): number {
    const unitTests = input.testCases.filter(testCase => 
      testCase.type === 'UNIT'
    ).length;

    const totalTests = input.testCases.length;
    if (totalTests === 0) return 0;
    return (unitTests / totalTests) * 100;
  }

  /**
   * Calculate integration test ratio
   */
  private calculateIntegrationTestRatio(input: QualityMetricsInput): number {
    const integrationTests = input.testCases.filter(testCase => 
      testCase.type === 'INTEGRATION'
    ).length;

    const totalTests = input.testCases.length;
    if (totalTests === 0) return 0;
    return (integrationTests / totalTests) * 100;
  }

  /**
   * Calculate E2E test ratio
   */
  private calculateE2eTestRatio(input: QualityMetricsInput): number {
    const e2eTests = input.testCases.filter(testCase => 
      testCase.type === 'E2E'
    ).length;

    const totalTests = input.testCases.length;
    if (totalTests === 0) return 0;
    return (e2eTests / totalTests) * 100;
  }

  /**
   * Calculate performance test ratio
   */
  private calculatePerformanceTestRatio(input: QualityMetricsInput): number {
    const performanceTests = input.testCases.filter(testCase => 
      testCase.type === 'PERFORMANCE'
    ).length;

    const totalTests = input.testCases.length;
    if (totalTests === 0) return 0;
    return (performanceTests / totalTests) * 100;
  }

  /**
   * Calculate critical risk coverage
   */
  private calculateCriticalRiskCoverage(input: QualityMetricsInput): number {
    const criticalTests = input.testCases.filter(testCase => 
      testCase.priority === 'CRITICAL'
    ).length;

    const criticalFlows = input.businessFlows.filter(flow => 
      flow.criticality === 'CRITICAL'
    ).length;

    if (criticalFlows === 0) return 0;
    return Math.min((criticalTests / criticalFlows) * 100, 100);
  }

  /**
   * Calculate high risk coverage
   */
  private calculateHighRiskCoverage(input: QualityMetricsInput): number {
    const highTests = input.testCases.filter(testCase => 
      testCase.priority === 'HIGH'
    ).length;

    const highFlows = input.businessFlows.filter(flow => 
      flow.criticality === 'HIGH'
    ).length;

    if (highFlows === 0) return 0;
    return Math.min((highTests / highFlows) * 100, 100);
  }

  /**
   * Calculate medium risk coverage
   */
  private calculateMediumRiskCoverage(input: QualityMetricsInput): number {
    const mediumTests = input.testCases.filter(testCase => 
      testCase.priority === 'MEDIUM'
    ).length;

    const mediumFlows = input.businessFlows.filter(flow => 
      flow.criticality === 'MEDIUM'
    ).length;

    if (mediumFlows === 0) return 0;
    return Math.min((mediumTests / mediumFlows) * 100, 100);
  }

  /**
   * Calculate low risk coverage
   */
  private calculateLowRiskCoverage(input: QualityMetricsInput): number {
    const lowTests = input.testCases.filter(testCase => 
      testCase.priority === 'LOW'
    ).length;

    const lowFlows = input.businessFlows.filter(flow => 
      flow.criticality === 'LOW'
    ).length;

    if (lowFlows === 0) return 0;
    return Math.min((lowTests / lowFlows) * 100, 100);
  }

  /**
   * Calculate test quality score
   */
  private calculateTestQualityScore(input: QualityMetricsInput): number {
    const scores = [];

    // Test case quality factors
    const hasDetailedSteps = input.testCases.filter(testCase => 
      Array.isArray(testCase.steps) && testCase.steps.length > 0
    ).length / input.testCases.length;

    const hasExpectedResults = input.testCases.filter(testCase => 
      testCase.expectedResult && testCase.expectedResult.trim() !== ''
    ).length / input.testCases.length;

    const hasCodeExamples = input.testCases.filter(testCase => 
      testCase.codeExample && testCase.codeExample.trim() !== ''
    ).length / input.testCases.length;

    const hasAssertions = input.testCases.filter(testCase => 
      Array.isArray(testCase.assertionPoints) && testCase.assertionPoints.length > 0
    ).length / input.testCases.length;

    scores.push(hasDetailedSteps * 25);
    scores.push(hasExpectedResults * 25);
    scores.push(hasCodeExamples * 25);
    scores.push(hasAssertions * 25);

    return scores.reduce((sum, score) => sum + score, 0);
  }

  /**
   * Calculate automation score
   */
  private calculateAutomationScore(input: QualityMetricsInput): number {
    const automationFactors = [];

    // Automation complexity distribution
    const simpleTests = input.testCases.filter(testCase => 
      testCase.automationComplexity === 'SIMPLE'
    ).length / input.testCases.length;

    const moderateTests = input.testCases.filter(testCase => 
      testCase.automationComplexity === 'MODERATE'
    ).length / input.testCases.length;

    const complexTests = input.testCases.filter(testCase => 
      testCase.automationComplexity === 'COMPLEX'
    ).length / input.testCases.length;

    // Calculate automation score (higher score for more automatable tests)
    const automationScore = (simpleTests * 100) + (moderateTests * 70) + (complexTests * 30);

    return Math.min(automationScore, 100);
  }

  /**
   * Calculate maintainability score
   */
  private calculateMaintainabilityScore(input: QualityMetricsInput): number {
    const maintainabilityFactors = [];

    // Test case maintainability factors
    const hasClearNames = input.testCases.filter(testCase => 
      testCase.testName && testCase.testName.trim() !== ''
    ).length / input.testCases.length;

    const hasDescriptions = input.testCases.filter(testCase => 
      testCase.scenario && testCase.scenario.trim() !== ''
    ).length / input.testCases.length;

    const hasPreconditions = input.testCases.filter(testCase => 
      Array.isArray(testCase.preconditions) && testCase.preconditions.length > 0
    ).length / input.testCases.length;

    const hasTags = input.testCases.filter(testCase => 
      Array.isArray(testCase.tags) && testCase.tags.length > 0
    ).length / input.testCases.length;

    maintainabilityFactors.push(hasClearNames * 25);
    maintainabilityFactors.push(hasDescriptions * 25);
    maintainabilityFactors.push(hasPreconditions * 25);
    maintainabilityFactors.push(hasTags * 25);

    return maintainabilityFactors.reduce((sum, factor) => sum + factor, 0);
  }

  /**
   * Get quality recommendations based on metrics
   */
  getQualityRecommendations(metrics: QualityMetricsResult): string[] {
    const recommendations: string[] = [];

    // Coverage recommendations
    if (metrics.overallCoverage < 80) {
      recommendations.push('Increase overall test coverage to at least 80%');
    }

    if (metrics.happyPathCoverage < 100) {
      recommendations.push('Ensure 100% coverage of happy path scenarios');
    }

    if (metrics.edgeCaseCoverage < 80) {
      recommendations.push('Increase edge case coverage to at least 80%');
    }

    if (metrics.errorHandlingCoverage < 90) {
      recommendations.push('Improve error handling test coverage to at least 90%');
    }

    // Test distribution recommendations
    if (metrics.unitTestRatio < 40) {
      recommendations.push('Increase unit test ratio to at least 40%');
    }

    if (metrics.integrationTestRatio < 30) {
      recommendations.push('Increase integration test ratio to at least 30%');
    }

    if (metrics.e2eTestRatio < 20) {
      recommendations.push('Increase E2E test ratio to at least 20%');
    }

    // Quality score recommendations
    if (metrics.testQualityScore < 80) {
      recommendations.push('Improve test case quality by adding detailed steps, expected results, and code examples');
    }

    if (metrics.automationScore < 70) {
      recommendations.push('Increase test automation by simplifying complex test cases');
    }

    if (metrics.maintainabilityScore < 80) {
      recommendations.push('Improve test maintainability by adding clear names, descriptions, and tags');
    }

    return recommendations;
  }

  /**
   * Calculate quality trends over time
   */
  async calculateQualityTrends(repositoryId: string, timeRange: string): Promise<any> {
    try {
      const startDate = this.getStartDate(timeRange);
      
      const reports = await this.prisma.regressionReport.findMany({
        where: {
          repositoryId,
          createdAt: {
            gte: startDate,
          },
        },
        include: {
          testQualityMetrics: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const trends = {
        overallCoverage: reports.map(r => r.testQualityMetrics?.overallCoverage || 0),
        testQualityScore: reports.map(r => r.testQualityMetrics?.testQualityScore || 0),
        automationScore: reports.map(r => r.testQualityMetrics?.automationScore || 0),
        maintainabilityScore: reports.map(r => r.testQualityMetrics?.maintainabilityScore || 0),
        timestamps: reports.map(r => r.createdAt),
      };

      return trends;
    } catch (error) {
      console.error('Error calculating quality trends:', error);
      throw new Error('Failed to calculate quality trends');
    }
  }

  /**
   * Get start date based on time range
   */
  private getStartDate(timeRange: string): Date {
    const now = new Date();
    
    switch (timeRange) {
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }
}
