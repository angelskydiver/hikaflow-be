import { GoogleGenerativeAI } from '@google/generative-ai';

// Constants
const EMBEDDING_DIMENSION = 768; // Gemini embedding-001 model dimension

/**
 * Gemini AI helper for analysis and embeddings
 */
export class Gemini {
  private readonly genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = ***REMOVED_SECRET***;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
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
      return new Array(EMBEDDING_DIMENSION).fill(0);
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
        model: 'gemini-2.5-flash',
      });

      const prompt = `
Fix this invalid JSON without analyzing it. The JSON is from a file analysis and needs to be valid:

${invalidJson}

The output must be properly formatted JSON.
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

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
      });
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
   * Generate a simple response (for V2 analysis)
   * @param prompt The prompt to send to AI
   * @param streamCallback Optional callback for streaming
   * @returns AI response
   */
  async generateResponse(prompt: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('Error generating response:', error);
      throw error;
    }
  }

  /**
   * Generate a response with streaming support
   * @param prompt The prompt to send to AI
   * @param streamCallback Callback for streaming chunks
   * @returns Complete AI response
   */
  async generateResponseWithStreaming(
    prompt: string,
    streamCallback?: (chunk: string) => void,
  ): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      if (streamCallback) {
        const result = await model.generateContentStream(prompt);
        let fullText = '';

        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          fullText += chunkText;
          streamCallback(chunkText);
        }

        return fullText;
      } else {
        const result = await model.generateContent(prompt);
        return result.response.text();
      }
    } catch (error) {
      console.error('Error generating streaming response:', error);
      throw error;
    }
  }

  /**
   * Generate an answer based on the query and relevant files
   * @param query User query
   * @param files Relevant files with their content
   * @returns AI response with references
   */
  async generateAnswer(
    input: string,
    result,
    previousQuestions?: string,
    modelToUse?: string,
  ) {
    modelToUse = modelToUse || 'gemini-2.5-pro';
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let lastError = null;

    // Try with Flash model first, fall back to Pro if needed
    while (retryCount <= MAX_RETRIES) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelToUse });

        let context = '';

        for (const r of result) {
          context += `source:${r.fileName}\ncode content:${r.sourceCode}\nsummary of file:${r.summary}\n\n`;
        }

        const prompt = `
You are an AI code assistant helping technical team members understand this codebase, debug issues, and complete tasks with high accuracy. You have deep knowledge of the codebase and can answer questions directly and naturally, as if you were a senior developer who wrote the code.

