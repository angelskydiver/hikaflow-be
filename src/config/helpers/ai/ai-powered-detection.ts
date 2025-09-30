/**
 * AI-Powered Impact Detection Engine
 *
 * This module provides intelligent, context-aware impact detection using AI analysis
 * instead of hard-coded patterns. It understands business context, user impact,
 * and infrastructure dependencies through sophisticated AI reasoning.
 */

export interface AIDetectionContext {
  filename: string;
  content: string;
  patch: string;
  fileType: string;
  changeType: string;
  businessContext?: string;
  userImpact?: string;
  infrastructureImpact?: string;
}

export interface AIDetectionResult {
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  willCatchBreakage: boolean;
  confidence: number;
  reasoning: string;
  businessImpact: string;
  technicalImpact: string;
  userImpact: string;
  recommendations: string[];
  aiAnalysis: {
    businessContext: string;
    userFacing: boolean;
    infrastructure: boolean;
    criticalBusinessFunction: string;
    realWorldImpact: string;
    affectedUsers: string;
    revenueImpact: string;
  };
}

export class AIPoweredDetectionEngine {
  /**
   * Analyze impact using AI-powered context understanding
   */
  static async analyzeImpact(
    filename: string,
    content: string,
    patch: string,
    aiModel: any, // The AI model instance
  ): Promise<AIDetectionResult> {
    // Create context for AI analysis
    const context = this.createAnalysisContext(filename, content, patch);

    // Generate AI-powered analysis prompt
    const analysisPrompt = this.generateAnalysisPrompt(context);

    // Get AI analysis
    const aiResponse = await this.getAIAnalysis(analysisPrompt, aiModel);

    // Parse and structure the AI response
    return this.parseAIResponse(aiResponse, context);
  }

  /**
   * Create comprehensive context for AI analysis
   */
  private static createAnalysisContext(
    filename: string,
    content: string,
    patch: string,
  ): AIDetectionContext {
    return {
      filename,
      content,
      patch,
      fileType: this.determineFileType(filename),
      changeType: this.determineChangeType(patch),
      businessContext: this.extractBusinessContext(filename, content),
      userImpact: this.extractUserImpact(filename, content),
      infrastructureImpact: this.extractInfrastructureImpact(filename, content),
    };
  }

  /**
   * Generate sophisticated AI analysis prompt
   */
  private static generateAnalysisPrompt(context: AIDetectionContext): string {
    return `
You are an expert software engineer analyzing code changes for business impact and breakage risk. 

ANALYSIS CONTEXT:
- File: ${context.filename}
- File Type: ${context.fileType}
- Change Type: ${context.changeType}
- Business Context: ${context.businessContext || 'Not specified'}
- User Impact: ${context.userImpact || 'Not specified'}
- Infrastructure Impact: ${context.infrastructureImpact || 'Not specified'}

CODE CHANGES:
${context.patch}

FULL FILE CONTENT:
${context.content}

ANALYSIS REQUIREMENTS:
1. **Business Context Analysis**: Understand the business importance of this change
2. **User Impact Assessment**: Determine if this affects user experience or customer-facing features
3. **Infrastructure Impact**: Assess if this affects core system components or infrastructure
4. **Risk Assessment**: Evaluate the real-world risk of this change
5. **Breakage Detection**: Determine if this change will cause breakages

CRITICAL BUSINESS FUNCTIONS TO CONSIDER:
- Email/Template Systems: Critical for user notifications and communications
- Authentication/Authorization: Essential for user access and security
- Payment/Billing Systems: Revenue-critical, affects financial transactions
- Database/Migration Changes: Data integrity and system stability
- API Endpoints: External integrations and service dependencies
- User Interface Components: User experience and accessibility

Please provide a comprehensive analysis including:
1. Risk level (critical/high/medium/low)
2. Whether this will catch breakage (true/false)
3. Confidence score (0-1)
4. Detailed reasoning
5. Business impact description
6. Technical impact description
7. User impact description
8. Specific recommendations
9. AI analysis of business context, user-facing status, infrastructure impact, critical business function, real-world impact, affected users, and revenue impact

Be specific and provide concrete evidence for your assessments.
`;
  }

