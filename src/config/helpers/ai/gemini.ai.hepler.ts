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
  You are an AI code assistant helping a technical intern understand a codebase.  
  For this you need to understand the context of the query, weather the query is related to any specific feature of the component or belongs to the overall functionality of the codebase.
  If the query is related to a specific feature or component, then return {context: null}.
  If the query is related to the overall functionality of the codebase, the Identify the Tag the Query is about, Related Tags, must be any of them.
  ${suggestedTags}

  Provide a response strictly in the following JSON format with no extra text, and should pass JSON.parse():
  
    {
      "context": "<project context identified> like User is asking about DB design, Project summary",
      "tag": "tag",
      "relatedTags": ["tag1", "tag2"]
    }

    Query: ${query}


    I want exact JSON response No '''json  '''.
    `;

      // Traits: Expert, helpful, kind, inspiring, detailed, and articulate.
      let resp: any = await model.generateContent([prompt]);
      console.log(
        'Gemini response:',
        resp.response.candidates[0].content.parts[0].text,
        JSON.stringify(
          resp.response.candidates[0].content.parts[0].text,
          null,
          2,
        ),
      );
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
      console.log(
        'Gemini response:',
        resp.response.candidates[0].content.parts[0].text,
        JSON.stringify(
          resp.response.candidates[0].content.parts[0].text,
          null,
          2,
        ),
      );
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

  async summarizer(answer: string) {
    const prompt = `
      You are a world-class senior software engineer and technical writer. Your task is to distill the entire conversation context and render it into a concise, yet comprehensive summary. This summary must capture all vital points, decisions, clarifications, and technical insights from the provided answer. It will later be used to maintain continuity in future discussions, so ensure that every nuance is preserved.

      Please follow these guidelines:
      - **Clarity & Precision:** Ensure that the summary covers the core discussion points, highlighting the key technical requirements, challenges, and decisions.
      - **Detailed & Articulate:** Expand on aspects that are critical for understanding the overall context of the discussion while using clear, simple language.
      - **Inspiration & Professionalism:** Your tone should be encouraging and authoritative, providing a sense of confidence to the reader.
      - **Markdown Format:** Structure your output in Markdown. Use headers, bullet points, and code blocks where appropriate for better readability.
      - **Context Awareness:** The summary should reflect a deep understanding of the complete conversation, integrating all crucial insights cohesively.
      - **Summarize the conversation:** Ensure that the summary captures the essence of the discussion, highlighting the key points, decisions, and challenges. Keep it under 300 words

      Below is the conversation you need to analyze:

      \`\`\`
      ${answer}
      \`\`\`

      Respond with the final summary in **Markdown** format.
      `;

    // Traits to guide the model’s output: Expert, helpful, kind, inspiring, detailed, and articulate.
    let resp: any = await model.generateContent([prompt]);
    // resp = this.extractCleanJSON(
    //   resp.response.candidates[0].content.parts[0].text,
    // );

    return {
      output: resp,
    };
  }
}
