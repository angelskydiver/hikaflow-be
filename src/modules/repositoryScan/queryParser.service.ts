import { Injectable } from '@nestjs/common';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';

/**
 * AI-Powered Query Parser
 * Extracts structured parameters from natural language queries
 */

interface QueryParseResult {
  queryType:
    | 'committer_analysis'
    | 'pr_analysis'
    | 'time_range_analysis'
    | 'feature_verification'
    | 'cross_pr'
    | 'module_analysis';
  tables: string[];
  filters: QueryFilter[];
  timeRange?: {
    startDate: Date;
    endDate: Date;
  };
  orderBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
  confidence: number;
}

interface QueryFilter {
  table: string;
  field: string;
  operator: 'equals' | 'contains' | 'gte' | 'lte' | 'in' | 'not';
  value: any;
  dataType: 'string' | 'number' | 'date' | 'boolean';
  logicalOperator?: 'AND' | 'OR';
}

@Injectable()
export class QueryParserService {
  private gemini: Gemini;

  // Schema definition for AI reference
  private readonly schemaDefinition = {
    commitSummary: {
      tableName: 'commitSummary',
      fields: {
        id: 'string',
        repositoryId: 'string',
        reportId: 'string',
        commitId: 'string',
        commitMessage: 'string',
        additions: 'number',
        deletions: 'number',
        totalFiles: 'number',
        committer: 'string',
        summary: 'json',
        branchName: 'string',
        isMerged: 'boolean',
        mergedAt: 'date',
        moduleChanges: 'json',
        commitUrl: 'string',
        parentCommitId: 'string',
        createdAt: 'date',
        updatedAt: 'date',
      },
      relationships: {
        repository: 'Repository',
        report: 'ExecutiveReport',
      },
    },
    ExecutiveReport: {
      tableName: 'ExecutiveReport',
      fields: {
        id: 'string',
        repositoryId: 'string',
        prNumber: 'number',
        summary: 'json',
      },
      relationships: {
        repository: 'Repository',
        commitSummary: 'commitSummary[]',
        codeOverview: 'CodeOverview[]',
      },
    },
    PrTracker: {
      tableName: 'PrTracker',
      fields: {
        id: 'string',
        prId: 'string',
        status: 'string',
        try: 'number',
        response: 'json',
        createdAt: 'date',
        updatedAt: 'date',
      },
    },
    Comment: {
      tableName: 'Comment',
      fields: {
        id: 'string',
        repositoryId: 'string',
        prId: 'string',
        content: 'string',
        line: 'number',
        file: 'string',
        issue: 'string',
        type: 'string',
        issueCategory: 'string',
        status: 'string',
        severity: 'string',
        reason: 'string',
        createdAt: 'date',
        updatedAt: 'date',
      },
    },
  };

  constructor() {
    this.gemini = new Gemini();
  }

  /**
   * Parse natural language query into structured parameters
   */
  async parseQuery(
    query: string,
    repositoryId: string,
  ): Promise<QueryParseResult> {
    console.log(`[QueryParser] ========================================`);
    console.log(`[QueryParser] Parsing query: "${query}"`);
    console.log(`[QueryParser] Repository ID: ${repositoryId}`);

    try {
      const aiResponse = await this.extractQueryParameters(query);
      console.log(
        '[QueryParser] AI Response:',
        JSON.stringify(aiResponse, null, 2),
      );

      const validated = this.validateAndCorrectParameters(aiResponse);

      console.log('[QueryParser] ========================================');
      console.log('[QueryParser] FINAL PARSE RESULT:');
      console.log('[QueryParser] Query Type:', validated.queryType);
      console.log('[QueryParser] Tables:', validated.tables);
      console.log(
        '[QueryParser] Filters:',
        JSON.stringify(validated.filters, null, 2),
      );
      console.log('[QueryParser] Time Range:', validated.timeRange);
      console.log('[QueryParser] Confidence:', validated.confidence);
      console.log('[QueryParser] ========================================');

      return validated;
    } catch (error) {
      console.error('[QueryParser] Error parsing query:', error);
      return this.getDefaultQueryParams(query, repositoryId);
    }
  }

