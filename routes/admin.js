const express = require("express");
const { checkAuth } = require("../imports/token");
const db = require("../imports/database");
const productImageUrl = require("../imports/productImageUrl");
const app = express.Router();
app.customPath = "/api";
const adminOnly = checkAuth("admin");
const orderRoutes = require("./orders");
const reviewRoutes = require("./reviews");
async function ensureDefaultCategories() {
  const existing = await db.execute("SELECT COUNT(*) AS category_count FROM categories");
  if (Number(existing.rows[0]?.category_count || 0) !== 0) return;
  await db.batch([
    { sql: "INSERT OR IGNORE INTO categories (category_id, category_name, description) VALUES (?, ?, ?)", args: [1, "Fruits", "Fresh fruits"] },
    { sql: "INSERT OR IGNORE INTO categories (category_id, category_name, description) VALUES (?, ?, ?)", args: [2, "Vegetables", "Fresh vegetables"] },
    { sql: "INSERT OR IGNORE INTO categories (category_id, category_name, description) VALUES (?, ?, ?)", args: [3, "Grains", "Grains and pantry staples"] },
    { sql: "INSERT OR IGNORE INTO categories (category_id, category_name, description) VALUES (?, ?, ?)", args: [4, "Others", "Other market products"] },
  ], "write");
}
let complaintResolutionSchemaReady;
async function ensureComplaintResolutionSchema() {
  if (!complaintResolutionSchemaReady) {
    complaintResolutionSchemaReady = (async () => {
      const columns = await db.execute("PRAGMA table_info(complaints)");
      if (!columns.rows.some((column) => column.name === "resolution")) {
        await db.execute("ALTER TABLE complaints ADD COLUMN resolution TEXT NOT NULL DEFAULT ''");
      }
    })().catch((error) => { complaintResolutionSchemaReady = null; throw error; });
  }
  return complaintResolutionSchemaReady;
}
const ensureAdminSchemas = async (withReviews = true) => {
  await orderRoutes.ensureSchema();
  if (withReviews) await reviewRoutes.ensureSchema();
};

app.get("/admin/overview", adminOnly, async (_req, res) => {
  try {
    await ensureAdminSchemas();
    const [orders, products, customers, reviews, complaints] = await Promise.all([
      db.execute("SELECT COUNT(*) AS order_count, COALESCE(SUM(CASE WHEN order_status != 'Cancelled' THEN total_amount ELSE 0 END), 0) AS sales_total, SUM(CASE WHEN order_status IN ('Pending', 'Confirmed') THEN 1 ELSE 0 END) AS pending_orders, SUM(CASE WHEN order_status IN ('Packed', 'Out for Delivery', 'Processing') THEN 1 ELSE 0 END) AS processing_orders, SUM(CASE WHEN order_status IN ('Delivered', 'Completed') THEN 1 ELSE 0 END) AS completed_orders, SUM(CASE WHEN order_status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_orders FROM orders"),
      db.execute("SELECT COUNT(*) AS product_count, SUM(CASE WHEN is_active = 1 AND stock_quantity <= 5 THEN 1 ELSE 0 END) AS low_stock_count FROM products"),
      db.execute("SELECT COUNT(*) AS customer_count FROM users WHERE LOWER(role) != 'admin'"),
      db.execute("SELECT COUNT(*) AS review_count FROM reviews"),
      db.execute("SELECT COUNT(*) AS complaint_count FROM complaints"),
    ]);
    return res.json({
      orderCount: Number(orders.rows[0]?.order_count || 0),
      salesTotal: Number(orders.rows[0]?.sales_total || 0),
      pendingOrders: Number(orders.rows[0]?.pending_orders || 0),
      processingOrders: Number(orders.rows[0]?.processing_orders || 0),
      completedOrders: Number(orders.rows[0]?.completed_orders || 0),
      cancelledOrders: Number(orders.rows[0]?.cancelled_orders || 0),
      productCount: Number(products.rows[0]?.product_count || 0),
      lowStockCount: Number(products.rows[0]?.low_stock_count || 0),
      customerCount: Number(customers.rows[0]?.customer_count || 0),
      reviewCount: Number(reviews.rows[0]?.review_count || 0),
      complaintCount: Number(complaints.rows[0]?.complaint_count || 0),
    });
  } catch (error) {
    console.error("Admin overview error:", error);
    return res.status(500).json({ error: "Unable to load admin overview" });
  }
});

