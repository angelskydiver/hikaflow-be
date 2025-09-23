import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { 
  TestCaseType, 
  TestCaseCategory, 
  TestCasePriority, 
  TestCaseConfidence, 
  AutomationComplexity 
} from '@prisma/client';

export interface EnhancedTestCaseInput {
  testName: string;
  type: TestCaseType;
  category: TestCaseCategory;
  priority: TestCasePriority;
  flowName?: string;
  scenario: string;
  preconditions?: string[];
  steps: any[];
  expectedResult: string;
  edgeCases?: any[];
  dataVariations?: any[];
  performanceExpectations?: any;
  securityConsiderations?: any;
  willCatchBreakage: boolean;
  confidence: TestCaseConfidence;
  estimatedExecutionTime?: string;
  automationComplexity: AutomationComplexity;
  framework?: string;
  copyPasteCode?: string;
  codeExample?: string;
  assertionPoints?: string[];
  mockRequirements?: string[];
  relatedFlows?: string[];
  tags?: string[];
  qualityScore?: number;
  coverageImpact?: number;
}

export interface BusinessFlowInput {
  flowName: string;
  description: string;
  flowType: string;
  steps: any[];
  entryPoints?: string[];
  exitPoints?: string[];
  dependencies?: string[];
  criticality: TestCasePriority;
  affectedComponents?: string[];
  testCases?: string[];
  coverage?: number;
  riskLevel?: string;
}

export interface TestQualityMetricsInput {
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
export class EnhancedTestCaseService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create enhanced test cases for a regression report
   */
  async createEnhancedTestCases(
    regressionReportId: string,
    testCases: EnhancedTestCaseInput[]
  ): Promise<any[]> {
    try {
      const createdTestCases = await Promise.all(
        testCases.map(async (testCase) => {
          return await this.prisma.enhancedTestCase.create({
            data: {
              ...testCase,
              regressionReportId,
            },
          });
        })
      );

      return createdTestCases;
    } catch (error) {
      console.error('Error creating enhanced test cases:', error);
      throw new Error('Failed to create enhanced test cases');
    }
  }

  /**
   * Create business flows for a regression report
   */
  async createBusinessFlows(
    regressionReportId: string,
    flows: BusinessFlowInput[]
  ): Promise<any[]> {
    try {
      const createdFlows = await Promise.all(
        flows.map(async (flow) => {
          return await this.prisma.businessFlow.create({
            data: {
              ...flow,
              regressionReportId,
            },
          });
        })
      );

      return createdFlows;
    } catch (error) {
      console.error('Error creating business flows:', error);
      throw new Error('Failed to create business flows');
    }
  }

  /**
   * Create or update test quality metrics for a regression report
   */
  async createOrUpdateTestQualityMetrics(
    regressionReportId: string,
    metrics: TestQualityMetricsInput
  ): Promise<any> {
    try {
      // Check if metrics already exist
      const existingMetrics = await this.prisma.testQualityMetrics.findFirst({
        where: { regressionReportId },
      });

      if (existingMetrics) {
        return await this.prisma.testQualityMetrics.update({
          where: { id: existingMetrics.id },
          data: metrics,
        });
      } else {
        return await this.prisma.testQualityMetrics.create({
          data: {
            ...metrics,
            regressionReportId,
          },
        });
      }
    } catch (error) {
      console.error('Error creating/updating test quality metrics:', error);
      throw new Error('Failed to create/update test quality metrics');
    }
  }

  /**
   * Get enhanced test cases for a regression report
   */
  async getEnhancedTestCases(regressionReportId: string): Promise<any[]> {
    try {
      return await this.prisma.enhancedTestCase.findMany({
        where: { regressionReportId },
        orderBy: [
          { priority: 'asc' },
          { type: 'asc' },
          { createdAt: 'desc' },
        ],
      });
    } catch (error) {
      console.error('Error fetching enhanced test cases:', error);
      throw new Error('Failed to fetch enhanced test cases');
    }
  }

  /**
   * Get business flows for a regression report
   */
  async getBusinessFlows(regressionReportId: string): Promise<any[]> {
    try {
      return await this.prisma.businessFlow.findMany({
        where: { regressionReportId },
        orderBy: [
          { criticality: 'asc' },
          { createdAt: 'desc' },
        ],
      });
    } catch (error) {
      console.error('Error fetching business flows:', error);
      throw new Error('Failed to fetch business flows');
    }
  }

  /**
   * Get test quality metrics for a regression report
   */
  async getTestQualityMetrics(regressionReportId: string): Promise<any | null> {
    try {
      return await this.prisma.testQualityMetrics.findFirst({
        where: { regressionReportId },
      });
    } catch (error) {
      console.error('Error fetching test quality metrics:', error);
      throw new Error('Failed to fetch test quality metrics');
    }
  }

