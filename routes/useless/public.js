const express = require("express");
const app = express.Router();
const path = require("path");

app.customPath = "/";

const filesPath = path.join(__dirname, "../../files");

app.use(express.static(filesPath));

app.get("/", (req, res) => {
  console.log("Route hit: /");
  res.redirect("/api/databaseChecker");
});

app.get("/login", (req, res) => {
  console.log("Route hit: /loginPage");
  res.clearCookie("auth");
  res.sendFile(path.join(filesPath, "LoginPage.html"));
});

app.get("/register", (req, res) => {
  console.log("Route hit: /registerPage");
  res.clearCookie("auth");
  res.sendFile(path.join(filesPath, "RegisterPage.html"));
});

app.get("/faqs", (req, res) => {
  console.log("Route hit: /faqs");
  res.sendFile(path.join(filesPath, "FAQs.html"));
});

app.get("/store", (req, res) => {
  console.log("Route hit: /store");
  res.sendFile(path.join(filesPath, "storepage.html"));
});

app.get("/product", (req, res) => {
  console.log("Route hit: /product");

  res.sendFile(path.join(filesPath, "productpage.html"));
});

module.exports = app;
