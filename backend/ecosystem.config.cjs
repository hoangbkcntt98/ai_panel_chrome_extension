const fs = require("fs");
const path = require("path");

// Parse .env thủ công
const envFile = path.join(__dirname, ".env");
const env = {};
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      env[key] = val;
    });
}

module.exports = {
  apps: [{
    name: "ai-panel-backend",
    script: "server.mjs",
    cwd: __dirname,
    env,
  }],
};
