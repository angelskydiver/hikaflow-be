import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FlowStep {
  stepNumber: number;
  description: string;
  component: string;
  action: string;
  expectedOutcome: string;
  dependencies?: string[];
  dataFlow?: any;
}

export interface DetectedFlow {
  flowName: string;
  description: string;
  flowType: 'USER_JOURNEY' | 'API_FLOW' | 'DATA_FLOW' | 'INTEGRATION_FLOW';
  steps: FlowStep[];
  entryPoints: string[];
  exitPoints: string[];
  dependencies: string[];
  criticality: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  affectedComponents: string[];
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

@Injectable()
export class FlowAnalyzerService {
  constructor(private prisma: PrismaService) {}

  /**
   * Analyze code changes to detect business flows
   */
  async analyzeFlowsFromChanges(changedFiles: any[]): Promise<DetectedFlow[]> {
    try {
      const detectedFlows: DetectedFlow[] = [];

      // Analyze each changed file for flow patterns
      for (const file of changedFiles) {
        const flows = await this.analyzeFileForFlows(file);
        detectedFlows.push(...flows);
      }

      // Merge similar flows and remove duplicates
      const mergedFlows = this.mergeSimilarFlows(detectedFlows);

      return mergedFlows;
    } catch (error) {
      console.error('Error analyzing flows from changes:', error);
      throw new Error('Failed to analyze flows from changes');
    }
  }

  /**
   * Analyze a single file for flow patterns
   */
  private async analyzeFileForFlows(file: any): Promise<DetectedFlow[]> {
    const flows: DetectedFlow[] = [];
    const fileName = file.filename || file.fileName;
    const content = file.sourceCode || file.content || '';

    // Detect user journey flows
    const userJourneyFlows = this.detectUserJourneyFlows(fileName, content);
    flows.push(...userJourneyFlows);

    // Detect API flows
    const apiFlows = this.detectApiFlows(fileName, content);
    flows.push(...apiFlows);

    // Detect data flows
    const dataFlows = this.detectDataFlows(fileName, content);
    flows.push(...dataFlows);

    // Detect integration flows
    const integrationFlows = this.detectIntegrationFlows(fileName, content);
    flows.push(...integrationFlows);

    return flows;
  }

  /**
   * Detect user journey flows from file content
   */
  private detectUserJourneyFlows(fileName: string, content: string): DetectedFlow[] {
    const flows: DetectedFlow[] = [];

    // Look for user interaction patterns
    const userInteractionPatterns = [
      /onClick|onSubmit|onChange|onFocus|onBlur/g,
      /handleClick|handleSubmit|handleChange|handleFocus|handleBlur/g,
      /navigate|redirect|route/g,
      /login|logout|register|signup|signin/g,
    ];

    const hasUserInteractions = userInteractionPatterns.some(pattern => pattern.test(content));

    if (hasUserInteractions) {
      const flowName = this.extractFlowName(fileName, 'User Journey');
      const steps = this.extractUserJourneySteps(content);
      
      flows.push({
        flowName,
        description: `User interaction flow detected in ${fileName}`,
        flowType: 'USER_JOURNEY',
        steps,
        entryPoints: this.extractEntryPoints(content, 'user'),
        exitPoints: this.extractExitPoints(content, 'user'),
        dependencies: this.extractDependencies(content),
        criticality: this.determineCriticality(content, 'user'),
        affectedComponents: this.extractAffectedComponents(fileName, content),
        riskLevel: this.determineRiskLevel(content, 'user'),
      });
    }

    return flows;
  }

