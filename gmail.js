const summarizeEmail = require("./summarizer");
const fs = require("fs").promises;
const path = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

function getBody(payload) {
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf8");
      }
    }
  }

  return "";
}

function extractEmail(from) {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}

async function markAsRead(gmail, messageId) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });

  console.log("Email marked as read.");
}

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });

  await fs.writeFile(TOKEN_PATH, payload);
}

async function authorize() {
  let client = await loadSavedCredentialsIfExist();

  if (client) {
    return client;
  }

  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  if (client.credentials) {
    await saveCredentials(client);
  }

  return client;
}



async function listUnreadEmails() {
  const auth = await authorize();

  const gmail = google.gmail({
    version: "v1",
    auth,
  });

  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread",
    maxResults: 15,
  });

  const messages = res.data.messages || [];

  console.log(`Found ${messages.length} unread emails`);

  for (const msg of messages) {
    const email = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const headers = email.data.payload.headers || [];

    const from = headers.find((h) => h.name === "From")?.value || "Unknown";
    const subject = headers.find((h) => h.name === "Subject")?.value || "No Subject";

   const lowerFrom = from.toLowerCase();
const lowerSubject = subject.toLowerCase();

if (
  lowerFrom.includes("noreply") ||
  lowerFrom.includes("no-reply") ||
  lowerFrom.includes("accounts.google.com") ||
  lowerFrom.includes("linkedin.com") ||
  lowerSubject.includes("otp") ||
  lowerSubject.includes("verification") ||
  lowerSubject.includes("verify") ||
  lowerSubject.includes("sign in") ||
  lowerSubject.includes("login") ||
  lowerSubject.includes("security alert") ||
  lowerSubject.includes("password")
) {
  console.log("Skipping OTP/security/automated email...");
  continue;
}

const body = getBody(email.data.payload);

const aiOutput = await summarizeEmail(body);

console.log("\nAI SUMMARY + REPLY:");
console.log(aiOutput);

// Create Gmail Draft
await createDraft(
  gmail,
  extractEmail(from),
  subject,
  aiOutput,
  email.data.threadId
);

await markAsRead(gmail, msg.id);

    console.log("\n----------------");
    console.log("From:", from);
    console.log("Subject:", subject);
    console.log("Body:");
    console.log(body.slice(0, 500));

    
  }

  
  
}

function createEmailRaw(to, subject, message, threadId) {
  const emailLines = [
    `To: ${to}`,
    `Subject: Re: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    message,
  ];

  const email = emailLines.join("\n");

  return Buffer.from(email)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createDraft(gmail, to, subject, replyText, threadId) {
  const raw = createEmailRaw(to, subject, replyText, threadId);

  await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw,
        threadId,
      },
    },
  });

  console.log("Draft created successfully.");
}

listUnreadEmails().catch(console.error);