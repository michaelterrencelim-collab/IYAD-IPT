const { createClient } = require("@libsql/client");

const db = createClient({
  url: process.env.TURSO_LINK,
  authToken: process.env.TURSO_TOKEN,
});

module.exports = db;
