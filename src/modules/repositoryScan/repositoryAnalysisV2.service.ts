import { Injectable } from '@nestjs/common';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { QueryParserService } from './queryParser.service';
import { SafeQueryExecutorService } from './safeQueryExecutor.service';

/**
 * Repository Analysis Service V2
 * Enhanced version with AI-powered query parsing and safe execution
 * This version does NOT affect existing functionality
 */

interface AnalysisResponseV2 {
  answer: string;
  evidence: {
    confidence: 'High' | 'Medium' | 'Low';
    sources: string[];
    dataPoints: number;
  };
  details: {
    queryType: string;
    rawData: any;
    summary: string;
    keyFindings: string[];
  };
  metadata: {
    queryParsed: boolean;
    executionTime: number;
    fallbackUsed: boolean;
  };
}

@Injectable()
export class RepositoryAnalysisV2Service {
  private gemini: Gemini;

  constructor(
    private prisma: PrismaService,
    private queryParser: QueryParserService,
    private queryExecutor: SafeQueryExecutorService,
  ) {
    this.gemini = new Gemini();
  }

  /**
   * Main entry point for V2 analysis
   * Handles all query types with AI-powered parsing and safe execution
   */
  async analyzeQueryV2(
    query: string,
    repositoryId: string,
    streamProgress?: (step: string, message: string, data?: any) => void,
    streamTextChunk?: (chunk: string) => void,
  ): Promise<AnalysisResponseV2> {
    const startTime = Date.now();
    console.log(`[AnalysisV2] Starting analysis for query: "${query}"`);

    try {
      // Step 1: Parse query using AI
      if (streamProgress) {
        streamProgress('parsing', 'Understanding your question with AI...');
      }

      const parsedQuery = await this.queryParser.parseQuery(
        query,
        repositoryId,
      );
      console.log('[AnalysisV2] Query parsed:', parsedQuery);

      // Step 2: Execute safe database query
      if (streamProgress) {
        streamProgress('querying', 'Retrieving data from database...');
      }

      const queryResult = await this.queryExecutor.executeQuery(
        parsedQuery,
        repositoryId,
      );
      console.log('[AnalysisV2] Query executed:', queryResult.queryType);

      // Step 3: Generate AI analysis
      if (streamProgress) {
        streamProgress('analyzing', 'Analyzing data with AI...');
      }

      const aiAnalysis = await this.generateAIAnalysis(
        query,
        queryResult,
        parsedQuery,
        streamTextChunk,
      );

      // Step 4: Build response
      const executionTime = Date.now() - startTime;
      const response: AnalysisResponseV2 = {
        answer: aiAnalysis.answer,
        evidence: {
          confidence: this.calculateConfidence(parsedQuery, queryResult),
          sources: this.extractSources(queryResult),
          dataPoints: this.countDataPoints(queryResult),
        },
        details: {
          queryType: parsedQuery.queryType,
          rawData: queryResult.data,
          summary: aiAnalysis.summary,
          keyFindings: aiAnalysis.keyFindings,
        },
        metadata: {
          queryParsed: parsedQuery.confidence > 0.5,
          executionTime,
          fallbackUsed: queryResult.queryType === 'fallback',
        },
      };

      console.log(`[AnalysisV2] Analysis completed in ${executionTime}ms`);
      return response;
    } catch (error) {
      console.error('[AnalysisV2] Analysis failed:', error);

      // Fallback response
      return {
        answer:
          'I encountered an issue processing your query. Please try rephrasing your question.',
        evidence: {
          confidence: 'Low',
          sources: [],
          dataPoints: 0,
        },
        details: {
          queryType: 'error',
          rawData: null,
          summary: 'Query processing failed',
          keyFindings: [],
        },
        metadata: {
          queryParsed: false,
          executionTime: Date.now() - startTime,
          fallbackUsed: true,
        },
      };
    }
  }