app.get("/admin/dashboard", adminOnly, async (_req, res) => {
  try {
    await ensureAdminSchemas();
    const [stats, orders, lowStock] = await Promise.all([
      db.execute("SELECT (SELECT COUNT(*) FROM orders) AS order_count, (SELECT COALESCE(SUM(CASE WHEN order_status != 'Cancelled' THEN total_amount ELSE 0 END), 0) FROM orders) AS sales_total, (SELECT SUM(CASE WHEN order_status IN ('Pending', 'Confirmed') THEN 1 ELSE 0 END) FROM orders) AS pending_orders, (SELECT SUM(CASE WHEN order_status IN ('Packed', 'Out for Delivery', 'Processing') THEN 1 ELSE 0 END) FROM orders) AS processing_orders, (SELECT SUM(CASE WHEN order_status IN ('Delivered', 'Completed') THEN 1 ELSE 0 END) FROM orders) AS completed_orders, (SELECT SUM(CASE WHEN order_status = 'Cancelled' THEN 1 ELSE 0 END) FROM orders) AS cancelled_orders, (SELECT COUNT(*) FROM products) AS product_count, (SELECT SUM(CASE WHEN is_active = 1 AND stock_quantity <= 5 THEN 1 ELSE 0 END) FROM products) AS low_stock_count, (SELECT COUNT(*) FROM users WHERE LOWER(role) != 'admin') AS customer_count, (SELECT COUNT(*) FROM reviews) AS review_count, (SELECT COUNT(*) FROM complaints) AS complaint_count"),
      db.execute("SELECT order_id, customer_name, order_status, total_amount, payment_method, placed_at, shipping_address FROM orders ORDER BY placed_at DESC, order_id DESC LIMIT 5"),
      db.execute("SELECT product_id, product_name, stock_quantity, unit FROM products WHERE is_active = 1 AND stock_quantity <= 5 ORDER BY stock_quantity, product_name LIMIT 10"),
    ]);
    const row = stats.rows[0] || {};
    return res.json({
      overview: {
        orderCount: Number(row.order_count || 0), salesTotal: Number(row.sales_total || 0),
        pendingOrders: Number(row.pending_orders || 0), processingOrders: Number(row.processing_orders || 0),
        completedOrders: Number(row.completed_orders || 0), cancelledOrders: Number(row.cancelled_orders || 0),
        productCount: Number(row.product_count || 0), lowStockCount: Number(row.low_stock_count || 0),
        customerCount: Number(row.customer_count || 0), reviewCount: Number(row.review_count || 0),
        complaintCount: Number(row.complaint_count || 0),
      },
      orders: orders.rows,
      lowStock: lowStock.rows,
    });
  } catch (error) {
    console.error("Admin dashboard error:", error);
    return res.status(500).json({ error: "Unable to load the admin dashboard" });
  }
});

