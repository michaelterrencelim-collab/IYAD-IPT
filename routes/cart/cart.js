const express = require("express");
const { checkAuth } = require("../../imports/token");
const db = require("../../imports/database");
const productImageUrl = require("../../imports/productImageUrl");

const app = express.Router();
const authenticated = checkAuth();

app.customPath = "/api";

app.get("/cart", authenticated, async (req, res) => {
  const customerId = Number(req.user.userId);

  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return res.status(401).json({ error: "Invalid customer account" });
  }

  try {
    const [result, accountResult] = await Promise.all([
      db.execute({
        sql: `
          SELECT
            c.cart_id,
            c.user_id,
            c.product_id,
            c.quantity,
            c.added_at,
            p.product_name,
            p.description AS product_description,
            p.price,
            p.stock_quantity,
            p.unit,
            p.image_url
          FROM cart c
          LEFT JOIN products p
            ON p.product_id = c.product_id
          WHERE c.user_id = ?
          ORDER BY c.added_at DESC, c.cart_id DESC
        `,
        args: [customerId],
      }),
      db.execute({
        sql: "SELECT full_name, email FROM users WHERE user_id = ?",
        args: [customerId],
      }),
    ]);

    return res.json({
      user: accountResult.rows[0]
        ? {
            fullName: accountResult.rows[0].full_name,
            email: accountResult.rows[0].email,
          }
        : null,
      items: result.rows.map((row) => ({
        ...row,
        image_url: productImageUrl(row.image_url),
      })),
    });
  } catch (error) {
    console.error("Error fetching customer cart:", error);
    return res.status(500).json({ error: "Failed to fetch cart" });
  }
});

app.post("/cart", authenticated, async (req, res) => {
  const customerId = Number(req.user.userId);
  const productId = Number(req.body?.product_id);
  const quantity = Number(req.body?.quantity ?? 1);
  if (!Number.isSafeInteger(productId) || productId <= 0 ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) {
    return res.status(400).json({ error: "A valid product and quantity are required" });
  }

  try {
    const productResult = await db.execute({
      sql: "SELECT stock_quantity FROM products WHERE product_id = ? AND is_active = 1",
      args: [productId],
    });
    const product = productResult.rows[0];
    if (!product) return res.status(404).json({ error: "Product not found" });

    const existingResult = await db.execute({
      sql: "SELECT cart_id, quantity FROM cart WHERE user_id = ? AND product_id = ?",
      args: [customerId, productId],
    });
    const existing = existingResult.rows[0];
    const newQuantity = Number(existing?.quantity ?? 0) + quantity;
    if (newQuantity > Number(product.stock_quantity)) {
      return res.status(409).json({ error: "Requested quantity exceeds available stock" });
    }

    if (existing) {
      await db.execute({
        sql: "UPDATE cart SET quantity = ? WHERE cart_id = ? AND user_id = ?",
        args: [newQuantity, existing.cart_id, customerId],
      });
    } else {
      await db.execute({
        sql: "INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)",
        args: [customerId, productId, quantity],
      });
    }

    const row = await getCartItem(customerId, productId);
    return res.status(200).json(row);
  } catch (error) {
    console.error("Error adding item to customer cart:", error);
    return res.status(500).json({ error: "Failed to update cart" });
  }
});

app.put("/cart/:productId", authenticated, async (req, res) => {
  const customerId = Number(req.user.userId);
  const productId = Number(req.params.productId);
  const quantity = Number(req.body?.quantity);
  if (!Number.isSafeInteger(productId) || productId <= 0 ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) {
    return res.status(400).json({ error: "A valid product and quantity are required" });
  }

  try {
    const result = await db.execute({
      sql: `
        UPDATE cart
        SET quantity = ?
        WHERE user_id = ? AND product_id = ?
          AND EXISTS (
            SELECT 1 FROM products
            WHERE products.product_id = cart.product_id
              AND products.is_active = 1
              AND products.stock_quantity >= ?
          )
      `,
      args: [quantity, customerId, productId, quantity],
    });
    if (Number(result.rowsAffected) === 0) {
      return res.status(404).json({ error: "Cart item not found or quantity exceeds stock" });
    }

    return res.json(await getCartItem(customerId, productId));
  } catch (error) {
    console.error("Error changing customer cart item:", error);
    return res.status(500).json({ error: "Failed to update cart" });
  }
});

app.delete("/cart/:productId", authenticated, async (req, res) => {
  const customerId = Number(req.user.userId);
  const productId = Number(req.params.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "A valid product is required" });
  }

  try {
    await db.execute({
      sql: "DELETE FROM cart WHERE user_id = ? AND product_id = ?",
      args: [customerId, productId],
    });
    return res.sendStatus(204);
  } catch (error) {
    console.error("Error removing customer cart item:", error);
    return res.status(500).json({ error: "Failed to remove cart item" });
  }
});

async function getCartItem(customerId, productId) {
  const result = await db.execute({
    sql: `
      SELECT c.cart_id, c.user_id, c.product_id, c.quantity, c.added_at,
        p.product_name, p.description AS product_description, p.price,
        p.stock_quantity, p.unit, p.image_url
      FROM cart c
      LEFT JOIN products p ON p.product_id = c.product_id
      WHERE c.user_id = ? AND c.product_id = ?
    `,
    args: [customerId, productId],
  });
  const row = result.rows[0];
  return row ? { ...row, image_url: productImageUrl(row.image_url) } : null;
}

app.delete("/cart", authenticated, async (req, res) => {
  const customerId = Number(req.user.userId);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return res.status(401).json({ error: "Invalid customer account" });
  }

  try {
    await db.execute({
      sql: "DELETE FROM cart WHERE user_id = ?",
      args: [customerId],
    });
    return res.sendStatus(204);
  } catch (error) {
    console.error("Error clearing customer cart after checkout:", error);
    return res.status(500).json({ error: "Failed to clear cart" });
  }
});
module.exports = app;