IMPORTANT GUIDELINES:
1. Answer questions directly and naturally, without referencing that you're looking at code or analyzing files
2. Don't start responses with phrases like "Based on the code..." or "Looking at the implementation..."
3. Speak with authority and confidence about how things work, as if you designed the system
4. Use a conversational, professional tone as if speaking to a colleague
5. analyze the query context from relevant files or previous questions and answer the question best and confident way you can.


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

        console.log(
          `Generating answer using ${modelToUse} (attempt ${retryCount + 1})`,
        );

        const resp = await model.generateContent([prompt]);

        return {
          output: resp,
          filesReferenced: result,
        };
      } catch (apiError) {
        console.error(
          `API error during generateAnswer (attempt ${retryCount + 1}):`,
          apiError,
        );
        lastError = apiError;

        // Handle specific error types
        if (
          apiError.status === 503 ||
          apiError.message?.includes('overloaded') ||
          apiError.message?.includes('fetch failed') ||
          apiError.message?.includes('network')
        ) {
          // Model overloaded or network issue - wait and retry with exponential backoff
          const waitTime = Math.min(2000 * Math.pow(2, retryCount), 30000); // Max 30 seconds
          console.log(
            `Model overloaded or network issue, waiting ${waitTime / 1000} seconds before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));

          // Switch model if we're not making progress
          if (retryCount >= 1) {
            modelToUse =
              modelToUse === 'gemini-2.5-pro'
                ? 'gemini-2.5-flash'
                : 'gemini-2.5-pro';
            console.log(`Switching to ${modelToUse} for retry`);
          }
        } else if (apiError.status === 429) {
          // Rate limit - wait longer
          const waitTime = Math.min(5000 * (retryCount + 1), 45000);
          console.log(
            `Rate limit hit, waiting ${waitTime / 1000} seconds before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          // For other errors, try switching model immediately
          modelToUse =
            modelToUse === 'gemini-2.5-pro'
              ? 'gemini-2.5-flash'
              : 'gemini-2.5-pro';
          console.log(`API error, switching to ${modelToUse} for retry`);
        }

        retryCount++;

        // If we've exhausted retries, throw the last error
        if (retryCount > MAX_RETRIES) {
          console.error('All retry attempts exhausted for generateAnswer');
          console.error('Last error:', lastError);
          throw new Error(
            `Failed to generate answer after ${MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`,
          );
        }

        // Continue to next retry iteration
        continue;
      }
    }

    // This should only be reached if all retries fail but don't throw specific errors
    console.error('Last error before final throw:', lastError);
    throw new Error(
      `Failed to generate answer: ${lastError?.message || 'Unknown error'}`,
    );
  }

  /**
   * Generate an answer with streaming support
   * @param input User query
   * @param result Relevant files with their content
   * @param previousQuestions Previous questions context
   * @param onChunk Callback for each text chunk
   * @returns AI response with references
   */
  async generateAnswerStream(
    input: string,
    filesWithCode,
    previousQuestions?: string,
    onChunk?: (chunk: string) => void,
  ) {
    let modelToUse = 'gemini-2.5-pro';
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let lastError = null;

    // Try with Pro model first, fall back to Flash if needed
    while (retryCount <= MAX_RETRIES) {
      let streamResult = null;
      try {
        const model = this.genAI.getGenerativeModel({ model: modelToUse });

        let context = '';

        for (const r of filesWithCode) {
          context += `source:${r.fileName}\ncode content:${r.sourceCode}\nsummary of file:${r.summary}\n\n`;
        }

        const prompt = `
You are an AI code assistant helping technical team members understand this codebase, debug issues, and complete tasks with high accuracy. You have deep knowledge of the codebase and can answer questions directly and naturally, as if you were a senior developer who wrote the code.

IMPORTANT GUIDELINES:
1. Answer questions directly and naturally, without referencing that you're looking at code or analyzing files
2. Don't start responses with phrases like "Based on the code..." or "Looking at the implementation..."
3. Speak with authority and confidence about how things work, as if you designed the system
4. Use a conversational, professional tone as if speaking to a colleague
5. analyze the query context from relevant files or previous questions and answer the question best and confident way you can.


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

        console.log(
          `Generating streaming answer using ${modelToUse} (attempt ${retryCount + 1})`,
        );

        // Use streaming generation
        streamResult = await model.generateContentStream([prompt]);
        let fullResponse = '';
        let buffer = ''; // Buffer to accumulate smaller chunks
        let streamCleanup = false;

        try {
          for await (const chunk of streamResult.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              fullResponse += chunkText;
              buffer += chunkText;

              // Send smaller chunks for smoother streaming
              if (buffer.length >= 20 || buffer.includes('\n')) {
                // Send the buffered content as a smaller chunk
                if (onChunk) {
                  onChunk(buffer);
                }
                buffer = ''; // Reset buffer
              }
            }
          }

          // Send any remaining buffered content
          if (buffer.length > 0 && onChunk) {
            onChunk(buffer);
          }
          streamCleanup = true;
        } finally {
          // Ensure stream cleanup to prevent memory leaks
          if (!streamCleanup && streamResult?.stream) {
            try {
              // Force cleanup of any remaining stream resources
              if (typeof streamResult.stream.return === 'function') {
                await streamResult.stream.return();
              }
            } catch (cleanupError) {
              console.warn('Error during stream cleanup:', cleanupError);
            }
          }
        }

        // Create the final response object
        const finalResponse = {
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: fullResponse,
                    },
                  ],
                },
              },
            ],
          },
        };

        return {
          output: finalResponse,
          filesReferenced: filesWithCode,
        };
      } catch (apiError) {
        console.error(
          `API error during generateAnswerStream (attempt ${retryCount + 1}):`,
          apiError,
        );
        lastError = apiError;

        // Clean up any active streams to prevent memory leaks
        try {
          if (
            streamResult?.stream &&
            typeof streamResult.stream.return === 'function'
          ) {
            await streamResult.stream.return();
          }
        } catch (cleanupError) {
          console.warn(
            'Error during stream cleanup in catch block:',
            cleanupError,
          );
        }

        // Handle specific error types
        if (
          apiError.status === 503 ||
          apiError.message?.includes('overloaded') ||
          apiError.message?.includes('fetch failed') ||
          apiError.message?.includes('network')
        ) {
          // Model overloaded or network issue - wait and retry with exponential backoff
          const waitTime = Math.min(2000 * Math.pow(2, retryCount), 30000); // Max 30 seconds
          console.log(
            `Model overloaded or network issue, waiting ${waitTime / 1000} seconds before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));

          // Switch model if we're not making progress
          if (retryCount >= 1) {
            modelToUse =
              modelToUse === 'gemini-2.5-pro'
                ? 'gemini-2.5-flash'
                : 'gemini-2.5-pro';
            console.log(`Switching to ${modelToUse} for retry`);
          }
        } else if (apiError.status === 429) {
          // Rate limit - wait longer
          const waitTime = Math.min(5000 * (retryCount + 1), 45000);
          console.log(
            `Rate limit hit, waiting ${waitTime / 1000} seconds before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          // For other errors, try switching model immediately
          modelToUse =
            modelToUse === 'gemini-2.5-pro'
              ? 'gemini-2.5-flash'
              : 'gemini-2.5-pro';
          console.log(`API error, switching to ${modelToUse} for retry`);
        }

        retryCount++;

        // If we've exhausted retries, throw the last error
        if (retryCount > MAX_RETRIES) {
          console.error(
            'All retry attempts exhausted for generateAnswerStream',
          );
          throw new Error(
            `Failed to generate streaming answer after ${MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`,
          );
        }

        // Continue to next retry iteration
        continue;
      }
    }

    // This should only be reached if all retries fail but don't throw specific errors
    throw new Error(
      `Failed to generate streaming answer: ${lastError?.message || 'Unknown error'}`,
    );
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

      let modelToUse = 'gemini-2.5-pro';
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
            const patchString =
              typeof file.patch === 'string'
                ? file.patch
                : String(file.patch || '');
            const summary = {
              filename: file.filename,
              patch: patchString.substring(0, 300), // Further limit patch size to reduce tokens
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
${file.patch ? (typeof file.patch === 'string' ? file.patch : String(file.patch)).substring(0, 300) + ((typeof file.patch === 'string' ? file.patch : String(file.patch)).length > 300 ? '...' : '') : 'No patch available'}
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
      "file": "Exact file path where component is defined",
      "line": "Line number where component is defined",
      "previousSignature": "Exact function signature before change",
      "newSignature": "Exact function signature after change",
      "changeType": "PARAMETER_ADDED|PARAMETER_REMOVED|PARAMETER_MODIFIED|RETURN_TYPE_CHANGED|FUNCTION_REMOVED",
      "previousBehavior": "Description of previous behavior",
      "newBehavior": "Description of new behavior",
      "callsites": [
        {
          "file": "File path where component is invoked",
          "line": "Line number of invocation",
          "callCode": "Exact code that calls this function",
          "compatibilityStatus": "WILL_BREAK|MIGHT_BREAK|WILL_WORK", 
          "breakageReason": "Specific reason why this will break (if applicable)",
          "requiredFix": "Exact code change needed to fix this callsite",
          "copyPasteCode": "Ready-to-use code that can be copied and pasted directly to fix this callsite",
          "explanation": "Exact reason for compatibility assessment",
          "importPath": "How this function is imported in this file",
          "confidence": "HIGH|MEDIUM|LOW - confidence in this analysis"
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
  ],

  "developerReport": {
    "executiveSummary": {
      "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
      "totalIssues": 0,
      "estimatedFixTime": "string (e.g., '15 minutes', '2 hours')",
      "deploymentRecommendation": "SAFE|REVIEW_REQUIRED|BLOCK",
      "oneLiner": "Brief summary of what needs attention"
    },
    "immediateActions": [
      {
        "priority": "CRITICAL|HIGH|MEDIUM|LOW",
        "action": "What needs to be done",
        "file": "File to modify",
        "line": "Line number",
        "currentCode": "Current code that will break",
        "requiredChange": "Exact code change needed",
        "reason": "Why this change is needed",
        "estimatedTime": "Time to fix (e.g., '2 minutes')",
        "copyPasteCode": "Ready-to-use code for copy-paste"
      }
    ],
    "testActions": [
      {
        "action": "What test to run",
        "command": "Exact command to execute",
        "expectedResult": "What to expect",
        "fixCommand": "Command to fix if test fails"
      }
    ],
    "deploymentDecision": {
      "recommendation": "DEPLOY|REVIEW|BLOCK",
      "reason": "Why this recommendation",
      "blockingIssues": ["List of issues that block deployment"],
      "riskMitigation": "How to reduce risk if deploying"
    }
  }
}

CRITICAL CALLSITE TRACING INSTRUCTIONS:
1. **MANDATORY: Find EVERY callsite** - You MUST search through ALL provided files systematically
2. **Search patterns (be exhaustive)**:
   - Direct calls: functionName(, functionName.call(, functionName.apply(
   - Method calls: object.functionName(, this.functionName(
   - Destructured calls: const { functionName } = module; functionName(
   - Imported calls: import { functionName } from 'module'; functionName(
   - Callback calls: .then(functionName), .catch(functionName), .finally(functionName)
   - Array methods: .map(functionName), .filter(functionName), .reduce(functionName)
   - Event handlers: onClick={functionName}, onSubmit={functionName}
   - Conditional calls: if (condition) functionName(, condition ? functionName( : otherFunction(
   - Async calls: await functionName(, Promise.resolve().then(() => functionName(

3. **BREAKAGE ANALYSIS RULES**:
   - WILL_BREAK: Only if the code will actually throw an error or fail at runtime
   - MIGHT_BREAK: Only if behavior changes in a way that could cause issues
   - WILL_WORK: If the change is backward compatible or doesn't affect this callsite
   - DO NOT flag parameter order issues unless the function signature actually changed
   - DO NOT flag store/state issues unless the actual store interface changed

4. **For each callsite found**:
   - Provide exact file path and line number
   - Show the exact code that calls the function
   - Determine breakage status with specific reasoning
   - If it will break, provide the exact fix needed
   - Estimate how long it will take to fix

5. **Example of precise callsite analysis**:
   If function getUserById(id, includeProfile) changes to getUserById(id, includeProfile, options):
   - Find: getUserById(userId, true) in UserProfile.jsx:67
   - Status: WILL_BREAK
   - Reason: Missing required 'options' parameter
   - Fix: getUserById(userId, true, {})
   - Time: 2 minutes

CRITICAL ACCURACY REQUIREMENTS:
1. **DO NOT FLAG THESE AS BREAKAGES**:
   - Parameter order in function calls (unless the function signature actually changed)
   - Store/state availability (unless the actual interface changed)
   - Generic "might break" scenarios without specific evidence
   - Assumptions about function behavior without seeing the actual implementation

2. **ONLY FLAG AS BREAKAGES**:
   - Actual function signature changes (added/removed required parameters)
   - Removed functions or methods
   - Type mismatches that will cause runtime errors
   - Actual interface changes in stores/APIs

3. **CALLSITE DETECTION**:
   - You MUST find ALL callsites, not just some
   - If you find 7 callsites, list all 7, not just 2
   - Be systematic: search file by file, line by line
   - Include all variations: direct calls, method calls, callbacks, etc.

4. **DIVERSE ANALYSIS**:
   - Don't repeat the same type of issue multiple times
   - Focus on different aspects: function changes, data flow, error handling, etc.
   - Provide unique insights for each potential breakage

5. **TEST CASE GENERATION**:
   - Generate specific, actionable test cases with exact inputs
   - Include copy-paste ready code for immediate use
   - Specify testing framework (Jest, Mocha, Pytest, etc.)
   - Provide estimated implementation time
   - Include specific assertion points and mock requirements
   - Focus on tests that will actually catch the breakages identified

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
              maxOutputTokens: modelToUse === 'gemini-2.5-pro' ? 8192 : 4096,
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
            if (modelToUse === 'gemini-2.5-pro') {
              console.log(
                'Rate limit hit with pro model, switching to gemini-2.5-pro...',
              );
              modelToUse = 'gemini-2.5-pro';
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
              modelToUse === 'gemini-2.5-pro'
                ? 'gemini-2.5-flash'
                : 'gemini-2.5-pro';
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
        // Create enhanced representations of files with full content for better analysis
        const compactChunk = chunks[i].map((file) => ({
          filename: file.filename,
          patch: file.patch || '',
          previousContent: file.previousContent || '',
          currentContent: file.currentContent || '',
          importerOnly: file.importerOnly || false,
          functions: Array.isArray(file.functions) ? file.functions : [],
          imports: Array.isArray(file.imports) ? file.imports : [],
          exports: Array.isArray(file.exports) ? file.exports : [],
          impactedBy: Array.isArray(file.impactedBy) ? file.impactedBy : [],
          impacts: Array.isArray(file.impacts) ? file.impacts : [],
          affectedFlows: Array.isArray(file.affectedFlows)
            ? file.affectedFlows
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
      collaboratorMetrics: {
        performanceGainScore: { score: 0 },
        codeFootprintScore: { score: 0 },
        refactorQualityScore: { score: 0 },
        efficiencyScore: { score: 0 },
        teamCollaborationScore: { score: 0 },
        testCoverageScore: { score: 0 },
        documentationQualityScore: { score: 0 },
        businessImpact: {
          criticalModules: [],
          userFacingImprovements: [],
          errorRateImpact: 'Not enough information',
          performanceEffects: 'Not enough information',
        },
      },
    };

    // File tracking (for summary)
    const analyzedFiles = new Set<string>();
    let totalValidChunks = 0;

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
            merged.impactedFlows.push({
              flowName: flow,
              description: 'Automatically detected flow',
              impactSeverity: 'MEDIUM',
              breakageStatus: 'MIGHT_BREAK',
              affectedComponents: [],
              breakageDetails: 'No specific details available',
            });
          } else if (typeof flow === 'object' && flow !== null) {
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

      // Merge collaborator metrics by averaging scores
      if (result.collaboratorMetrics) {
        totalValidChunks++;

        // Update scores by adding them (we'll average later)
        merged.collaboratorMetrics.performanceGainScore.score +=
          result.collaboratorMetrics.performanceGainScore?.score || 0;
        merged.collaboratorMetrics.codeFootprintScore.score +=
          result.collaboratorMetrics.codeFootprintScore?.score || 0;
        merged.collaboratorMetrics.refactorQualityScore.score +=
          result.collaboratorMetrics.refactorQualityScore?.score || 0;
        merged.collaboratorMetrics.efficiencyScore.score +=
          result.collaboratorMetrics.efficiencyScore?.score || 0;
        merged.collaboratorMetrics.teamCollaborationScore.score +=
          result.collaboratorMetrics.teamCollaborationScore?.score || 0;
        merged.collaboratorMetrics.testCoverageScore.score +=
          result.collaboratorMetrics.testCoverageScore?.score || 0;
        merged.collaboratorMetrics.documentationQualityScore.score +=
          result.collaboratorMetrics.documentationQualityScore?.score || 0;

        // Merge business impact data
        if (result.collaboratorMetrics.businessImpact) {
          merged.collaboratorMetrics.businessImpact.criticalModules.push(
            ...(result.collaboratorMetrics.businessImpact.criticalModules ||
              []),
          );
          merged.collaboratorMetrics.businessImpact.userFacingImprovements.push(
            ...(result.collaboratorMetrics.businessImpact
              .userFacingImprovements || []),
          );
        }
      }
    }

    // Calculate averages for collaborator metrics if we have valid chunks
    if (totalValidChunks > 0) {
      merged.collaboratorMetrics.performanceGainScore.score /= totalValidChunks;
      merged.collaboratorMetrics.codeFootprintScore.score /= totalValidChunks;
      merged.collaboratorMetrics.refactorQualityScore.score /= totalValidChunks;
      merged.collaboratorMetrics.efficiencyScore.score /= totalValidChunks;
      merged.collaboratorMetrics.teamCollaborationScore.score /=
        totalValidChunks;
      merged.collaboratorMetrics.testCoverageScore.score /= totalValidChunks;
      merged.collaboratorMetrics.documentationQualityScore.score /=
        totalValidChunks;
    }

    // Deduplicate business impact arrays
    merged.collaboratorMetrics.businessImpact.criticalModules = [
      ...new Set(merged.collaboratorMetrics.businessImpact.criticalModules),
    ];
    merged.collaboratorMetrics.businessImpact.userFacingImprovements = [
      ...new Set(
        merged.collaboratorMetrics.businessImpact.userFacingImprovements,
      ),
    ];

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
        model: 'gemini-2.5-pro',
      });

      const prompt = `You are an AI assistant that helps categorize user questions about codebases into one of five types:

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

4. RELEASE_ANALYSIS: Questions about commit history, code changes, releases, or version differences. Examples:
   - "What changes were made in the last commit?"
   - "Show me the recent code changes"
   - "What features were added in the latest release?"
   - "What did the user change in their last commit?"
   - "What are the main changes between versions?"
   - "Summarize the recent code modifications"
   - "What bugs were fixed in recent commits?"

5. FOLLOW_UP: Questions that reference or build upon previous questions/answers in the conversation. Examples:
   - "Can you explain that part in more detail?"
   - "What about the other functions it calls?"
   - "How does that relate to what you showed earlier?"
   - "Could you show me more examples of this?"
   - "Why does it work that way?"
   - "What else is connected to this?"

Based on the query below, categorize it into exactly ONE of these types: PROJECT_LEVEL, FUNCTION_TRACE, USER_FLOW, RELEASE_ANALYSIS, or FOLLOW_UP.
Respond with ONLY the category name, nothing else.

Query: ${query}`;

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
        ![
          'PROJECT_LEVEL',
          'FUNCTION_TRACE',
          'USER_FLOW',
          'FOLLOW_UP',
          'RELEASE_ANALYSIS',
        ].includes(categoryType)
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
        model: 'gemini-2.5-pro',
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
      const summary = result.response.text().trim();

      return summary;
    } catch (error) {
      console.error('Error generating summary:', error);
      // Return a shortened version of the original as fallback
      return content.substring(0, 200) + (content.length > 200 ? '...' : '');
    }
  }

  /**
   * Analyze PR issues against latest commit changes and determine which comments are fixed.
   * Returns an array of comment IDs that should be marked as OUTDATED/RESOLVED.
   */
  async detectFixedComments(input: {
    issues: Array<{
      id: string;
      file: string;
      line: number;
      content: string;
      issue?: string;
      reason?: string;
    }>;
    changes: Array<{
      fileName: string;
      lineNumber: number;
      content: string;
      type?: string;
    }>;
  }): Promise<string[]> {
    console.log('issues: ', input.issues);
    console.log('changes: ', input.changes);

    try {
      if (
        !input ||
        !Array.isArray(input.issues) ||
        !Array.isArray(input.changes)
      ) {
        return [];
      }

      // Group changes by file and compress content to keep prompt compact
      const groupedChanges: Record<
        string,
        Array<{ lineNumber: number; content: string; type?: string }>
      > = {};
      for (const change of input.changes) {
        if (!groupedChanges[change.fileName])
          groupedChanges[change.fileName] = [];
        groupedChanges[change.fileName].push({
          lineNumber: change.lineNumber,
          content: change.content?.slice(0, 1000) || '',
          type: change.type,
        });
      }

      // Sort and trim changes per file to a reasonable size
      for (const file of Object.keys(groupedChanges)) {
        groupedChanges[file] = groupedChanges[file]
          .sort((a, b) => a.lineNumber - b.lineNumber)
          .slice(0, 500); // cap per file
      }

      // Batch issues to avoid token limits
      const BATCH_SIZE = 25;
      const fixedIds: string[] = [];

      for (let i = 0; i < input.issues.length; i += BATCH_SIZE) {
        const batch = input.issues.slice(i, i + BATCH_SIZE);

        const model = this.genAI.getGenerativeModel({
          model: 'gemini-2.5-pro',
        });

        const prompt = `You are an expert code reviewer. Your task is to determine which PR review comments are now FIXED based on the latest commit changes.

Definition of FIXED:
- The underlying issue described in the review comment has been addressed.
- This can be by removing the problematic code, modifying it so the issue no longer applies, or replacing it with a correct implementation.
- For example, null pointer risks must be mitigated with proper checks, hardcoded values must be replaced with configurable constants, and duplicate logic must be refactored into a single place.

NOT FIXED if:
- The problematic code still exists in essentially the same form.
- The issue was simply moved or re-added elsewhere.
- The root cause described in the comment remains unresolved (even if unrelated changes were made nearby).
- In cases of duplication (DRY violations), having the same logic still repeated in multiple places means NOT FIXED.

You must:
- Check each issue independently.
- Only return IDs you are certain are fixed.
- If uncertain, treat it as NOT FIXED.

Return ONLY a strict JSON array of IDs of the fixed comments, no markdown, no extra text. Example: ["id1","id2"].

ISSUES:
${JSON.stringify(
  batch.map((c) => ({
    id: c.id,
    file: c.file,
    line: c.line,
    content: (c.content || '').slice(0, 800),
    issue: (c.issue || '').slice(0, 400),
    reason: (c.reason || '').slice(0, 400),
  })),
)}

LATEST_CHANGES_BY_FILE:
${JSON.stringify(groupedChanges)}
`;

        console.log('final prompt: ', prompt);

        const result = await model.generateContent([prompt]);
        const text = result.response.text().trim();

        let ids: string[] = [];
        try {
          ids = this.extractCleanJSON(text);
        } catch (_) {
          // Fallback: try naive JSON parse
          try {
            ids = JSON.parse(text);
          } catch (e) {
            ids = [];
          }
        }

        // Validate IDs are strings
        if (Array.isArray(ids)) {
          for (const id of ids) {
            if (typeof id === 'string') fixedIds.push(id);
          }
        }
      }

      // Deduplicate
      console.log('fixedIds: ', Array.from(new Set(fixedIds)));
      return Array.from(new Set(fixedIds));
    } catch (error) {
      console.error('detectFixedComments error:', error);
      return [];
    }
  }

  /**
   * Generate contributor insights using AI analysis
   * @param metrics Contributor performance metrics
   * @param contributor Contributor information
   * @param period Report period
   * @returns Array of insights
   */
  async generateContributorInsights(
    metrics: {
      commits: {
        total: number;
        merged: number;
        additions: number;
        deletions: number;
        filesChanged: number;
      };
      modules: {
        primary: string[];
        all: { name: string; commits: number; changes: number }[];
      };
      issues: {
        fixed: number;
        opened: number;
        stillOpen: number;
        closed: number;
        categories: { [category: string]: number };
        avgResolutionTime: number;
      };
      pullRequests: {
        created: number;
        merged: number;
        reviewed: number;
      };
      codeQuality: {
        commentsAddressed: number;
        securityFixes: number;
        codeSmellFixes: number;
        commentsOnPRs: number;
      };
    },
    contributor: { name: string; role: string; team: string },
    period: { start: Date; end: Date },
  ): Promise<string[]> {
    try {
      const prompt = `You are an expert Engineering Manager and Data Analyst specializing in software development productivity analysis.

Analyze the following contributor's weekly performance metrics and provide 3-5 key insights that would be valuable to a Team Lead, Engineering Manager, or CTO. Focus on actionable, data-driven observations.

## Contributor Information:
- Name: ${contributor.name}
- Role: ${contributor.role}
- Team: ${contributor.team}
- Period: ${period.start.toISOString().split('T')[0]} to ${period.end.toISOString().split('T')[0]}

## Performance Metrics:

### Commit Activity:
- Total Commits: ${metrics.commits.total}
- Merged Commits: ${metrics.commits.merged}
- Lines Added: ${metrics.commits.additions}
- Lines Deleted: ${metrics.commits.deletions}
- Files Changed: ${metrics.commits.filesChanged}

### Module Focus:
- Primary Modules (Top 3): ${metrics.modules.primary.join(', ') || 'None'}
- Total Modules Worked On: ${metrics.modules.all.length}
- Module Distribution: ${JSON.stringify(metrics.modules.all.slice(0, 5).map((m) => `${m.name} (${m.commits} commits, ${m.changes} changes)`))}

### Issue Management (Hikaflow Usage):
- Issues Fixed/Closed: ${metrics.issues.fixed}
- Issues Opened This Week: ${metrics.issues.opened}
- Issues Still Open: ${metrics.issues.stillOpen}
- Average Resolution Time: ${metrics.issues.avgResolutionTime.toFixed(1)} hours
- Issue Categories: ${JSON.stringify(metrics.issues.categories)}
- **Hikaflow Engagement:** ${metrics.issues.fixed + metrics.issues.opened > 0 ? '✅ Active' : '⚠️ Low - Consider using Hikaflow for issue tracking'}

### Pull Request Activity:
- PRs Created: ${metrics.pullRequests.created}
- PRs Merged: ${metrics.pullRequests.merged}
- PRs Reviewed: ${metrics.pullRequests.reviewed}

### Code Quality:
- Comments Addressed: ${metrics.codeQuality.commentsAddressed}
- Security Fixes: ${metrics.codeQuality.securityFixes}
- Code Smell Fixes: ${metrics.codeQuality.codeSmellFixes}
- Comments on PRs: ${metrics.codeQuality.commentsOnPRs}

## Instructions:
1. Provide 3-5 concise, impactful insights (one sentence each)
2. Use emojis sparingly and professionally (🔥, 📈, ✅, ⚠️, 💡)
3. Highlight strengths, patterns, and areas of excellence
4. Note any concerning trends or risks
5. Be specific with numbers when relevant
6. Focus on what matters to engineering leadership (velocity, quality, collaboration, growth)
7. **IMPORTANT:** If issue tracking is low (few or no issues opened/fixed), encourage active use of Hikaflow for tracking bugs, technical debt, and improvements - this is critical for team visibility and process improvement

## Output Format:
Return a JSON array of insight strings:
{
  "insights": [
    "Insight 1...",
    "Insight 2...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Parse JSON response
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.insights || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini response as JSON:', e);
      }

      // Fallback: extract insights from markdown list
      const lines = response
        .split('\n')
        .filter(
          (line) =>
            line.trim().startsWith('-') ||
            line.trim().startsWith('*') ||
            line.trim().match(/^\d+\./),
        );
      return lines
        .map((line) => line.replace(/^[-*\d.]\s*/, '').trim())
        .filter(Boolean);
    } catch (error) {
      console.error('Error generating contributor insights:', error);
      return [];
    }
  }

  /**
   * Generate contributor improvement suggestions using AI analysis
   * @param metrics Contributor performance metrics
   * @param contributor Contributor information
   * @returns Array of suggestions
   */
  async generateContributorSuggestions(
    metrics: {
      commits: {
        total: number;
        merged: number;
        additions: number;
        deletions: number;
        filesChanged: number;
      };
      modules: {
        primary: string[];
        all: { name: string; commits: number; changes: number }[];
      };
      issues: {
        fixed: number;
        opened: number;
        stillOpen: number;
        closed: number;
        avgResolutionTime: number;
      };
      pullRequests: {
        created: number;
        merged: number;
        reviewed: number;
      };
      codeQuality: {
        commentsAddressed: number;
        securityFixes: number;
        codeSmellFixes: number;
        commentsOnPRs: number;
      };
    },
    contributor: { name: string; role: string },
  ): Promise<string[]> {
    try {
      const prompt = `You are an expert Engineering Manager providing constructive feedback to improve a developer's performance.

Analyze the contributor's metrics and provide 3-5 specific, actionable improvement suggestions. These should be:
- Practical and achievable
- Specific to the data shown
- Focused on growth and productivity
- Suitable for a professional development context

## Contributor Context:
- Name: ${contributor.name}
- Role: ${contributor.role}

## Current Performance Metrics:

### Commit Activity:
- Total Commits: ${metrics.commits.total}
- Merged Commits: ${metrics.commits.merged} (${metrics.commits.merged > 0 ? ((metrics.commits.merged / metrics.commits.total) * 100).toFixed(0) : 0}% merge rate)
- Lines Added: ${metrics.commits.additions}
- Lines Deleted: ${metrics.commits.deletions}
- Files Changed: ${metrics.commits.filesChanged}

### Module Focus:
- Primary Modules: ${metrics.modules.primary.join(', ') || 'None'}
- Total Modules: ${metrics.modules.all.length}

### Issue Management (Hikaflow Platform):
- Issues Fixed/Closed: ${metrics.issues.fixed}
- Issues Opened This Week: ${metrics.issues.opened}
- Issues Still Open: ${metrics.issues.stillOpen}
- Net Impact: ${metrics.issues.fixed - metrics.issues.opened}
- Avg Resolution Time: ${metrics.issues.avgResolutionTime.toFixed(1)} hours
- **Hikaflow Engagement:** ${metrics.issues.fixed + metrics.issues.opened > 0 ? 'Active ✅' : 'Low ⚠️ - Encourage use of Hikaflow for tracking'}

### Collaboration:
- PRs Created: ${metrics.pullRequests.created}
- PRs Merged: ${metrics.pullRequests.merged}
- PRs Reviewed: ${metrics.pullRequests.reviewed}
- Comments on PRs: ${metrics.codeQuality.commentsOnPRs}

### Code Quality:
- Comments Addressed: ${metrics.codeQuality.commentsAddressed}
- Security Fixes: ${metrics.codeQuality.securityFixes}
- Code Smell Fixes: ${metrics.codeQuality.codeSmellFixes}

## Instructions:
1. Identify areas with room for improvement (low numbers, imbalances, gaps)
2. Provide specific, actionable suggestions
3. Use a supportive, constructive tone
4. Reference specific metrics when relevant
5. Suggest concrete actions (not vague advice)
6. Consider role-appropriate expectations
7. **CRITICAL:** If issue tracking is low or zero (0 issues opened/fixed), STRONGLY encourage using Hikaflow to track bugs, technical debt, code improvements, and feature requests. Emphasize that issue tracking is essential for:
   - Team visibility into problems and improvements
   - Better project planning and prioritization
   - Demonstrating proactive problem-solving
   - Creating a culture of continuous improvement

## Output Format:
Return a JSON object with suggestions array:
{
  "suggestions": [
    "Specific actionable suggestion 1...",
    "Specific actionable suggestion 2...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.suggestions || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini suggestions as JSON:', e);
      }

      // Fallback
      const lines = response
        .split('\n')
        .filter(
          (line) =>
            line.trim().startsWith('-') ||
            line.trim().startsWith('*') ||
            line.trim().match(/^\d+\./),
        );
      return lines
        .map((line) => line.replace(/^[-*\d.]\s*/, '').trim())
        .filter(Boolean);
    } catch (error) {
      console.error('Error generating contributor suggestions:', error);
      return [];
    }
  }

  /**
   * Generate team insights using AI analysis
   * @param data Team performance data
   * @param teamName Team name
   * @param period Report period
   * @returns Array of insights
   */
  async generateTeamInsights(
    data: {
      totalCommits: number;
      totalIssuesFixed: number;
      velocity: number;
      backlog: number;
      contributors: number;
    },
    teamName: string,
    period: { start: Date; end: Date },
  ): Promise<string[]> {
    try {
      const prompt = `You are an expert Engineering Director analyzing team performance for weekly reporting to CTO and upper management.

Analyze the team's metrics and provide 4-6 strategic insights that would be valuable to engineering leadership. Focus on team health, productivity trends, and business impact.

## Team Information:
- Team Name: ${teamName}
- Period: ${period.start.toISOString().split('T')[0]} to ${period.end.toISOString().split('T')[0]}

## Team Performance Metrics:

### Productivity:
- Total Commits: ${data.totalCommits}
- Team Velocity: ${data.velocity} commits/week
- Active Contributors: ${data.contributors}
- Average Commits per Contributor: ${data.contributors > 0 ? (data.totalCommits / data.contributors).toFixed(1) : 0}

### Issue Management:
- Issues Fixed: ${data.totalIssuesFixed}
- Open Issue Backlog: ${data.backlog}
- Backlog Trend: ${data.backlog < 10 ? 'Healthy' : data.backlog > 30 ? 'Concerning' : 'Moderate'}

## Context for Analysis:
- Velocity of ${data.velocity} commits indicates ${data.velocity > 50 ? 'high' : data.velocity > 20 ? 'moderate' : 'low'} productivity
- Backlog of ${data.backlog} issues is ${data.backlog < 10 ? 'well-managed' : data.backlog > 30 ? 'needs attention' : 'manageable'}
- ${data.contributors} active contributors this week

## Instructions:
1. Provide 4-6 strategic insights (one sentence each)
2. Use professional tone suitable for CTO/VP level reporting
3. Highlight team strengths and achievements
4. Identify risks or areas needing attention
5. Reference specific numbers
6. Consider team size and context in analysis
7. Focus on actionable observations for leadership

## Output Format:
{
  "insights": [
    "Strategic insight 1...",
    "Strategic insight 2...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.insights || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini team insights:', e);
      }

      return [];
    } catch (error) {
      console.error('Error generating team insights:', error);
      return [];
    }
  }

  /**
   * Generate team recommendations using AI analysis
   * @param data Team performance data
   * @param teamName Team name
   * @param contributors Individual contributor reports
   * @returns Array of recommendations
   */
  async generateTeamRecommendations(
    data: {
      quality: string;
      velocity: number;
      backlog: number;
      contributors: Array<{
        contributor: { name: string };
        metrics: { commits: { total: number }; issues: { fixed: number } };
      }>;
    },
    teamName: string,
  ): Promise<string[]> {
    try {
      const avgCommits =
        data.contributors.length > 0
          ? data.contributors.reduce(
              (sum, c) => sum + c.metrics.commits.total,
              0,
            ) / data.contributors.length
          : 0;

      const prompt = `You are an expert Engineering Director providing strategic recommendations to improve team performance.

Analyze the team's current state and provide 3-5 actionable recommendations for the Team Lead or Engineering Manager. These should be strategic, practical, and based on the data.

## Team Context:
- Team Name: ${teamName}
- Team Health Status: ${data.quality}
- Team Velocity: ${data.velocity} commits/week
- Open Issue Backlog: ${data.backlog}
- Active Contributors: ${data.contributors.length}
- Average Commits per Contributor: ${avgCommits.toFixed(1)}

## Performance Breakdown:
${data.contributors.map((c, i) => `Contributor ${i + 1}: ${c.contributor.name} - ${c.metrics.commits.total} commits, ${c.metrics.issues.fixed} issues fixed`).join('\n')}

## Current State Analysis:
- Quality Status: ${data.quality} (${data.quality === 'excellent' ? 'performing well' : data.quality === 'good' ? 'solid performance' : 'needs improvement'})
- Velocity: ${data.velocity} commits is ${data.velocity > 50 ? 'strong' : data.velocity > 20 ? 'moderate' : 'below expectations'}
- Backlog Management: ${data.backlog} open issues (${data.backlog < 10 ? 'well-controlled' : data.backlog > 30 ? 'requires immediate action' : 'manageable'})
- Team Engagement: ${data.contributors.length} active contributors

## Instructions:
1. Provide 3-5 strategic recommendations
2. Be specific and actionable (what to do, not vague advice)
3. Prioritize by impact and urgency
4. Consider team context and current state
5. Reference specific metrics when relevant
6. Focus on improvements that will move the needle

## Output Format:
{
  "recommendations": [
    "Specific strategic recommendation 1...",
    "Specific strategic recommendation 2...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.recommendations || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini recommendations:', e);
      }

      return [];
    } catch (error) {
      console.error('Error generating team recommendations:', error);
      return [];
    }
  }

  /**
   * Generate project insights using AI analysis
   * @param data Project performance data
   * @param repositoryName Repository name
   * @param period Report period
   * @returns Array of insights
   */
  async generateProjectInsights(
    data: {
      commits: number;
      mergedCommits?: number;
      openCommits?: number;
      issuesFixed: number;
      openIssues: number;
      prsOpen?: number;
      prsMerged?: number;
      modules?: string[];
      commitAnalysis?: {
        features: Array<{
          description: string;
          module?: string;
          committer: string;
          commitCount: number;
        }>;
        fixes: Array<{
          description: string;
          module?: string;
          committer: string;
          commitCount: number;
        }>;
        improvements: Array<{
          description: string;
          module?: string;
          committer: string;
          commitCount: number;
        }>;
        otherTasks: Array<{
          description: string;
          module?: string;
          committer: string;
          commitCount: number;
        }>;
        summary: {
          totalFeatures: number;
          totalFixes: number;
          totalImprovements: number;
          totalOtherTasks: number;
        };
      };
    },
    repositoryName: string,
    period: { start: Date; end: Date },
  ): Promise<string[]> {
    try {
      const modulesText =
        data.modules && data.modules.length > 0
          ? `\n### Modules/Features Focus:\n- Top modules worked on: ${data.modules.slice(0, 5).join(', ')}`
          : '';

      // Build detailed commit analysis text
      let commitAnalysisText = '';
      if (data.commitAnalysis) {
        const ca = data.commitAnalysis;

        commitAnalysisText = `\n\n### 🎯 ACTUAL WORK COMPLETED - Commit Analysis:\n`;

        if (ca.features.length > 0) {
          commitAnalysisText += `\n**Features Implemented (${ca.summary.totalFeatures} total):**\n`;
          ca.features.slice(0, 5).forEach((feature, idx) => {
            commitAnalysisText += `${idx + 1}. ${feature.description}${feature.module ? ` (Module: ${feature.module})` : ''} - ${feature.committer} (${feature.commitCount} commits)\n`;
          });
        }

        if (ca.fixes.length > 0) {
          commitAnalysisText += `\n**Bugs Fixed (${ca.summary.totalFixes} total):**\n`;
          ca.fixes.slice(0, 5).forEach((fix, idx) => {
            commitAnalysisText += `${idx + 1}. ${fix.description}${fix.module ? ` (Module: ${fix.module})` : ''} - ${fix.committer} (${fix.commitCount} commits)\n`;
          });
        }

        if (ca.improvements.length > 0) {
          commitAnalysisText += `\n**Improvements Made (${ca.summary.totalImprovements} total):**\n`;
          ca.improvements.slice(0, 5).forEach((improvement, idx) => {
            commitAnalysisText += `${idx + 1}. ${improvement.description}${improvement.module ? ` (Module: ${improvement.module})` : ''} - ${improvement.committer} (${improvement.commitCount} commits)\n`;
          });
        }

        if (ca.otherTasks.length > 0 && ca.otherTasks.length <= 3) {
          commitAnalysisText += `\n**Other Tasks:**\n`;
          ca.otherTasks.slice(0, 3).forEach((task, idx) => {
            commitAnalysisText += `${idx + 1}. ${task.description}${task.module ? ` (Module: ${task.module})` : ''} - ${task.committer}\n`;
          });
        }
      }

      const prompt = `You are an expert Engineering Manager and Technical Analyst using Gemini 2.5 Pro for project/repository performance analysis.

Analyze the repository's weekly metrics and provide 3-5 key insights about project health, development velocity, code quality trends, and most importantly - WHAT THE TEAM ACTUALLY WORKED ON.

## Project Information:
- Repository: ${repositoryName}
- Period: ${period.start.toISOString().split('T')[0]} to ${period.end.toISOString().split('T')[0]}

## Project Performance Metrics:

### Development Activity:
- Total Commits: ${data.commits}
- Merged Commits: ${data.mergedCommits || 0}
- Open Commits: ${data.openCommits || 0}
- Activity Level: ${data.commits > 30 ? 'High' : data.commits > 15 ? 'Moderate' : 'Low'}

### Pull Request Status:
- Total PRs: ${(data.prsOpen || 0) + (data.prsMerged || 0)}
- Open PRs: ${data.prsOpen || 0}
- Merged PRs: ${data.prsMerged || 0}
- Merge Rate: ${data.prsMerged && data.prsOpen ? ((data.prsMerged / ((data.prsMerged || 0) + (data.prsOpen || 0))) * 100).toFixed(1) : 'N/A'}%

### Issue Management:
- Issues Fixed: ${data.issuesFixed}
- Open Issues: ${data.openIssues}
- Net Impact: ${data.issuesFixed - data.openIssues} (${data.issuesFixed > data.openIssues ? 'Positive - reducing debt' : data.issuesFixed < data.openIssues ? 'Negative - debt increasing' : 'Neutral'})${modulesText}${commitAnalysisText}

## Context:
- ${data.commits} commits this week (${data.mergedCommits || 0} merged, ${data.openCommits || 0} open) indicates ${data.commits > 30 ? 'active ongoing development' : data.commits > 15 ? 'steady progress' : 'minimal activity'}
${data.modules && data.modules.length > 0 ? `- **PRIMARY FOCUS**: The team focused primarily on these modules/features: ${data.modules.slice(0, 5).join(', ')}` : ''}
- These modules represent the core work completed during this period
${data.modules && data.modules.length > 0 ? `- Module distribution: ${data.modules.length} different modules/features were actively developed` : ''}
- Issue resolution ratio: ${data.openIssues > 0 ? (data.issuesFixed / data.openIssues).toFixed(2) : 'N/A'} (fixed/opened)

## Instructions:
1. **CRITICAL - LEAD WITH ACTUAL WORK**: Your FIRST insight MUST describe what the team actually built, fixed, or improved this week based on the commit analysis above
2. **FEATURES/FIXES/IMPROVEMENTS FOCUS**: Mention specific features implemented, bugs fixed, and improvements made from the commit analysis
3. **WHAT WAS DELIVERED**: Engineering managers care about deliverables - mention what was shipped, not just commit counts
4. Reference specific modules/features worked on (from modules list)
5. Mention key contributors and their contributions where relevant
6. Highlight development momentum and commit merge trends (secondary)
7. Note issue management effectiveness (tertiary)
8. Use professional, technical tone without markdown formatting
9. Be specific and concrete - mention actual features, fixes, or improvements by name when provided in commit analysis
10. Structure insights as:
    - Insight 1: WHAT was delivered (features/fixes/improvements)
    - Insight 2: Modules/areas focused on
    - Insight 3: Development velocity/momentum
    - Insight 4: Code quality/PRs (if relevant)
    - Insight 5: Issues/backlog (if relevant)
11. If commit analysis shows specific features/fixes, reference them directly (e.g., "Team implemented feature X and fixed bug Y")

## Output Format:
Return a JSON object with an "insights" array containing plain text strings (no markdown):
{
  "insights": [
    "Insight 1 about modules and activity...",
    "Insight 2 about PRs and commits...",
    "Insight 3 about issues and quality...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.insights || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini project insights:', e);
      }

      return [];
    } catch (error) {
      console.error('Error generating project insights:', error);
      return [];
    }
  }

  /**
   * Generate project recommendations using AI analysis
   * @param data Project performance data
   * @param repositoryName Repository name
   * @returns Array of recommendations
   */
  async generateProjectRecommendations(
    data: {
      issuesFixed: number;
      openIssues: number;
      commits: number;
      prsOpen?: number;
      prsMerged?: number;
      modules?: string[];
    },
    repositoryName: string,
  ): Promise<string[]> {
    try {
      const modulesText =
        data.modules && data.modules.length > 0
          ? `\n- Top Modules Worked On: ${data.modules.slice(0, 5).join(', ')}`
          : '';

      const prompt = `You are an expert Engineering Manager and Technical Advisor using Gemini 2.5 Pro to analyze project performance for the last 7 days and provide strategic, actionable recommendations.

Analyze the project metrics thoroughly and provide 3-5 specific, data-driven recommendations for the Project Manager or Tech Lead to improve repository health, development velocity, and code quality.

## Project Context:
- Repository: ${repositoryName}
- Period: Last 7 days (weekly report)
- Open Issues Backlog: ${data.openIssues}
- Issues Fixed This Week: ${data.issuesFixed}
- Total Commits: ${data.commits}
- Open PRs: ${data.prsOpen || 0}
- Merged PRs: ${data.prsMerged || 0}${modulesText}

## Current State Analysis:
- Issue Backlog Status: ${data.openIssues < 10 ? 'Healthy - well managed' : data.openIssues > 30 ? 'Critical - requires immediate attention' : 'Moderate - needs monitoring'}
- Fix Rate: ${data.issuesFixed} issues resolved this week (${data.issuesFixed > data.openIssues ? 'Positive - backlog reducing' : data.issuesFixed < data.openIssues ? 'Concerning - backlog growing' : 'Balanced - status quo'})
- Development Activity: ${data.commits} commits indicates ${data.commits > 30 ? 'high' : data.commits > 15 ? 'moderate' : 'low'} activity level
- PR Merge Status: ${data.prsMerged || 0} merged, ${data.prsOpen || 0} open (Merge rate: ${data.prsMerged && (data.prsOpen || data.prsMerged) ? ((data.prsMerged / ((data.prsMerged || 0) + (data.prsOpen || 0))) * 100).toFixed(1) : 'N/A'}%)
${modulesText ? `- Module Focus: ${modulesText.split('\n- Top Modules Worked On: ')[1] || 'Multiple modules'}` : ''}

## Analysis Instructions:
1. **Data-Driven Recommendations**: Base recommendations on actual metrics - identify specific problems or opportunities
2. **Prioritize by Impact**: Address critical issues first (backlog growth, low merge rates, etc.)
3. **Module-Specific Suggestions**: If modules are provided, suggest improvements specific to those areas
4. **PR Process Optimization**: If PRs are piling up, suggest review process improvements
5. **Issue Management Strategies**: If backlog is growing, provide concrete backlog management strategies
6. **Velocity Improvement**: Suggest ways to improve development velocity without sacrificing quality
7. **Technical Debt**: Identify areas of technical debt and suggest remediation approaches
8. **Actionable Steps**: Each recommendation should be implementable and specific
9. **Use Plain Text**: No markdown formatting, just clear recommendations

## Output Format:
Return a JSON object with a "recommendations" array containing plain text strings (no markdown):
{
  "recommendations": [
    "Specific, actionable recommendation 1 based on metrics...",
    "Detailed recommendation 2 addressing specific issue...",
    "Strategic recommendation 3 for improvement...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.recommendations || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini project recommendations:', e);
      }

      return [];
    } catch (error) {
      console.error('Error generating project recommendations:', error);
      return [];
    }
  }

  /**
   * Generate organization highlights using AI analysis
   * @param teams Array of team performance data
   * @param organizationName Organization name
   * @param period Report period
   * @returns Array of highlights
   */
  async generateProjectStatus(
    commits: Array<{
      commitMessage: string;
      committer: string;
      summary: any;
      module?: string;
      additions: number;
      deletions: number;
      totalFiles: number;
      isMerged: boolean;
    }>,
    repositoryName: string,
    period: { start: Date; end: Date },
  ): Promise<{
    status: string;
    mainFeatures: string[];
    modules: string[];
    summary: string;
  }> {
    try {
      // Extract commit summaries for analysis
      const commitSummaries = commits
        .slice(0, 50) // Limit to first 50 commits for token efficiency
        .map((commit) => {
          let summaryText = commit.commitMessage || '';
          if (commit.summary && typeof commit.summary === 'object') {
            try {
              const summary =
                typeof commit.summary === 'string'
                  ? JSON.parse(commit.summary)
                  : commit.summary;
              summaryText =
                summary.summary ||
                summary.description ||
                summary.changes ||
                commit.commitMessage ||
                '';
            } catch (e) {
              summaryText = commit.commitMessage || '';
            }
          }
          return {
            message: summaryText,
            committer: commit.committer,
            module: commit.module,
            additions: commit.additions,
            deletions: commit.deletions,
            files: commit.totalFiles,
          };
        });

      const prompt = `You are an expert Engineering Manager analyzing a software project's weekly development activity.

Analyze the commit summaries below and provide a comprehensive project status assessment.

## Project Information:
- Repository: ${repositoryName}
- Period: ${period.start.toISOString().split('T')[0]} to ${period.end.toISOString().split('T')[0]}
- Total Commits Analyzed: ${commits.length}

## Commit Summaries:
${commitSummaries
  .map(
    (c, idx) => `${idx + 1}. Committer: ${c.committer}
   Module: ${c.module || 'N/A'}
   Summary: ${c.message.substring(0, 200)}
   Changes: +${c.additions}/-${c.deletions} lines, ${c.files} files`,
  )
  .join('\n\n')}

## Instructions:
1. Determine overall project status (e.g., "Active Development", "Stable", "High Activity", "Maintenance Mode")
2. Extract the main features/functionalities worked on during this period (3-5 key features)
3. List all modules/components that received significant work (5-8 modules)
4. Provide a concise summary (2-3 sentences) of the project's current state and focus areas

## Output Format:
Return a JSON object:
{
  "status": "Active Development",
  "mainFeatures": ["Feature 1", "Feature 2", ...],
  "modules": ["Module 1", "Module 2", ...],
  "summary": "Brief summary of project status and focus..."
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          status: parsed.status || 'Active',
          mainFeatures: Array.isArray(parsed.mainFeatures)
            ? parsed.mainFeatures
            : [],
          modules: Array.isArray(parsed.modules) ? parsed.modules : [],
          summary: parsed.summary || 'Project is in active development.',
        };
      }

      return {
        status: 'Active',
        mainFeatures: [],
        modules: [],
        summary: 'Project is in active development.',
      };
    } catch (error) {
      console.error('Error generating project status:', error);
      return {
        status: 'Active',
        mainFeatures: [],
        modules: [],
        summary: 'Project is in active development.',
      };
    }
  }

  async generateOrganizationHighlights(
    teams: Array<{
      teamName: string;
      performance: string;
      keyMetrics: {
        commits: number;
        issuesFixed: number;
        velocity: number;
      };
    }>,
    organizationName: string,
    period: { start: Date; end: Date },
  ): Promise<string[]> {
    try {
      const prompt = `You are a CTO analyzing organization-wide engineering performance for executive reporting.

Analyze the performance across all teams and provide 4-6 strategic highlights that showcase organizational health, achievements, and notable patterns. This will be shared with executive leadership.

## Organization Context:
- Organization: ${organizationName}
- Period: ${period.start.toISOString().split('T')[0]} to ${period.end.toISOString().split('T')[0]}
- Total Teams: ${teams.length}

## Team Performance Summary:
${teams
  .map(
    (t, i) => `
Team ${i + 1}: ${t.teamName}
- Performance Rating: ${t.performance}
- Commits: ${t.keyMetrics.commits}
- Issues Fixed: ${t.keyMetrics.issuesFixed}
- Velocity: ${t.keyMetrics.velocity} commits/week
`,
  )
  .join('\n')}

## Aggregate Metrics:
- Total Teams: ${teams.length}
- Total Commits Across All Teams: ${teams.reduce((sum, t) => sum + t.keyMetrics.commits, 0)}
- Total Issues Fixed: ${teams.reduce((sum, t) => sum + t.keyMetrics.issuesFixed, 0)}
- Teams Performing Excellently: ${teams.filter((t) => t.performance === 'excellent').length}
- Teams Needing Attention: ${teams.filter((t) => t.performance === 'needs_attention').length}

## Instructions:
1. Provide 4-6 executive-level highlights
2. Celebrate achievements and top performers
3. Identify organizational patterns and trends
4. Note any strategic concerns
5. Use professional, C-suite appropriate language
6. Focus on business impact and engineering excellence
7. Be concise and impactful

## Output Format:
{
  "highlights": [
    "Executive highlight 1...",
    "Executive highlight 2...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.highlights || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini highlights:', e);
      }

      return [];
    } catch (error) {
      console.error('Error generating organization highlights:', error);
      return [];
    }
  }

  /**
   * Generate organization recommendations using AI analysis
   * @param teams Array of team performance data
   * @param organizationName Organization name
   * @returns Array of recommendations
   */
  async generateOrganizationRecommendations(
    teams: Array<{
      teamName: string;
      performance: string;
      keyMetrics: {
        commits: number;
        issuesFixed: number;
        velocity: number;
      };
    }>,
    organizationName?: string,
  ): Promise<string[]> {
    try {
      const needsAttention = teams.filter(
        (t) => t.performance === 'needs_attention',
      );
      const excellent = teams.filter((t) => t.performance === 'excellent');
      const average = teams.filter((t) => t.performance === 'average');

      const prompt = `You are a CTO providing strategic recommendations for organization-wide engineering improvements.

Analyze the performance distribution across teams and provide 3-5 strategic recommendations for executive leadership. Focus on organizational-level improvements and resource allocation.

## Organization Performance Distribution:
- Total Teams: ${teams.length}
- Teams Performing Excellently: ${excellent.length}
- Teams Performing Well: ${average.length}
- Teams Needing Attention: ${needsAttention.length}

## Team Performance Details:
${teams
  .map(
    (t) => `
- ${t.teamName}: ${t.performance} (${t.keyMetrics.commits} commits, ${t.keyMetrics.issuesFixed} issues fixed, velocity: ${t.keyMetrics.velocity})
`,
  )
  .join('')}

## Current State Analysis:
- ${((excellent.length / teams.length) * 100).toFixed(0)}% of teams performing excellently
- ${((needsAttention.length / teams.length) * 100).toFixed(0)}% of teams need attention
- Average team velocity: ${(teams.reduce((sum, t) => sum + t.keyMetrics.velocity, 0) / teams.length).toFixed(1)} commits/week

## Instructions:
1. Provide 3-5 strategic, organization-level recommendations
2. Focus on cross-team improvements and resource allocation
3. Consider scaling successful patterns from top teams
4. Address systemic issues affecting multiple teams
5. Be specific and actionable for C-suite decision making
6. Reference team data when relevant

## Output Format:
{
  "recommendations": [
    "Strategic organizational recommendation 1...",
    "Strategic organizational recommendation 2...",
    ...
  ]
}`;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.recommendations || [];
        }
      } catch (e) {
        console.warn('Failed to parse Gemini org recommendations:', e);
      }

      return [];
    } catch (error) {
      console.error('Error generating AI org recommendations:', error);
      return [];
    }
  }
}
