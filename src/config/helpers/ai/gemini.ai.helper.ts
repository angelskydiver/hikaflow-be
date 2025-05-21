import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = ***REMOVED_SECRET***;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
});

const generationConfig = {
  temperature: 0,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: 'application/json',
};

/**
 * Gemini AI helper for analysis and embeddings
 */
export class Gemini {
  private readonly genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  /**
   * Generate embeddings for a text using Gemini
   * @param text Text to embed
   * @returns Embedding array
   */
  async getEmbeddings(text: string): Promise<number[]> {
    try {
      // Create embedding model
      const model = this.genAI.getGenerativeModel({ model: 'embedding-001' });

      // Generate embeddings
      const result = await model.embedContent(text);
      const embedding = result.embedding.values;

      return embedding;
    } catch (error) {
      console.error('Error generating embeddings:', error);
      // Return empty array on error, this is just a placeholder
      // In production, you should handle this better
      return new Array(768).fill(0);
    }
  }

  /**
   * Analyze a file to extract code structure information
   * This is a fallback for when DeepSeek fails
   * @param fileData File data including content
   * @returns Structured analysis of the file
   */
  async analyzeFile(fileData: {
    content: string;
    name?: string;
    fileRelativePath?: string;
    invalidResponse?: string;
  }): Promise<any> {
    try {
      // If we received an invalid response from DeepSeek, try to fix it
      if (fileData.invalidResponse) {
        return this.repairInvalidJson(
          fileData.invalidResponse,
          fileData.name || fileData.fileRelativePath,
        );
      }

      // This method is now deprecated. Use direct minimal structure generation
      // or the repairInvalidJson method instead.
      const fileName =
        fileData.name ||
        fileData.fileRelativePath?.split('/').pop() ||
        'unknown';

      return {
        summary: `File ${fileName}`,
        tags: ['UTILITY'],
        functions: [],
        classes: [],
        components: [],
        relations: {
          imports: [],
          exports: [],
        },
      };
    } catch (error) {
      console.error('Error with Gemini fallback:', error);
      // Return a minimal valid structure to prevent downstream errors
      return {
        summary: 'File summary placeholder',
        tags: ['UTILITY'],
        functions: [],
        classes: [],
        components: [],
        relations: {
          imports: [],
          exports: [],
        },
      };
    }
  }

  /**
   * Repairs invalid JSON from DeepSeek
   * @param invalidJson Invalid JSON string from DeepSeek
   * @param fileName File name for context
   * @returns Fixed JSON object
   */
  async repairInvalidJson(invalidJson: string, fileName: string): Promise<any> {
    try {
      // First attempt: Try to extract JSON directly by removing markdown code blocks
      invalidJson = invalidJson.replace(/```json|```/g, '').trim();

      try {
        // See if it's valid JSON now
        return JSON.parse(invalidJson);
      } catch (extractError) {
        // Continue if direct cleaning fails
        console.log(`JSON cleaning failed, attempting to extract with regex`);
      }

      // Second attempt: Try regex extraction
      const jsonMatch = invalidJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          // Continue to reformatting if direct extraction fails
          console.log(
            'Regex JSON extraction failed, attempting Gemini reformatting',
          );
        }
      }

      // Third attempt: Use Gemini to repair the JSON
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      const prompt = `
Fix this invalid JSON without analyzing it. The JSON is from a file analysis and needs to be valid:

${invalidJson}

The output must be properly formatted JSON with this structure:
{
  "summary": "Brief description",
  "tags": ["TAG1", "TAG2"],  
  "functions": [],
  "classes": [],
  "components": [],
  "relations": {
    "imports": [],
    "exports": []
  }
}

Return ONLY the fixed JSON with no other text, explanations, or code formatting.
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim();

      // Clean up any potential markdown or text
      const cleanedResponse = response.replace(/```json|```/g, '').trim();

      try {
        return JSON.parse(cleanedResponse);
      } catch (finalParseError) {
        throw new Error(
          'Failed to parse Gemini-fixed JSON:  ' + finalParseError,
        );
      }

      // If all fails, return minimal structure
      return {
        summary: `File ${fileName || 'unknown'}`,
        tags: ['UTILITY'],
        functions: [],
        classes: [],
        components: [],
        relations: {
          imports: [],
          exports: [],
        },
      };
    } catch (error) {
      console.error('JSON repair failed:', error);
      // Return minimal structure on failure
      return {
        summary: `File ${fileName || 'unknown'}`,
        tags: ['UTILITY'],
        functions: [],
        classes: [],
        components: [],
        relations: {
          imports: [],
          exports: [],
        },
      };
    }
  }

  /**
   * Analyze code using Gemini
   * @param code Code to analyze
   * @returns Analysis result
   */
  async analyzeCode(code: string): Promise<any> {
    try {
      // Create generative model
      const model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });

      // Generate response
      const prompt = `Analyze the following code and summarize its functionality, potential issues, and improvements:
      