  /**
   * Detect API flows from file content
   */
  private detectApiFlows(fileName: string, content: string): DetectedFlow[] {
    const flows: DetectedFlow[] = [];

    // Look for API patterns
    const apiPatterns = [
      /fetch|axios|request|http|api/g,
      /GET|POST|PUT|DELETE|PATCH/g,
      /endpoint|route|controller|service/g,
      /response|status|error|catch/g,
    ];

    const hasApiPatterns = apiPatterns.some(pattern => pattern.test(content));

    if (hasApiPatterns) {
      const flowName = this.extractFlowName(fileName, 'API Flow');
      const steps = this.extractApiSteps(content);
      
      flows.push({
        flowName,
        description: `API flow detected in ${fileName}`,
        flowType: 'API_FLOW',
        steps,
        entryPoints: this.extractEntryPoints(content, 'api'),
        exitPoints: this.extractExitPoints(content, 'api'),
        dependencies: this.extractDependencies(content),
        criticality: this.determineCriticality(content, 'api'),
        affectedComponents: this.extractAffectedComponents(fileName, content),
        riskLevel: this.determineRiskLevel(content, 'api'),
      });
    }

    return flows;
  }

  /**
   * Detect data flows from file content
   */
  private detectDataFlows(fileName: string, content: string): DetectedFlow[] {
    const flows: DetectedFlow[] = [];

    // Look for data processing patterns
    const dataPatterns = [
      /database|db|query|sql|orm/g,
      /model|schema|entity|table/g,
      /create|read|update|delete|crud/g,
      /transform|map|filter|reduce|process/g,
      /validate|sanitize|parse|serialize/g,
    ];

    const hasDataPatterns = dataPatterns.some(pattern => pattern.test(content));

    if (hasDataPatterns) {
      const flowName = this.extractFlowName(fileName, 'Data Flow');
      const steps = this.extractDataSteps(content);
      
      flows.push({
        flowName,
        description: `Data flow detected in ${fileName}`,
        flowType: 'DATA_FLOW',
        steps,
        entryPoints: this.extractEntryPoints(content, 'data'),
        exitPoints: this.extractExitPoints(content, 'data'),
        dependencies: this.extractDependencies(content),
        criticality: this.determineCriticality(content, 'data'),
        affectedComponents: this.extractAffectedComponents(fileName, content),
        riskLevel: this.determineRiskLevel(content, 'data'),
      });
    }

    return flows;
  }

  /**
   * Detect integration flows from file content
   */
  private detectIntegrationFlows(fileName: string, content: string): DetectedFlow[] {
    const flows: DetectedFlow[] = [];

    // Look for integration patterns
    const integrationPatterns = [
      /import|export|require|module/g,
      /service|provider|client|adapter/g,
      /middleware|interceptor|guard/g,
      /event|emit|listen|subscribe/g,
      /webhook|callback|notification/g,
    ];

    const hasIntegrationPatterns = integrationPatterns.some(pattern => pattern.test(content));

    if (hasIntegrationPatterns) {
      const flowName = this.extractFlowName(fileName, 'Integration Flow');
      const steps = this.extractIntegrationSteps(content);
      
      flows.push({
        flowName,
        description: `Integration flow detected in ${fileName}`,
        flowType: 'INTEGRATION_FLOW',
        steps,
        entryPoints: this.extractEntryPoints(content, 'integration'),
        exitPoints: this.extractExitPoints(content, 'integration'),
        dependencies: this.extractDependencies(content),
        criticality: this.determineCriticality(content, 'integration'),
        affectedComponents: this.extractAffectedComponents(fileName, content),
        riskLevel: this.determineRiskLevel(content, 'integration'),
      });
    }

    return flows;
  }

  /**
   * Extract flow name from file name and type
   */
  private extractFlowName(fileName: string, type: string): string {
    const baseName = fileName.split('/').pop()?.split('.')[0] || 'Unknown';
    return `${baseName} ${type}`;
  }

  /**
   * Extract user journey steps from content
   */
  private extractUserJourneySteps(content: string): FlowStep[] {
    const steps: FlowStep[] = [];
    const lines = content.split('\n');
    let stepNumber = 1;

    lines.forEach((line, index) => {
      if (line.includes('onClick') || line.includes('onSubmit') || line.includes('handleClick')) {
        steps.push({
          stepNumber: stepNumber++,
          description: `User interaction at line ${index + 1}`,
          component: this.extractComponentName(line),
          action: this.extractAction(line),
          expectedOutcome: 'User interaction completed',
          dependencies: this.extractLineDependencies(line),
        });
      }
    });

    return steps;
  }

