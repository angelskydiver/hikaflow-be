import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { EnhancedTestCaseService } from './enhancedTestCase.service';
import { FlowAnalyzerService } from './flowAnalyzer.service';
import { QualityMetricsService } from './qualityMetrics.service';

@Controller('enhanced-test-cases')
export class EnhancedTestCaseController {
  constructor(
    private enhancedTestCaseService: EnhancedTestCaseService,
    private flowAnalyzerService: FlowAnalyzerService,
    private qualityMetricsService: QualityMetricsService,
  ) {}

  /**
   * Create enhanced test cases for a regression report
   */
  @Post(':regressionReportId')
  async createEnhancedTestCases(
    @Param('regressionReportId') regressionReportId: string,
    @Body() body: { testCases: any[]; flows: any[]; qualityMetrics: any }
  ) {
    try {
      const { testCases, flows, qualityMetrics } = body;

      // Create enhanced test cases
      const createdTestCases = await this.enhancedTestCaseService.createEnhancedTestCases(
        regressionReportId,
        testCases
      );

      // Create business flows
      const createdFlows = await this.enhancedTestCaseService.createBusinessFlows(
        regressionReportId,
        flows
      );

      // Create quality metrics
      const createdMetrics = await this.enhancedTestCaseService.createOrUpdateTestQualityMetrics(
        regressionReportId,
        qualityMetrics
      );

      return {
        success: true,
        data: {
          testCases: createdTestCases,
          flows: createdFlows,
          qualityMetrics: createdMetrics,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get enhanced test cases for a regression report
   */
  @Get(':regressionReportId')
  async getEnhancedTestCases(@Param('regressionReportId') regressionReportId: string) {
    try {
      const testCases = await this.enhancedTestCaseService.getEnhancedTestCases(regressionReportId);
      return {
        success: true,
        data: testCases,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get business flows for a regression report
   */
  @Get(':regressionReportId/flows')
  async getBusinessFlows(@Param('regressionReportId') regressionReportId: string) {
    try {
      const flows = await this.enhancedTestCaseService.getBusinessFlows(regressionReportId);
      return {
        success: true,
        data: flows,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get test quality metrics for a regression report
   */
  @Get(':regressionReportId/quality-metrics')
  async getTestQualityMetrics(@Param('regressionReportId') regressionReportId: string) {
    try {
      const metrics = await this.enhancedTestCaseService.getTestQualityMetrics(regressionReportId);
      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get comprehensive test analysis for a regression report
   */
  @Get(':regressionReportId/comprehensive-analysis')
  async getComprehensiveTestAnalysis(@Param('regressionReportId') regressionReportId: string) {
    try {
      const analysis = await this.enhancedTestCaseService.getComprehensiveTestAnalysis(regressionReportId);
      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Analyze flows from code changes
   */
  @Post('analyze-flows')
  async analyzeFlowsFromChanges(@Body() body: { changedFiles: any[] }) {
    try {
      const { changedFiles } = body;
      const flows = await this.flowAnalyzerService.analyzeFlowsFromChanges(changedFiles);
      return {
        success: true,
        data: flows,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Calculate quality metrics
   */
  @Post('calculate-quality-metrics')
  async calculateQualityMetrics(@Body() body: any) {
    try {
      const metrics = await this.qualityMetricsService.calculateQualityMetrics(body);
      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get quality recommendations
   */
  @Post('quality-recommendations')
  async getQualityRecommendations(@Body() body: { metrics: any }) {
    try {
      const { metrics } = body;
      const recommendations = this.qualityMetricsService.getQualityRecommendations(metrics);
      return {
        success: true,
        data: recommendations,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update test case quality score
   */
  @Put(':testCaseId/quality-score')
  async updateTestCaseQualityScore(
    @Param('testCaseId') testCaseId: string,
    @Body() body: { qualityScore: number; coverageImpact: number }
  ) {
    try {
      const { qualityScore, coverageImpact } = body;
      const updatedTestCase = await this.enhancedTestCaseService.updateTestCaseQualityScore(
        testCaseId,
        qualityScore,
        coverageImpact
      );
      return {
        success: true,
        data: updatedTestCase,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete enhanced test cases for a regression report
   */
  @Delete(':regressionReportId')
  async deleteEnhancedTestCases(@Param('regressionReportId') regressionReportId: string) {
    try {
      await this.enhancedTestCaseService.deleteEnhancedTestCases(regressionReportId);
      await this.enhancedTestCaseService.deleteBusinessFlows(regressionReportId);
      await this.enhancedTestCaseService.deleteTestQualityMetrics(regressionReportId);
      return {
        success: true,
        message: 'Enhanced test cases deleted successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get quality trends for a repository
   */
  @Get('quality-trends/:repositoryId')
  async getQualityTrends(
    @Param('repositoryId') repositoryId: string,
    @Query('timeRange') timeRange: string = '30d'
  ) {
    try {
      const trends = await this.qualityMetricsService.calculateQualityTrends(repositoryId, timeRange);
      return {
        success: true,
        data: trends,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
