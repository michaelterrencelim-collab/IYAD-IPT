const express = require("express");
const path = require("path");
const { requireAuth } = require("../../imports/token");

const app = express.Router();

const filesPath = path.join(__dirname, "../../files");
app.use(express.static(filesPath));

app.customPath = "/admin";
app.get("/dashboard", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/dashboard");
  res.sendFile(path.join(filesPath, "AdminDashboard.html"));
});

app.get("/accountManagement", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/accountManagement");
  res.sendFile(path.join(filesPath, "AccountManagement.html"));
});

app.get("/contentManagement", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/contentManagement");
  res.sendFile(path.join(filesPath, "ContentManagement.html"));
});

app.get("/audit", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/audit");
  res.sendFile(path.join(filesPath, "Audit.html"));
});

app.get("/ordersReports", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/ordersReports");
  res.sendFile(path.join(filesPath, "OrdersReports.html"));
});

app.get("/productsReports", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/productsReports");
  res.sendFile(path.join(filesPath, "Products & Reports.html"));
});

app.get("/salesReport", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/salesReport");
  res.sendFile(path.join(filesPath, "SalesReport.html"));
});

app.get("/stocksInventory", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/stocksInventory");
  res.sendFile(path.join(filesPath, "StocksInventory.html"));
});

app.get("/settings", requireAuth("admin"), (req, res) => {
  console.log("Route hit: /admin/settings");
  res.sendFile(path.join(filesPath, "SettingsConfig.html"));
});

module.exports = app;
