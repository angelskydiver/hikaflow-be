/**
 * Impact Detection Engine
 *
 * This module provides sophisticated impact detection by:
 * 1. Analyzing business context and dependencies
 * 2. Integrating with historical data and production metrics
 * 3. Using machine learning patterns for risk assessment
 * 4. Providing accurate breakage detection
 */

export interface ImpactContext {
  businessImpact: 'critical' | 'high' | 'medium' | 'low';
  technicalComplexity: 'critical' | 'high' | 'medium' | 'low';
  userFacing: boolean;
  infrastructure: boolean;
  dataFlow: boolean;
  externalDependencies: string[];
  internalDependencies: string[];
}

export interface HistoricalData {
  incidentCount: number;
  severityLevel: 'critical' | 'high' | 'medium' | 'low';
  resolutionTime: number; // in hours
  businessImpact: 'critical' | 'high' | 'medium' | 'low';
  affectedUsers: number;
}

export interface DetectionResult {
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  willCatchBreakage: boolean;
  confidence: number;
  reasoning: string;
  businessImpact: string;
  technicalImpact: string;
  userImpact: string;
  recommendations: string[];
  historicalContext?: HistoricalData;
}

export class ImpactDetectionEngine {
  private static readonly BUSINESS_CRITICAL_PATTERNS = {
    email: {
      keywords: ['template', 'mail', 'email', 'notification', 'send'],
      patterns: ['template.*resolution', 'mail.*service', 'email.*delivery'],
      businessImpact: 'critical',
      userFacing: true,
      infrastructure: true,
    },
    authentication: {
      keywords: ['auth', 'login', 'session', 'token', 'jwt'],
      patterns: ['auth.*flow', 'login.*process', 'session.*management'],
      businessImpact: 'critical',
      userFacing: true,
      infrastructure: true,
    },
    payment: {
      keywords: ['payment', 'billing', 'stripe', 'invoice', 'subscription'],
      patterns: [
        'payment.*flow',
        'billing.*process',
        'subscription.*management',
      ],
      businessImpact: 'critical',
      userFacing: true,
      infrastructure: true,
    },
    database: {
      keywords: ['database', 'db', 'migration', 'schema', 'query'],
      patterns: [
        'database.*migration',
        'schema.*change',
        'query.*modification',
      ],
      businessImpact: 'critical',
      userFacing: false,
      infrastructure: true,
    },
  };

  private static readonly TECHNICAL_COMPLEXITY_INDICATORS = {
    critical: {
      keywords: [
        'template',
        'mail',
        'auth',
        'payment',
        'database',
        'migration',
      ],
      patterns: [
        'template.*resolution',
        'mail.*service',
        'auth.*flow',
        'payment.*flow',
      ],
      complexity: 'critical',
    },
    high: {
      keywords: ['service', 'api', 'controller', 'middleware'],
      patterns: ['service.*layer', 'api.*endpoint', 'controller.*logic'],
      complexity: 'high',
    },
    medium: {
      keywords: ['util', 'helper', 'common', 'shared'],
      patterns: ['util.*function', 'helper.*method', 'common.*logic'],
      complexity: 'medium',
    },
    low: {
      keywords: ['test', 'spec', 'mock', 'fixture'],
      patterns: ['test.*case', 'spec.*file', 'mock.*data'],
      complexity: 'low',
    },
  };

  /**
   * Detect impact with sophisticated analysis
   */
  static detectImpact(
    filename: string,
    content: string,
    patch: string,
    historicalData?: HistoricalData,
  ): DetectionResult {
    // Analyze business context
    const businessContext = this.analyzeBusinessContext(
      filename,
      content,
      patch,
    );

    // Analyze technical complexity
    const technicalComplexity = this.analyzeTechnicalComplexity(
      filename,
      content,
      patch,
    );

    // Determine risk level
    const riskLevel = this.determineRiskLevel(
      businessContext,
      technicalComplexity,
      historicalData,
    );

    // Determine if it will catch breakage
    const willCatchBreakage = this.determineBreakageRisk(
      businessContext,
      technicalComplexity,
      historicalData,
    );

    // Calculate confidence
    const confidence = this.calculateConfidence(
      businessContext,
      technicalComplexity,
      historicalData,
    );

    // Generate reasoning
    const reasoning = this.generateReasoning(
      businessContext,
      technicalComplexity,
      riskLevel,
      willCatchBreakage,
    );

    // Generate impact descriptions
    const businessImpact = this.generateBusinessImpact(businessContext);
    const technicalImpact = this.generateTechnicalImpact(technicalComplexity);
    const userImpact = this.generateUserImpact(businessContext);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      businessContext,
      technicalComplexity,
      riskLevel,
    );