      ${code}`;

      const result = await model.generateContent(prompt);
      const response = result.response;

      return {
        summary: response.text(),
        // Add other analysis fields as needed
      };
    } catch (error) {
      console.error('Error analyzing code with Gemini:', error);
      return {
        summary: 'Error analyzing code',
        error: error.message,
      };
    }
  }

  /**
   * Filter files relevant to a user query
   * @param query The user's query
   * @param files Array of file information
   * @returns Filtered list of relevant files
   */
  async filterRelevantFiles(query: string, files: any[]): Promise<any> {
    console.log(`Filtering ${files.length} files for query: ${query}`);

    // Simple implementation that just returns all files
    // In production, replace with actual relevance filtering
    try {
      const prompt = `
      You are an AI code assistant helping technical team members understand a codebase.  
      
      Your task is to analyze the query and filter the file list to only include the most relevant files that would best answer the question.
      
      Query types to consider:
      1. For project purpose, domain, or target users questions: Prioritize README files, configuration files, and core service definitions
      2. For technical implementation questions: Select files directly related to the specific feature mentioned
      3. For bug/task assistance: Prioritize files that implement the functionality related to the issue
      4. For questions about specific services or modules: Include both the implementation file and related models/interfaces
      5. For file-specific questions: Ensure you include that file and its most closely related dependencies
      
      File selection criteria:
      - Return at least 1 and at most 5 files
      - For questions about project architecture, consider including multiple key service files
      - For specific feature questions, focus on the primary file implementing that feature
      - Exclude test files unless the query is specifically about testing
      - For each file, assess its relevance based on file name, path structure, file type tags, and summary
    
      Provide a response in the following JSON format with no extra text:
      
