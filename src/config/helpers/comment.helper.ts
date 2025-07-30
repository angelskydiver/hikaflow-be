export function filterHighPriorityComments(comments) {
  const priorityOrder = { High: 3, Medium: 2, Low: 1 };
  const commentMap = new Map();

  comments.forEach((comment) => {
    const key = `${comment.file}:${comment.line}`;
    if (
      !commentMap.has(key) ||
      priorityOrder[comment.priority] >
        priorityOrder[commentMap.get(key).priority]
    ) {
      commentMap.set(key, comment);
    }
  });

  return Array.from(commentMap.values());
}

/**
 * Advanced quality filtering system to eliminate low-value/basic issues
 * that make the product look unprofessional
 */
export function filterQualityIssues(issues, repositorySettings = []) {
  if (!Array.isArray(issues)) return [];

  // Get active repository settings for filtering
  const activeSettings = repositorySettings.filter((setting) => setting.active);
  const enabledCategories = new Set(activeSettings.map((s) => s.key));

  // Issues to completely exclude as they're too basic/annoying
  const excludePatterns = [
    /formatting/i,
    /indentation/i,
    /whitespace/i,
    /spacing/i,
    /trailing\s+space/i,
    /line\s+ending/i,
    /missing\s+semicolon/i,
    /console\.log/i, // Only exclude if it's just about console statements
    /comment\s+style/i,
    /variable\s+name\s+length/i,
    /function\s+name\s+length/i,
  ];

  // Basic error handling patterns to exclude (too generic)
  const basicErrorHandlingPatterns = [
    /try\s*{\s*}\s*catch/i,
    /catch\s*\(\s*e\s*\)/i,
    /catch\s*\(\s*error\s*\)/i,
    /catch\s*\(\s*exception\s*\)/i,
    /should\s+use\s+try\s*-\s*catch/i,
    /add\s+error\s+handling/i,
    /missing\s+error\s+handling/i,
  ];

  // Filter out low-quality issues
  const qualityFiltered = issues.filter((issue) => {
    // Exclude formatting and style issues
    if (
      excludePatterns.some(
        (pattern) =>
          pattern.test(issue.issue) ||
          pattern.test(issue.reason) ||
          pattern.test(issue.category),
      )
    ) {
      return false;
    }

    // Exclude basic error handling suggestions
    if (
      basicErrorHandlingPatterns.some(
        (pattern) => pattern.test(issue.issue) || pattern.test(issue.reason),
      )
    ) {
      return false;
    }

    // Exclude duplicate code issues if they're handled separately
    if (
      issue.category === 'Duplicate Code' ||
      issue.issueCategory === 'Duplicate Code' ||
      /duplicate\s+code/i.test(issue.issue)
    ) {
      return false;
    }

    // Filter based on repository settings
    if (enabledCategories.size > 0) {
      const issueKey = issue.issueCategory || issue.category;
      if (issueKey && !enabledCategories.has(issueKey)) {
        return false;
      }
    }

    // Only keep high-impact issues
    return isHighImpactIssue(issue);
  });

  return qualityFiltered;
}

/**
 * Determines if an issue is high-impact and worth showing to users
 */
function isHighImpactIssue(issue) {
  // Security issues are always high impact
  if (
    issue.category === 'Security' ||
    issue.issueCategory === 'Security' ||
    /security|vulnerability|injection|xss|csrf/i.test(issue.issue)
  ) {
    return true;
  }

  // Performance issues are valuable
  if (
    /performance|optimization|inefficient|slow|memory\s+leak/i.test(issue.issue)
  ) {
    return true;
  }

  // Logic errors and bugs are valuable
  if (
    /bug|logic\s+error|race\s+condition|deadlock|null\s+pointer/i.test(
      issue.issue,
    )
  ) {
    return true;
  }

  // Architectural improvements are valuable
  if (
    /architecture|design\s+pattern|refactor|solid\s+principle/i.test(
      issue.issue,
    )
  ) {
    return true;
  }

  // Code that could cause runtime errors
  if (/runtime\s+error|exception|crash|fail/i.test(issue.issue)) {
    return true;
  }

  // Exclude trivial issues
  if (issue.priority === 'Low' || issue.priority === 'LOW') {
    return false;
  }

  // Default to including the issue if it's not clearly low-value
  return true;
}

/**
 * Human-like quality evaluation using AI to filter out hallucinations
 */
