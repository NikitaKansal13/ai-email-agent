# AI Email Agent

An AI-powered email management agent built with Node.js, Gmail API, and Gemini AI.

## Overview

AI Email Agent automatically monitors unread Gmail messages, extracts email content, categorizes emails, generates AI-powered summaries and suggested replies, creates Gmail drafts, marks processed emails as read, and maintains a processing history.

The project demonstrates how Large Language Models can be integrated with email workflows to automate routine communication tasks.

---

## Features

### Email Processing

* Reads unread Gmail emails using Gmail API
* Extracts sender, subject, body, and attachment metadata
* Skips automated security and OTP emails
* Prevents duplicate processing using message ID tracking

### AI-Powered Analysis

* Email categorization:

  * Work
  * Personal
  * Support
  * Invoice
  * Newsletter
* Dynamic reply tone selection:

  * Professional
  * Friendly
  * Formal
  * Brief & Helpful
* AI-generated:

  * Email summaries
  * Suggested replies
  * Priority assessment

### Gmail Actions

* Creates reply drafts in Gmail
* Marks processed emails as read
* Maintains Gmail conversation threads

### Agent Capabilities

* Scheduled execution using node-cron
* Runs automatically every hour
* Maintains processing history
* Logs all actions performed

### Monitoring

* Processed email tracking
* Local run history
* Action logging via log.json

---

## Tech Stack

* Node.js
* Gmail API
* Google OAuth 2.0
* Gemini API
* Express.js
* Node Cron

---

## Workflow

1. Agent runs automatically every hour.
2. Fetches unread Gmail messages.
3. Skips previously processed emails.
4. Filters OTP, verification, and security emails.
5. Extracts email body and attachment information.
6. Categorizes the email.
7. Generates AI summary and suggested reply using Gemini.
8. Creates a Gmail draft.
9. Marks the email as read.
10. Saves processing history and logs.

---

## Setup

### Install Dependencies

npm install

### Configure Environment Variables

Create a .env file:

GEMINI_API_KEY=YOUR_API_KEY

### Configure Gmail OAuth

Place your Google OAuth credentials file:

credentials.json

in the project root directory.

### Run Agent

node agent.js

### Run Dashboard

node server.js

Open:

http://localhost:3000







