const express = require("express");
const app = express.Router();

app.customPath = "/sanity";
app.get("/test", (req, res) => {
  res.send("you are sane! atleast");
});

module.exports = app;
//text
