const express = require("express");
const crypto = require("crypto");
const { promisify } = require("util");
const db = require("../imports/database");
const { checkAuth } = require("../imports/token");

const app = express.Router();
const authenticated = checkAuth("user");
const scrypt = promisify(crypto.scrypt);
app.customPath = "/api";

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;
  const [algorithm, salt, digest] = storedHash.split(":");
  if (
    algorithm !== "scrypt" ||
    !/^[a-f0-9]{32}$/i.test(salt || "") ||
    !/^[a-f0-9]{128}$/i.test(digest || "")
  ) return false;

  const expected = Buffer.from(digest, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

app.post("/change-password", authenticated, async (req, res) => {
  const userId = Number(req.user.userId);
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Signed-in account could not be verified" });
  }
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "Current and new passwords are required" });
  }
  if (!currentPassword || newPassword.length < 8 || newPassword.length > 64) {
    return res.status(400).json({ error: "New password must be between 8 and 64 characters" });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "Choose a new password that differs from your current password" });
  }

  try {
    const result = await db.execute({
      sql: "SELECT password_hash FROM users WHERE user_id = ? AND account_status = 'Active'",
      args: [userId],
    });
    const account = result.rows[0];
    if (!account || !(await verifyPassword(currentPassword, account.password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const digest = (await scrypt(newPassword, salt, 64)).toString("hex");
    const passwordHash = `scrypt:${salt}:${digest}`;
    await db.execute({
      sql: "UPDATE users SET password_hash = ? WHERE user_id = ? AND account_status = 'Active'",
      args: [passwordHash, userId],
    });

    return res.json({ message: "Your password has been changed for this account." });
  } catch (error) {
    console.error("Password update failed:", error);
    return res.status(500).json({ error: "Unable to update password" });
  }
});

module.exports = app;
