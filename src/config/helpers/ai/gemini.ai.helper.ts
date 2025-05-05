import { GoogleGenerativeAI } from '@google/generative-ai';

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
    return {
      output: files.slice(0, 5).map((file) => ({
        fileName: file.fileName || file.name,
        relevance: 0.8,
      })),
    };
  }

  /**
   * Generate an answer based on the query and relevant files
   * @param query User query
   * @param files Relevant files with their content
   * @returns AI response with references
   */
  async generateAnswer(input: string, result) {
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
}