app.get("/admin/complaints", adminOnly, async (_req, res) => {
  try {
    await ensureComplaintResolutionSchema();
    const result = await db.execute("SELECT complaint_id, user_id, name, email, subject, message, status, resolution FROM complaints ORDER BY complaint_id DESC");
    return res.json(result.rows);
  } catch (error) {
    console.error("Admin complaints error:", error);
    return res.status(500).json({ error: "Unable to load customer complaints" });
  }
});
app.post("/admin/complaints", adminOnly, async (req, res) => {
  const body = req.body || {};
  const userId = Number(req.user?.userId);
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  if (!Number.isSafeInteger(userId) || userId < 1 || name.length < 2 || name.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !subject || subject.length > 200 || !message || message.length > 5000) {
    return res.status(400).json({ error: "Enter valid complaint details" });
  }
  try {
    await ensureComplaintResolutionSchema();
    const result = await db.execute({ sql: "INSERT INTO complaints (user_id, name, email, subject, message, status) VALUES (?, ?, ?, ?, ?, 'Pending')", args: [userId, name, email, subject, message] });
    return res.status(201).json({ complaintId: Number(result.lastInsertRowid) });
  } catch (error) {
    console.error("Admin complaint create error:", error);
    return res.status(500).json({ error: "Unable to create complaint" });
  }
});

app.patch("/admin/complaints/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  const status = String(body.status || "").trim();
  const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
  if (!Number.isSafeInteger(id) || id < 1 || name.length < 2 || name.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !subject || subject.length > 200 || !message || message.length > 5000 || !["Pending", "In Progress", "Resolved", "Closed"].includes(status) || resolution.length > 2000 || (status === "Resolved" && !resolution)) {
    return res.status(400).json({ error: "Enter valid complaint details and status" });
  }
  try {
    await ensureComplaintResolutionSchema();
    const result = await db.execute({ sql: "UPDATE complaints SET name = ?, email = ?, subject = ?, message = ?, status = ?, resolution = ? WHERE complaint_id = ?", args: [name, email, subject, message, status, resolution, id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Complaint not found" });
    return res.json({ saved: true });
  } catch (error) {
    console.error("Admin complaint update error:", error);
    return res.status(500).json({ error: "Unable to update complaint" });
  }
});

app.delete("/admin/complaints/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid complaint" });
  try {
    const result = await db.execute({ sql: "DELETE FROM complaints WHERE complaint_id = ?", args: [id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Complaint not found" });
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Admin complaint delete error:", error);
    return res.status(500).json({ error: "Unable to delete complaint" });
  }
});
app.get("/admin/products", adminOnly, async (_req, res) => {
  try {
    const result = await db.execute("SELECT p.product_id, p.product_name, p.description, p.price, p.stock_quantity, p.unit, p.image_url, p.is_active, p.category_id, c.category_name FROM products p LEFT JOIN categories c ON c.category_id = p.category_id ORDER BY p.product_name");
    return res.json(result.rows.map((row) => ({ ...row, is_active: Boolean(row.is_active), image_url: productImageUrl(row.image_url) || null })));
  } catch (error) {
    console.error("Admin products error:", error);
    return res.status(500).json({ error: "Unable to load products" });
  }
});

app.post("/admin/products", adminOnly, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const unit = String(body.unit || "").trim();
  const price = Number(body.price);
  const stock = Number(body.stockQuantity);
  const categoryId = body.categoryId == null || body.categoryId === "" ? null : Number(body.categoryId);
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null;
  if (!name || name.length > 120 || description.length > 2000 || !unit || unit.length > 40 || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0 || categoryId === null || !Number.isSafeInteger(categoryId) || categoryId < 1 || (imageUrl && imageUrl.length > 750000)) {
    return res.status(400).json({ error: "Enter valid product details, price, stock, category, and image" });
  }
  try {
    await ensureDefaultCategories();
    const category = await db.execute({ sql: "SELECT category_id FROM categories WHERE category_id = ?", args: [categoryId] });
    if (!category.rows[0]) return res.status(400).json({ error: "Selected category does not exist. Refresh categories and try again." });
    const result = await db.execute({ sql: "INSERT INTO products (product_name, description, price, stock_quantity, unit, image_url, category_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", args: [name, description, price, stock, unit, imageUrl, categoryId] });
    return res.status(201).json({ productId: Number(result.lastInsertRowid) });
  } catch (error) {
    console.error("Admin product create error:", error);
    return res.status(500).json({ error: "Unable to create product" });
  }
});

app.get("/admin/categories", adminOnly, async (_req, res) => {
  try {
    await ensureDefaultCategories();
    const result = await db.execute("SELECT category_id, category_name, description FROM categories ORDER BY category_name");
    return res.json(result.rows);
  } catch (error) {
    console.error("Admin categories error:", error);
    return res.status(500).json({ error: "Unable to load categories" });
  }
});

app.get("/admin/category-counts", adminOnly, async (_req, res) => {
  try {
    const result = await db.execute("SELECT p.category_id, c.category_name, COUNT(*) AS product_count FROM products p LEFT JOIN categories c ON c.category_id = p.category_id GROUP BY p.category_id, c.category_name");
    const names = ["Fruits", "Vegetables", "Grains", "Others"];
    const counts = new Map(names.map((name) => [name, 0]));
    const fallbackById = new Map([[1, "Fruits"], [2, "Vegetables"], [3, "Grains"], [4, "Others"]]);
    for (const row of result.rows) {
      const label = String(row.category_name || "").toLowerCase();
      let bucket = label.includes("fruit") ? "Fruits"
        : label.includes("vegetable") ? "Vegetables"
          : label.includes("grain") ? "Grains"
            : label.includes("other") ? "Others"
              : fallbackById.get(Number(row.category_id)) || "Others";
      counts.set(bucket, counts.get(bucket) + Number(row.product_count || 0));
    }
    return res.json(names.map((category_name) => ({ category_name, product_count: counts.get(category_name) })));
  } catch (error) {
    console.error("Admin category counts error:", error);
    return res.status(500).json({ error: "Unable to load category product counts" });
  }
});

app.post("/admin/categories", adminOnly, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  if (!name || name.length > 100 || description.length > 1000) return res.status(400).json({ error: "Enter a category name and a shorter description" });
  try {
    const result = await db.execute({ sql: "INSERT INTO categories (category_name, description) VALUES (?, ?)", args: [name, description] });
    return res.status(201).json({ categoryId: Number(result.lastInsertRowid) });
  } catch (error) {
    console.error("Admin category create error:", error);
    return res.status(500).json({ error: "Unable to create category" });
  }
});