  /**
   * Generate AI analysis from query results
   */
  private async generateAIAnalysis(
    query: string,
    queryResult: any,
    parsedQuery: any,
    streamTextChunk?: (chunk: string) => void,
  ): Promise<any> {
    const prompt = this.buildAnalysisPrompt(query, queryResult, parsedQuery);

    try {
      const response = await this.gemini.generateResponseWithStreaming(
        prompt,
        streamTextChunk,
      );

      return this.parseAIAnalysisResponse(response);
    } catch (error) {
      console.error('[AnalysisV2] AI analysis failed:', error);
      return this.generateFallbackAnalysis(queryResult);
    }
  }

  /**
   * Build comprehensive analysis prompt for AI
   */
  private buildAnalysisPrompt(
    query: string,
    queryResult: any,
    parsedQuery: any,
  ): string {
    const dataContext = this.buildDataContext(queryResult);

    return `
You are a senior software engineer analyzing code repository data. Provide a clear, accurate, and confident answer.

USER QUESTION: "${query}"

QUERY TYPE: ${parsedQuery.queryType}

DATA CONTEXT:
${dataContext}

INSTRUCTIONS:
1. Answer the question DIRECTLY and CONFIDENTLY
2. Use SPECIFIC data from the context (numbers, names, dates)
3. Provide EVIDENCE for your answer
4. Structure your response clearly
5. Be CONCISE but COMPLETE

RESPONSE FORMAT (JSON):
{
  "answer": "Direct answer to the question with specific details",
  "summary": "Brief summary of findings",
  "keyFindings": [
    "Finding 1 with specific data",
    "Finding 2 with specific data",
    "Finding 3 with specific data"
  ]
}

IMPORTANT:
- NO generic statements like "Based on the data..."
- USE actual numbers and names from the data
- BE SPECIFIC about what was done, when, and by whom
- If data is insufficient, say so clearly

Analyze and respond in JSON format:
`;
  }

  /**
   * Build data context from query results
   */
  private buildDataContext(queryResult: any): string {
    let context = '';

    switch (queryResult.queryType) {
      case 'pr_analysis':
        context = this.buildPRContext(queryResult.data);
        break;
      case 'committer_analysis':
        context = this.buildCommitterContext(queryResult.data);
        break;
      case 'time_range_analysis':
        context = this.buildTimeRangeContext(queryResult.data);
        break;
      case 'feature_verification':
        context = this.buildFeatureContext(queryResult.data);
        break;
      default:
        context = this.buildGenericContext(queryResult.data);
    }

    return context;
  }

  /**
   * Build PR-specific context
   */
  private buildPRContext(data: any): string {
    const { prReport, commits, comments, summary } = data;

    return `
PR #${prReport?.prNumber || 'Unknown'}
- Title: ${prReport?.summary?.title || 'N/A'}
- Total Commits: ${summary.totalCommits}
- Total Comments: ${summary.totalComments}
- Lines Added: ${summary.linesAdded}
- Lines Deleted: ${summary.linesDeleted}
- Files Changed: ${summary.filesChanged}
- Contributors: ${summary.contributors.join(', ')}

COMMITS:
${commits
  .slice(0, 10)
  .map((c) => `- ${c.commitMessage} (${c.committer})`)
  .join('\n')}

ANALYSIS:
${JSON.stringify(prReport?.summary || {}, null, 2)}
`;
  }

  /**
   * Build committer-specific context
   */
  private buildCommitterContext(data: any): string {
    const { commits, metrics } = data;

    return `
COMMITTER ACTIVITY:
- Total Commits: ${metrics.totalCommits}
- Total Additions: ${metrics.totalAdditions}
- Total Deletions: ${metrics.totalDeletions}
- Files Modified: ${metrics.filesModified}
- Unique PRs: ${metrics.uniquePRs}
- Time Range: ${metrics.timeRange.earliest} to ${metrics.timeRange.latest}

RECENT COMMITS:
${commits
  .slice(0, 10)
  .map(
    (c) =>
      `- ${c.commitMessage} (+${c.additions}/-${c.deletions}) on ${c.createdAt}`,
  )
  .join('\n')}
`;
  }

