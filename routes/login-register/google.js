const express = require("express");
const app = express.Router();

const db = require("../../imports/database");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/api/auth/google/callback";

const googleClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
);

app.customPath = "/api";

let googleSchemaReady;
async function ensureGoogleSchema() {
  if (!googleSchemaReady) {
    googleSchemaReady = (async () => {
      const columns = await db.execute("PRAGMA table_info(users)");
      if (!columns.rows.some((column) => column.name === "google_id")) {
        await db.execute("ALTER TABLE users ADD COLUMN google_id TEXT");
      }
    })().catch((error) => {
      googleSchemaReady = null;
      throw error;
    });
  }
  return googleSchemaReady;
}

app.get("/auth/google", (_req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    return res.status(503).json({ error: "Google authentication is not configured" });
  }

  const url = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  });

  return res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    if (!req.query.code || typeof req.query.code !== "string") {
      return res.status(400).json({ error: "Missing Google authorization code" });
    }

    await ensureGoogleSchema();

    const { tokens } = await googleClient.getToken(req.query.code);
    if (!tokens.id_token) {
      return res.status(401).json({ error: "Google did not return an identity token" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: "Google email is not verified" });
    }

    const email = payload.email.trim().toLowerCase();
    const googleId = payload.sub;
    const existingResult = await db.execute({
      sql: `
        SELECT user_id, username, full_name, email, role, account_status, google_id
        FROM users
        WHERE email = ?
      `,
      args: [email],
    });

    let user = existingResult.rows[0];
    if (user) {
      if (user.account_status !== "Active") {
        return res.status(403).json({ error: "Account is not active" });
      }
      if (user.google_id && user.google_id !== googleId) {
        return res.status(409).json({ error: "This account is linked to another Google account" });
      }

      if (!user.google_id) {
        await db.execute({
          sql: "UPDATE users SET google_id = ? WHERE user_id = ?",
          args: [googleId, user.user_id],
        });
        user = { ...user, google_id: googleId };
      }
    } else {
      const fullName =
        [payload.given_name, payload.family_name]
          .filter((part) => typeof part === "string" && part.trim())
          .map((part) => part.trim())
          .join(" ") || payload.name?.trim() || email.split("@")[0];
      const username = `${email.split("@")[0].slice(0, 50)}_${googleId.slice(-8)}`;
      // The existing users schema requires password_hash. This deliberately does not
      // use the scrypt format, so password login cannot authenticate a Google-only account.
      const unusablePasswordHash = `google:${crypto.randomBytes(32).toString("hex")}`;

      const result = await db.execute({
        sql: `
          INSERT INTO users (
            username,
            full_name,
            email,
            password_hash,
            google_id
          )
          VALUES (?, ?, ?, ?, ?)
          RETURNING user_id, username, full_name, email, role, account_status, google_id
        `,
        args: [username, fullName, email, unusablePasswordHash, googleId],
      });
      user = result.rows[0];
      if (!user) {
        return res.status(500).json({ error: "Failed to create account" });
      }
    }

    const isAdmin = String(user.role).toLowerCase() === "admin";
    const token = jwt.sign(
      {
        userId: user.user_id,
        email: user.email,
        role: isAdmin ? "admin" : "user",
      },
      JWT_SECRET,
      { expiresIn: "24h" },
    );

    res.cookie("auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    const frontendOrigin = (process.env.FRONTEND_ORIGIN || "http://localhost:4200")
      .split(",")[0]
      .trim()
      .replace(/\/+$/, "");
    return res.redirect(`${frontendOrigin}/auth/google/callback`);
  } catch (err) {
    console.error("Google login error:", err);
    return res.status(500).json({ error: "Google authentication failed" });
  }
});

module.exports = app;