  /**
   * Use AI to extract query parameters
   */
  private async extractQueryParameters(query: string): Promise<any> {
    const prompt = `
You are a database query parameter extractor. Analyze the user's question and extract structured query parameters.

DATABASE SCHEMA:
${JSON.stringify(this.schemaDefinition, null, 2)}

USER QUESTION: "${query}"

Extract the following information and return as JSON:

1. **queryType**: Classify the query type
   - "committer_analysis": Questions about what a specific person did
   - "pr_analysis": Questions about a specific PR
   - "time_range_analysis": Questions about progress/changes in a time period
   - "feature_verification": Questions about whether a feature exists
   - "cross_pr": Questions comparing or relating multiple PRs
   - "module_analysis": Questions about specific modules/components

2. **tables**: Which tables need to be queried (array)
   - commitSummary, ExecutiveReport, PrTracker, Comment

3. **filters**: Array of filter conditions with:
   - table: Which table (e.g., "commitSummary")
   - field: Which field (e.g., "committer", "prNumber")
   - operator: "equals", "contains", "gte", "lte", "in", "not"
   - value: The actual value (extract from query)
   - dataType: "string", "number", "date", "boolean"
   - logicalOperator: "AND" or "OR" (default "AND")

4. **timeRange**: If time-based query, extract:
   - startDate: ISO date string (REQUIRED for time-based queries)
   - endDate: ISO date string (REQUIRED for time-based queries)
   
   IMPORTANT: Calculate actual dates from NOW (${new Date().toISOString()})
   
   Parse time expressions:
   - "last 24 hours" → Calculate: ${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()} to NOW
   - "last 34 days" → Calculate: ${new Date(Date.now() - 34 * 24 * 60 * 60 * 1000).toISOString()} to NOW
   - "last week" → Calculate: ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()} to NOW
   - "last month" → Calculate: ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()} to NOW
   - "past 2 weeks" → Calculate: ${new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()} to NOW
   
   CRITICAL: ALWAYS include timeRange for queries with "last X days/hours/weeks", "in the past X", etc.

5. **orderBy**: Sorting preference
   - field: Which field to sort by
   - direction: "asc" or "desc"

6. **limit**: Maximum number of results (default: 50)

7. **confidence**: How confident are you in this parsing (0.0 to 1.0)

IMPORTANT RULES:
- Always include repositoryId filter
- Use "contains" operator for name searches (case-insensitive)
- Use "equals" for exact matches like PR numbers
- Extract PR numbers from formats: "PR 22", "PR#22", "pull request 22"
- For committer names, use "contains" operator
- Convert time expressions to actual dates
- Return ONLY valid JSON, no markdown or explanations

EXAMPLE OUTPUT:
{
  "queryType": "committer_analysis",
  "tables": ["commitSummary"],
  "filters": [
    {
      "table": "commitSummary",
      "field": "committer",
      "operator": "contains",
      "value": "Mudassir",
      "dataType": "string",
      "logicalOperator": "AND"
    }
  ],
  "timeRange": {
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-02-05T00:00:00.000Z"
  },
  "orderBy": {
    "field": "createdAt",
    "direction": "desc"
  },
  "limit": 50,
  "confidence": 0.9
}

Now parse the user's question and return JSON:
`;

    const response = await this.gemini.generateResponse(prompt);
    return this.parseAIResponse(response);
  }

  /**
   * Parse AI response and extract JSON
   */
  private parseAIResponse(response: string): any {
    try {
      // Try to extract JSON from response
      let jsonStr = response.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }

      // Parse JSON
      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (error) {
      console.error('[QueryParser] Failed to parse AI response:', error);
      throw new Error('Invalid AI response format');
    }
  }

  /**
   * Validate and correct AI-extracted parameters
   */
  private validateAndCorrectParameters(params: any): QueryParseResult {
    // Ensure required fields exist
    const validated: QueryParseResult = {
      queryType: params.queryType || 'time_range_analysis',
      tables: params.tables || ['commitSummary'],
      filters: [],
      confidence: params.confidence || 0.5,
    };

    // Validate and correct filters
    if (params.filters && Array.isArray(params.filters)) {
      validated.filters = params.filters.map((filter) =>
        this.validateFilter(filter),
      );
    }

    // Validate time range
    if (params.timeRange) {
      validated.timeRange = {
        startDate: new Date(params.timeRange.startDate),
        endDate: new Date(params.timeRange.endDate),
      };
    }

    // Validate orderBy
    if (params.orderBy) {
      validated.orderBy = {
        field: params.orderBy.field || 'createdAt',
        direction: params.orderBy.direction || 'desc',
      };
    }

    // Validate limit
    validated.limit = params.limit || 50;

    return validated;
  }

  /**
   * Validate individual filter
   */
  private validateFilter(filter: any): QueryFilter {
    const validated: QueryFilter = {
      table: filter.table || 'commitSummary',
      field: filter.field,
      operator: filter.operator || 'equals',
      value: filter.value,
      dataType: filter.dataType || 'string',
      logicalOperator: filter.logicalOperator || 'AND',
    };

    // Type conversion based on dataType
    switch (validated.dataType) {
      case 'number':
        validated.value = parseInt(validated.value);
        break;
      case 'boolean':
        validated.value = Boolean(validated.value);
        break;
      case 'date':
        validated.value = new Date(validated.value);
        break;
      case 'string':
      default:
        validated.value = String(validated.value);
        break;
    }

    return validated;
  }

  /**
   * Get default query parameters if AI fails
   */
  private getDefaultQueryParams(
    query: string,
    repositoryId: string,
  ): QueryParseResult {
    // Simple rule-based fallback
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('pr') && /\d+/.test(query)) {
      // PR analysis
      const prNumber = parseInt(query.match(/\d+/)[0]);
      return {
        queryType: 'pr_analysis',
        tables: ['ExecutiveReport', 'commitSummary'],
        filters: [
          {
            table: 'ExecutiveReport',
            field: 'prNumber',
            operator: 'equals',
            value: prNumber,
            dataType: 'number',
            logicalOperator: 'AND',
          },
        ],
        confidence: 0.7,
      };
    }

    // Default to time range analysis
    return {
      queryType: 'time_range_analysis',
      tables: ['commitSummary'],
      filters: [],
      timeRange: {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      },
      orderBy: {
        field: 'createdAt',
        direction: 'desc',
      },
      limit: 50,
      confidence: 0.5,
    };
  }
}
