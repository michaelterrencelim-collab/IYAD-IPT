const express = require("express");
const app = express.Router();

app.customPath = "/api";

app.post("/logout", (req, res) => {
  res.clearCookie("auth", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return res.json({ logout: "success" });
});

module.exports = app;
