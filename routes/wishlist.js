const express = require("express");
const { checkAuth } = require("../../imports/token");
const db = require("../../imports/database");

const app = express.Router();
const authenticated = checkAuth("user");
let tableReady;

app.customPath = "/api";

function ensureWishlistTable() {
  if (!tableReady) {
    tableReady = db.execute(
      "CREATE TABLE IF NOT EXISTS user_wishlist (" +
      "user_id INTEGER NOT NULL, " +
      "product_id INTEGER NOT NULL, " +
      "saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, " +
      "PRIMARY KEY (user_id, product_id))"
    ).catch((error) => {
      tableReady = undefined;
      throw error;
    });
  }
  return tableReady;
}

app.get("/wishlist", authenticated, async (req, res) => {
  const userId = Number(req.user.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: "Invalid customer account" });
  }

  try {
    await ensureWishlistTable();
    const result = await db.execute({
      sql: "SELECT w.product_id, w.saved_at " +
        "FROM user_wishlist w " +
        "INNER JOIN products p ON p.product_id = w.product_id " +
        "WHERE w.user_id = ? AND p.is_active = 1 " +
        "ORDER BY w.saved_at DESC, w.product_id DESC",
      args: [userId],
    });
    return res.json(result.rows);
  } catch (error) {
    console.error("Error fetching customer wishlist:", error);
    return res.status(500).json({ error: "Failed to fetch wishlist" });
  }
});

app.post("/wishlist", authenticated, async (req, res) => {
  const userId = Number(req.user.userId);
  const productId = Number(req.body?.product_id);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "A valid product is required" });
  }

  try {
    await ensureWishlistTable();
    const product = await db.execute({
      sql: "SELECT product_id FROM products WHERE product_id = ? AND is_active = 1",
      args: [productId],
    });
    if (!product.rows[0]) return res.status(404).json({ error: "Product not found" });

    await db.execute({
      sql: "INSERT OR IGNORE INTO user_wishlist (user_id, product_id) VALUES (?, ?)",
      args: [userId, productId],
    });
    return res.sendStatus(204);
  } catch (error) {
    console.error("Error saving customer wishlist item:", error);
    return res.status(500).json({ error: "Failed to save wishlist item" });
  }
});

app.delete("/wishlist/:productId", authenticated, async (req, res) => {
  const userId = Number(req.user.userId);
  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "A valid product is required" });
  }

  try {
    await ensureWishlistTable();
    await db.execute({
      sql: "DELETE FROM user_wishlist WHERE user_id = ? AND product_id = ?",
      args: [userId, productId],
    });
    return res.sendStatus(204);
  } catch (error) {
    console.error("Error removing customer wishlist item:", error);
    return res.status(500).json({ error: "Failed to remove wishlist item" });
  }
});

module.exports = app;
