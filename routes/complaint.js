const express = require("express");
const { checkAuth } = require("../imports/token");
const db = require("../imports/database");

const app = express.Router();
const authenticated = checkAuth("user");

app.customPath = "/api";

let resolutionSchemaReady;
async function ensureComplaintResolutionSchema() {
  if (!resolutionSchemaReady) {
    resolutionSchemaReady = (async () => {
      const columns = await db.execute("PRAGMA table_info(complaints)");
      if (!columns.rows.some((column) => column.name === "resolution")) {
        await db.execute("ALTER TABLE complaints ADD COLUMN resolution TEXT NOT NULL DEFAULT ''");
      }
    })().catch((error) => {
      resolutionSchemaReady = null;
      throw error;
    });
  }
  return resolutionSchemaReady;
}

app.get("/complaint", authenticated, async (req, res) => {
  const userId = Number(req.user.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Invalid customer account" });
  }
  try {
    await ensureComplaintResolutionSchema();
    const result = await db.execute({
      sql: "SELECT complaint_id, user_id, name, email, subject, message, status, resolution FROM complaints WHERE user_id = ? ORDER BY complaint_id DESC",
      args: [userId],
    });
    return res.json(result.rows);
  } catch (error) {
    console.error("Customer inbox load failed:", error);
    return res.status(500).json({ error: "Unable to load inbox" });
  }
});
app.post("/complaint", authenticated, async (req, res) => {
  const userId = Number(req.user.userId);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Invalid customer account" });
  }
  if (!name || name.length < 2 || name.length > 200) {
    return res.status(400).json({ error: "Name must be between 2 and 200 characters" });
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }
  if (!subject || subject.length > 200) {
    return res.status(400).json({ error: "Subject is required and must be 200 characters or fewer" });
  }
  if (!message || message.length > 5000) {
    return res.status(400).json({ error: "Message is required and must be 5000 characters or fewer" });
  }

  try {
    const account = await db.execute({
      sql: "SELECT user_id FROM users WHERE user_id = ? AND account_status = 'Active'",
      args: [userId],
    });
    if (!account.rows[0]) {
      return res.status(401).json({ error: "Active account not found" });
    }

    const result = await db.execute({
      sql: "INSERT INTO complaints (user_id, name, email, subject, message, status) " +
        "VALUES (?, ?, ?, ?, ?, 'Pending') RETURNING complaint_id, status",
      args: [userId, name, email, subject, message],
    });
    const complaint = result.rows[0];
    if (!complaint) {
      return res.status(500).json({ error: "Unable to save complaint" });
    }

    return res.status(201).json({
      complaintId: Number(complaint.complaint_id),
      status: complaint.status,
    });
  } catch (error) {
    console.error("Complaint submission failed:", error);
    return res.status(500).json({ error: "Unable to submit message" });
  }
});

module.exports = app;