  /**
   * Get comprehensive test analysis for a regression report
   */
  async getComprehensiveTestAnalysis(regressionReportId: string): Promise<any> {
    try {
      const [testCases, businessFlows, qualityMetrics] = await Promise.all([
        this.getEnhancedTestCases(regressionReportId),
        this.getBusinessFlows(regressionReportId),
        this.getTestQualityMetrics(regressionReportId),
      ]);

      // Calculate additional metrics
      const testCaseStats = this.calculateTestCaseStats(testCases);
      const flowStats = this.calculateFlowStats(businessFlows);

      return {
        testCases,
        businessFlows,
        qualityMetrics,
        testCaseStats,
        flowStats,
        summary: {
          totalTestCases: testCases.length,
          totalFlows: businessFlows.length,
          overallCoverage: qualityMetrics?.overallCoverage || 0,
          qualityScore: qualityMetrics?.testQualityScore || 0,
        },
      };
    } catch (error) {
      console.error('Error fetching comprehensive test analysis:', error);
      throw new Error('Failed to fetch comprehensive test analysis');
    }
  }

  /**
   * Calculate test case statistics
   */
  private calculateTestCaseStats(testCases: any[]): any {
    const stats = {
      byType: {},
      byCategory: {},
      byPriority: {},
      byConfidence: {},
      totalExecutionTime: 0,
      automationRatio: 0,
    };

    testCases.forEach((testCase) => {
      // Count by type
      stats.byType[testCase.type] = (stats.byType[testCase.type] || 0) + 1;

      // Count by category
      stats.byCategory[testCase.category] = (stats.byCategory[testCase.category] || 0) + 1;

      // Count by priority
      stats.byPriority[testCase.priority] = (stats.byPriority[testCase.priority] || 0) + 1;

      // Count by confidence
      stats.byConfidence[testCase.confidence] = (stats.byConfidence[testCase.confidence] || 0) + 1;

      // Calculate total execution time (simplified)
      const timeMatch = testCase.estimatedExecutionTime?.match(/(\d+)/);
      if (timeMatch) {
        stats.totalExecutionTime += parseInt(timeMatch[1]);
      }

      // Count automation complexity
      if (testCase.automationComplexity !== 'COMPLEX') {
        stats.automationRatio++;
      }
    });

    stats.automationRatio = testCases.length > 0 ? stats.automationRatio / testCases.length : 0;

    return stats;
  }

  /**
   * Calculate flow statistics
   */
  private calculateFlowStats(businessFlows: any[]): any {
    const stats = {
      byType: {},
      byCriticality: {},
      byRiskLevel: {},
      totalCoverage: 0,
      averageCoverage: 0,
    };

    businessFlows.forEach((flow) => {
      // Count by type
      stats.byType[flow.flowType] = (stats.byType[flow.flowType] || 0) + 1;

      // Count by criticality
      stats.byCriticality[flow.criticality] = (stats.byCriticality[flow.criticality] || 0) + 1;

      // Count by risk level
      stats.byRiskLevel[flow.riskLevel] = (stats.byRiskLevel[flow.riskLevel] || 0) + 1;

      // Calculate coverage
      stats.totalCoverage += flow.coverage || 0;
    });

    stats.averageCoverage = businessFlows.length > 0 ? stats.totalCoverage / businessFlows.length : 0;

    return stats;
  }

  /**
   * Update test case quality score
   */
  async updateTestCaseQualityScore(
    testCaseId: string,
    qualityScore: number,
    coverageImpact: number
  ): Promise<any> {
    try {
      return await this.prisma.enhancedTestCase.update({
        where: { id: testCaseId },
        data: {
          qualityScore,
          coverageImpact,
        },
      });
    } catch (error) {
      console.error('Error updating test case quality score:', error);
      throw new Error('Failed to update test case quality score');
    }
  }

  /**
   * Delete enhanced test cases for a regression report
   */
  async deleteEnhancedTestCases(regressionReportId: string): Promise<void> {
    try {
      await this.prisma.enhancedTestCase.deleteMany({
        where: { regressionReportId },
      });
    } catch (error) {
      console.error('Error deleting enhanced test cases:', error);
      throw new Error('Failed to delete enhanced test cases');
    }
  }

  /**
   * Delete business flows for a regression report
   */
  async deleteBusinessFlows(regressionReportId: string): Promise<void> {
    try {
      await this.prisma.businessFlow.deleteMany({
        where: { regressionReportId },
      });
    } catch (error) {
      console.error('Error deleting business flows:', error);
      throw new Error('Failed to delete business flows');
    }
  }

  /**
   * Delete test quality metrics for a regression report
   */
  async deleteTestQualityMetrics(regressionReportId: string): Promise<void> {
    try {
      await this.prisma.testQualityMetrics.deleteMany({
        where: { regressionReportId },
      });
    } catch (error) {
      console.error('Error deleting test quality metrics:', error);
      throw new Error('Failed to delete test quality metrics');
    }
  }
}