  /**
   * Extract API steps from content
   */
  private extractApiSteps(content: string): FlowStep[] {
    const steps: FlowStep[] = [];
    const lines = content.split('\n');
    let stepNumber = 1;

    lines.forEach((line, index) => {
      if (line.includes('fetch') || line.includes('axios') || line.includes('request')) {
        steps.push({
          stepNumber: stepNumber++,
          description: `API call at line ${index + 1}`,
          component: this.extractComponentName(line),
          action: this.extractAction(line),
          expectedOutcome: 'API response received',
          dependencies: this.extractLineDependencies(line),
        });
      }
    });

    return steps;
  }

  /**
   * Extract data steps from content
   */
  private extractDataSteps(content: string): FlowStep[] {
    const steps: FlowStep[] = [];
    const lines = content.split('\n');
    let stepNumber = 1;

    lines.forEach((line, index) => {
      if (line.includes('create') || line.includes('read') || line.includes('update') || line.includes('delete')) {
        steps.push({
          stepNumber: stepNumber++,
          description: `Data operation at line ${index + 1}`,
          component: this.extractComponentName(line),
          action: this.extractAction(line),
          expectedOutcome: 'Data operation completed',
          dependencies: this.extractLineDependencies(line),
        });
      }
    });

    return steps;
  }

  /**
   * Extract integration steps from content
   */
  private extractIntegrationSteps(content: string): FlowStep[] {
    const steps: FlowStep[] = [];
    const lines = content.split('\n');
    let stepNumber = 1;

    lines.forEach((line, index) => {
      if (line.includes('import') || line.includes('export') || line.includes('service')) {
        steps.push({
          stepNumber: stepNumber++,
          description: `Integration step at line ${index + 1}`,
          component: this.extractComponentName(line),
          action: this.extractAction(line),
          expectedOutcome: 'Integration completed',
          dependencies: this.extractLineDependencies(line),
        });
      }
    });

    return steps;
  }

