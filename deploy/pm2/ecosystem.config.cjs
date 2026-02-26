module.exports = {
  apps: [
    {
      name: "oms-backend",
      cwd: "/var/www/order-management-system/backend",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 8008,
      },
    },
  ],
};
