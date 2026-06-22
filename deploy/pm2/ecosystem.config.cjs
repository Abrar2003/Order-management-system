const path = require("path");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
  apps: [
    {
      name: "oms-backend",
      cwd: path.resolve(__dirname, "../../backend"),
      script: "index.js",

      instances: parsePositiveInt(process.env.PM2_WEB_INSTANCES, 2),
      exec_mode: "cluster",

      autorestart: true,
      watch: false,
      max_memory_restart: "700M",

      env: {
        NODE_ENV: "production",
        PORT: 8008,
      },
    },
    {
      name: "oms-worker",
      cwd: path.resolve(__dirname, "../../backend"),
      script: "worker.js",

      instances: parsePositiveInt(process.env.PM2_WORKER_INSTANCES, 1),
      exec_mode: "fork",

      autorestart: true,
      watch: false,
      max_memory_restart: "900M",

      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