  /**
   * Extract component name from line
   */
  private extractComponentName(line: string): string {
    const match = line.match(/(\w+)\s*[=\(]/);
    return match ? match[1] : 'Unknown';
  }

  /**
   * Extract action from line
   */
  private extractAction(line: string): string {
    if (line.includes('onClick')) return 'Click';
    if (line.includes('onSubmit')) return 'Submit';
    if (line.includes('fetch')) return 'API Call';
    if (line.includes('create')) return 'Create';
    if (line.includes('update')) return 'Update';
    if (line.includes('delete')) return 'Delete';
    return 'Action';
  }

  /**
   * Extract dependencies from line
   */
  private extractLineDependencies(line: string): string[] {
    const dependencies: string[] = [];
    
    // Look for import statements
    const importMatch = line.match(/import.*from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      dependencies.push(importMatch[1]);
    }

    // Look for function calls
    const functionMatches = line.match(/(\w+)\s*\(/g);
    if (functionMatches) {
      functionMatches.forEach(match => {
        const funcName = match.replace(/\s*\(/, '');
        if (funcName && funcName !== 'console' && funcName !== 'return') {
          dependencies.push(funcName);
        }
      });
    }

    return dependencies;
  }

  /**
   * Extract entry points from content
   */
  private extractEntryPoints(content: string, type: string): string[] {
    const entryPoints: string[] = [];
    
    if (type === 'user') {
      const userEntryPatterns = [
        /onClick|onSubmit|onChange/g,
        /handleClick|handleSubmit|handleChange/g,
        /navigate|redirect/g,
      ];
      
      userEntryPatterns.forEach(pattern => {
        const matches = content.match(pattern);
        if (matches) {
          entryPoints.push(...matches);
        }
      });
    }

    return [...new Set(entryPoints)]; // Remove duplicates
  }

  /**
   * Extract exit points from content
   */
  private extractExitPoints(content: string, type: string): string[] {
    const exitPoints: string[] = [];
    
    if (type === 'user') {
      const userExitPatterns = [
        /navigate|redirect|route/g,
        /logout|signout/g,
        /success|complete|finish/g,
      ];
      
      userExitPatterns.forEach(pattern => {
        const matches = content.match(pattern);
        if (matches) {
          exitPoints.push(...matches);
        }
      });
    }

    return [...new Set(exitPoints)]; // Remove duplicates
  }

  /**
   * Extract dependencies from content
   */
  private extractDependencies(content: string): string[] {
    const dependencies: string[] = [];
    
    // Extract import statements
    const importMatches = content.match(/import.*from\s+['"]([^'"]+)['"]/g);
    if (importMatches) {
      importMatches.forEach(match => {
        const moduleMatch = match.match(/from\s+['"]([^'"]+)['"]/);
        if (moduleMatch) {
          dependencies.push(moduleMatch[1]);
        }
      });
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Determine criticality based on content
   */
  private determineCriticality(content: string, type: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    const criticalKeywords = ['auth', 'security', 'payment', 'critical', 'important'];
    const highKeywords = ['user', 'data', 'api', 'service'];
    const mediumKeywords = ['component', 'function', 'utility'];
    
    const lowerContent = content.toLowerCase();
    
    if (criticalKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'CRITICAL';
    }
    
    if (highKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'HIGH';
    }
    
    if (mediumKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'MEDIUM';
    }
    
    return 'LOW';
  }

  /**
   * Extract affected components from file name and content
   */
  private extractAffectedComponents(fileName: string, content: string): string[] {
    const components: string[] = [];
    
    // Add file name as component
    const baseName = fileName.split('/').pop()?.split('.')[0];
    if (baseName) {
      components.push(baseName);
    }
    
    // Extract component names from content
    const componentMatches = content.match(/(\w+)\s*[=\(]/g);
    if (componentMatches) {
      componentMatches.forEach(match => {
        const componentName = match.replace(/\s*[=\(]/, '');
        if (componentName && componentName !== 'console' && componentName !== 'return') {
          components.push(componentName);
        }
      });
    }
    
    return [...new Set(components)]; // Remove duplicates
  }

  /**
   * Determine risk level based on content
   */
  private determineRiskLevel(content: string, type: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    const highRiskKeywords = ['error', 'exception', 'fail', 'crash', 'security'];
    const mediumRiskKeywords = ['warning', 'deprecated', 'legacy'];
    
    const lowerContent = content.toLowerCase();
    
    if (highRiskKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'HIGH';
    }
    
    if (mediumRiskKeywords.some(keyword => lowerContent.includes(keyword))) {
      return 'MEDIUM';
    }
    
    return 'LOW';
  }

  /**
   * Merge similar flows to avoid duplicates
   */
  private mergeSimilarFlows(flows: DetectedFlow[]): DetectedFlow[] {
    const mergedFlows: DetectedFlow[] = [];
    const flowMap = new Map<string, DetectedFlow>();
    
    flows.forEach(flow => {
      const key = `${flow.flowName}_${flow.flowType}`;
      
      if (flowMap.has(key)) {
        const existingFlow = flowMap.get(key)!;
        // Merge steps and other properties
        existingFlow.steps.push(...flow.steps);
        existingFlow.entryPoints.push(...flow.entryPoints);
        existingFlow.exitPoints.push(...flow.exitPoints);
        existingFlow.dependencies.push(...flow.dependencies);
        existingFlow.affectedComponents.push(...flow.affectedComponents);
        
        // Remove duplicates
        existingFlow.entryPoints = [...new Set(existingFlow.entryPoints)];
        existingFlow.exitPoints = [...new Set(existingFlow.exitPoints)];
        existingFlow.dependencies = [...new Set(existingFlow.dependencies)];
        existingFlow.affectedComponents = [...new Set(existingFlow.affectedComponents)];
      } else {
        flowMap.set(key, { ...flow });
      }
    });
    
    return Array.from(flowMap.values());
  }
}