  /**
   * Get AI analysis using the provided model
   */
  private static async getAIAnalysis(
    prompt: string,
    aiModel: any,
  ): Promise<string> {
    try {
      // Use the AI model to analyze the prompt
      const response = await aiModel.generateContent(prompt);
      return response.text || response;
    } catch (error) {
      console.error('AI analysis error:', error);
      return this.getFallbackAnalysis();
    }
  }

  /**
   * Parse AI response into structured result
   */
  private static parseAIResponse(
    aiResponse: string,
    context: AIDetectionContext,
  ): AIDetectionResult {
    try {
      // Try to parse JSON response
      const parsed = JSON.parse(aiResponse);
      return this.structureAIResult(parsed, context);
    } catch {
      // Fallback to text parsing
      return this.parseTextResponse(aiResponse, context);
    }
  }

  /**
   * Structure AI result from parsed JSON
   */
  private static structureAIResult(
    parsed: any,
    context: AIDetectionContext,
  ): AIDetectionResult {
    return {
      riskLevel: parsed.riskLevel || this.inferRiskLevel(parsed),
      willCatchBreakage:
        parsed.willCatchBreakage || this.inferBreakageRisk(parsed),
      confidence: parsed.confidence || 0.7,
      reasoning: parsed.reasoning || 'AI analysis provided',
      businessImpact: parsed.businessImpact || 'Business impact analysis',
      technicalImpact: parsed.technicalImpact || 'Technical impact analysis',
      userImpact: parsed.userImpact || 'User impact analysis',
      recommendations: parsed.recommendations || [
        'Review the changes carefully',
      ],
      aiAnalysis: {
        businessContext:
          parsed.businessContext || context.businessContext || 'Not analyzed',
        userFacing: parsed.userFacing || this.inferUserFacing(context),
        infrastructure:
          parsed.infrastructure || this.inferInfrastructure(context),
        criticalBusinessFunction:
          parsed.criticalBusinessFunction ||
          this.inferCriticalFunction(context),
        realWorldImpact: parsed.realWorldImpact || 'Real-world impact analysis',
        affectedUsers: parsed.affectedUsers || 'User impact analysis',
        revenueImpact: parsed.revenueImpact || 'Revenue impact analysis',
      },
    };
  }

  /**
   * Parse text response from AI
   */
  private static parseTextResponse(
    text: string,
    context: AIDetectionContext,
  ): AIDetectionResult {
    // Extract information from text response
    const riskLevel = this.extractRiskLevel(text);
    const willCatchBreakage = this.extractBreakageRisk(text);
    const confidence = this.extractConfidence(text);

    return {
      riskLevel,
      willCatchBreakage,
      confidence,
      reasoning: this.extractReasoning(text),
      businessImpact: this.extractBusinessImpact(text),
      technicalImpact: this.extractTechnicalImpact(text),
      userImpact: this.extractUserImpactFromText(text),
      recommendations: this.extractRecommendations(text),
      aiAnalysis: {
        businessContext: context.businessContext || 'Not analyzed',
        userFacing: this.inferUserFacing(context),
        infrastructure: this.inferInfrastructure(context),
        criticalBusinessFunction: this.inferCriticalFunction(context),
        realWorldImpact: 'Real-world impact analysis',
        affectedUsers: 'User impact analysis',
        revenueImpact: 'Revenue impact analysis',
      },
    };
  }

  /**
   * Determine file type from filename
   */
  private static determineFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const name = filename.toLowerCase();

    if (name.includes('template') || name.includes('mail'))
      return 'email-template';
    if (name.includes('auth') || name.includes('login'))
      return 'authentication';
    if (name.includes('payment') || name.includes('billing')) return 'payment';
    if (name.includes('database') || name.includes('migration'))
      return 'database';
    if (name.includes('api') || name.includes('controller')) return 'api';
    if (name.includes('component') || name.includes('ui')) return 'ui';
    if (name.includes('service')) return 'service';
    if (name.includes('util') || name.includes('helper')) return 'utility';
    if (name.includes('test')) return 'test';