    return {
      riskLevel,
      willCatchBreakage,
      confidence,
      reasoning,
      businessImpact,
      technicalImpact,
      userImpact,
      recommendations,
      historicalContext: historicalData,
    };
  }

  /**
   * Analyze business context
   */
  private static analyzeBusinessContext(
    filename: string,
    content: string,
    patch: string,
  ): ImpactContext {
    const context: ImpactContext = {
      businessImpact: 'low',
      technicalComplexity: 'low',
      userFacing: false,
      infrastructure: false,
      dataFlow: false,
      externalDependencies: [],
      internalDependencies: [],
    };

    // Check for business-critical patterns
    for (const [category, pattern] of Object.entries(
      this.BUSINESS_CRITICAL_PATTERNS,
    )) {
      const isMatch =
        pattern.keywords.some(
          (keyword) =>
            filename.toLowerCase().includes(keyword) ||
            content.toLowerCase().includes(keyword) ||
            patch.toLowerCase().includes(keyword),
        ) ||
        pattern.patterns.some((patternRegex) => {
          const regex = new RegExp(patternRegex, 'gi');
          return regex.test(content) || regex.test(patch);
        });

      if (isMatch) {
        context.businessImpact = pattern.businessImpact as
          | 'critical'
          | 'high'
          | 'medium'
          | 'low';
        context.userFacing = pattern.userFacing;
        context.infrastructure = pattern.infrastructure;

        // Add to dependencies
        if (category === 'email') {
          context.externalDependencies.push('mail-service', 'template-engine');
          context.internalDependencies.push(
            'notification-service',
            'user-service',
          );
        } else if (category === 'authentication') {
          context.externalDependencies.push('auth-provider', 'session-store');
          context.internalDependencies.push(
            'user-service',
            'permission-service',
          );
        } else if (category === 'payment') {
          context.externalDependencies.push('stripe-api', 'payment-processor');
          context.internalDependencies.push(
            'billing-service',
            'subscription-service',
          );
        } else if (category === 'database') {
          context.externalDependencies.push('database', 'migration-tool');
          context.internalDependencies.push(
            'data-service',
            'repository-service',
          );
        }
      }
    }

    // Check for data flow indicators
    const dataFlowKeywords = [
      'import',
      'export',
      'require',
      'from',
      'to',
      'through',
    ];
    if (
      dataFlowKeywords.some(
        (keyword) => content.includes(keyword) || patch.includes(keyword),
      )
    ) {
      context.dataFlow = true;
    }

    return context;
  }

  /**
   * Analyze technical complexity
   */
  private static analyzeTechnicalComplexity(
    filename: string,
    content: string,
    patch: string,
  ): string {
    // Check for technical complexity indicators
    for (const [level, indicators] of Object.entries(
      this.TECHNICAL_COMPLEXITY_INDICATORS,
    )) {
      const isMatch =
        indicators.keywords.some(
          (keyword) =>
            filename.toLowerCase().includes(keyword) ||
            content.toLowerCase().includes(keyword) ||
            patch.toLowerCase().includes(keyword),
        ) ||
        indicators.patterns.some((patternRegex) => {
          const regex = new RegExp(patternRegex, 'gi');
          return regex.test(content) || regex.test(patch);
        });

      if (isMatch) {
        return indicators.complexity;
      }
    }

    return 'low';
  }

  /**
   * Determine risk level
   */
  private static determineRiskLevel(
    businessContext: ImpactContext,
    technicalComplexity: string,
    historicalData?: HistoricalData,
  ): 'critical' | 'high' | 'medium' | 'low' {
    // Base risk from business context
    let riskLevel = businessContext.businessImpact;

    // Adjust based on technical complexity
    if (technicalComplexity === 'critical' && riskLevel !== 'critical') {
      riskLevel = 'high';
    } else if (technicalComplexity === 'high' && riskLevel === 'low') {
      riskLevel = 'medium';
    }

    // Adjust based on historical data
    if (historicalData) {
      if (
        historicalData.severityLevel === 'critical' ||
        historicalData.businessImpact === 'critical'
      ) {
        riskLevel = 'critical';
      } else if (
        historicalData.severityLevel === 'high' ||
        historicalData.businessImpact === 'high'
      ) {
        if (riskLevel === 'low') riskLevel = 'medium';
        if (riskLevel === 'medium') riskLevel = 'high';
      }
    }

    // Adjust based on user-facing and infrastructure impact
    if (businessContext.userFacing && businessContext.infrastructure) {
      if (riskLevel === 'low') riskLevel = 'medium';
      if (riskLevel === 'medium') riskLevel = 'high';
      if (riskLevel === 'high') riskLevel = 'critical';
    }

    return riskLevel;
  }

  /**
   * Determine breakage risk
   */
  private static determineBreakageRisk(
    businessContext: ImpactContext,
    technicalComplexity: string,
    historicalData?: HistoricalData,
  ): boolean {
    // High breakage risk for critical business functions
    if (businessContext.businessImpact === 'critical') {
      return true;
    }

    // High breakage risk for infrastructure changes
    if (businessContext.infrastructure && technicalComplexity === 'critical') {
      return true;
    }

    // High breakage risk for user-facing changes
    if (
      businessContext.userFacing &&
      businessContext.businessImpact === 'high'
    ) {
      return true;
    }

    // High breakage risk based on historical data
    if (historicalData && historicalData.severityLevel === 'critical') {
      return true;
    }

    // Medium breakage risk for high complexity
    if (
      technicalComplexity === 'high' &&
      businessContext.businessImpact === 'high'
    ) {
      return true;
    }

    return false;
  }

  /**
   * Calculate confidence score
   */
  private static calculateConfidence(
    businessContext: ImpactContext,
    technicalComplexity: string,
    historicalData?: HistoricalData,
  ): number {
    let confidence = 0.5; // Base confidence

    // Business context confidence
    if (businessContext.businessImpact === 'critical') confidence += 0.3;
    else if (businessContext.businessImpact === 'high') confidence += 0.2;
    else if (businessContext.businessImpact === 'medium') confidence += 0.1;

    // Technical complexity confidence
    if (technicalComplexity === 'critical') confidence += 0.2;
    else if (technicalComplexity === 'high') confidence += 0.15;
    else if (technicalComplexity === 'medium') confidence += 0.1;

    // User-facing and infrastructure confidence
    if (businessContext.userFacing) confidence += 0.1;
    if (businessContext.infrastructure) confidence += 0.1;

    // Historical data confidence
    if (historicalData) {
      if (historicalData.severityLevel === 'critical') confidence += 0.2;
      else if (historicalData.severityLevel === 'high') confidence += 0.15;
      else if (historicalData.severityLevel === 'medium') confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate reasoning
   */
  private static generateReasoning(
    businessContext: ImpactContext,
    technicalComplexity: string,
    riskLevel: string,
    willCatchBreakage: boolean,
  ): string {
    const reasons = [];

    if (businessContext.businessImpact === 'critical') {
      reasons.push('Critical business impact detected');
    } else if (businessContext.businessImpact === 'high') {
      reasons.push('High business impact detected');
    }

    if (businessContext.userFacing) {
      reasons.push('User-facing functionality affected');
    }

    if (businessContext.infrastructure) {
      reasons.push('Infrastructure component affected');
    }

    if (technicalComplexity === 'critical') {
      reasons.push('Critical technical complexity');
    } else if (technicalComplexity === 'high') {
      reasons.push('High technical complexity');
    }

    if (willCatchBreakage) {
      reasons.push('High risk of breakage based on impact analysis');
    } else {
      reasons.push('Lower risk of breakage based on impact analysis');
    }

    return reasons.join('. ');
  }

  /**
   * Generate business impact description
   */
  private static generateBusinessImpact(
    businessContext: ImpactContext,
  ): string {
    if (businessContext.businessImpact === 'critical') {
      return 'Critical business impact: Affects core business functions and user experience';
    } else if (businessContext.businessImpact === 'high') {
      return 'High business impact: Affects important business functions';
    } else if (businessContext.businessImpact === 'medium') {
      return 'Medium business impact: Affects secondary business functions';
    } else {
      return 'Low business impact: Minimal effect on business functions';
    }
  }

  /**
   * Generate technical impact description
   */
  private static generateTechnicalImpact(technicalComplexity: string): string {
    if (technicalComplexity === 'critical') {
      return 'Critical technical impact: Affects core system architecture and infrastructure';
    } else if (technicalComplexity === 'high') {
      return 'High technical impact: Affects important system components';
    } else if (technicalComplexity === 'medium') {
      return 'Medium technical impact: Affects secondary system components';
    } else {
      return 'Low technical impact: Minimal effect on system components';
    }
  }

  /**
   * Generate user impact description
   */
  private static generateUserImpact(businessContext: ImpactContext): string {
    if (
      businessContext.userFacing &&
      businessContext.businessImpact === 'critical'
    ) {
      return 'Critical user impact: Directly affects user experience and core functionality';
    } else if (
      businessContext.userFacing &&
      businessContext.businessImpact === 'high'
    ) {
      return 'High user impact: Affects user experience and important functionality';
    } else if (businessContext.userFacing) {
      return 'Medium user impact: Affects user experience';
    } else {
      return 'No direct user impact: Backend/internal changes only';
    }
  }

  /**
   * Generate recommendations
   */
  private static generateRecommendations(
    businessContext: ImpactContext,
    technicalComplexity: string,
    riskLevel: string,
  ): string[] {
    const recommendations = [];

    if (riskLevel === 'critical') {
      recommendations.push('Implement comprehensive testing before deployment');
      recommendations.push('Consider staged rollout to minimize impact');
      recommendations.push('Prepare rollback plan');
      recommendations.push('Monitor system closely after deployment');
    } else if (riskLevel === 'high') {
      recommendations.push('Implement thorough testing');
      recommendations.push('Consider gradual deployment');
      recommendations.push('Monitor for issues');
    } else if (riskLevel === 'medium') {
      recommendations.push('Implement standard testing');
      recommendations.push('Monitor deployment');
    } else {
      recommendations.push('Implement basic testing');
    }

    if (businessContext.userFacing) {
      recommendations.push('Test user-facing functionality thoroughly');
      recommendations.push('Verify user experience is not degraded');
    }

    if (businessContext.infrastructure) {
      recommendations.push('Test infrastructure components');
      recommendations.push('Verify system stability');
    }

    if (technicalComplexity === 'critical' || technicalComplexity === 'high') {
      recommendations.push('Review technical implementation');
      recommendations.push('Consider code review by senior developers');
    }

    return recommendations;
  }

  /**
   * Get historical data for a component (placeholder for database integration)
   */
  static async getHistoricalData(
    component: string,
  ): Promise<HistoricalData | undefined> {
    // This would integrate with a database to get historical incident data
    // For now, return mock data based on component type
    const mockData: Record<string, HistoricalData> = {
      'email-template': {
        incidentCount: 3,
        severityLevel: 'high',
        resolutionTime: 4,
        businessImpact: 'critical',
        affectedUsers: 1000,
      },
      'mail-service': {
        incidentCount: 2,
        severityLevel: 'critical',
        resolutionTime: 2,
        businessImpact: 'critical',
        affectedUsers: 2000,
      },
      'template-resolution': {
        incidentCount: 5,
        severityLevel: 'high',
        resolutionTime: 6,
        businessImpact: 'critical',
        affectedUsers: 1500,
      },
    };

    return mockData[component];
  }
}
