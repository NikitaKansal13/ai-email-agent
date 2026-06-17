const summarizeEmail = require("./summarizer");

const fs = require("fs").promises;
const path = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

const PROCESSED_PATH = path.join(process.cwd(), "processed.json");
const LOG_PATH = path.join(process.cwd(), "log.json");

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

function getAttachments(payload) {
  const attachments = [];

  function checkParts(parts) {
    if (!parts) return;

    for (const part of parts) {
      if (part.filename && part.filename.length > 0) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
        });
      }

      if (part.parts) {
        checkParts(part.parts);
      }
    }
  }

  checkParts(payload.parts);
  return attachments;
}

function categorizeEmail(subject, from, body) {
  const text = `${subject} ${from} ${body}`.toLowerCase();

  if (text.includes("invoice") || text.includes("payment") || text.includes("receipt")) {
    return "invoice";
  }

  if (text.includes("newsletter") || text.includes("unsubscribe")) {
    return "newsletter";
  }

  if (text.includes("support") || text.includes("ticket") || text.includes("issue")) {
    return "support";
  }

  if (text.includes("internship") || text.includes("interview") || text.includes("job") || text.includes("meeting")) {
    return "work";
  }

  return "personal";
}

function getTone(category) {
  if (category === "work") return "professional";
  if (category === "support") return "brief and helpful";
  if (category === "personal") return "friendly";
  if (category === "invoice") return "formal";
  return "brief";
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

async function loadProcessedEmails() {
  try {
    const content = await fs.readFile(PROCESSED_PATH, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveProcessedEmails(processedIds) {
  await fs.writeFile(PROCESSED_PATH, JSON.stringify(processedIds, null, 2));
}

async function writeLog(entry) {
  let logs = [];

  try {
    const content = await fs.readFile(LOG_PATH, "utf8");
    logs = JSON.parse(content);
  } catch {
    logs = [];
  }

  logs.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });

  await fs.writeFile(LOG_PATH, JSON.stringify(logs, null, 2));
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
  const processedEmails = await loadProcessedEmails(); //skip already processed email to avoid duplicate

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

    const body = getBody(email.data.payload);
    const attachments = getAttachments(email.data.payload);

    const category = categorizeEmail(subject, from, body);
    const tone = getTone(category);


   const lowerFrom = from.toLowerCase();
   const lowerSubject = subject.toLowerCase();

   if (processedEmails.includes(msg.id)) {
  console.log("Skipping already processed email:", msg.id);
  continue;
}

processedEmails.push(msg.id);
await saveProcessedEmails(processedEmails);


await writeLog({
  messageId: msg.id,
  from,
  subject,
  category: "skipped",
  action: "skipped automated or low-priority email",
});

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



// if (category === "newsletter") {
//   console.log("Skipping newsletter...");
//   continue;
// }


const aiOutput = await summarizeEmail(body, category, tone, attachments);

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

  await writeLog({
  messageId: msg.id,
  from,
  subject,
  category,
  action: "processed",
});

}



// listUnreadEmails().catch(console.error);
if (require.main === module) {
  listUnreadEmails().catch(console.error);
}

module.exports = {
  listUnreadEmails,
};