app.patch("/admin/categories/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  if (!Number.isSafeInteger(id) || id < 1 || !name || name.length > 100 || description.length > 1000) return res.status(400).json({ error: "Enter a valid category name and description" });
  try {
    const result = await db.execute({ sql: "UPDATE categories SET category_name = ?, description = ? WHERE category_id = ?", args: [name, description, id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Category not found" });
    return res.json({ saved: true });
  } catch (error) {
    console.error("Admin category update error:", error);
    return res.status(500).json({ error: "Unable to update category" });
  }
});

app.delete("/admin/categories/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid category" });
  try {
    const used = await db.execute({ sql: "SELECT COUNT(*) AS product_count FROM products WHERE category_id = ?", args: [id] });
    if (Number(used.rows[0]?.product_count || 0)) return res.status(409).json({ error: "Reassign or remove products in this category first" });
    const result = await db.execute({ sql: "DELETE FROM categories WHERE category_id = ?", args: [id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Category not found" });
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Admin category delete error:", error);
    return res.status(500).json({ error: "Unable to delete category" });
  }
});

app.get("/admin/reports", adminOnly, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !datePattern.test(from)) || (to && !datePattern.test(to))) return res.status(400).json({ error: "Use YYYY-MM-DD dates" });
  const conditions = [];
  const args = [];
  if (from) { conditions.push("date(placed_at) >= date(?)"); args.push(from); }
  if (to) { conditions.push("date(placed_at) <= date(?)"); args.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderWhere = conditions.length ? `WHERE ${conditions.map((condition) => condition.replaceAll("placed_at", "o.placed_at")).join(" AND ")} AND o.order_status != 'Cancelled'` : "WHERE o.order_status != 'Cancelled'";
  try {
    await ensureAdminSchemas();
    const [summary, daily, bestSellers, lowStock, reviews] = await Promise.all([
      db.execute({ sql: `SELECT COUNT(*) AS order_count, COALESCE(SUM(CASE WHEN order_status != 'Cancelled' THEN total_amount ELSE 0 END), 0) AS sales_total FROM orders ${where}`, args }),
      db.execute({ sql: `SELECT date(placed_at) AS sale_date, COUNT(*) AS order_count, COALESCE(SUM(CASE WHEN order_status != 'Cancelled' THEN total_amount ELSE 0 END), 0) AS sales_total FROM orders ${where} GROUP BY date(placed_at) ORDER BY sale_date DESC LIMIT 31`, args }),
      db.execute({ sql: `SELECT i.product_id, i.product_name, SUM(i.quantity) AS units_sold, SUM(i.quantity * i.unit_price) AS sales_total FROM order_items i INNER JOIN orders o ON o.order_id = i.order_id ${orderWhere} GROUP BY i.product_id, i.product_name ORDER BY units_sold DESC LIMIT 10`, args }),
      db.execute("SELECT product_id, product_name, stock_quantity, unit FROM products WHERE is_active = 1 AND stock_quantity <= 5 ORDER BY stock_quantity, product_name"),
      db.execute("SELECT r.review_id, r.rating_stars, r.comment_text, r.created_at, COALESCE(NULLIF(r.author_name, ''), u.full_name, 'Customer') AS author, p.product_name FROM reviews r LEFT JOIN users u ON u.user_id = r.user_id LEFT JOIN products p ON p.product_id = r.product_id ORDER BY r.created_at DESC, r.review_id DESC LIMIT 50"),
    ]);
    return res.json({ summary: summary.rows[0], daily: daily.rows, bestSellers: bestSellers.rows, lowStock: lowStock.rows, reviews: reviews.rows });
  } catch (error) {
    console.error("Admin report error:", error);
    return res.status(500).json({ error: "Unable to load sales reports" });
  }
});

