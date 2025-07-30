# AI Analysis Helpers

This directory contains AI analysis helpers for code review and PR analysis.

## Moonshot Kimi Helper (`moonshot.kimi.helper.ts`)

### Overview

The Moonshot Kimi helper provides sophisticated PR analysis using the Moonshot Kimi K2 Free API. It offers more accurate issue detection, better false positive prevention, and comprehensive risk assessment.

### Model Configuration

- **Model**: `moonshotai/kimi-k2:free`
- **Context Window**: 32,768 tokens
- **Cost**: $0/M input tokens, $0/M output tokens
- **Features**: Optimized for agentic capabilities, advanced tool use, reasoning, and code synthesis

### Key Features

#### 1. **Advanced Issue Detection**

- **Confidence Scoring**: Each issue has a confidence score (0-100) to filter out uncertain findings
- **False Positive Risk Assessment**: Categorizes issues as LOW/MEDIUM/HIGH risk of being false positives
- **Business Impact Analysis**: Evaluates issues based on CRITICAL/HIGH/MEDIUM/LOW business impact
- **Context-Aware Analysis**: Considers repository settings, PR metadata, and file relationships

#### 2. **Sophisticated Risk Assessment**

- **Security Risk**: 0-100 scale for security vulnerabilities
- **Performance Risk**: 0-100 scale for performance issues
- **Maintainability Risk**: 0-100 scale for code quality issues
- **Business Risk**: 0-100 scale for business impact
- **Overall Risk**: CRITICAL/HIGH/MEDIUM/LOW based on highest individual risk

#### 3. **Actionable Recommendations**

- **Immediate Actions**: Critical issues that must be fixed before merge
- **Short Term**: Important improvements for next sprint
- **Long Term**: Architectural improvements for future development

#### 4. **Comprehensive Metrics**

- Total issues found
- Breakdown by priority (Critical, High, Medium, Low)
- False positive estimate percentage
- Performance tracking

### Configuration

The system is pre-configured with a free API key for immediate use. For production use, you can override with your own API key:

```bash
MOONSHOT_API_KEY=your_api_key_here
```

### Usage

```typescript
import { MoonshotKimi } from 'src/config/helpers/ai/moonshot.kimi.helper';

const moonshotKimi = new MoonshotKimi({
  apiKey: ***REMOVED_SECRET*** || '',
});

const analysis = await moonshotKimi.analyzeCodeFilesForIssues(fileChanges, {
  repositorySettings: settings,
  fileChanges: files,
  prMetadata: {
    title: 'PR Title',
    description: 'PR Description',
    author: 'Author Name',
    branch: 'feature-branch',
    targetBranch: 'main',
  },
});
```

### Free Tier Optimizations

The system is optimized for the free tier with:

- **Conservative Context Management**: 32,768 token context window
- **Efficient Chunking**: Intelligent file splitting to stay within limits
- **Content Optimization**: Aggressive whitespace reduction and content trimming
- **Rate Limit Respect**: Built-in delays between requests
- **Fallback Mechanism**: Automatic fallback to DeepSeek if needed

### Fallback Mechanism

If Moonshot Kimi is not configured or fails, the system automatically falls back to DeepSeek analysis to ensure continuous operation.

### Benefits Over Previous System

1. **Higher Accuracy**: Reduced false positives through confidence scoring and context awareness
2. **Better Context Management**: Handles large codebases with intelligent chunking for free tier
3. **Comprehensive Risk Assessment**: Multi-dimensional risk evaluation
4. **Actionable Insights**: Specific recommendations with business context
5. **Performance Optimization**: Parallel processing with intelligent batching
6. **Reliability**: Fallback mechanism ensures system availability
7. **Cost Effective**: Free tier with sophisticated analysis capabilities

### Issue Categories

#### Security Issues (High Priority)

- SQL Injection, XSS, CSRF vulnerabilities
- Authentication/Authorization bypasses
- Insecure data handling
- Hardcoded secrets
- Input validation issues

#### Performance Issues (High Priority)

- N+1 database queries
- Memory leaks
- Inefficient algorithms
- Blocking operations in async contexts

#### Architectural Issues (Medium Priority)

- SOLID principle violations
- Tight coupling
- Code duplication
- Poor separation of concerns

#### Maintainability Issues (Low Priority)

- Complex functions/classes
- Poor naming/documentation
- Magic numbers
- Deep nesting

### Quality Gates

The system only flags issues that:

1. Would actually concern a senior engineer
2. Could cause real problems in production
3. Are not just style preferences
4. Have sufficient evidence and context

### False Positive Prevention

**DO NOT FLAG:**

- Style preferences (indentation, spacing, naming)
- Framework-specific patterns that are actually recommended
- Generic suggestions without technical merit
- Parameter extraction/destructuring preferences
- Simple if statements that are clear
- Console.log statements (unless logging sensitive data)
- Magic numbers in CSS classes or configuration values

## DeepSeek Helper (`deepseek.ai.helper.ts`)

The original DeepSeek helper remains available as a fallback option and for specific use cases where its analysis patterns are preferred.

## Gemini Helper (`gemini.ai.helper.ts`)

The Gemini helper provides additional AI analysis capabilities, particularly for regression testing and complex code analysis scenarios.
