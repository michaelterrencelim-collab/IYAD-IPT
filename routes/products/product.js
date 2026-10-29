const express = require("express");
const app = express.Router();
const { checkAuth } = require("../../imports/token");
const db = require("../../imports/database");
const productImageUrl = require("../../imports/productImageUrl");

app.customPath = "/api";

app.get("/fetchProducts", async (req, res) => {
  const { productId } = req.query;

  try {
    const params = [];
    // Only fetch active products by default for the mobile UI
    let conditions = ["p.is_active = 1"];

    if (productId) {
      conditions.push("p.product_id = ?");
      params.push(productId);
    }

    const whereClause = "WHERE " + conditions.join(" AND ");

    const result = await db.execute({
      sql: `
        SELECT
          p.product_id,
          p.product_name,
          p.description,
          p.price,
          p.stock_quantity,
          p.unit,
          p.image_url,
          p.is_active,

          c.category_id,
          c.category_name,
          c.description AS category_description

        FROM products p
        LEFT JOIN categories c
          ON p.category_id = c.category_id

        ${whereClause}

        ORDER BY
          p.product_id ASC
      `,
      args: params,
    });

    // Format rows into a clean JSON structure
    const products = result.rows.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      description: row.description,
      price: row.price,
      stock_quantity: row.stock_quantity,
      unit: row.unit,
      image_url: productImageUrl(row.image_url),
      is_active: Boolean(row.is_active),
      category: row.category_id
        ? {
            category_id: row.category_id,
            category_name: row.category_name,
            description: row.category_description,
          }
        : null,
    }));

    res.json(productId ? products[0] || null : products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      error: "Failed to fetch products",
    });
  }
});

module.exports = app;
