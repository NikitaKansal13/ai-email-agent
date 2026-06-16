require("dotenv").config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function summarizeEmail(body) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
  });

  const prompt = `
You are an AI email assistant.

Summarize this email in 3 short bullet points.
Then write a professional suggested reply.

Email:
${body}
`;

  const result = await model.generateContent(prompt);
  const response = await result.response;

  return response.text();
}

module.exports = summarizeEmail;