app.patch("/admin/reviews/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 2000) {
    return res.status(400).json({ error: "Enter a rating from 1 to 5 and a review under 2,000 characters" });
  }
  try {
    await reviewRoutes.ensureSchema();
    const result = await db.execute({ sql: "UPDATE reviews SET rating_stars = ?, comment_text = ? WHERE review_id = ?", args: [rating, comment || null, id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Review not found" });
    return res.json({ saved: true });
  } catch (error) {
    console.error("Admin review update error:", error);
    return res.status(500).json({ error: "Unable to update review" });
  }
});
app.delete("/admin/reviews/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid review" });
  try {
    await reviewRoutes.ensureSchema();
    const result = await db.execute({ sql: "DELETE FROM reviews WHERE review_id = ?", args: [id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Review not found" });
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Admin review delete error:", error);
    return res.status(500).json({ error: "Unable to delete review" });
  }
});
app.patch("/admin/products/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  const unit = String(req.body?.unit || "").trim();
  const price = Number(req.body?.price);
  const stock = Number(req.body?.stockQuantity);
  const active = req.body?.isActive;
  const categoryId = req.body?.categoryId == null || req.body.categoryId === "" ? null : Number(req.body.categoryId);
  const imageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl : null;
  if (!Number.isSafeInteger(id) || id < 1 || !name || name.length > 120 || description.length > 2000 || !unit || unit.length > 40 || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0 || typeof active !== "boolean" || categoryId === null || !Number.isSafeInteger(categoryId) || categoryId < 1 || (imageUrl && imageUrl.length > 750000)) {
    return res.status(400).json({ error: "Enter valid product details, price, stock, category, and image" });
  }
  try {
    await ensureDefaultCategories();
    const category = await db.execute({ sql: "SELECT category_id FROM categories WHERE category_id = ?", args: [categoryId] });
    if (!category.rows[0]) return res.status(400).json({ error: "Selected category does not exist. Refresh categories and try again." });
    const result = await db.execute({ sql: "UPDATE products SET product_name = ?, description = ?, price = ?, stock_quantity = ?, unit = ?, category_id = ?, image_url = ?, is_active = ? WHERE product_id = ?", args: [name, description, price, stock, unit, categoryId, imageUrl, active ? 1 : 0, id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Product not found" });
    return res.json({ saved: true });
  } catch (error) {
    console.error("Admin product update error:", error);
    return res.status(500).json({ error: "Unable to update product" });
  }
});

app.get("/admin/orders", adminOnly, async (_req, res) => {
  try {
    await ensureAdminSchemas(false);
    const result = await db.execute("SELECT order_id, customer_name, order_status, total_amount, payment_method, placed_at, shipping_address FROM orders ORDER BY placed_at DESC, order_id DESC LIMIT 200");
    return res.json(result.rows);
  } catch (error) {
    console.error("Admin orders error:", error);
    return res.status(500).json({ error: "Unable to load orders" });
  }
});

app.get("/admin/orders/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid order" });
  try {
    await ensureAdminSchemas(false);
    const order = await db.execute({ sql: "SELECT o.*, u.full_name, u.email, u.phone_number FROM orders o LEFT JOIN users u ON u.user_id = o.user_id WHERE o.order_id = ?", args: [id] });
    if (!order.rows.length) return res.status(404).json({ error: "Order not found" });
    const items = await db.execute({ sql: "SELECT product_id, product_name, quantity, unit_price, unit, image_url FROM order_items WHERE order_id = ? ORDER BY rowid", args: [id] });
    return res.json({ ...order.rows[0], items: items.rows });
  } catch (error) {
    console.error("Admin order detail error:", error);
    return res.status(500).json({ error: "Unable to load order details" });
  }
});

