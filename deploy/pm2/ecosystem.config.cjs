const path = require("path");

module.exports = {
  apps: [
    {
      name: "oms-backend",
      cwd: path.resolve(__dirname, "../../backend"),
      script: "index.js",

      instances: 2,
      exec_mode: "cluster",

      autorestart: true,
      watch: false,
      max_memory_restart: "700M",

      env: {
        NODE_ENV: "production",
        PORT: 8008,
      },
    },
  ],
};