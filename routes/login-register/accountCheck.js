const express = require("express");
const app = express.Router();
const jwt = require("jsonwebtoken");
const { checkAuth } = require("../../imports/token");
const db = require("../../imports/database");
const JWT_SECRET = process.env.JWT_SECRET;

app.customPath = "/api";

app.get("/isLoggedIn", checkAuth("user"), async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT user_id, full_name, email, phone_number, shipping_address, role FROM users WHERE user_id = ?",
      args: [req.user.userId],
    });
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Account not found" });
    }

    return res.status(200).json({
      loggedIn: true,
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        phoneNumber: user.phone_number,
        shippingAddress: user.shipping_address,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Account lookup error:", error);
    return res.status(500).json({ error: "Unable to retrieve account" });
  }
});

app.patch("/profile", checkAuth("user"), async (req, res) => {
  const userId = Number(req.user.userId);
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phoneNumber = typeof req.body?.phoneNumber === "string" ? req.body.phoneNumber.trim() : "";
  const shippingAddress = typeof req.body?.shippingAddress === "string" ? req.body.shippingAddress.trim() : "";

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Signed-in account could not be verified" });
  }
  if (!fullName || fullName.length > 200) {
    return res.status(400).json({ error: "Full name is required and must be 200 characters or fewer" });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (phoneNumber.length > 30 || shippingAddress.length > 500) {
    return res.status(400).json({ error: "Phone number or address is too long" });
  }

  try {
    const duplicate = await db.execute({
      sql: "SELECT user_id FROM users WHERE lower(email) = ? AND user_id != ? LIMIT 1",
      args: [email, userId],
    });
    if (duplicate.rows.length > 0) {
      return res.status(409).json({ error: "That email address is already in use" });
    }

    const result = await db.execute({
      sql: `UPDATE users
            SET full_name = ?, email = ?, phone_number = ?, shipping_address = ?
            WHERE user_id = ? AND account_status = 'Active'
            RETURNING user_id, full_name, email, phone_number, shipping_address, role`,
      args: [fullName, email, phoneNumber || null, shippingAddress || null, userId],
    });
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: "Active account not found" });
    }

    const role = String(user.role).toLowerCase() === "admin" ? "admin" : "user";
    const token = jwt.sign({ userId: user.user_id, email: user.email, role }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("auth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.json({
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        phoneNumber: user.phone_number,
        shippingAddress: user.shipping_address,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return res.status(500).json({ error: "Unable to save profile details" });
  }
});

app.get("/dbworking", async (req, res) => {
  try {
    const result = await db.execute("SELECT 1 AS connected");

    return res.status(200).json({
      success: true,
      message: "Database connection successful",
      database: "connected",
      result: result.rows[0],
    });
  } catch (error) {
    console.error("Database availability check failed:", {
      message: error.message,
      code: error.code,
      status: error.cause?.status,
    });

    return res.status(503).json({
      success: false,
      message: "Database connection failed",
      database: "unavailable",
      error: error.message,
      code: error.code || null,
      status: error.cause?.status || null,
    });
  }
});
app.get("/allproducts", async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT
        product_id,
        product_name
      FROM products
      ORDER BY product_id ASC
    `);



    res.json(result);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      error: "Failed to fetch products",
    });
  }
});

module.exports = app;
