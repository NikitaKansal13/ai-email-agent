const summarizeEmail = require("./summarizer");
 
const fs      = require("fs").promises;
const path    = require("path");
const process = require("process");
const { authenticate } = require("@google-cloud/local-auth");
const { google }       = require("googleapis");
 
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
 
const TOKEN_PATH       = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const PROCESSED_PATH   = path.join(process.cwd(), "processed.json");
const LOG_PATH         = path.join(process.cwd(), "log.json");
 
// ─── getBody ─────────────────────────────────────────────────────────────────
function getBody(payload) {
  // Case 1: body data is directly on this part (simple emails)
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  }
 
  // Case 2: multipart — search parts recursively (same pattern as getAttachments)
  if (payload.parts) {
    for (const part of payload.parts) {
      // Found a plain text part directly
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf8");
      }
 
      // Found a nested multipart — recurse into it
      if (part.mimeType && part.mimeType.startsWith("multipart/")) {
        const nested = getBody(part);
        if (nested) return nested;
      }
    }
  }
 
  return "";
}
 
// ─── getAttachments ───────────────────────────────────────────────────────────
function getAttachments(payload) {
  const attachments = [];
 
  function checkParts(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.filename.length > 0) {
        attachments.push({ filename: part.filename, mimeType: part.mimeType });
      }
      if (part.parts) checkParts(part.parts);
    }
  }
 
  checkParts(payload.parts);
  return attachments;
}
 
// ─── categorizeEmail ──────────────────────────────────────────────────────────
//  keyword-based categorization
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
  if (
    text.includes("internship") ||
    text.includes("interview") ||
    text.includes("job") ||
    text.includes("meeting")
  ) {
    return "work";
  }
  return "personal";
}
 
// ─── getTone ──────────────────────────────────────────────────────────────────
function getTone(category) {
  if (category === "work")    return "professional";
  if (category === "support") return "brief and helpful";
  if (category === "personal") return "friendly";
  if (category === "invoice") return "formal";
  return "brief";
}
 
// ─── extractEmail ─────────────────────────────────────────────────────────────
function extractEmail(from) {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}
 
// ─── markAsRead ───────────────────────────────────────────────────────────────
async function markAsRead(gmail, messageId) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
  console.log("Email marked as read.");
}
 
// ─── loadProcessedEmails ──────────────────────────────────────────────────────
async function loadProcessedEmails() {
  try {
    const content = await fs.readFile(PROCESSED_PATH, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}
 
// ─── saveProcessedEmails ──────────────────────────────────────────────────────
//  cap the list at 500 entries so it doesn't grow forever
async function saveProcessedEmails(processedIds) {
  // Keep only the most recent 500 IDs to prevent unbounded file growth
  const trimmed = processedIds.slice(-500);
  await fs.writeFile(PROCESSED_PATH, JSON.stringify(trimmed, null, 2));
}
 
// ─── writeLog ─────────────────────────────────────────────────────────────────
// Takes { messageId, from, subject, category, action } and appends to log.json
async function writeLog(entry) {
  let logs = [];
  try {
    const content = await fs.readFile(LOG_PATH, "utf8");
    logs = JSON.parse(content);
  } catch {
    logs = [];
  }
 
  logs.push({ timestamp: new Date().toISOString(), ...entry });
 
  await fs.writeFile(LOG_PATH, JSON.stringify(logs, null, 2));
}
 
// ─── Auth helpers ─────────────────────────────────────────────────────────────
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    return google.auth.fromJSON(JSON.parse(content));
  } catch {
    return null;
  }
}
 
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys    = JSON.parse(content);
  const key     = keys.installed || keys.web;
 
  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify({
      type:          "authorized_user",
      client_id:     key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    })
  );
}
 
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) return client;
 
  client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
  if (client.credentials) await saveCredentials(client);
  return client;
}
 
