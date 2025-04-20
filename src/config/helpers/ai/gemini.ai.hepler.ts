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
      //     const prompt = `
      // You are an AI code assistant helping a technical intern understand a codebase.
      // For this you need to understand the context of the query, weather the query is related to any specific feature of the component or belongs to the overall functionality of the codebase.
      // If the query is related to a specific feature or component, then return {context: null}.
      // If the query is related to the overall functionality of the codebase, the Identify the Tag the Query is about, Related Tags, must be any of them.

      // Incase User ask about project impact, project Summary, project Purpose, it means to understand the overall functionality of the codebase, which is more likely identify by code files.
      // Incase User ask about project design, project architecture, it means to understand the overall functionality of the codebase.
      // Incase User ask about project structure, project architecture, it means to understand the overall functionality of the codebase.
      // ** for the Frontend project you might check routes/router or related tag that show of routes management file
      // ** for the Backend project you might check tags that refer DB model

      // ${suggestedTags}

      // Provide a response strictly in the following JSON format with no extra text, and should pass JSON.parse():

      //   {
      //     "context": "<project context identified> like User is asking about DB design, Project summary",
      //     "tag": "tag",
      //     "relatedTags": ["tag1", "tag2"]
      //   }

      //   Query: ${query}

      //   I want exact JSON response No '''json  '''.
      //   `;

      const prompt = `
          You are an AI code assistant helping a technical intern understand a codebase.

          Your primary task is to analyze the intern's query and determine if it pertains to a specific feature or the overall functionality of the codebase.

          **Context Determination:**
          - If the query relates to a particular feature, component, or specific code section, return:
            \`\`\`json
            {
              "context": null
            }
            \`\`\`
          - If the query pertains to the overall functionality, identify the most relevant tag representing the user's inquiry and suggest related tags from the provided list.

          **Identifying Overall Functionality Queries:**
          - Questions about the project's impact, summary, purpose, or business outcomes indicate an interest in the overall functionality.
          - Questions about the project's design, architecture, or structure also indicate an interest in the overall functionality.

          **Tagging Guidelines:**
          - Identify the single most appropriate tag that directly addresses the user's query about the overall functionality.
          - Suggest up to two additional related tags that could provide further helpful context.
          - **Frontend Projects:** Consider tags related to routing (e.g., "UI Routes", "Navigation Flow") if the query seems related to user journeys or application structure.
          - **Backend Projects:** Consider tags related to data models (e.g., "Data Models", "Database Schema") if the query touches upon data or relationships.

          **Provided Tags:**
          ${suggestedTags}

          **Query Analysis:**
          Query: ${query}

          **Response Format:**
          Return a JSON object strictly adhering to the following format (no extra text or markdown outside the JSON):
          \`\`\`json
          {
            "context": "<brief description of the overall functionality aspect the user is asking about, e.g., 'User is asking about the project's purpose', 'User is asking about the high-level structure of the application'>",
            "tag": "<most relevant tag from the provided list>",
            "relatedTags": ["<related tag 1>", "<related tag 2>"]
          }
          \`\`\`
        `;

      // Traits: Expert, helpful, kind, inspiring, detailed, and articulate.
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
  You are an AI code assistant helping a technical intern in understanding, debugging and assisting them in their tasks in the context of a codebase.
  
  Traits: Expert, helpful, kind, inspiring, detailed, and articulate.
  
  Only respond based on provided context. If not found, say: "I'm sorry, but I don't know the answer to that question."
  
  Answer in **markdown syntax**. Include code snippets if needed. Be as clear and specific as possible.
  
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
      You are an AI code assistant helping a technical intern understand a codebase.  
      For this you need to understand the context of the query, based on the query you have to filter the unnecessary files to make the context strong for future queries.
      You will receive a query and a list of files, each file have {fileName, filePath, tags, summary} so you can take better decision you have to filter the files based on the query.
    
      Provide a response strictly in the following JSON format with no extra text, and should pass JSON.parse():
      
         [{
          "fileName": "<project context identified> file name that you think is valid for the query analysis",
        }]
    
        Query: ${query}
        Files: ${JSON.stringify(files)}
    
        I want exact JSON response No '''json  '''.
        `;

      // Traits: Expert, helpful, kind, inspiring, detailed, and articulate.
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
