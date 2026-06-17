require("dotenv").config();
 
const { GoogleGenerativeAI } = require("@google/generative-ai");
 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
 
async function summarizeEmail(body, category, tone, attachments) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
  });
 
  // Format attachment list for the prompt
  const attachmentInfo =
    attachments.length > 0
      ? attachments.map((a) => `${a.filename} (${a.mimeType})`).join(", ")
      : "No attachments";
 
  // Guard: if body is empty (e.g. getBody() returned ""), tell the AI explicitly
  // so it doesn't hallucinate a summary of nothing
  const emailContent = body.trim() || "(No email body could be extracted)";
 
  const prompt = `
You are an AI email assistant.
 
Email category: ${category}
Reply tone: ${tone}
Attachments: ${attachmentInfo}
 
Tasks:
1. Give urgency score from 1 to 10.
2. Categorize the email as work, newsletter, invoice, support, personal, or other.
3. Summarize the email in 3 short bullet points.
4. Generate a ${tone} reply only if a reply is needed.
5. If attachments exist, mention them in the summary.
 
Email:
${emailContent}
`;
 
  const result   = await model.generateContent(prompt);
  const response = await result.response;
 
  return response.text();
}
 
module.exports = summarizeEmail;