const db = require("./database");

async function initializeDatabase() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cart (
      cart_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const result = await db.execute("PRAGMA table_info(products)");
  const hasActiveColumn = result.rows.some((column) => column.name === "is_active");

  if (!hasActiveColumn) {
    await db.execute(`
      ALTER TABLE products
      ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
      CHECK (is_active IN (0, 1))
    `);
    console.log("Added products.is_active column; existing products remain active.");
  }
}

module.exports = initializeDatabase;