  /**
   * Build time range context
   */
  private buildTimeRangeContext(data: any): string {
    const { commits, prs, metrics } = data;

    return `
TIME RANGE ANALYSIS:
- Total Commits: ${metrics.totalCommits}
- Total PRs: ${metrics.totalPRs}
- Total Additions: ${metrics.totalAdditions}
- Total Deletions: ${metrics.totalDeletions}
- Unique Contributors: ${metrics.uniqueContributors}
- Most Active: ${metrics.mostActiveContributor}

RECENT COMMITS:
${commits
  .slice(0, 10)
  .map((c) => `- ${c.commitMessage} by ${c.committer} on ${c.createdAt}`)
  .join('\n')}

RECENT PRS:
${prs
  .slice(0, 5)
  .map((pr) => `- PR #${pr.prNumber} (${pr.commitSummary.length} commits)`)
  .join('\n')}
`;
  }

  /**
   * Build feature verification context
   */
  private buildFeatureContext(data: any): string {
    const { found, commits, latestPR } = data;

    return `
FEATURE SEARCH RESULTS:
- Found: ${found ? 'YES' : 'NO'}
- Related Commits: ${commits.length}

${found ? `RELATED COMMITS:\n${commits.map((c) => `- ${c.commitMessage} by ${c.committer}`).join('\n')}` : 'No commits found related to this feature.'}

LATEST PR:
- PR #${latestPR?.prNumber || 'N/A'}
- Commits: ${latestPR?.commitSummary?.length || 0}
`;
  }

  /**
   * Build generic context
   */
  private buildGenericContext(data: any): string {
    if (data.commits) {
      return `
COMMITS:
${data.commits
  .slice(0, 10)
  .map((c) => `- ${c.commitMessage} by ${c.committer}`)
  .join('\n')}
`;
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Parse AI analysis response
   */
  private parseAIAnalysisResponse(response: string): any {
    try {
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.includes('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(jsonStr);
      return {
        answer: parsed.answer || 'No answer provided',
        summary: parsed.summary || '',
        keyFindings: parsed.keyFindings || [],
      };
    } catch (error) {
      console.error('[AnalysisV2] Failed to parse AI response:', error);
      return {
        answer: response,
        summary: response,
        keyFindings: [],
      };
    }
  }

  /**
   * Generate fallback analysis
   */
  private generateFallbackAnalysis(queryResult: any): any {
    return {
      answer: 'Analysis completed. See details below.',
      summary: `Found ${this.countDataPoints(queryResult)} data points`,
      keyFindings: ['Data retrieved successfully', 'See raw data for details'],
    };
  }

  /**
   * Calculate confidence level
   */
  private calculateConfidence(
    parsedQuery: any,
    queryResult: any,
  ): 'High' | 'Medium' | 'Low' {
    const dataPoints = this.countDataPoints(queryResult);
    const parseConfidence = parsedQuery.confidence || 0;

    if (parseConfidence > 0.8 && dataPoints > 5) {
      return 'High';
    } else if (parseConfidence > 0.5 && dataPoints > 2) {
      return 'Medium';
    } else {
      return 'Low';
    }
  }

  /**
   * Extract data sources
   */
  private extractSources(queryResult: any): string[] {
    const sources = new Set<string>();

    if (queryResult.data.commits) {
      sources.add('Commits');
    }
    if (queryResult.data.prs || queryResult.data.prReport) {
      sources.add('Pull Requests');
    }
    if (queryResult.data.comments) {
      sources.add('Comments');
    }

    return Array.from(sources);
  }

  /**
   * Count data points
   */
  private countDataPoints(queryResult: any): number {
    let count = 0;

    if (queryResult.data.commits) {
      count += queryResult.data.commits.length;
    }
    if (queryResult.data.prs) {
      count += queryResult.data.prs.length;
    }
    if (queryResult.data.comments) {
      count += queryResult.data.comments.length;
    }

    return count;
  }
}
