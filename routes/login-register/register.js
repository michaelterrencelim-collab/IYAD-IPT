const express = require("express");
const app = express.Router();
const db = require("../../imports/database");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { promisify } = require("util");

const JWT_SECRET = process.env.JWT_SECRET;
const scrypt = promisify(crypto.scrypt);

app.customPath = "/api";

app.post("/register", async (req, res) => {
  try {

    console.log("Registration attempt received.");
    const {
      firstName,
      lastName,
      fullName,
      full_name,
      username,
      email,
      password,
      role,
      adminCode,
      phoneNumber,
      phone_number,
      shippingAddress,
      shipping_address,
    } = req.body ?? {};

    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const name =
      typeof full_name === "string"
        ? full_name.trim()
        : typeof fullName === "string"
          ? fullName.trim()
          : [firstName, lastName]
              .filter((part) => typeof part === "string" && part.trim())
              .map((part) => part.trim())
              .join(" ");

    if (!name || !normalizedEmail || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const requestedRole = typeof role === "string" ? role.trim() : "Customer";
    if (requestedRole !== "Customer" && requestedRole !== "Admin") {
      return res.status(400).json({ error: "Choose Customer or Admin as the account role" });
    }
    if (requestedRole === "Admin" && adminCode !== "admin") {
      return res.status(403).json({ error: "The Admin access code is incorrect" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    if (password.length > 64) {
      return res.status(400).json({ error: "Password too long" });
    }

    if (name.length > 200) {
      return res.status(400).json({ error: "Name too long" });
    }

    if (normalizedEmail.length > 254) {
      return res.status(400).json({ error: "Email too long" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const existingUser = await db.execute({
      sql: `
        SELECT user_id
        FROM users
        WHERE email = ?
      `,
      args: [normalizedEmail],
    });

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: "Email is already registered",
      });
    }

    const normalizedUsername =
      typeof username === "string" && username.trim()
        ? username.trim()
        : normalizedEmail.split("@")[0];
    const phone =
      typeof phone_number === "string" ? phone_number : phoneNumber;
    const address =
      typeof shipping_address === "string"
        ? shipping_address
        : shippingAddress;
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString("hex")}`;

    const result = await db.execute({
      sql: `
        INSERT INTO users (
          username,
          full_name,
          email,
          phone_number,
          password_hash,
          role,
          shipping_address
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING user_id, email, full_name, role
      `,
      args: [
        normalizedUsername,
        name,
        normalizedEmail,
        typeof phone === "string" && phone ? phone : null,
        passwordHash,
        requestedRole,
        typeof address === "string" && address ? address : null,
      ],
    });

    const user = result.rows[0];
    if (!user) {
      return res.status(500).json({ error: "Server error" });
    }
    console.log("Registered account created:", user.user_id);

    const token = jwt.sign(
      {
        userId: user.user_id,
        email: user.email,
        role: String(user.role).toLowerCase() === "admin" ? "admin" : "user",
      },
      JWT_SECRET,
      {
        expiresIn: "24h",
      },
    );

    res.cookie("auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.json({
      login: "success",
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = app;
