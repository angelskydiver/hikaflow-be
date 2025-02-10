export const repositorySettingsTemp = [
  {
    key: 'Magic Numbers',
    description: 'Hardcoded numeric values in functions.',
    prompt:
      "Flag hardcoded numeric values used directly in logic or calculations (e.g., `if (x > 100)`). Ignore numbers in strings (e.g., `'20px'`), Tailwind classes, or configuration values.",
    priority: 'Low',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Large Class',
    description: 'Classes with too many fields/methods.',
    prompt:
      'Flag classes with excessive fields/methods (e.g., >10 fields or >15 methods). Exclude React Class-Based Components unless they are clearly bloated.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Dead Code',
    description: 'Commented or unreachable code.',
    prompt:
      'Flag commented-out code blocks or unreachable code (e.g., `return` statements before unreachable logic). Ignore single-line comments or TODOs.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Inefficient Loops',
    description: 'Complex or nested loops.',
    prompt:
      'Flag nested loops or loops with high complexity (e.g., O(n^2) or worse). Ignore simple loops unless they are clearly problematic.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Hardcoded Limits',
    description: 'Fixed limits that don’t scale.',
    prompt:
      'Flag fixed limits that don’t scale (e.g., `for (int i = 0; i < 100; i++)`). Ignore limits that are configuration-driven or part of business logic.',
    priority: 'Low',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Inconsistent Naming',
    description: 'Inconsistent naming conventions.',
    prompt:
      'Flag inconsistent naming conventions (e.g., mixing `camelCase` and `snake_case` in the same scope). Ignore minor deviations like abbreviations.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Overuse of Global Variables',
    description: 'Excessive use of global variables.',
    prompt:
      'Flag excessive reliance on global variables (e.g., >5 global variables in a single file). Ignore configuration or environment-specific globals.',
    priority: 'High',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'SQL Injection',
    description: 'Unsanitized input in SQL queries.',
    prompt:
      'Flag unsanitized user input in SQL queries. Ignore parameterized queries or ORM usage.',
    priority: 'High',
    active: true,
    category: 'Security',
  },
  {
    key: 'Cross-Site Scripting (XSS)',
    description: 'Unescaped user input in HTML.',
    prompt:
      'Flag unescaped user input in HTML or JavaScript. Ignore cases where input is sanitized or escaped.',
    priority: 'High',
    active: true,
    category: 'Security',
  },
  {
    key: 'Cross-Site Request Forgery (CSRF)',
    description: 'Missing CSRF tokens.',
    prompt:
      'Flag missing CSRF tokens in forms or APIs. Ignore endpoints that don’t require CSRF protection.',
    priority: 'High',
    active: true,
    category: 'Security',
  },
  {
    key: 'Insecure Deserialization',
    description: 'Unsafe data deserialization.',
    prompt:
      'Flag unsafe deserialization of data (e.g., `JSON.parse` with untrusted input). Ignore cases where input is validated or sanitized.',
    priority: 'High',
    active: true,
    category: 'Security',
  },
  {
    key: 'Use of Hardcoded Secrets',
    description: 'Hardcoded secrets in code.',
    prompt:
      'Flag hardcoded secrets (e.g., API keys, passwords). Ignore secrets loaded from environment variables or config files.',
    priority: 'High',
    active: true,
    category: 'Security',
  },
  {
    key: 'Insecure API Authentication',
    description: 'Missing authentication for APIs.',
    prompt:
      'Flag APIs missing authentication mechanisms. Ignore public or intentionally open endpoints.',
    priority: 'Medium',
    active: true,
    category: 'Security',
  },
  {
    key: 'Directory Traversal',
    description: 'Unvalidated file paths.',
    prompt:
      'Flag unvalidated file paths that could lead to directory traversal. Ignore paths that are validated or sanitized.',
    priority: 'High',
    active: true,
    category: 'Security',
  },
  {
    key: 'Insecure File Uploads',
    description: 'Unvalidated file uploads.',
    prompt:
      'Flag unvalidated file uploads (e.g., no file type or size checks). Ignore uploads with proper validation.',
    priority: 'Medium',
    active: true,
    category: 'Security',
  },
  {
    key: 'Missing Rate Limiting',
    description: 'No rate limits on APIs.',
    prompt:
      'Flag APIs without rate limiting. Ignore internal or low-risk endpoints.',
    priority: 'Medium',
    active: true,
    category: 'Security',
  },
  {
    key: 'Insecure Password Storage',
    description: 'Weak or plaintext password storage.',
    prompt:
      'Flag weak hashing (e.g., MD5) or plaintext password storage. Ignore secure hashing algorithms (e.g., bcrypt).',
    priority: 'High',
    active: true,
    category: 'Security',
  },
  {
    key: 'Unreachable Code',
    description: 'Code that can never execute.',
    prompt:
      'Flag code that cannot execute under any circumstances (e.g., `return` before logic or `if (false)`). Ignore code that is unreachable due to rare edge cases.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Improper Error Handling',
    description: 'Broad catch blocks or ignored exceptions.',
    prompt:
      'Flag overly broad catch blocks (e.g., `catch (Exception e)`) or ignored exceptions. Ignore specific, intentional exception handling.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Violations of SOLID Principles',
    description: 'Violates SOLID design principles.',
    prompt:
      'Flag clear violations of SOLID principles (e.g., large classes, tightly coupled code). Ignore minor deviations unless they significantly impact maintainability.',
    priority: 'High',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Improper Use of Logging',
    description: 'Logging sensitive information.',
    prompt:
      'Flag logging of sensitive information (e.g., passwords, tokens). Ignore non-sensitive debug logs.',
    priority: 'Low',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Inconsistent Indentation',
    description: 'Mixed tabs and spaces.',
    prompt:
      'Flag mixed tabs/spaces or severe formatting issues. Ignore minor indentation inconsistencies.',
    priority: 'Low',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Missing Unit Tests',
    description: 'Critical functionality without tests.',
    prompt:
      'Flag critical functionality without tests. Ignore non-critical or experimental code.',
    priority: 'Medium',
    active: true,
    category: 'Testing',
  },
  {
    key: 'Violations of DRY Principle',
    description: 'Code duplication issues.',
    prompt:
      'Flag significant code duplication that could be refactored. Ignore minor or intentional repetition.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Improper Use of Constants',
    description: 'Using hardcoded values instead of constants.',
    prompt:
      'Flag hardcoded values that should be constants (e.g., `if (status == 2)`). Ignore values that are configuration-driven or part of business logic.',
    priority: 'Low',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Lack of Dependency Injection',
    description: 'Classes creating their own dependencies.',
    prompt:
      'Flag classes that create their own dependencies instead of using DI. Ignore cases where DI is not applicable (e.g., simple utilities).',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Static Code Analysis',
    description: 'Improper implementation of design patterns.',
    prompt:
      'Flag improper implementation of design patterns (e.g., Singleton misuse). Ignore cases where patterns are used correctly.',
    priority: 'Medium',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Unused Variables',
    description: 'Variables declared but not used.',
    prompt:
      'Flag variables declared but not used (e.g., `int x = 10;` with no further reference). Ignore variables in dead code or placeholders.',
    priority: 'Low',
    active: true,
    category: 'Code Quality',
  },
  {
    key: 'Null Pointer Dereference',
    description: 'Potential null/undefined access.',
    prompt:
      'Flag potential null/undefined access without proper checks. Ignore cases where nullability is explicitly handled.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Resource Leak',
    description: 'Unclosed resources like files or connections.',
    prompt:
      'Flag unclosed resources (e.g., files, connections). Ignore cases where resources are properly managed.',
    priority: 'Medium',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Insecure Randomness',
    description: 'Non-cryptographic random generators.',
    prompt:
      'Flag use of non-cryptographic random generators (e.g., `Math.random()`). Ignore secure random generators.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Race Conditions',
    description: 'Potential race conditions in code.',
    prompt:
      'Flag potential race conditions in concurrent code. Ignore thread-safe or properly synchronized code.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Memory Leaks',
    description: 'Potential memory leaks in code.',
    prompt:
      'Flag potential memory allocation without cleanup. Ignore cases where memory is properly managed.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Type Safety Violations',
    description: 'Unsafe type casting or operations.',
    prompt:
      'Flag unsafe type casting or operations. Ignore cases where type safety is ensured.',
    priority: 'Medium',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Deprecated API Usage',
    description: 'Use of deprecated APIs.',
    prompt:
      'Flag usage of deprecated APIs only if you are 100% sure. Ignore cases where alternatives are not available.',
    priority: 'Medium',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Cyclomatic Complexity',
    description: 'High complexity methods.',
    prompt:
      'Flag methods with cyclomatic complexity > 10 only if you are 100% sure. Ignore simple or well-structured methods.',
    priority: 'Medium',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Infinite Loops',
    description: 'Loops with no exit condition.',
    prompt:
      'Flag loops with no clear exit condition. Ignore loops with well-defined termination logic.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Unsafe Type Conversions',
    description: 'Unsafe type conversions or unchecked casts.',
    prompt:
      'Flag unsafe type conversions or unchecked casts. Ignore cases where type safety is ensured.',
    priority: 'Medium',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Concurrency Issues',
    description: 'Improper threading or synchronization.',
    prompt:
      'Flag improper use of threading or synchronization. Ignore thread-safe or properly synchronized code.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Insecure Cryptography',
    description: 'Weak or deprecated cryptographic algorithms.',
    prompt:
      'Flag use of weak or deprecated cryptographic algorithms. Ignore secure cryptographic practices.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Uninitialized Variables',
    description: 'Variables used before initialization.',
    prompt:
      'Flag variables used before initialization. Ignore cases where initialization is guaranteed.',
    priority: 'Medium',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Deadlocks',
    description: 'Potential deadlock scenarios.',
    prompt:
      'Flag potential deadlock scenarios in concurrent code. Ignore cases where deadlocks are impossible.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Improper Exception Propagation',
    description: 'Exceptions being swallowed or improperly propagated.',
    prompt:
      'Flag exceptions being swallowed or improperly propagated. Ignore intentional exception handling.',
    priority: 'Medium',
    active: true,
    category: 'Static Code Analysis',
  },
  {
    key: 'Code Syntax',
    description: 'Syntax errors in the code.',
    prompt:
      'Flag syntax errors like mismatched brackets or tags. Ignore stylistic or formatting issues.',
    priority: 'High',
    active: true,
    category: 'Static Code Analysis',
  },
];
export const transformPrompts = (repositorySettingsTemp) => {
  const activeFlags = repositorySettingsTemp.filter((flag) => flag.active);

  // Group by category
  const groupedFlags = activeFlags.reduce((acc, flag) => {
    if (!acc[flag.category]) {
      acc[flag.category] = [];
    }
    acc[flag.category].push(flag);
    return acc;
  }, {});

  // Format the output
  let output = '';

  // Code Smells
  if (groupedFlags['Code Quality']) {
    output += '### **Code Smells (with Priorities)**\n\n';
    groupedFlags['Code Quality'].forEach((flag, index) => {
      output += `${index + 1}. **${flag.key}** (priority<'Low', 'Medium', 'High'>): ${flag.prompt}\n`;
    });
    output += '\n---\n\n';
  }

  // Security Concerns
  if (groupedFlags['Security']) {
    output += '### **Security Concerns (with Priorities)**\n\n';
    groupedFlags['Security'].forEach((flag, index) => {
      output += `${index + 1}. **${flag.key}** (priority<'Low', 'Medium', 'High'>): ${flag.prompt}\n`;
    });
    output += '\n---\n\n';
  }

  // Additional Serious Flags
  // if (groupedFlags["Static Code Analysis"]) {
  //   output += "### **Additional Serious Flags (with Priorities)**\n\n";
  //   groupedFlags["Static Code Analysis"].forEach((flag, index) => {
  //     output += `${index + 1}. **${flag.key}** (priority<'Low', 'Medium', 'High'> ie. based on severity for Extremely worst condition it should be 'High', for Worst condition it should be 'Medium', for Bad condition it is 'Low'): ${flag.prompt}\n`;
  //   });
  //   output += "\n---\n\n";
  // }

  // Static Code Analysis
  if (groupedFlags['Static Code Analysis']) {
    output += '### **Static Code Analysis**\n\n';
    groupedFlags['Static Code Analysis'].forEach((flag, index) => {
      output += `${index + 1}. **${flag.key}** (priority<'Low', 'Medium', 'High'>): ${flag.prompt}\n`;
    });
  }

  return output;
};