      [{
        "fileName": "<file name that is most relevant to answering the query>",
      }]
      I want exact JSON response No '''json  '''.
      Query: ${query}
      Files: ${JSON.stringify(files)}
      `;

      let resp: any = await model.generateContent([prompt]);
      resp = this.extractCleanJSON(
        resp.response.candidates[0].content.parts[0].text,
      );

      return {
        output: resp,
      };
    } catch (err) {
      console.error('filterRelevantFiles error:', err.message);
      throw new Error('Failed to filter relevant files');
    }
  }

  extractCleanJSON(rawText: string): any {
    // Match inside triple backticks or fallback to entire text
    const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonString = match ? match[1] : rawText;

    try {
      return JSON.parse(jsonString);
    } catch (e) {
      console.error('Failed to parse JSON:', jsonString);
      throw new Error('Invalid JSON format from Gemini');
    }
  }

  /**
   * Generate an answer based on the query and relevant files
   * @param query User query
   * @param files Relevant files with their content
   * @returns AI response with references
   */
  async generateAnswer(input: string, result, previousQuestions?: string) {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    try {
      let context = '';

      for (const r of result) {
        context += `source:${r.fileName}\ncode content:${r.sourceCode}\nsummary of file:${r.summary}\n\n`;
      }

      const prompt = `
You are an AI code assistant helping technical team members understand this codebase, debug issues, and complete tasks with high accuracy.

When answering about the project's purpose, focus on:
1. The specific domain the project serves
2. Target customers and user personas
3. Core unique features that differentiate this solution
4. Business goals and outcomes it aims to achieve
5. How the various components fit together in the overall architecture
6. Key technologies and frameworks used in the project

For file-specific questions:
1. Explain the file's role in the larger system architecture
2. Describe key classes, functions, and their relationships
3. Highlight important patterns and design decisions
4. Connect to other related files and how they interact

For technical assistance:
1. Prioritize practical, working solutions over theoretical explanations
2. Provide precise code snippets that follow the codebase patterns
3. Reference specific files, functions, and components that are relevant
4. Consider performance and best practices in your suggestions

IMPORTANT: For questions about project purpose or overview, extract information from README files, package configs, and service definitions to provide a comprehensive answer. If the information in the context is limited, synthesize the best answer from what's available rather than saying there's not enough information.

Answer in **markdown syntax**. Be comprehensive yet concise, focusing on the most relevant information to the question.

START CONTEXT BLOCK
${context}
END OF CONTEXT BLOCK

START QUESTION
${input}
END OF QUESTION

CONTEXT OF PREVIOUS QUESTIONS
${previousQuestions || 'No previous questions'}
END OF PREVIOUS QUESTIONS
`;

      const resp = await model.generateContent([prompt]);

      return {
        output: resp,
        filesReferenced: result,
      };
    } catch (err) {
      console.error('generateAnswer error:', err.message);
      throw new Error('Failed to generate answer');
    }
  }

  /**
   * Get context information about a query
   * @param query User query
   * @param tags Available tags in the project
   * @returns Context information
   */
  async getQueryContext(query: string, tags: string): Promise<any> {
    console.log(`Getting context for query: ${query}`);

    // Mock implementation
    return {
      output: {
        context: 'Project overview',
        tag: 'CONFIG',
        relatedTags: ['API', 'SERVICE', 'CONTROLLER'],
      },
    };
  }

  /**
   * Analyze potential regression impacts from code changes in a PR using Gemini's larger context window
   * This is a fallback for when DeepSeek is unavailable or rate-limited
   * @param changedFiles Array of changed files with metadata
   * @returns Analysis of potential regressions and test suggestions
   */
  async analyzeRegressionImpact(changedFiles: any[]): Promise<any> {
    try {
      console.log(
        `Analyzing regression impact for ${changedFiles.length} files using Gemini (FALLBACK MODE)`,
      );

      // If there are too many files, break them into smaller chunks
      if (changedFiles.length > 10) {
        console.log(
          `Large PR detected (${changedFiles.length} files), chunking analysis`,
        );
        return this.analyzeRegressionImpactInChunks(changedFiles);
      }

      let modelToUse = 'gemini-1.5-pro';
      let retryCount = 0;
      const MAX_RETRIES = 3;
      let lastError = null;

      // Try with Pro model first, fall back to Flash if needed
      while (retryCount <= MAX_RETRIES) {
        try {
          // Create generative model
          const model = this.genAI.getGenerativeModel({ model: modelToUse });

          // Prepare a more structured context with important information only to manage token count
          const fileContexts = changedFiles.map((file) => {
            // Get essential data about each file
            const summary = {
              filename: file.filename,
              patch: file.patch?.substring(0, 300) || '', // Further limit patch size to reduce tokens
              importerOnly: file.importerOnly || false,
              functions: Array.isArray(file.functions)
                ? file.functions.slice(0, 5)
                : [], // Limit number of functions even more
              imports: Array.isArray(file.imports)
                ? file.imports.slice(0, 5)
                : [], // Limit imports
              exports: Array.isArray(file.exports)
                ? file.exports.slice(0, 5)
                : [], // Limit exports
              impactedBy: Array.isArray(file.impactedBy)
                ? file.impactedBy.slice(0, 3)
                : [],
              impacts: Array.isArray(file.impacts)
                ? file.impacts.slice(0, 3)
                : [],
              affectedFlows: Array.isArray(file.affectedFlows)
                ? file.affectedFlows.slice(0, 3)
                : [],
            };

            // Include key content snippets instead of full content to reduce tokens
            let previousSnippet = '';
            let currentSnippet = '';

            if (file.previousContent) {
              // Extract up to 30 lines max from previous content (reduced from 50)
              const prevLines = file.previousContent.split('\n').slice(0, 30);
              previousSnippet = prevLines.join('\n');
            }

            if (file.currentContent) {
              // Extract up to 30 lines max from current content (reduced from 50)
              const currLines = file.currentContent.split('\n').slice(0, 30);
              currentSnippet = currLines.join('\n');
            }

            return {
              ...summary,
              previousSnippet,
              currentSnippet,
            };
          });

          // System prompt for PR analysis - modified to match DeepSeek's output format exactly
          const systemPrompt = `You are an expert code regression analyst specializing in identifying concrete code breakage risks. Your analysis must provide definitive statements about what WILL break and what WILL work after changes. This is CRITICAL as you are the fallback system when our primary AI is unavailable.

PRECISE INSTRUCTIONS:
1. Trace function call chains across files to find exact breakage points
2. Identify missing/changed parameters, return values, or types that WILL cause runtime errors 
3. Examine database queries, API calls, and state mutations for incomplete changes
4. Pinpoint data flow issues where expected values are missing or incorrect
5. Look at all files that call the modified functions to detect cross-file effects

ANALYSIS METHOD:
1. Map each modified function to all places it's invoked
2. Check if parameter changes match all invocation patterns
3. Verify database schema expectations vs. provided values
4. Track all conditionals affected by changed behavior
5. Trace API contract changes and their impacts

DEFINITIVENESS REQUIREMENTS:
- Each finding MUST have concrete "WILL_BREAK" or "WILL_WORK" assessment
- Every breakage must reference the exact file:line where the issue occurs
- Include code snippets showing the exact breakage point
- Explicitly state what value/parameter/behavior is wrong
- For each broken function, explain what INPUT leads to failure

You MUST follow the EXACT DeepSeek format to ensure compatibility:`;

          // Prepare human prompt with structured information
          const humanPrompt = `Analyze these code changes to definitively identify what WILL break and what WILL work. BE EXTREMELY SPECIFIC WITH DETAILS:

The changes include modifications to ${changedFiles.length} files.

${fileContexts
  .map(
    (file) =>
      `## File: ${file.filename}
${file.importerOnly ? '(This file only imports changed code)' : ''}
${file.imports?.length > 0 ? `Imports: ${file.imports.join(', ')}` : ''}
${file.exports?.length > 0 ? `Exports: ${file.exports.join(', ')}` : ''}
${file.impactedBy?.length > 0 ? `Impacted by files: ${file.impactedBy.join(', ')}` : ''}
${file.impacts?.length > 0 ? `Impacts files: ${file.impacts.join(', ')}` : ''}
${file.affectedFlows?.length > 0 ? `Affected flows: ${file.affectedFlows.join(', ')}` : ''}

--- Previous Code Snippet ---
${file.previousSnippet || 'No previous content available'}

--- Current Code Snippet ---
${file.currentSnippet || 'No current content available'}

--- Patch (partial) ---
${file.patch ? file.patch.substring(0, 300) + (file.patch.length > 300 ? '...' : '') : 'No patch available'}
`,
  )
  .join('\n\n')}

REQUIRED OUTPUT FORMAT - YOU MUST FOLLOW THIS STRUCTURE EXACTLY TO MATCH DEEPSEEK:

{
  "summary": "Precise summary of changes and their concrete impacts",
  
  "impactedFlows": [
    {
      "flowName": "Name of the affected business flow",
      "impactSeverity": "HIGH|MEDIUM|LOW",
      "breakageStatus": "WILL_BREAK|MIGHT_BREAK|WILL_WORK",
      "description": "Precise description with specific error conditions",
      "affectedComponents": ["List", "of", "affected", "components"],
      "breakageDetails": "Exact locations and conditions where flow breaks"
    }
  ],
  
  "changedBehavior": [
    {
      "component": "Component or function name",
      "previousBehavior": "Description of previous behavior",
      "newBehavior": "Description of new behavior",
      "invocations": [
        {
          "file": "File path where component is invoked",
          "line": "Line number of invocation",
          "compatibilityStatus": "COMPATIBLE|INCOMPATIBLE|UNCERTAIN", 
          "explanation": "Exact reason for compatibility assessment"
        }
      ]
    }
  ],
  
  "potentialBreakages": [
    {
      "area": "Function/API/Data area with issues",
      "breakageStatus": "WILL_BREAK|MIGHT_BREAK|WILL_WORK",
      "description": "Detailed description of exactly what will break",
      "evidence": "Evidence from code that proves breakage will occur",
      "location": "Exact file:line where breakage occurs",
      "failureCondition": "Precise input/condition that triggers failure",
      "mitigation": "Required change to fix the issue"
    }
  ],
  
  "testCases": [
    {
      "testName": "Descriptive test name",
      "type": "UNIT|INTEGRATION|E2E|REGRESSION",
      "scenario": "What scenario this test covers",
      "steps": ["Step 1", "Step 2", "..."],
      "expectedResult": "Expected outcome of the test",
      "codeExample": "Code example with exact inputs that will trigger failure",
      "willCatchBreakage": true|false
    }
  ]
}

The analysis must be HIGHLY DETAILED and SPECIFIC. Include exact file locations, line numbers, variable names, and concrete examples of breakage conditions. Generic statements are USELESS. BE SPECIFIC.`;

          console.log(
            `Sending regression analysis request to Gemini using ${modelToUse}...`,
          );

          // Generate content with Gemini
          const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: humanPrompt }] }],
            systemInstruction: systemPrompt,
            generationConfig: {
              temperature: 0.2, // Slight randomness for better analysis quality
              maxOutputTokens: modelToUse === 'gemini-1.5-pro' ? 8192 : 4096,
              topK: 40,
              topP: 0.95,
            },
          });

          // Extract the text response
          const response = result.response;
          const output = response.text().trim();

          console.log(
            `Received Gemini regression analysis (${output.length} chars)`,
          );

          // Try to parse the JSON response
          try {
            // Extract just the JSON part if there's additional text
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            const jsonString = jsonMatch ? jsonMatch[0] : output;

            const parsedOutput = JSON.parse(jsonString);

            // Ensure all expected properties exist and match DeepSeek's format
            const enhancedOutput = {
              summary: parsedOutput.summary || 'No summary provided',

              impactedFlows: Array.isArray(parsedOutput.impactedFlows)
                ? parsedOutput.impactedFlows.map((flow) => ({
                    ...flow,
                    // Ensure required fields exist
                    flowName: flow.flowName || 'Unnamed flow',
                    impactSeverity: flow.impactSeverity || 'MEDIUM',
                    breakageStatus: flow.breakageStatus || 'MIGHT_BREAK',
                    description: flow.description || 'No description provided',
                    affectedComponents: Array.isArray(flow.affectedComponents)
                      ? flow.affectedComponents
                      : [],
                    breakageDetails:
                      flow.breakageDetails || 'No specific details provided',
                  }))
                : [],

              changedBehavior: Array.isArray(parsedOutput.changedBehavior)
                ? parsedOutput.changedBehavior.map((behavior) => ({
                    ...behavior,
                    // Ensure invocations exist and have required fields
                    invocations: Array.isArray(behavior.invocations)
                      ? behavior.invocations
                      : [
                          {
                            file: 'Unknown',
                            line: 'Unknown',
                            compatibilityStatus: 'UNCERTAIN',
                            explanation:
                              'No specific information available from fallback analysis',
                          },
                        ],
                  }))
                : [],

              potentialBreakages: Array.isArray(parsedOutput.potentialBreakages)
                ? parsedOutput.potentialBreakages.map((breakage) => ({
                    ...breakage,
                    // Ensure required fields exist
                    breakageStatus: breakage.breakageStatus || 'MIGHT_BREAK',
                    evidence:
                      breakage.evidence ||
                      'Evidence not provided by fallback analysis',
                    location: breakage.location || 'Unknown location',
                    failureCondition:
                      breakage.failureCondition ||
                      'Specific failure conditions not identified',
                  }))
                : [],

              testCases: Array.isArray(parsedOutput.testCases)
                ? parsedOutput.testCases.map((test) => ({
                    ...test,
                    // Ensure required fields exist
                    steps: Array.isArray(test.steps)
                      ? test.steps
                      : ['Step not provided by fallback analysis'],
                    willCatchBreakage:
                      test.willCatchBreakage !== undefined
                        ? test.willCatchBreakage
                        : true,
                  }))
                : [],
            };

            return enhancedOutput;
          } catch (parseError) {
            console.error(
              'Failed to parse Gemini regression analysis JSON:',
              parseError,
            );
            console.log('Raw output:', output.substring(0, 200) + '...');

            // Extract insights even if JSON parsing fails
            return this.fallbackMinimalAnalysisDeepSeek(
              changedFiles,
              parseError,
            );
          }
        } catch (apiError) {
          console.error(
            `API error during Gemini regression analysis (attempt ${retryCount + 1}):`,
            apiError,
          );
          lastError = apiError;

          // If we get rate limit error (429), wait and retry or switch model
          if (apiError.status === 429) {
            // Try with less intensive model if we're still using pro
            if (modelToUse === 'gemini-1.5-pro') {
              console.log(
                'Rate limit hit with pro model, switching to gemini-1.5-flash...',
              );
              modelToUse = 'gemini-1.5-flash';
              // Small delay to allow quota to reset
              await new Promise((resolve) => setTimeout(resolve, 2000));
            } else {
              // If already using flash model, wait longer before retry
              const waitTime = Math.min(5000 * (retryCount + 1), 15000);
              console.log(
                `Rate limit hit with flash model, waiting ${waitTime / 1000} seconds before retry...`,
              );
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }
          } else {
            // For other errors, switch model and retry
            modelToUse =
              modelToUse === 'gemini-1.5-pro'
                ? 'gemini-1.5-flash'
                : 'gemini-1.5-pro';
          }

          retryCount++;

          // If we've exhausted retries, fall back to a minimal analysis
          if (retryCount > MAX_RETRIES) {
            return this.fallbackMinimalAnalysisDeepSeek(
              changedFiles,
              lastError,
            );
          }

          // Continue to next retry iteration
          continue;
        }
      }

      // This should only be reached if all retries fail but don't throw specific errors
      return this.fallbackMinimalAnalysisDeepSeek(changedFiles, lastError);
    } catch (error) {
      console.error('Error in Gemini regression impact analysis:', error);

      return this.fallbackMinimalAnalysisDeepSeek(changedFiles, error);
    }
  }

  /**
   * Minimal analysis specifically formatted to match DeepSeek's output structure
   * @param changedFiles Changed files array
   * @param error Error that caused fallback
   * @returns Basic analysis
   */
  private fallbackMinimalAnalysisDeepSeek(
    changedFiles: any[],
    error: any,
  ): any {
    console.log('Using fallback minimal analysis method (DeepSeek compatible)');

    // Extract basic information from files
    const fileNames = changedFiles
      .map((file) => file.filename || 'Unknown file')
      .slice(0, 20);
    const fileTypes = new Set(
      fileNames.map((name) => {
        const ext = name.split('.').pop();
        return ext ? `.${ext}` : 'unknown';
      }),
    );

    // Extract info about which components might be affected based on file paths
    const components = new Set(
      fileNames.map((name) => {
        const parts = name.split('/');
        // Try to extract component name from path
        if (parts.length > 2) {
          return parts[1] || 'Unknown';
        }
        return 'Unknown component';
      }),
    );

    const componentsArray = Array.from(components);

    // Generate basic test cases based on file types
    const genericTestCases = [];

    if (fileTypes.has('.js') || fileTypes.has('.ts')) {
      genericTestCases.push({
        testName: 'Basic functionality test for changed JS/TS files',
        type: 'INTEGRATION',
        scenario:
          'Verify the basic functionality of changed JavaScript/TypeScript files still works',
        steps: [
          'Step 1: Identify the main exported functions/methods in each changed file',
          'Step 2: Create test inputs for each function/method',
          'Step 3: Call each function with the test inputs',
          'Step 4: Verify the results match expected outputs',
        ],
        expectedResult:
          'Each function should return expected values without errors',
        willCatchBreakage: true,
        codeExample: `// Example test for a function
test('functionName returns expected results', () => {
  const result = functionName(testInput);
  expect(result).toBe(expectedOutput);
});`,
      });
    }

    if (
      fileTypes.has('.jsx') ||
      fileTypes.has('.tsx') ||
      fileTypes.has('.vue')
    ) {
      genericTestCases.push({
        testName: 'UI component rendering test',
        type: 'UNIT',
        scenario: 'Verify UI components render correctly with various props',
        steps: [
          'Step 1: Render each changed component with default props',
          'Step 2: Render each changed component with various prop combinations',
          'Step 3: Verify the component renders without errors',
          'Step 4: Check that the component structure matches expectations',
        ],
        expectedResult:
          'Components should render correctly with all prop combinations',
        willCatchBreakage: true,
        codeExample: `// Example test for a React component
test('Component renders with props', () => {
  const { getByTestId } = render(<Component prop1="test" prop2={123} />);
  expect(getByTestId('component-element')).toBeInTheDocument();
});`,
      });
    }

    if (
      fileTypes.has('.api.ts') ||
      fileTypes.has('.service.ts') ||
      fileTypes.has('.controller.ts')
    ) {
      genericTestCases.push({
        testName: 'API contract test',
        type: 'INTEGRATION',
        scenario: "Verify API contract hasn't changed in an incompatible way",
        steps: [
          'Step 1: Call each changed API endpoint with valid inputs',
          'Step 2: Call each changed API endpoint with invalid inputs',
          'Step 3: Verify response structure matches expected schema',
          'Step 4: Verify error handling works correctly',
        ],
        expectedResult:
          'API responses should match expected structure and status codes',
        willCatchBreakage: true,
        codeExample: `// Example test for an API endpoint
test('API returns correct response', async () => {
  const response = await request(app).get('/api/endpoint').send({ param: 'value' });
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('expectedField');
});`,
      });
    }

    // For each file, create a potential breakage entry
    const potentialBreakages = fileNames
      .map((filename) => {
        return {
          area: `Changes in ${filename}`,
          breakageStatus: 'MIGHT_BREAK',
          description: `Changes in this file may affect dependent modules or functionality`,
          evidence: 'File has been modified in this PR',
          location: `${filename}:1`,
          failureCondition:
            'Unknown due to automated fallback analysis limitations',
          mitigation:
            'Manual code review and comprehensive testing recommended',
        };
      })
      .slice(0, 5); // Limit to 5 to avoid overwhelming the user

    // For each component, create a changed behavior entry
    const changedBehavior = componentsArray
      .map((component) => {
        return {
          component: component,
          previousBehavior: 'Original implementation before changes',
          newBehavior: 'Modified implementation after changes',
          invocations: [
            {
              file: 'Unknown - requires manual analysis',
              line: 'Unknown',
              compatibilityStatus: 'UNCERTAIN',
              explanation:
                'Automated fallback analysis cannot determine exact compatibility',
            },
          ],
        };
      })
      .slice(0, 3); // Limit to 3 to avoid overwhelming the user

    return {
      summary: `Automated fallback analysis: This PR modifies ${changedFiles.length} files including ${fileTypes.size} different file types. Detailed analysis was not possible due to API limitations: ${error?.message || 'Unknown error'}. Manual code review strongly recommended.`,

      impactedFlows: [
        {
          flowName: 'Manual review required',
          description:
            'Automated analysis was unable to identify specific flows',
          impactSeverity: 'MEDIUM',
          breakageStatus: 'MIGHT_BREAK',
          affectedComponents: componentsArray,
          breakageDetails:
            'Manual analysis required to identify exact breakages',
        },
      ],

      changedBehavior:
        changedBehavior.length > 0
          ? changedBehavior
          : [
              {
                component: 'Unknown Components',
                previousBehavior: 'Original behavior before changes',
                newBehavior: 'Modified behavior after changes',
                invocations: [
                  {
                    file: 'Unknown',
                    line: 'Unknown',
                    compatibilityStatus: 'UNCERTAIN',
                    explanation:
                      'Automated fallback analysis cannot determine exact compatibility',
                  },
                ],
              },
            ],

      potentialBreakages:
        potentialBreakages.length > 0
          ? potentialBreakages
          : [
              {
                area: 'General',
                breakageStatus: 'MIGHT_BREAK',
                description:
                  'Unable to analyze specific breakages due to analysis limitations',
                evidence: 'Multiple files modified in PR',
                location: 'Various locations',
                failureCondition: 'Unknown conditions may trigger failures',
                mitigation: 'Comprehensive manual testing recommended',
              },
            ],

      testCases:
        genericTestCases.length > 0
          ? genericTestCases
          : [
              {
                testName: 'Manual regression testing',
                type: 'REGRESSION',
                scenario: 'Comprehensive testing of all changed functionality',
                steps: [
                  'Step 1: Identify all changed components and functions',
                  'Step 2: Create test cases for each change',
                  'Step 3: Verify old behavior is preserved where expected',
                  'Step 4: Verify new behavior works as intended',
                ],
                expectedResult:
                  'All functionality works correctly with no regressions',
                willCatchBreakage: true,
                codeExample: '// Manual testing required',
              },
            ],
    };
  }

  /**
   * Handle large PRs by analyzing files in chunks
   * @param changedFiles All changed files
   * @returns Consolidated analysis
   */
  private async analyzeRegressionImpactInChunks(
    changedFiles: any[],
  ): Promise<any> {
    console.log(
      'Using chunked Gemini analysis strategy for large PR (FALLBACK MODE)',
    );

    // Constants designed to stay under token limits
    const CHUNK_SIZE = 3;
    const CONTENT_LENGTH_LIMIT = 10000;

    // Sort files by importance - directly changed files before importers
    const sortedFiles = [...changedFiles].sort((a, b) => {
      // Direct changes are more important than importers
      if (a.importerOnly && !b.importerOnly) return 1;
      if (!a.importerOnly && b.importerOnly) return -1;
      return 0;
    });

    // Create chunks of files that stay under token limits
    const chunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentChunkSize = 0;

    for (const file of sortedFiles) {
      // Estimate token count (rough approximation)
      const contentSize =
        (file.previousContent?.length || 0) +
        (file.currentContent?.length || 0) +
        (file.patch?.length || 0);

      // If adding this file would exceed our limit, start a new chunk
      if (
        currentChunk.length >= CHUNK_SIZE ||
        (currentChunkSize > 0 &&
          currentChunkSize + contentSize > CONTENT_LENGTH_LIMIT)
      ) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentChunkSize = 0;
      }

      // Add file to current chunk
      currentChunk.push(file);
      currentChunkSize += contentSize;
    }

    // Add the last chunk if it has files
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    console.log(`Split PR analysis into ${chunks.length} chunks`);

    // Analyze each chunk
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Analyzing chunk ${i + 1} of ${chunks.length}...`);

      try {
        // Create compact representations of files to reduce token usage
        const compactChunk = chunks[i].map((file) => ({
          filename: file.filename,
          patch: file.patch?.substring(0, 300) || '',
          previousContent: file.previousContent?.substring(0, 1000) || '',
          currentContent: file.currentContent?.substring(0, 1000) || '',
          importerOnly: file.importerOnly || false,
          functions: Array.isArray(file.functions)
            ? file.functions.slice(0, 3)
            : [],
          imports: Array.isArray(file.imports) ? file.imports.slice(0, 3) : [],
          exports: Array.isArray(file.exports) ? file.exports.slice(0, 3) : [],
          impactedBy: Array.isArray(file.impactedBy)
            ? file.impactedBy.slice(0, 3)
            : [],
          impacts: Array.isArray(file.impacts) ? file.impacts.slice(0, 3) : [],
          affectedFlows: Array.isArray(file.affectedFlows)
            ? file.affectedFlows.slice(0, 3)
            : [],
        }));

        // Create a temporary instance of this class to avoid recursive chunking
        const tempAnalyzer = new Gemini();

        // Call the main analysis method (it will use the fallback implementation directly)
        // Use call to preserve the 'this' context
        const chunkResult = await Object.getPrototypeOf(
          this,
        ).analyzeRegressionImpact.call(tempAnalyzer, compactChunk);

        // Track which files were analyzed in this chunk for better summaries
        chunkResult._analyzedFiles = compactChunk.map((f) => f.filename);

        results.push(chunkResult);

        // Add a delay between chunks to avoid rate limiting
        if (i < chunks.length - 1) {
          console.log('Waiting between chunk analysis to avoid rate limits...');
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.error(`Error analyzing chunk ${i + 1}:`, error);

        // Even if one chunk fails, still try to create minimal analysis for it
        results.push(
          this.fallbackMinimalAnalysisDeepSeek(
            chunks[i],
            new Error(`Failed to analyze chunk ${i + 1}: ${error.message}`),
          ),
        );
      }
    }

    // Merge results into a comprehensive analysis
    console.log(
      `Successfully analyzed ${results.length} chunks, merging results...`,
    );
    return this.mergeChunkResults(results, chunks);
  }

  /**
   * Merge analysis results from multiple chunks
   * @param results Array of analysis results
   * @param chunks Original file chunks
   * @returns Consolidated result
   */
  private mergeChunkResults(results: any[], chunks?: any[][]): any {
    if (results.length === 0) {
      return this.fallbackMinimalAnalysisDeepSeek(
        [],
        new Error('No chunks were successfully analyzed'),
      );
    }

    // Combine all results into a DeepSeek-compatible format
    const merged = {
      summary: 'Combined analysis from multiple chunks:\n',
      impactedFlows: [],
      testCases: [],
      potentialBreakages: [],
      changedBehavior: [],
    };

    // File tracking (for summary)
    const analyzedFiles = new Set<string>();

    // Process each chunk's results
    for (const result of results) {
      if (!result) continue;

      // Track analyzed files
      if (Array.isArray(result._analyzedFiles)) {
        result._analyzedFiles.forEach((file: string) =>
          analyzedFiles.add(file),
        );
      }

      // Add chunk's summary to the combined summary
      merged.summary += `- ${result.summary || 'No summary for this chunk'}\n`;

      // Handle impactedFlows with DeepSeek format
      if (Array.isArray(result.impactedFlows)) {
        for (const flow of result.impactedFlows) {
          if (typeof flow === 'string') {
            // Convert strings to objects in DeepSeek format
            merged.impactedFlows.push({
              flowName: flow,
              description: 'Automatically detected flow',
              impactSeverity: 'MEDIUM',
              breakageStatus: 'MIGHT_BREAK',
              affectedComponents: [],
              breakageDetails: 'No specific details available',
            });
          } else if (typeof flow === 'object' && flow !== null) {
            // Ensure object has required DeepSeek fields
            merged.impactedFlows.push({
              ...flow,
              breakageStatus: flow.breakageStatus || 'MIGHT_BREAK',
              affectedComponents: Array.isArray(flow.affectedComponents)
                ? flow.affectedComponents
                : [],
              breakageDetails:
                flow.breakageDetails || 'No specific details provided',
            });
          }
        }
      }

      // Add test cases
      if (Array.isArray(result.testCases)) {
        merged.testCases.push(
          ...result.testCases.map((test) => ({
            ...test,
            steps: Array.isArray(test.steps)
              ? test.steps
              : ['Step not provided from chunk analysis'],
            willCatchBreakage:
              test.willCatchBreakage !== undefined
                ? test.willCatchBreakage
                : true,
          })),
        );
      }

      // Add potential breakages with DeepSeek fields
      if (Array.isArray(result.potentialBreakages)) {
        merged.potentialBreakages.push(
          ...result.potentialBreakages.map((breakage) => ({
            ...breakage,
            breakageStatus: breakage.breakageStatus || 'MIGHT_BREAK',
            evidence:
              breakage.evidence || 'Evidence not provided from chunk analysis',
            failureCondition:
              breakage.failureCondition ||
              'Unknown conditions that may trigger failures',
          })),
        );
      }

      // Add changed behavior with DeepSeek invocations
      if (Array.isArray(result.changedBehavior)) {
        merged.changedBehavior.push(
          ...result.changedBehavior.map((behavior) => ({
            ...behavior,
            invocations: Array.isArray(behavior.invocations)
              ? behavior.invocations
              : [
                  {
                    file: 'Unknown',
                    line: 'Unknown',
                    compatibilityStatus: 'UNCERTAIN',
                    explanation:
                      'No specific information available from chunk analysis',
                  },
                ],
          })),
        );
      }
    }

    // Generate a meaningful final summary about all files analyzed
    merged.summary = `Analysis of ${analyzedFiles.size} files from chunked processing.\n\nKey findings:\n${merged.summary}`;

    // Deduplicate arrays by key fields
    merged.impactedFlows = this.deduplicateObjectArray(
      merged.impactedFlows,
      'flowName',
    );
    merged.testCases = this.deduplicateObjectArray(
      merged.testCases,
      'testName',
    );
    merged.potentialBreakages = this.deduplicateObjectArray(
      merged.potentialBreakages,
      'area',
    );
    merged.changedBehavior = this.deduplicateObjectArray(
      merged.changedBehavior,
      'component',
    );

    return merged;
  }

  /**
   * Deduplicate an array of objects based on a key
   * @param array Array of objects
   * @param key Property to deduplicate on
   * @returns Deduplicated array
   */
  private deduplicateObjectArray(array: any[], key: string): any[] {
    const seen = new Set();
    return array.filter((item) => {
      const value = item[key];
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  /**
   * Categorizes a query type to help determine the most appropriate handling
   * @param query The user query text
   * @returns The query category (USER_FLOW, FUNCTION_TRACE, or PROJECT_LEVEL)
   */
  async categorizeQueryType(
    query: string,
    hasThreadId: boolean = false,
  ): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      const prompt = `
You are an AI assistant that helps categorize user questions about codebases into one of four types:

1. PROJECT_LEVEL: Questions about the overall project, its structure, purpose, technologies used, database schema, models, tables, or high-level architecture. Examples:
   - "What is the purpose of this project?"
   - "What are the main tables in this project?"
   - "How is this project organized?"
   - "What database does this project use?"
   - "What frameworks are used in this project?"
   - "Explain the database schema"
   - "What are the main entities in this system?"

2. FUNCTION_TRACE: Questions about specific functions, methods, APIs, implementations, or code tracing. Examples:
   - "How is the login functionality implemented?"
   - "Where is the 'createUser' function defined?"
   - "What API endpoints are available for user management?"
   - "How does the application authenticate requests?"
   - "Show me where the payment processing happens"
   - "How do I use the caching mechanism?"

3. USER_FLOW: Questions about user journeys, workflows, or sequences of actions. Examples:
   - "What happens when a user signs up?"
   - "What is the checkout process?"
   - "How does the login flow work?"
   - "What's the user registration journey?"
   - "Walk me through the authentication flow"
   - "What's the process for submitting a form?"

4. FOLLOW_UP: Questions that reference or build upon previous questions/answers in the conversation. Examples:
   - "Can you explain that part in more detail?"
   - "What about the other functions it calls?"
   - "How does that relate to what you showed earlier?"
   - "Could you show me more examples of this?"
   - "Why does it work that way?"
   - "What else is connected to this?"

Based on the query below, categorize it into exactly ONE of these types: PROJECT_LEVEL, FUNCTION_TRACE, USER_FLOW, or FOLLOW_UP.
Respond with ONLY the category name, nothing else.

Query: ${query}
`;

      const resp = await model.generateContent([prompt]);
      const categoryType = resp.response.text().trim();

      // If it's a FOLLOW_UP type but no threadId is provided, default to PROJECT_LEVEL
      if (categoryType === 'FOLLOW_UP' && !hasThreadId) {
        console.warn(
          'Query categorized as FOLLOW_UP but no threadId provided, defaulting to PROJECT_LEVEL',
        );
        return 'PROJECT_LEVEL';
      }

      // Validate the response is one of the expected categories
      if (
        !['PROJECT_LEVEL', 'FUNCTION_TRACE', 'USER_FLOW', 'FOLLOW_UP'].includes(
          categoryType,
        )
      ) {
        console.warn(
          `Unexpected category type returned: ${categoryType}, defaulting to PROJECT_LEVEL`,
        );
        return 'PROJECT_LEVEL';
      }

      return categoryType;
    } catch (err) {
      console.error('Error categorizing query:', err.message);
      // Default to PROJECT_LEVEL if categorization fails
      return 'PROJECT_LEVEL';
    }
  }

  /**
   * Generates a concise summary of an answer for threading context
   * @param content The content to summarize (either the answer or a prompt with the answer)
   * @returns A concise summary focusing on key technical details
   */
  async generateSummary(content: string): Promise<string> {
    try {
      // Create generative model
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
        },
      });

      // Generate summary
      const prompt = `
Create a concise, factual summary of this technical response. Focus only on extracting the most important:
- Technical concepts mentioned
- File names and paths
- Function names and methods
- Data structures or models mentioned
- Key findings or solutions

Make the summary useful for maintaining context in a thread of technical questions.
Keep it under 250 words and don't add any commentary or explanations.

${content}
`;

      const result = await model.generateContent(prompt);
      let summary = result.response.text().trim();

      // // Ensure it's not too long (max 500 chars)
      // if (summary.length > 500) {
      //   summary = summary.substring(0, 497) + '...';
      // }

      return summary;
    } catch (error) {
      console.error('Error generating summary:', error);
      // Return a shortened version of the original as fallback
      return content.substring(0, 200) + (content.length > 200 ? '...' : '');
    }
  }
}
