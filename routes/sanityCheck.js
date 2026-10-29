const express = require("express");
const app = express.Router();

app.customPath = "/sanity";
app.get("/test", (req, res) => {
  res.send("you are sane!");
});

module.exports = app;
//text
