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
  async processCodeFiles(codes: { name: string; content: string }[]) {
    // Start a chat session with an initial empty history
    const chatSession = model.startChat({
      generationConfig,
      history: [],
    });

    // Step 1: Send the initial prompt
    await chatSession.sendMessage(
      `You are an AI assistant specializing in providing detailed, high-level code reviews. Your task is to analyze the provided code files holistically, identifying areas related to security, code quality, and overall software design. Focus on the code's structure, best practices, performance considerations, and maintainability.
                
                For each provided file, please review the following areas:
                1. **Security Issues**: Identify any potential vulnerabilities or concerns.
                2. **Code Quality**: Provide feedback on key aspects of the code, such as its consistency, readability, efficiency, maintainability, and scalability.
                
                Please provide the review in the following JSON format, consolidating feedback from all files after the analysis is complete:
                
                {
                  "securityIssues": {
                    "codeSecurity": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '},
                    "encryptionStrength": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '},
                    "inputValidation": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '}
                  },
                  "codeQuality": {
                    "consistency": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '},
                    "readability": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '},
                    "efficiency": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '},
                    "maintainability": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '},
                    "scalability": {rate: <1(lowest) - 10(Highest)>, reason: 'Generic reason in summarized manner, do not target any specific component '}
                  },
                  "rating": <1-10>
                }
                
                **Guidelines:**
                - **Rating Scale**:
                    1 - Poor: Major issues, code is not suitable for production.
                    2 - Needs Improvement (Major): Significant issues affecting functionality, performance, or security, making the code unreliable for production.
                    3 - Needs Improvement (Minor): Works but has minor issues that affect stability or performance; requires attention for better maintainability.
                    4 - Average: Functional but lacks refinement; needs improvements in design, performance, or documentation.
                    5 - Average (Good Foundation): Sound code with some adherence to best practices; requires structural or performance refinements.
                    6 - Average (Solid with Minor Tweaks): Generally solid code; only minor adjustments needed for optimization or clarity.
                    7 - Good: Clean, maintainable code with good structure, clear documentation, and adherence to best practices.
                    8 - Very Good: Well-organized, efficient, and production-ready code with strong error handling and performance.
                    9 - Exceptional: Highly maintainable, efficient, secure code following best practices and designed for scalability.
                    10 - Outstanding: Flawless code with optimal performance, robust security, extensive testing, and future-proof design.
                
                **Important Notes**:
                  1. Provide only the necessary feedback in the specified JSON format, without extra commentary, explanations, or details outside of the JSON object.
                  2. Ensure that the review reflects a comprehensive analysis of the entire provided code, rather than specific functions or isolated code blocks.
                  3. Focus on the overall structure, design, and best practices, providing high-level insights rather than micromanaging specific lines of code
                  4. Respond in valid JSON format without extra characters or explanations outside the JSON object.
                  5. Do not include any explanation, Just required JSON format starting from "{", ending at "}"
                
                Your review should consider how the code would perform in real-world scenarios, its alignment with industry standards, and its adaptability to future changes and scaling.
                `,
    );

    // Step 2: Send files (each file is a separate message)
    for (let file of codes) {
      await chatSession.sendMessage(
        `File: ${file.name}\nContent:\n${file.content}`,
      );
    }

    // Step 3: Send a follow-up request after files
    const result = await chatSession.sendMessage(
      'Please provide an analysis of these files.',
    );
    console.log(result);
    console.log(result.response.text()); // Model's analysis response
    return JSON.parse(result.response.text());
  }
}
