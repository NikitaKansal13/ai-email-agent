const cron = require("node-cron");
const { listUnreadEmails } = require("./gmail");

console.log("AI Email Agent started...");
console.log("Agent will run every hour.");

async function runAgent() {
  console.log("\nRunning email agent at:", new Date().toISOString());

  try {
    await listUnreadEmails();
    console.log("Agent run completed.");
  } catch (error) {
    console.error("Agent run failed:", error.message);
  }
}

// Run immediately on startup
runAgent();

// Then run every hour
cron.schedule("0 * * * *", runAgent);