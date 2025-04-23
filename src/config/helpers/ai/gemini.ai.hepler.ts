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

export class Gemini {
  async getEmbeddings(text: string) {
    // For embeddings, use the Text Embeddings model
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    const result = await model.embedContent(text);
    const embedding = result.embedding;
    return embedding.values as number[];
  }

  async getQueryContext(query: string, suggestedTags: string) {
    try {
      const prompt = `
          You are an AI code assistant helping technical team members understand a codebase.

          Your primary task is to analyze the query and determine if it pertains to a specific feature or the overall functionality of the codebase.

          **Context Determination:**
          - If the query relates to a particular feature, component, or specific code section, return:
            \`\`\`json
            {
              "context": null
            }
            \`\`\`
          - If the query pertains to the overall functionality, identify the most relevant tag representing the user's inquiry and suggest related tags from the provided list.

          **Identifying Overall Functionality Queries:**
          - Questions about the project's purpose, business domain, target users, or competitive advantages indicate holistic interest.
          - Questions about the project's impact, summary, high-level architecture, or business outcomes indicate an interest in the overall functionality.
          - Questions containing terms like "why was this built", "what problem does it solve", "what makes it unique", "who uses this" signal holistic understanding needs.

          **Tagging Guidelines:**
          - Identify the single most appropriate tag that directly addresses the user's query about the overall functionality.
          - Suggest up to two additional related tags that could provide further helpful context.
          - **Frontend Projects:** Consider tags related to routing and UI components if the query seems related to user experience or application structure.
          - **Backend Projects:** Consider tags related to data models and services if the query touches upon data or business logic.

          **Provided Tags:**
          ${suggestedTags}

          **Query Analysis:**
          Query: ${query}

          **Response Format:**
          Return a JSON object strictly adhering to the following format (no extra text or markdown outside the JSON):
          \`\`\`json
          {
            "context": "<brief description of the overall functionality aspect the user is asking about, e.g., 'User is asking about the project's purpose', 'User is asking about the target users'>",
            "tag": "<most relevant tag from the provided list>",
            "relatedTags": ["<related tag 1>", "<related tag 2>"]
          }
          \`\`\`
        `;

      let resp: any = await model.generateContent([prompt]);
      resp = this.extractCleanJSON(
        resp.response.candidates[0].content.parts[0].text,
      );

      return {
        output: resp,
      };
    } catch (error) {
      console.error('getQueryContext error:', error.message);
      throw new Error('Failed to get query context');
    }
  }

  async generateAnswer(input: string, result) {
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

      let resp = await model.generateContent([prompt]);

      return {
        output: resp,
        filesReferenced: result,
      };
    } catch (err) {
      console.error('generateAnswer error:', err.message);
      throw new Error('Failed to generate answer');
    }
  }

  async filterRelevantFiles(query: string, files: any[]) {
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

  //

  async analyzeFile(file: { name: string; content: string }) {
    const prompt = `You are an AI specializing in **deeply structured file analysis**. Your task is to analyze a given file and generate documentation in **JSON format**, maintaining a **nested structure** for classes, functions, React/Vue components, and their internal details.

        ## **Schema:**
        {
          "summary": "**Detailed markdown-formatted string explanation** of the file, including:
            - 📌 **Purpose**: Why this file exists and what problem it solves.
            - 🔗 **Where is this used?**: Mention direct dependencies & where it's referenced.
            - 💡 **Key Insights**: Best practices, optimizations, and internal logic.
            - ⚠ **Common Gotchas**: Mistakes to avoid & debugging hints.
            - 🚀 **Potential Enhancements**: How this file can be improved.
          ",
          "functions": [
            {
              "name": "FunctionName",
              "description": "Detailed explanation of what this function does.",
              "parameters": [
                {
                  "name": "param1",
                  "type": "Type",
                  "description": "Explanation of this parameter."
                }
              ],
              "returnType": "Type",
              "relatedFunctions": ["Other related functions"],
              "invokedIn": ["List of places where this function is used"]
            }
          ],
          "classes": [
            {
              "name": "ClassName",
              "description": "Purpose of this class and its role in the project.",
              "properties": [
                {
                  "name": "PropertyName",
                  "type": "Type",
                  "description": "What this property stores."
                }
              ],
              "methods": [
                {
                  "name": "MethodName",
                  "description": "What this method does.",
                  "parameters": [
                    {
                      "name": "param1",
                      "type": "Type",
                      "description": "Explanation of this parameter."
                    }
                  ],
                  "returnType": "Type",
                  "calls": ["Other functions/methods this method calls"],
                  "invokedIn": ["Places where this method is used"]
                }
              ],
              "extends": "ParentClass (if applicable)"
            }
          ],
          "components": [
            {
              "name": "ComponentName",
              "description": "Purpose of this React/Vue component.",
              "props": [
                {
                  "name": "PropName",
                  "type": "Type",
                  "description": "What this prop does."
                }
              ],
              "state": [
                {
                  "name": "StateVariable",
                  "type": "Type",
                  "description": "Explanation of this state."
                }
              ],
              "hooks": [
                {
                  "name": "HookName",
                  "description": "What this hook is used for."
                }
              ],
              "eventHandlers": [
                {
                  "name": "handleEvent",
                  "description": "What this handler does."
                }
              ],
              "renders": ["List of other components this component renders"]
            }
          ],
          "relations": {
            "imports": ["List of imported modules/files"],
            "exports": ["List of exported modules/functions/classes/components"],
            "dependencies": ["External libraries or internal files it depends on"]
          },
          "tags": ["CONTROLLER" | "SERVICE" | "SCHEMA" | "MIGRATION" | "REPOSITORY" | "CONFIG" | "CONSTANTS" | "MIDDLEWARE" | "UTILITY" | "JOB" | "MODULE" | "ASSETS" | "DOCUMENTATION" | "TEST" | "EVENT_HANDLER" | "LOGGING" | "PROJECT_SETUP"] // max 3 tags, Most relevant tag should be First
        }

        ***I want exact JSON response No '''json  '''.*** 
        \\\
          File: ${file.name}\nContent:\n${file.content}
        \\\
      `;

    let output;
    try {
      // @ts-ignore
      let resp: any = await model.generateContent([prompt]);
      resp = this.extractCleanJSON(
        resp.response.candidates[0].content.parts[0].text,
      );

      // Return the parsed JSON response
      return resp;
    } catch (error) {
      console.error(
        `Error processing the code files(analyzeFile): 
        error: ${error}
        output: ${output}`,
      );
      throw new Error(
        `Error while generating code review. ${error}, file.name ${file.name} object: ${output}`,
      );
    }
  }
}
