/**
 * GO TO
 * /api/databaseChecker
 *
 * IF YOU WANNA SEE THE TABLE!
 *
 */


const express = require("express");
const path = require("path");
const db = require("../../imports/database");

const app = express.Router();

app.customPath = "/api/databaseChecker";

// Open the database checker page
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../files/databaseMan.html")
  );
});

app.get("/home", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../files/databaseMan.html")
  );
});

// Test the database and list existing tables
app.get("/tables", async (req, res) => {
  try {
    const result = await db.execute({
      sql: `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `,
      args: [],
    });

    res.json({
      success: true,
      message: "Database query successful",
      tables: result.rows.map((row) => row.name),
    });
  } catch (error) {
    console.error("Database diagnostic failed:", error);

    res.status(500).json({
      success: false,
      message: "Database query failed",
      error: error.message,
      code: error.code || null,
    });
  }
});

module.exports = app;

