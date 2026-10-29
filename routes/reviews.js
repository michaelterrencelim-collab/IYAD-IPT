const express = require("express");
const { checkAuth } = require("../imports/token");
const db = require("../imports/database");
const app = express.Router();
app.customPath = "/api";
const authenticated = checkAuth();
let schemaReady;

async function ensureSchema() {
  if (!schemaReady) schemaReady = (async () => {
    let result = await db.execute("PRAGMA table_info(reviews)");
    if (!result.rows.length) {
      await db.execute(`CREATE TABLE reviews (
        review_id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        user_id INTEGER NOT NULL,
        rating_stars INTEGER NOT NULL,
        comment_text TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        author_name TEXT,
        FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`);
    } else {
      const columns = new Map(result.rows.map((row) => [row.name, row]));
      if (Number(columns.get("product_id")?.notnull) === 1) {
      await db.batch([
        `CREATE TABLE reviews_new (
          review_id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER,
          user_id INTEGER NOT NULL,
          rating_stars INTEGER NOT NULL,
          comment_text TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          author_name TEXT,
          FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )`,
        `INSERT INTO reviews_new (review_id, product_id, user_id, rating_stars, comment_text, created_at)
         SELECT review_id, product_id, user_id, rating_stars, comment_text, created_at FROM reviews`,
        "DROP TABLE reviews",
        "ALTER TABLE reviews_new RENAME TO reviews",
        ], "write");
      } else if (!columns.has("author_name")) {
        await db.execute("ALTER TABLE reviews ADD COLUMN author_name TEXT");
      }
    }

    const users = await db.execute("PRAGMA table_info(users)");
    if (!users.rows.some((row) => row.name === "avatar_url")) {
      await db.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT");
    }
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

function customerId(req) {
  const id = Number(req.user?.userId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalize(row) {
  return {
    id: String(row.review_id),
    author: row.author || "Customer",
    rating: Number(row.rating_stars),
    createdAt: row.created_at || "",
    text: row.comment_text || "",
    productId: row.product_id == null ? null : Number(row.product_id),
    productName: row.product_name || null,
    authorAvatar: row.author_avatar || null,
  };
}

app.get("/reviews", async (_req, res) => {
  try {
    await ensureSchema();
    const result = await db.execute(`
      SELECT r.review_id, r.product_id, r.rating_stars, r.comment_text, r.created_at,
             COALESCE(NULLIF(r.author_name, ''), u.full_name, 'Customer') AS author,
             p.product_name, u.avatar_url AS author_avatar
      FROM reviews r
      LEFT JOIN users u ON u.user_id = r.user_id
      LEFT JOIN products p ON p.product_id = r.product_id
      ORDER BY r.created_at DESC, r.review_id DESC
    `);
    return res.json(result.rows.map(normalize));
  } catch (error) {
    console.error("Error loading reviews:", error);
    return res.status(500).json({ error: "Failed to load reviews" });
  }
});

app.get("/reviews/mine/count", authenticated, async (req, res) => {
  const userId = customerId(req);
  if (!userId) return res.status(401).json({ error: "Sign in to view your review count" });
  try {
    await ensureSchema();
    const result = await db.execute({
      sql: "SELECT COUNT(*) AS review_count FROM reviews WHERE user_id = ?",
      args: [userId],
    });
    return res.json({ count: Number(result.rows[0]?.review_count || 0) });
  } catch (error) {
    console.error("Error loading account review count:", error);
    return res.status(500).json({ error: "Failed to load your review count" });
  }
});
app.get("/reviews/avatar", authenticated, async (req, res) => {
  try {
    await ensureSchema();
    const userId = customerId(req);
    if (!userId) return res.status(401).json({ error: "Sign in to view your profile photo" });
    const result = await db.execute({ sql: "SELECT avatar_url FROM users WHERE user_id = ?", args: [userId] });
    if (!result.rows.length) return res.status(404).json({ error: "Customer account not found" });
    return res.json({ avatarUrl: result.rows[0].avatar_url || null });
  } catch (error) {
    console.error("Error loading profile photo:", error);
    return res.status(500).json({ error: "Failed to load profile photo" });
  }
});

app.put("/reviews/avatar", authenticated, async (req, res) => {
  const userId = customerId(req);
  const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl : "";
  if (!userId) return res.status(401).json({ error: "Sign in to save a profile photo" });
  if (avatarUrl.length > 750000 || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl)) {
    return res.status(400).json({ error: "Choose a valid JPEG or PNG profile photo" });
  }
  try {
    await ensureSchema();
    const result = await db.execute({ sql: "UPDATE users SET avatar_url = ? WHERE user_id = ?", args: [avatarUrl, userId] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Customer account not found" });
    return res.json({ avatarUrl });
  } catch (error) {
    console.error("Error saving profile photo:", error);
    return res.status(500).json({ error: "Failed to save profile photo" });
  }
});

app.post("/reviews", authenticated, async (req, res) => {
  const userId = customerId(req);
  const author = String(req.body?.author || "").trim();
  const text = String(req.body?.text || "").trim();
  const rating = Number(req.body?.rating);
  const productId = req.body?.productId == null ? null : Number(req.body.productId);
  if (!userId) return res.status(401).json({ error: "Sign in to submit a review" });
  if (!author || author.length > 80 || !text || text.length > 3000 || !Number.isInteger(rating) || rating < 1 || rating > 5 || (productId !== null && (!Number.isSafeInteger(productId) || productId < 1))) {
    return res.status(400).json({ error: "Enter a name, a review, and a rating from one to five stars" });
  }

  try {
    await ensureSchema();
    const account = await db.execute({ sql: "SELECT user_id FROM users WHERE user_id = ?", args: [userId] });
    if (!account.rows.length) return res.status(401).json({ error: "Customer account not found" });
    if (productId !== null) {
      const product = await db.execute({ sql: "SELECT product_id FROM products WHERE product_id = ?", args: [productId] });
      if (!product.rows.length) return res.status(404).json({ error: "Product not found" });
    }
    const inserted = await db.execute({
      sql: "INSERT INTO reviews (product_id, user_id, rating_stars, comment_text, author_name) VALUES (?, ?, ?, ?, ?)",
      args: [productId, userId, rating, text, author],
    });
    const saved = await db.execute({
      sql: `SELECT r.review_id, r.product_id, r.rating_stars, r.comment_text, r.created_at,
                   COALESCE(NULLIF(r.author_name, ''), u.full_name, 'Customer') AS author,
                   p.product_name, u.avatar_url AS author_avatar
            FROM reviews r
            LEFT JOIN users u ON u.user_id = r.user_id
            LEFT JOIN products p ON p.product_id = r.product_id
            WHERE r.review_id = ?`,
      args: [Number(inserted.lastInsertRowid)],
    });
    return res.status(201).json(normalize(saved.rows[0]));
  } catch (error) {
    console.error("Error saving review:", error);
    return res.status(500).json({ error: "Failed to save review" });
  }
});

app.ensureSchema = ensureSchema;
module.exports = app;