export async function evaluateIssueQuality(issues, deepSeekWrapper) {
  if (!Array.isArray(issues) || issues.length === 0) return [];

  try {
    const evaluationPrompt = `
You are a PRINCIPAL SOFTWARE ENGINEER acting as a quality-gate for AI-generated issue lists.

TASK
----
For every *Issue* supplied below decide if it provides tangible value to a professional team.
Return **exactly** one of the tokens KEEP or REJECT followed by a micro-reason (≤12 words).

KEEP   → security flaw, correctness bug, significant performance/architectural problem, severe maintainability risk
REJECT → stylistic preference, formatting nit, generic best-practice, low impact, hallucination

OUTPUT FORMAT (no extra text)
<index>. KEEP|REJECT - <micro reason>
Example:
1. KEEP - potential SQL injection
2. REJECT - naming preference only

ISSUES
------
${issues
  .map(
    (issue, index) => `
${index + 1}. Issue: ${issue.issue}
   Category: ${issue.category || issue.issueCategory}
   Code: ${issue.content}
   Reason: ${issue.reason}
`,
  )
  .join('\n')}

Remember: No commentary before or after the numbered list.
`;

    const evaluation =
      await deepSeekWrapper.evaluateCodeQuality(evaluationPrompt);

    if (!evaluation || !evaluation.evaluation) {
      console.warn('Quality evaluation failed, returning original issues');
      return issues;
    }

    const evaluationLines = evaluation.evaluation
      .split('\n')
      .filter((line) => line.trim());
    const filteredIssues = [];

    evaluationLines.forEach((line, index) => {
      if (index < issues.length) {
        const decision = line.toLowerCase().includes('keep');
        if (decision) {
          filteredIssues.push(issues[index]);
        }
      }
    });

    console.log(
      `Quality evaluation: ${issues.length} -> ${filteredIssues.length} issues`,
    );
    return filteredIssues;
  } catch (error) {
    console.error('Error in quality evaluation:', error);
    return issues; // Return original issues if evaluation fails
  }
}

/**
 * Format affected lines as array for CodeDetailsModal compatibility
 */
export function formatAffectedLinesAsArray(issue) {
  if (!issue.affectedCodeBlock) {
    issue.affectedCodeBlock = {};
  }

  // Ensure codeLines is an array
  if (issue.content && typeof issue.content === 'string') {
    issue.affectedCodeBlock.codeLines = issue.content.split('\n');
  } else if (!Array.isArray(issue.affectedCodeBlock.codeLines)) {
    issue.affectedCodeBlock.codeLines = [];
  }

  // Set line numbers
  if (!issue.affectedCodeBlock.startLine) {
    issue.affectedCodeBlock.startLine = issue.line || 1;
  }

  if (!issue.affectedCodeBlock.endLine) {
    issue.affectedCodeBlock.endLine =
      issue.affectedCodeBlock.startLine +
      (issue.affectedCodeBlock.codeLines.length - 1);
  }

  // Same for improved code block
  if (
    issue.improvedCodeBlock &&
    !Array.isArray(issue.improvedCodeBlock.codeLines)
  ) {
    if (issue.improvedCodeBlock.content) {
      issue.improvedCodeBlock.codeLines =
        issue.improvedCodeBlock.content.split('\n');
    } else {
      issue.improvedCodeBlock.codeLines = [];
    }
  }

  return issue;
}

/**
 * Advanced filtering pipeline that combines all quality checks
 */
export async function advancedIssueFiltering(
  issues,
  repositorySettings,
  deepSeekWrapper,
) {
  console.log(`Starting advanced filtering for ${issues.length} issues`);

  // Step 1: Basic quality filtering
  let filteredIssues = filterQualityIssues(issues, repositorySettings);
  console.log(`After quality filtering: ${filteredIssues.length} issues`);

  // Step 2: Format for frontend compatibility
  filteredIssues = filteredIssues.map(formatAffectedLinesAsArray);

  // Step 3: AI-powered quality evaluation (human-like filtering)
  if (deepSeekWrapper && filteredIssues.length > 0) {
    filteredIssues = await evaluateIssueQuality(
      filteredIssues,
      deepSeekWrapper,
    );
    console.log(`After AI evaluation: ${filteredIssues.length} issues`);
  }

  // Step 4: Final priority filtering
  filteredIssues = filterHighPriorityComments(filteredIssues);
  console.log(`Final filtered issues: ${filteredIssues.length}`);

  return filteredIssues;
}
