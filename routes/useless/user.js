const express = require("express");
const path = require("path");

const app = express.Router();
const { requireAuth } = require("../../imports/token");
const filesPath = path.join(__dirname, "../../files");
app.use(express.static(filesPath));

app.customPath = "/user";
app.get("/shopping", requireAuth("user"), (req, res) => {
  console.log("Route hit: /user/shoppingCart");
  res.sendFile(path.join(filesPath, "shoppingcart.html"));
});

app.get("/order", requireAuth("user"), (req, res) => {
  console.log("Route hit: /user/orderHistory");
  res.sendFile(path.join(filesPath, "Orderhistory.html"));
});

app.get("/profile", requireAuth("user"), (req, res) => {
  console.log("Route hit: /user/profile");
  res.sendFile(path.join(filesPath, "ProfilePage.html"));
});

app.get("/reviews", requireAuth("user"), (req, res) => {
  console.log("Route hit: /user/reviews");
  res.sendFile(path.join(filesPath, "Review.html"));
});

app.use((req, res) => {
  res.status(404).sendFile(
    path.join(__dirname, "public", "404.html")
  );
});

module.exports = app;
