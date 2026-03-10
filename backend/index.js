const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dns = require("dns");
const dotenv = require("dotenv");

dotenv.config({
  path: process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development",
});


const connectDB = require("./config/connectDB");
const orderRouter = require("./routers/orders.routes");
const authRouter = require("./routers/auth.routes");
const qcRouter = require("./routers/qc.routes");
const brandRouter = require("./routers/brand.route");
const inspectorRouter = require("./routers/inspector.routes");
const userRouter = require("./routers/user.routes");
const googleRouter = require("./routers/google.routes");
const itemRouter = require("./routers/items.routes");

const app = express();
const PORT = Number.parseInt(String(process.env.PORT || "8008"), 10) || 8008;

const isTruthy = (value) =>
  String(value || "")
    .trim()
    .toLowerCase() === "true";

const toList = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

if (isTruthy(process.env.FORCE_PUBLIC_DNS)) {
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
}

if (isTruthy(process.env.TRUST_PROXY)) {
  app.set("trust proxy", 1);
}

const allowedOrigins = toList(process.env.CORS_ORIGIN || process.env.CORS_ORIGINS);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: isTruthy(process.env.CORS_ALLOW_CREDENTIALS),
};

app.use(cors(corsOptions));
app.use(
  express.json({
    limit: String(process.env.JSON_BODY_LIMIT || "10mb"),
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    limit: String(process.env.URLENCODED_BODY_LIMIT || "10mb"),
  }),
);

app.use("/orders", orderRouter);
app.use("/auth", authRouter);
app.use("/qc", qcRouter);
app.use("/brands", brandRouter);
app.use("/inspectors", inspectorRouter);
app.use("/users", userRouter);
app.use("/google", googleRouter);
app.use("/items", itemRouter);

app.get("/", (req, res) => {
  res.send({ message: "Server OK" });
});

app.get("/healthz", (req, res) => {
  const readyStateMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const dbReadyState = mongoose.connection.readyState;
  const healthy = dbReadyState === 1;

  return res.status(healthy ? 200 : 503).json({
    ok: healthy,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: readyStateMap[dbReadyState] || "unknown",
    environment: process.env.NODE_ENV || "development",
  });
});

app.use((error, req, res, next) => {
  if (error?.message === "Not allowed by CORS") {
    return res.status(403).json({ message: error.message });
  }
  return next(error);
});

const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`Server started on port ${PORT}`);
    });

    const shutdown = (signal) => {
      console.log(`${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        try {
          await mongoose.connection.close(false);
          console.log("MongoDB connection closed.");
          process.exit(0);
        } catch (error) {
          console.error("Error while closing MongoDB connection:", error);
          process.exit(1);
        }
      });

      setTimeout(() => {
        console.error("Forced shutdown after timeout.");
        process.exit(1);
      }, 10000).unref();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