app.patch("/admin/orders/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  const allowed = ["Pending", "Packed", "Out for Delivery", "Delivered", "Cancelled", "Processing", "Completed"];
  if (!Number.isSafeInteger(id) || id < 1 || !allowed.includes(status)) return res.status(400).json({ error: "Choose a valid order status" });
  try {
    await ensureAdminSchemas(false);
    const result = await db.execute({ sql: "UPDATE orders SET order_status = ? WHERE order_id = ?", args: [status, id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Order not found" });
    return res.json({ saved: true });
  } catch (error) {
    console.error("Admin order update error:", error);
    return res.status(500).json({ error: "Unable to update order" });
  }
});

app.get("/admin/customers", adminOnly, async (_req, res) => {
  try {
    const result = await db.execute("SELECT user_id, full_name, username, email, phone_number, account_status FROM users WHERE LOWER(role) != 'admin' ORDER BY full_name");
    return res.json(result.rows);
  } catch (error) {
    console.error("Admin customers error:", error);
    return res.status(500).json({ error: "Unable to load customer accounts" });
  }
});

app.get("/admin/customers/:id/orders", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid customer" });
  try {
    await ensureAdminSchemas(false);
    const result = await db.execute({ sql: "SELECT order_id, order_status, total_amount, placed_at FROM orders WHERE user_id = ? ORDER BY placed_at DESC", args: [id] });
    return res.json(result.rows);
  } catch (error) {
    console.error("Admin customer order history error:", error);
    return res.status(500).json({ error: "Unable to load customer order history" });
  }
});

app.patch("/admin/customers/:id", adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isSafeInteger(id) || id < 1 || !["Active", "Inactive"].includes(status)) return res.status(400).json({ error: "Choose Active or Inactive" });
  try {
    const result = await db.execute({ sql: "UPDATE users SET account_status = ? WHERE user_id = ? AND LOWER(role) != 'admin'", args: [status, id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: "Customer account not found" });
    return res.json({ saved: true });
  } catch (error) {
    console.error("Admin customer update error:", error);
    return res.status(500).json({ error: "Unable to update customer account" });
  }
});

module.exports = app;