    return ext || 'unknown';
  }

  /**
   * Determine change type from patch
   */
  private static determineChangeType(patch: string): string {
    if (patch.includes('+') && patch.includes('-')) return 'modification';
    if (patch.includes('+') && !patch.includes('-')) return 'addition';
    if (patch.includes('-') && !patch.includes('+')) return 'removal';
    return 'unknown';
  }

  /**
   * Extract business context from filename and content
   */
  private static extractBusinessContext(
    filename: string,
    content: string,
  ): string {
    const name = filename.toLowerCase();
    const text = content.toLowerCase();

    if (
      name.includes('template') ||
      name.includes('mail') ||
      text.includes('email')
    ) {
      return 'Email/Template system - Critical for user notifications and communications';
    }
    if (
      name.includes('auth') ||
      name.includes('login') ||
      text.includes('authentication')
    ) {
      return 'Authentication system - Essential for user access and security';
    }
    if (
      name.includes('payment') ||
      name.includes('billing') ||
      text.includes('stripe')
    ) {
      return 'Payment system - Revenue-critical, affects financial transactions';
    }
    if (
      name.includes('database') ||
      name.includes('migration') ||
      text.includes('schema')
    ) {
      return 'Database system - Data integrity and system stability';
    }
    if (name.includes('api') || name.includes('controller')) {
      return 'API system - External integrations and service dependencies';
    }
    if (name.includes('component') || name.includes('ui')) {
      return 'UI system - User experience and customer-facing functionality';
    }

    return 'General system component';
  }

  /**
   * Extract user impact from filename and content
   */
  private static extractUserImpact(filename: string, content: string): string {
    const name = filename.toLowerCase();
    const text = content.toLowerCase();

    if (
      name.includes('template') ||
      name.includes('mail') ||
      text.includes('notification')
    ) {
      return 'High user impact - Affects user notifications and communications';
    }
    if (name.includes('auth') || name.includes('login')) {
      return 'Critical user impact - Affects user access and security';
    }
    if (name.includes('payment') || name.includes('billing')) {
      return 'Critical user impact - Affects payment processing and transactions';
    }
    if (name.includes('component') || name.includes('ui')) {
      return 'High user impact - Affects user interface and experience';
    }
    if (name.includes('api') || name.includes('controller')) {
      return 'Medium user impact - May affect external integrations';
    }

    return 'Low user impact - Backend/internal changes';
  }

  /**
   * Extract infrastructure impact from filename and content
   */
  private static extractInfrastructureImpact(
    filename: string,
    content: string,
  ): string {
    const name = filename.toLowerCase();
    const text = content.toLowerCase();

    if (name.includes('template') || name.includes('mail')) {
      return 'High infrastructure impact - Core email delivery system';
    }
    if (name.includes('auth') || name.includes('login')) {
      return 'Critical infrastructure impact - Core authentication system';
    }
    if (name.includes('payment') || name.includes('billing')) {
      return 'Critical infrastructure impact - Core payment processing system';
    }
    if (name.includes('database') || name.includes('migration')) {
      return 'Critical infrastructure impact - Core data system';
    }
    if (name.includes('api') || name.includes('controller')) {
      return 'High infrastructure impact - Core API system';
    }

    return 'Low infrastructure impact - Secondary system component';
  }

  /**
   * Infer risk level from AI response
   */
  private static inferRiskLevel(
    parsed: any,
  ): 'critical' | 'high' | 'medium' | 'low' {
    const text = JSON.stringify(parsed).toLowerCase();
    if (text.includes('critical')) return 'critical';
    if (text.includes('high')) return 'high';
    if (text.includes('medium')) return 'medium';
    return 'low';
  }

  /**
   * Infer breakage risk from AI response
   */
  private static inferBreakageRisk(parsed: any): boolean {
    const text = JSON.stringify(parsed).toLowerCase();
    return (
      text.includes('break') || text.includes('fail') || text.includes('error')
    );
  }

  /**
   * Infer user-facing status from context
   */
  private static inferUserFacing(context: AIDetectionContext): boolean {
    const name = context.filename.toLowerCase();
    const content = context.content.toLowerCase();

    return (
      name.includes('template') ||
      name.includes('mail') ||
      name.includes('auth') ||
      name.includes('login') ||
      name.includes('payment') ||
      name.includes('billing') ||
      name.includes('component') ||
      name.includes('ui') ||
      content.includes('user') ||
      content.includes('customer')
    );
  }

  /**
   * Infer infrastructure status from context
   */
  private static inferInfrastructure(context: AIDetectionContext): boolean {
    const name = context.filename.toLowerCase();
    const content = context.content.toLowerCase();

    return (
      name.includes('template') ||
      name.includes('mail') ||
      name.includes('auth') ||
      name.includes('login') ||
      name.includes('payment') ||
      name.includes('billing') ||
      name.includes('database') ||
      name.includes('migration') ||
      name.includes('api') ||
      name.includes('controller') ||
      content.includes('infrastructure') ||
      content.includes('core')
    );
  }

  /**
   * Infer critical business function from context
   */
  private static inferCriticalFunction(context: AIDetectionContext): string {
    const name = context.filename.toLowerCase();
    const content = context.content.toLowerCase();

    if (
      name.includes('template') ||
      name.includes('mail') ||
      content.includes('email')
    ) {
      return 'Email';
    }
    if (
      name.includes('auth') ||
      name.includes('login') ||
      content.includes('authentication')
    ) {
      return 'Authentication';
    }
    if (
      name.includes('payment') ||
      name.includes('billing') ||
      content.includes('stripe')
    ) {
      return 'Payment';
    }
    if (
      name.includes('database') ||
      name.includes('migration') ||
      content.includes('schema')
    ) {
      return 'Database';
    }
    if (name.includes('api') || name.includes('controller')) {
      return 'API';
    }
    if (name.includes('component') || name.includes('ui')) {
      return 'UI';
    }

    return 'General';
  }

  /**
   * Extract risk level from text
   */
  private static extractRiskLevel(
    text: string,
  ): 'critical' | 'high' | 'medium' | 'low' {
    const lower = text.toLowerCase();
    if (lower.includes('critical')) return 'critical';
    if (lower.includes('high')) return 'high';
    if (lower.includes('medium')) return 'medium';
    return 'low';
  }

  /**
   * Extract breakage risk from text
   */
  private static extractBreakageRisk(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('break') ||
      lower.includes('fail') ||
      lower.includes('error')
    );
  }

  /**
   * Extract confidence from text
   */
  private static extractConfidence(text: string): number {
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const num = parseFloat(match[1]);
      return num > 1 ? num / 100 : num;
    }
    return 0.7;
  }

  /**
   * Extract reasoning from text
   */
  private static extractReasoning(text: string): string {
    const lines = text.split('\n');
    for (const line of lines) {
      if (
        line.toLowerCase().includes('reason') ||
        line.toLowerCase().includes('because')
      ) {
        return line.trim();
      }
    }
    return 'AI analysis provided';
  }

  /**
   * Extract business impact from text
   */
  private static extractBusinessImpact(text: string): string {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().includes('business')) {
        return line.trim();
      }
    }
    return 'Business impact analysis';
  }

  /**
   * Extract technical impact from text
   */
  private static extractTechnicalImpact(text: string): string {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().includes('technical')) {
        return line.trim();
      }
    }
    return 'Technical impact analysis';
  }

  /**
   * Extract user impact from text response
   */
  private static extractUserImpactFromText(text: string): string {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().includes('user')) {
        return line.trim();
      }
    }
    return 'User impact analysis';
  }

  /**
   * Extract recommendations from text
   */
  private static extractRecommendations(text: string): string[] {
    const lines = text.split('\n');
    const recommendations = [];

    for (const line of lines) {
      if (
        line.toLowerCase().includes('recommend') ||
        line.toLowerCase().includes('suggest')
      ) {
        recommendations.push(line.trim());
      }
    }

    return recommendations.length > 0
      ? recommendations
      : ['Review the changes carefully'];
  }

  /**
   * Get fallback analysis when AI fails
   */
  private static getFallbackAnalysis(): string {
    return JSON.stringify({
      riskLevel: 'medium',
      willCatchBreakage: false,
      confidence: 0.5,
      reasoning: 'Fallback analysis - AI model unavailable',
      businessImpact: 'Business impact analysis unavailable',
      technicalImpact: 'Technical impact analysis unavailable',
      userImpact: 'User impact analysis unavailable',
      recommendations: ['Review changes manually'],
      businessContext: 'Business context analysis unavailable',
      userFacing: false,
      infrastructure: false,
      criticalBusinessFunction: 'General',
      realWorldImpact: 'Real-world impact analysis unavailable',
      affectedUsers: 'User impact analysis unavailable',
      revenueImpact: 'Revenue impact analysis unavailable',
    });
  }
}
