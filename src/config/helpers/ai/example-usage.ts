/**
 * Example usage of the Moonshot Kimi helper for PR analysis
 *
 * This file demonstrates how to use the new sophisticated PR analysis system
 * that provides more accurate issue detection and better false positive prevention.
 */

import { AnalysisResult, MoonshotKimi } from './moonshot.kimi.helper';

// Example: Analyzing a PR with the new Moonshot Kimi system
async function analyzePullRequest() {
  // Initialize the Moonshot Kimi helper
  const moonshotKimi = new MoonshotKimi();

  // Example file changes from a PR
  const fileChanges = [
    {
      file: 'src/services/userService.ts',
      content: `
1: import { Injectable } from '@nestjs/common';
2: import { PrismaService } from '../prisma/prisma.service';
3: 
4: @Injectable()
5: export class UserService {
6:   constructor(private prisma: PrismaService) {}
7: 
8:   async getUserById(id: string) {
9:     // Potential SQL injection vulnerability
10:     const user = await this.prisma.$queryRaw\`SELECT * FROM users WHERE id = \${id}\`;
11:     return user;
12:   }
13: 
14:   async createUser(userData: any) {
15:     // Missing input validation
16:     const user = await this.prisma.user.create({
17:       data: userData
18:     });
19:     return user;
20:   }
21: }
      `.trim(),
    },
    {
      file: 'src/controllers/authController.ts',
      content: `
1: import { Controller, Post, Body } from '@nestjs/common';
2: 
3: @Controller('auth')
4: export class AuthController {
5:   @Post('login')
6:   async login(@Body() credentials: any) {
7:     // Hardcoded secret - security issue
8:     const secret = 'my-super-secret-key-12345';
9:     
10:     // Missing input validation
11:     const { username, password } = credentials;
12:     
13:     // Insecure password comparison
14:     if (username === 'admin' && password === 'password123') {
15:       return { token: 'fake-jwt-token' };
16:     }
17:     
18:     throw new Error('Invalid credentials');
19:   }
20: }
      `,
    },
  ];

  // Analysis context with repository settings and PR metadata
  const analysisContext = {
    repositorySettings: [
      { name: 'Security Level', value: 'HIGH' },
      { name: 'Performance Focus', value: 'MEDIUM' },
      { name: 'Code Quality', value: 'HIGH' },
    ],
    fileChanges: fileChanges,
    prMetadata: {
      title: 'Add user authentication service',
      description: 'Implementing user login and registration functionality',
      author: 'john.doe@company.com',
      branch: 'feature/user-auth',
      targetBranch: 'main',
    },
  };

  try {
    // Perform the analysis
    const analysis: AnalysisResult =
      await moonshotKimi.analyzeCodeFilesForIssues(
        fileChanges,
        analysisContext,
      );

    // Display results
    console.log('=== Moonshot Kimi Analysis Results ===');
    console.log(`Summary: ${analysis.summary}`);
    console.log(`Total Issues: ${analysis.metrics.totalIssues}`);
    console.log(`Critical Issues: ${analysis.metrics.criticalIssues}`);
    console.log(`High Priority Issues: ${analysis.metrics.highPriorityIssues}`);
    console.log(
      `False Positive Estimate: ${analysis.metrics.falsePositiveEstimate}%`,
    );

    console.log('\n=== Risk Assessment ===');
    console.log(`Overall Risk: ${analysis.riskAssessment.overallRisk}`);
    console.log(`Security Risk: ${analysis.riskAssessment.securityRisk}/100`);
    console.log(
      `Performance Risk: ${analysis.riskAssessment.performanceRisk}/100`,
    );
    console.log(
      `Maintainability Risk: ${analysis.riskAssessment.maintainabilityRisk}/100`,
    );
    console.log(`Business Risk: ${analysis.riskAssessment.businessRisk}/100`);

    console.log('\n=== Issues Found ===');
    analysis.codeIssues.forEach((issue, index) => {
      console.log(`\n${index + 1}. ${issue.issue} (${issue.priority})`);
      console.log(`   File: ${issue.file}:${issue.line}`);
      console.log(`   Category: ${issue.category}`);
      console.log(`   Confidence: ${issue.confidence}%`);
      console.log(`   False Positive Risk: ${issue.falsePositiveRisk}`);
      console.log(`   Business Impact: ${issue.businessImpact}`);
      console.log(`   Reason: ${issue.reason}`);
    });

    console.log('\n=== Recommendations ===');
    if (analysis.recommendations.immediate.length > 0) {
      console.log('\nImmediate Actions:');
      analysis.recommendations.immediate.forEach((rec) =>
        console.log(`  - ${rec}`),
      );
    }

    if (analysis.recommendations.shortTerm.length > 0) {
      console.log('\nShort Term:');
      analysis.recommendations.shortTerm.forEach((rec) =>
        console.log(`  - ${rec}`),
      );
    }

    if (analysis.recommendations.longTerm.length > 0) {
      console.log('\nLong Term:');
      analysis.recommendations.longTerm.forEach((rec) =>
        console.log(`  - ${rec}`),
      );
    }
  } catch (error) {
    console.error('Analysis failed:', error.message);
  }
}

// Example: Using the complexity analysis feature
async function analyzeCodeComplexity() {
  const moonshotKimi = new MoonshotKimi();

  const files = [
    {
      filename: 'src/services/complexService.ts',
      patch: `
+ function complexFunction() {
+   if (condition1) {
+     if (condition2) {
+       if (condition3) {
+         // Deep nesting detected
+         doSomething();
+       }
+     }
+   }
+ }
      `,
    },
  ];

  try {
    const complexityAnalysis =
      await moonshotKimi.analyzeCodeComplexityAndDuplication(files);

    console.log('=== Complexity Analysis ===');
    console.log(`Duplication: ${complexityAnalysis.duplication.percentage}%`);
    console.log(`Complexity: ${complexityAnalysis.complexity.percentage}%`);

    console.log('\nDuplicated Files:');
    complexityAnalysis.duplication.files.forEach((file) => {
      console.log(`  - ${file.fileName}: ${file.description}`);
    });

    console.log('\nComplex Files:');
    complexityAnalysis.complexity.files.forEach((file) => {
      console.log(`  - ${file.fileName}: ${file.description}`);
    });
  } catch (error) {
    console.error('Complexity analysis failed:', error.message);
  }
}

// Export for use in other modules
export { analyzeCodeComplexity, analyzePullRequest };
