require("dotenv").config();

const express = require("express");

const app = express();
const PORT = 3001;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`AI Sales Coach backend listening on port ${PORT}`);
});