// ─── createEmailRaw ───────────────────────────────────────────────────────────
function createEmailRaw(to, subject, message) {
  const emailLines = [
    `To: ${to}`,
    `Subject: Re: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    message,
  ];
 
  return Buffer.from(emailLines.join("\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
 
// ─── createDraft ─────────────────────────────────────────────────────────────
// category were all undefined in this function's scope → would throw ReferenceError
// Logging now happens in listUnreadEmails() where all variables are in scope
async function createDraft(gmail, to, subject, replyText, threadId) {
  const raw = createEmailRaw(to, subject, replyText);
 
  await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw, threadId },
    },
  });
 
  console.log("Draft created successfully.");
  // No writeLog here — caller (listUnreadEmails) handles logging
}
 
// ─── isAutomated ─────────────────────────────────────────────────────────────
// Extracted the filter into its own function for clarity
function isAutomated(from, subject) {
  const lf = from.toLowerCase();
  const ls = subject.toLowerCase();
 
  return (
    lf.includes("noreply")             ||
    lf.includes("no-reply")            ||
    lf.includes("accounts.google.com") ||
    lf.includes("linkedin.com")        ||
    ls.includes("otp")                 ||
    ls.includes("verification")        ||
    ls.includes("verify")              ||
    ls.includes("sign in")             ||
    ls.includes("login")               ||
    ls.includes("security alert")      ||
    ls.includes("password")
  );
}
 
// ─── listUnreadEmails ────────────────────────────────────────────────────────
async function listUnreadEmails() {
  const auth  = await authorize();
  const gmail = google.gmail({ version: "v1", auth });
 
  const processedEmails = await loadProcessedEmails();
 
  const res = await gmail.users.messages.list({
    userId:     "me",
    q:          "is:unread",
    maxResults: 15,
  });
 
  const messages = res.data.messages || [];
  console.log(`Found ${messages.length} unread emails`);
 
  for (const msg of messages) {
    // ── Skip already-processed emails ──────────────────────────────────────
    if (processedEmails.includes(msg.id)) {
      console.log("Skipping already processed email:", msg.id);
      continue;
    }
 
    // ── Fetch full email ────────────────────────────────────────────────────
    const email = await gmail.users.messages.get({
      userId: "me",
      id:     msg.id,
      format: "full",
    });
 
    const headers = email.data.payload.headers || [];
    const from    = headers.find((h) => h.name === "From")?.value    || "Unknown";
    const subject = headers.find((h) => h.name === "Subject")?.value || "No Subject";
 
    const body        = getBody(email.data.payload);      
    const attachments = getAttachments(email.data.payload);
    const category    = categorizeEmail(subject, from, body);
    const tone        = getTone(category);
 
    // ── Filter: automated / OTP / security emails ───────────────────────────
    // this check, so every email was logged as "skipped" regardless of outcome
    // check, so spam was permanently marked as processed even when skipped
    if (isAutomated(from, subject)) {
      console.log("Skipping automated/OTP email:", subject);
 
      // Log with correct action (skipped-automated, NOT "processed")
      await writeLog({ messageId: msg.id, from, subject, category, action: "skipped-automated" });
 
      // Mark as read so it doesn't keep appearing as unread
      await markAsRead(gmail, msg.id);
 
      // Record as processed so we don't revisit it
      processedEmails.push(msg.id);
      await saveProcessedEmails(processedEmails);
      continue;
    }
 
    // ── Filter: newsletters ─────────────────────────────────────────────────
    if (category === "newsletter") {
      console.log("Skipping newsletter:", subject);
      await writeLog({ messageId: msg.id, from, subject, category, action: "skipped-newsletter" });
      await markAsRead(gmail, msg.id);
      processedEmails.push(msg.id);
      await saveProcessedEmails(processedEmails);
      continue;
    }
 
    // ── Summarize + draft ───────────────────────────────────────────────────
    console.log(`\nProcessing: "${subject}" from ${from}`);
 
    const aiOutput = await summarizeEmail(body, category, tone, attachments);
 
    console.log("\nAI SUMMARY + REPLY:");
    console.log(aiOutput);
 
    await createDraft(gmail, extractEmail(from), subject, aiOutput, email.data.threadId);
 
    await markAsRead(gmail, msg.id);
 
    
    await writeLog({ messageId: msg.id, from, subject, category, action: "drafted" });
    processedEmails.push(msg.id);
    await saveProcessedEmails(processedEmails);
 
    console.log("\n----------------");
    console.log("From:",    from);
    console.log("Subject:", subject);
    console.log("Body preview:");
    console.log(body.slice(0, 500));
  }
}
 
// ─── Exports ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  listUnreadEmails().catch(console.error);
}
 
module.exports = { listUnreadEmails };