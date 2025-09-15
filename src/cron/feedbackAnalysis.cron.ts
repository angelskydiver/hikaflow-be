import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Gemini } from '../config/helpers/ai/gemini.ai.helper';
import { FeedbackService } from '../modules/feedback/feedback.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeedbackAnalysisCronService {
  private readonly logger = new Logger(FeedbackAnalysisCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedbackService: FeedbackService,
  ) {}

  private readonly gemini = new Gemini();

  /**
   * Weekly cron job to analyze ignored comments and update AI prompts using Gemini
   * Runs every Sunday at 2 AM
   */
  //   @Cron('0 2 * * 0') // Every Sunday at 2 AM
  @Cron(CronExpression.EVERY_DAY_AT_6PM)
  //   @Cron('*/3 * * * *')
  async analyzeIgnoreFeedbackAndUpdatePrompts() {
    this.logger.log('\n🚀 STARTING GEMINI-POWERED FEEDBACK ANALYSIS CRON JOB');
    this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    this.logger.log('='.repeat(80));

    try {
      // Get all organizations
      const organizations = await this.prisma.organization.findMany({
        select: {
          id: true,
          name: true,
        },
      });

      this.logger.log(
        `📊 Found ${organizations.length} organizations to process`,
      );

      let totalProcessed = 0;
      let totalUpdated = 0;

      for (const organization of organizations) {
        this.logger.log(
          `\n🏢 Processing organization: ${organization.name} (${organization.id})`,
        );

        const result = await this.processOrganizationFeedback(
          organization.id,
          organization.name,
        );

        if (result) {
          totalProcessed += result.processed;
          totalUpdated += result.updated;
        }
      }

      this.logger.log('\n' + '='.repeat(80));
      this.logger.log(
        '🎉 GEMINI-POWERED FEEDBACK ANALYSIS COMPLETED SUCCESSFULLY',
      );
      this.logger.log(
        `📊 Total Organizations Processed: ${organizations.length}`,
      );
      this.logger.log(`📝 Total Feedback Items Processed: ${totalProcessed}`);
      this.logger.log(`✨ Total Prompts Updated: ${totalUpdated}`);
      this.logger.log(`⏰ Completion Time: ${new Date().toISOString()}`);
      this.logger.log('='.repeat(80) + '\n');
    } catch (error) {
      this.logger.error('\n❌ ERROR IN GEMINI-POWERED FEEDBACK ANALYSIS:');
      this.logger.error('='.repeat(80));
      this.logger.error(error);
      this.logger.error('='.repeat(80) + '\n');
    }
  }

  /**
   * Process feedback by grouping similar issues and using Gemini for batch improvement
   */
  private async processFeedbackByIssueGroups(
    organizationId: string,
    ignoredComments: any[],
  ): Promise<number> {
    // Group feedback by issue type
    const issueGroups = new Map<string, any[]>();

    for (const comment of ignoredComments) {
      const issueType = comment.issue;
      if (!issueGroups.has(issueType)) {
        issueGroups.set(issueType, []);
      }
      issueGroups.get(issueType).push(comment);
    }

    this.logger.log(
      `Processing ${issueGroups.size} different issue types for organization ${organizationId}`,
    );

    // Log detailed breakdown of issue groups
    this.logger.log(`\n📊 ISSUE TYPE BREAKDOWN:`);
    this.logger.log(`${'-'.repeat(50)}`);
    for (const [issueType, comments] of issueGroups) {
      const willProcess = comments.length >= 3;
      this.logger.log(
        `📋 "${issueType}": ${comments.length} feedback items ${willProcess ? '✅ (WILL PROCESS)' : '❌ (SKIPPED - need 3+)'}`,
      );
    }
    this.logger.log(`${'-'.repeat(50)}`);

    let totalUpdated = 0;

    // Process each issue type group
    for (const [issueType, comments] of issueGroups) {
      // Only process if we have enough feedback
      this.logger.log(
        `\n🚀 Processing issue type "${issueType}" with ${comments.length} feedback items...`,
      );
      const updated = await this.processIssueTypeGroup(
        organizationId,
        issueType,
        comments,
      );
      totalUpdated += updated;
      this.logger.log(
        `✅ Completed processing "${issueType}" - Updated ${updated} repositories`,
      );
    }

    return totalUpdated;
  }

  /**
   * Process a specific issue type group with Gemini
   */
  private async processIssueTypeGroup(
    organizationId: string,
    issueType: string,
    comments: any[],
  ): Promise<number> {
    try {
      this.logger.log(
        `Processing ${comments.length} feedback items for issue type: ${issueType}`,
      );

      // Get current prompt for this issue type (prioritizes customPrompt over default prompt)
      const currentPrompt = await this.getCurrentPromptForIssue(
        organizationId,
        issueType,
      );

      // Prepare comprehensive feedback data
      const feedbackData = {
        reasons: comments.map((c) => c.ignoreReason).filter(Boolean),
        count: comments.length,
        examples: comments.slice(0, 5), // Top 5 examples
        issueType: issueType,
        organizationId: organizationId,
      };

      // Log initial prompt and feedback data
      this.logPromptImprovementProcess(issueType, currentPrompt, feedbackData);

      // Generate improved prompt using Gemini
      const improvedPrompt = await this.generateImprovedPromptWithGemini(
        issueType,
        currentPrompt,
        feedbackData,
      );

      // Log the enhanced version
      this.logEnhancedPrompt(issueType, improvedPrompt);

      // Update all repositories for this organization with the improved prompt
      const updatedCount = await this.updatePromptForAllRepositories(
        organizationId,
        issueType,
        improvedPrompt,
      );

      this.logger.log(
        `Successfully updated prompt for issue type "${issueType}" across ${updatedCount} repositories`,
      );

      return updatedCount;
    } catch (error) {
      this.logger.error(
        `Error processing issue type group "${issueType}":`,
        error,
      );
      return 0;
    }
  }

  /**
   * Get current prompt for a specific issue type
   */
  private async getCurrentPromptForIssue(
    organizationId: string,
    issueType: string,
  ): Promise<string> {
    const setting = await this.prisma.repositorySettings.findFirst({
      where: {
        key: issueType,
        repository: {
          organizationId: organizationId,
        },
      },
    });

    // Prioritize customPrompt over default prompt
    if (setting?.customPrompt) {
      this.logger.log(
        `📝 Using existing customPrompt as base for improvement: ${issueType}`,
      );
      return setting.customPrompt;
    }

    if (setting?.prompt) {
      this.logger.log(
        `📝 Using default prompt as base for improvement: ${issueType}`,
      );
      return setting.prompt;
    }

    this.logger.warn(`⚠️ No prompt found for ${issueType}, using fallback`);
    return `Default analysis prompt for ${issueType}`;
  }

  /**
   * Update prompt for all repositories in an organization
   */
  private async updatePromptForAllRepositories(
    organizationId: string,
    issueType: string,
    improvedPrompt: string,
  ): Promise<number> {
    const repositories = await this.prisma.repository.findMany({
      where: { organizationId },
      include: { repositorySettings: true },
    });

    this.logger.log(`\n🔍 REPOSITORY SETTINGS ANALYSIS:`);
    this.logger.log(`${'-'.repeat(50)}`);
    this.logger.log(
      `📁 Found ${repositories.length} repositories in organization`,
    );

    let updatedCount = 0;
    let skippedCount = 0;

    for (const repository of repositories) {
      this.logger.log(`\n📂 Repository: "${repository.name}"`);
      this.logger.log(
        `   - Total Settings: ${repository.repositorySettings.length}`,
      );

      const activeSettings = repository.repositorySettings.filter(
        (s) => s.active,
      );
      this.logger.log(`   - Active Settings: ${activeSettings.length}`);

      const matchingSettings = activeSettings.filter(
        (s) => s.key === issueType,
      );
      this.logger.log(
        `   - Matching "${issueType}" Settings: ${matchingSettings.length}`,
      );

      const setting = repository.repositorySettings.find(
        (s) => s.key === issueType && s.active,
      );

      if (setting) {
        await this.prisma.repositorySettings.update({
          where: { id: setting.id },
          data: { customPrompt: improvedPrompt },
        });

        updatedCount++;
        this.logger.log(
          `   ✅ Updated prompt for "${issueType}" in repository "${repository.name}"`,
        );
      } else {
        skippedCount++;
        this.logger.log(
          `   ⏭️  No active setting found for "${issueType}" in repository "${repository.name}"`,
        );
      }
    }

    this.logger.log(`\n📊 UPDATE SUMMARY:`);
    this.logger.log(`   - Repositories Checked: ${repositories.length}`);
    this.logger.log(`   - Successfully Updated: ${updatedCount}`);
    this.logger.log(`   - Skipped (No Matching Setting): ${skippedCount}`);

    // Log final update process
    this.logFinalUpdateProcess(issueType, organizationId, updatedCount);

    return updatedCount;
  }

  /**
   * Process feedback for a specific organization
   */
  private async processOrganizationFeedback(
    organizationId: string,
    organizationName: string,
  ): Promise<{ processed: number; updated: number } | null> {
    this.logger.log(
      `Processing feedback for organization: ${organizationName}`,
    );

    try {
      // Get ignored comments from the last 7 days
      const ignoredComments =
        await this.feedbackService.getIgnoreFeedbackForAnalysis(
          organizationId,
          1 / 24,
        );

      if (ignoredComments.length === 0) {
        this.logger.log(
          `No ignored comments found for organization: ${organizationName}`,
        );
        return { processed: 0, updated: 0 };
      }

      // Log detailed feedback data
      this.logger.log(`\n📋 FEEDBACK DATA ANALYSIS:`);
      this.logger.log(`${'-'.repeat(50)}`);
      this.logger.log(`📊 Total Ignored Comments: ${ignoredComments.length}`);

      // Group by issue type for analysis
      const issueTypeCounts = new Map<string, number>();
      for (const comment of ignoredComments) {
        const issueType = comment.issue || 'Unknown';
        issueTypeCounts.set(
          issueType,
          (issueTypeCounts.get(issueType) || 0) + 1,
        );
      }

      this.logger.log(`📋 Issue Types Found:`);
      for (const [issueType, count] of issueTypeCounts) {
        this.logger.log(`   - "${issueType}": ${count} items`);
      }

      // Show sample feedback
      this.logger.log(`\n📝 Sample Feedback Items:`);
      ignoredComments.slice(0, 3).forEach((comment, index) => {
        this.logger.log(
          `   ${index + 1}. Issue: "${comment.issue}" | Reason: "${comment.ignoreReason}" | File: "${comment.file}"`,
        );
      });
      this.logger.log(`${'-'.repeat(50)}`);

      // Process feedback by grouping similar issues and using Gemini for improvement
      const updatedCount = await this.processFeedbackByIssueGroups(
        organizationId,
        ignoredComments,
      );

      this.logger.log(
        `Processed ${ignoredComments.length} ignored comments for organization: ${organizationName}`,
      );

      return { processed: ignoredComments.length, updated: updatedCount };
    } catch (error) {
      this.logger.error(
        `Error processing feedback for organization ${organizationName}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Generate improved prompt using Gemini's smartest model based on feedback analysis
   */
  private async generateImprovedPromptWithGemini(
    issue: string,
    currentPrompt: string,
    feedbackData: {
      reasons: string[];
      count: number;
      examples: any[];
    },
  ): Promise<string> {
    try {
      const prompt = `You are an expert AI prompt engineer specializing in code analysis and quality assurance. Your task is to improve an existing AI prompt based on user feedback to make it more accurate, specific, and contextually aware.

## Current Issue Type: ${issue}

## Current Prompt:
${currentPrompt}

## User Feedback Analysis:
- **Total Ignored Count**: ${feedbackData.count} times
- **Common Reasons for Ignoring**:
${feedbackData.reasons.map((reason, index) => `${index + 1}. ${reason}`).join('\n')}

## Sample Ignored Issues:
${feedbackData.examples
  .slice(0, 3)
  .map(
    (example, index) => `
**Example ${index + 1}:**
- Issue: ${example.issue}
- File: ${example.file}
- Reason for Ignoring: ${example.ignoreReason}
- Code Context: ${example.content?.substring(0, 200)}...
`,
  )
  .join('\n')}

## Your Task:
Create a highly specific, actionable prompt that addresses the exact feedback patterns. The improved prompt must:

### 1. **Be Extremely Specific (Not Generic)**:
- Include concrete examples from the actual feedback
- Reference specific file patterns, function names, or code structures
- Avoid vague statements like "consider context" or "be more careful"
- Use exact terminology from the feedback reasons

### 2. **Maximum 500 Characters for Description**:
- Keep the main description under 500 characters
- Be concise but comprehensive
- Focus on the most critical improvements

### 3. **Include Specific Code Examples**:
- Show actual code patterns that should be ignored
- Only mention file names/extensions if specifically mentioned in feedback reasons
- Include specific function signatures or variable names from feedback
- Focus on code patterns, not file locations

### 4. **Create Clear Decision Rules**:
- "Flag when: [specific condition]"
- "Ignore when: [specific condition from feedback]"
- Use exact phrases from the ignore reasons
- Apply rules to entire repository, not specific files

### 5. **Address Each Feedback Reason Directly**:
- For each ignore reason, create a specific rule
- Use the exact wording from the feedback
- Make it clear why that specific case should be ignored
- Only reference file names if they appear in the ignore reasons

## Requirements:
- **Maximum 500 characters** for the main description
- **Highly specific** - no generic advice
- **Actionable** - developers can immediately understand what to do
- **Based on real feedback** - use actual examples from the data
- **Clear decision tree** - when to flag vs when to ignore
- **Repository-wide scope** - apply to entire codebase, not specific files
- **File-agnostic** - only mention file names if they appear in ignore reasons

## Output Format:
Return ONLY the improved prompt as a single, well-structured text block. Start with a brief description (max 500 chars), then provide specific rules and examples. Focus on code patterns and behaviors, not file locations.`;

      const response = await this.gemini.generateAnswer(prompt, []);

      // Extract the improved prompt from the response
      let improvedPrompt = this.extractPromptFromResponse(
        response.output.response.text(),
      );

      // Validate and fix description length if needed
      improvedPrompt = this.validateAndFixPromptLength(improvedPrompt, issue);

      this.logger.log(
        `Generated improved prompt for issue "${issue}" using Gemini`,
      );
      return improvedPrompt;
    } catch (error) {
      this.logger.error(
        `Error generating improved prompt with Gemini for issue "${issue}":`,
        error,
      );

      // Fallback to the original method if Gemini fails
      return this.generateImprovedPromptFallback(issue, feedbackData.reasons);
    }
  }

  /**
   * Extract the improved prompt from Gemini's response
   */
  private extractPromptFromResponse(response: string): string {
    // Try to extract the prompt from markdown code blocks
    const codeBlockMatch = response.match(/```[\s\S]*?```/);
    if (codeBlockMatch) {
      return codeBlockMatch[0].replace(/```/g, '').trim();
    }

    // If no code blocks, try to find the main content
    const lines = response.split('\n');
    let promptStart = -1;
    let promptEnd = lines.length;

    // Find the start of the actual prompt (after any introductory text)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('#') && lines[i].includes('Analysis')) {
        promptStart = i;
        break;
      }
    }

    if (promptStart >= 0) {
      return lines.slice(promptStart, promptEnd).join('\n').trim();
    }

    // If all else fails, return the full response
    return response.trim();
  }

  /**
   * Fallback method for generating improved prompt (original logic)
   */
  private generateImprovedPromptFallback(
    issue: string,
    reasons: string[],
  ): string {
    const commonReasons = this.extractCommonReasons(reasons);

    return `# ${issue} Analysis - Improved Version

## Original Analysis Rules
[Keep original analysis logic but with enhanced context awareness]

## Feedback-Based Improvements
Based on user feedback, please consider the following:

### Common Concerns:
${commonReasons.map((reason) => `- ${reason}`).join('\n')}

### Enhanced Guidelines:
1. **Context Awareness**: Consider the specific context and use case before flagging
2. **Severity Assessment**: Only flag as high severity if it truly impacts functionality
3. **Alternative Approaches**: Suggest multiple solutions when appropriate
4. **Team Preferences**: Respect team coding patterns and preferences

### When to Flag:
- Only flag if the issue genuinely impacts code quality, security, or maintainability
- Consider if the "issue" is actually a valid design choice for this specific context
- Provide constructive suggestions rather than just pointing out problems

### When NOT to Flag:
- If the code follows team-established patterns
- If the approach is valid for the specific use case
- If the "issue" is a matter of preference rather than best practice

Remember: The goal is to improve code quality while respecting team context and preferences.`;
  }

  /**
   * Extract common reasons from feedback
   */
  private extractCommonReasons(reasons: string[]): string[] {
    const reasonCounts = new Map<string, number>();

    for (const reason of reasons) {
      const normalized = reason.toLowerCase().trim();
      if (normalized.length > 0) {
        reasonCounts.set(normalized, (reasonCounts.get(normalized) || 0) + 1);
      }
    }

    // Return top 3 most common reasons
    return Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason]) => reason);
  }

  /**
   * Log the prompt improvement process with initial prompt and feedback data
   */
  private logPromptImprovementProcess(
    issueType: string,
    currentPrompt: string,
    feedbackData: {
      reasons: string[];
      count: number;
      examples: any[];
      issueType: string;
      organizationId: string;
    },
  ) {
    this.logger.log(`\n${'='.repeat(80)}`);
    this.logger.log(`🔍 PROMPT IMPROVEMENT PROCESS STARTED`);
    this.logger.log(`📋 Issue Type: ${issueType}`);
    this.logger.log(`🏢 Organization ID: ${feedbackData.organizationId}`);
    this.logger.log(`📊 Total Feedback Count: ${feedbackData.count}`);
    this.logger.log(`${'='.repeat(80)}`);

    // Log initial prompt with type indication
    const promptType = currentPrompt.includes('Default analysis prompt')
      ? 'DEFAULT'
      : 'CUSTOM';
    this.logger.log(`\n📝 INITIAL PROMPT (${promptType}):`);
    this.logger.log(`${'-'.repeat(40)}`);
    this.logger.log(currentPrompt);
    this.logger.log(`${'-'.repeat(40)}`);

    // Log feedback reasons
    this.logger.log(
      `\n💬 FEEDBACK REASONS (${feedbackData.reasons.length} total):`,
    );
    this.logger.log(`${'-'.repeat(40)}`);
    feedbackData.reasons.forEach((reason, index) => {
      this.logger.log(`${index + 1}. "${reason}"`);
    });
    this.logger.log(`${'-'.repeat(40)}`);

    // Log sample examples
    this.logger.log(
      `\n📋 SAMPLE IGNORED ISSUES (${feedbackData.examples.length} examples):`,
    );
    this.logger.log(`${'-'.repeat(40)}`);
    feedbackData.examples.forEach((example, index) => {
      this.logger.log(`Example ${index + 1}:`);
      this.logger.log(`  - Issue: ${example.issue}`);
      this.logger.log(`  - File: ${example.file}`);
      this.logger.log(`  - Reason: ${example.ignoreReason}`);
      this.logger.log(
        `  - Code Context: ${example.content?.substring(0, 100)}...`,
      );
      this.logger.log(
        `  - Repository: ${example.repository?.name || 'Unknown'}`,
      );
      this.logger.log(`  - Created: ${example.createdAt}`);
      this.logger.log('');
    });
    this.logger.log(`${'-'.repeat(40)}`);

    this.logger.log(`\n🤖 Sending data to Gemini for prompt improvement...`);
  }

  /**
   * Log the enhanced prompt generated by Gemini
   */
  private logEnhancedPrompt(issueType: string, enhancedPrompt: string) {
    this.logger.log(
      `\n✨ ENHANCED PROMPT GENERATED BY GEMINI (will be saved as customPrompt):`,
    );
    this.logger.log(`${'-'.repeat(40)}`);
    this.logger.log(enhancedPrompt);
    this.logger.log(`${'-'.repeat(40)}`);

    // Extract and validate description length
    const description = this.extractDescriptionFromPrompt(enhancedPrompt);
    const descriptionLength = description.length;
    const isDescriptionValid = descriptionLength <= 500;

    // Log prompt statistics
    const originalLength = enhancedPrompt.length;
    const lineCount = enhancedPrompt.split('\n').length;
    const wordCount = enhancedPrompt.split(/\s+/).length;

    this.logger.log(`\n📊 ENHANCED PROMPT STATISTICS:`);
    this.logger.log(`  - Total Character Count: ${originalLength}`);
    this.logger.log(
      `  - Description Length: ${descriptionLength} ${isDescriptionValid ? '✅' : '❌ (exceeds 500 chars)'}`,
    );
    this.logger.log(`  - Line Count: ${lineCount}`);
    this.logger.log(`  - Word Count: ${wordCount}`);
    this.logger.log(`  - Issue Type: ${issueType}`);

    if (!isDescriptionValid) {
      this.logger.warn(`⚠️  WARNING: Description exceeds 500 character limit!`);
      this.logger.warn(`   Description: "${description}"`);
    }

    this.logger.log(`\n${'='.repeat(80)}`);
    this.logger.log(`✅ PROMPT IMPROVEMENT PROCESS COMPLETED`);
    this.logger.log(`${'='.repeat(80)}\n`);
  }

  /**
   * Extract the main description from the prompt (first paragraph or section)
   */
  private extractDescriptionFromPrompt(prompt: string): string {
    // Try to find the main description (usually the first paragraph or section)
    const lines = prompt.split('\n');

    // Look for the first substantial paragraph (not headers or empty lines)
    let description = '';
    let inDescription = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip headers, empty lines, and markdown formatting
      if (
        trimmedLine.startsWith('#') ||
        trimmedLine.startsWith('##') ||
        trimmedLine.startsWith('###') ||
        trimmedLine.startsWith('-') ||
        trimmedLine.startsWith('*') ||
        trimmedLine === '' ||
        trimmedLine.startsWith('**') ||
        trimmedLine.startsWith('Flag when:') ||
        trimmedLine.startsWith('Ignore when:')
      ) {
        if (inDescription) break; // End of description section
        continue;
      }

      // Start collecting description
      if (trimmedLine.length > 0) {
        inDescription = true;
        description += (description ? ' ' : '') + trimmedLine;

        // Stop if we've reached a reasonable length
        if (description.length > 600) break;
      }
    }

    return description.trim();
  }

  /**
   * Validate and fix prompt length to ensure description is under 500 characters
   */
  private validateAndFixPromptLength(
    prompt: string,
    issueType: string,
  ): string {
    const description = this.extractDescriptionFromPrompt(prompt);

    if (description.length <= 500) {
      return prompt; // No changes needed
    }

    this.logger.warn(
      `⚠️  Description too long (${description.length} chars), truncating to 500 chars...`,
    );

    // Truncate description to 500 characters
    const truncatedDescription = description.substring(0, 497) + '...';

    // Replace the original description in the prompt
    const lines = prompt.split('\n');
    let newPrompt = '';
    let foundDescription = false;
    let inDescription = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip headers, empty lines, and markdown formatting
      if (
        trimmedLine.startsWith('#') ||
        trimmedLine.startsWith('##') ||
        trimmedLine.startsWith('###') ||
        trimmedLine.startsWith('-') ||
        trimmedLine.startsWith('*') ||
        trimmedLine === '' ||
        trimmedLine.startsWith('**') ||
        trimmedLine.startsWith('Flag when:') ||
        trimmedLine.startsWith('Ignore when:')
      ) {
        if (inDescription) {
          inDescription = false;
          foundDescription = true;
        }
        newPrompt += line + '\n';
        continue;
      }

      // Handle description section
      if (!foundDescription && trimmedLine.length > 0) {
        if (!inDescription) {
          inDescription = true;
          newPrompt += truncatedDescription + '\n\n';
        }
        // Skip the original description lines
        continue;
      }

      newPrompt += line + '\n';
    }

    this.logger.log(
      `✅ Truncated description to ${truncatedDescription.length} characters`,
    );
    return newPrompt.trim();
  }

  /**
   * Log the final update process
   */
  private logFinalUpdateProcess(
    issueType: string,
    organizationId: string,
    repositoryCount: number,
  ) {
    this.logger.log(`\n🔄 FINAL UPDATE PROCESS:`);
    this.logger.log(`${'-'.repeat(40)}`);
    this.logger.log(`📋 Issue Type: ${issueType}`);
    this.logger.log(`🏢 Organization ID: ${organizationId}`);
    this.logger.log(`📁 Repositories Updated: ${repositoryCount}`);
    this.logger.log(`🌐 Scope: Repository-wide (entire codebase)`);
    this.logger.log(`📁 File Scope: Only when mentioned in feedback reasons`);
    this.logger.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    this.logger.log(`${'-'.repeat(40)}\n`);
  }
}
