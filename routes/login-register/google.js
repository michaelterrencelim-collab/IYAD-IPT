const express = require("express");
const app = express.Router();

const db = require("../../imports/database");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

const googleClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
);

app.customPath = "/api";

async function findOrCreateGoogleUser(payload) {
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    const error = new Error("Google email is not verified");
    error.status = 401;
    throw error;
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
      const error = new Error("Account is not active");
      error.status = 403;
      throw error;
    }
    if (user.google_id && user.google_id !== googleId) {
      const error = new Error("This account is linked to another Google account");
      error.status = 409;
      throw error;
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
    const result = await db.execute({
      sql: `
        INSERT INTO users (username, full_name, email, password_hash, google_id)
        VALUES (?, ?, ?, NULL, ?)
        RETURNING user_id, username, full_name, email, role, account_status, google_id
      `,
      args: [email.split("@")[0], fullName, email, googleId],
    });
    user = result.rows[0];
    if (!user) {
      const error = new Error("Failed to create account");
      error.status = 500;
      throw error;
    }
  }
  return user;
}

function createAppToken(user) {
  return jwt.sign(
    {
      userId: user.user_id,
      email: user.email,
      role: String(user.role).toLowerCase() === "admin" ? "admin" : "user",
    },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
}

app.get("/auth/google/config", (_req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google authentication is not configured" });
  }
  return res.json({ webClientId: GOOGLE_CLIENT_ID });
});

app.post("/auth/google/native", async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: "Google authentication is not configured" });
    }
    const idToken = req.body?.idToken;
    if (typeof idToken !== "string" || !idToken) {
      return res.status(400).json({ error: "Missing Google identity token" });
    }

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const user = await findOrCreateGoogleUser(ticket.getPayload());
    return res.json({
      token: createAppToken(user),
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Native Google login error:", err);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Google authentication failed",
    });
  }
});

app.get("/auth/google", (req, res) => {
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

    const user = await findOrCreateGoogleUser(payload);
    const token = createAppToken(user);

    res.cookie("auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    const frontendOrigin = (process.env.FRONTEND_ORIGIN || "")
      .split(",")[0]
      .trim();
    return res.redirect(frontendOrigin || "/");
  } catch (err) {
    console.error("Google login error:", err);
    return res.status(500).json({ error: "Google authentication failed" });
  }
});

module.exports = app;
