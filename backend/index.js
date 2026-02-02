const express = require("express");
const connectDB = require("./config/connectDB");
const cors = require("cors");
require("dotenv").config();
const orderRouter = require("./routers/orders.routes");
const authRouter = require("./routers/auth.routes");
const qcRouter = require("./routers/qc.routes");
const brandRouter = require("./routers/brand.route");
const inspectorRouter = require("./routers/inspector.routes");

const app = express();
const PORT = process.env.PORT;

// 🔥 CORS MUST COME FIRST
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  })
);

app.use((req, res, next) => {
  const contentType = req.headers["content-type"] || "";

  if (contentType.includes("multipart/form-data")) {
    // Let multer handle it
    return next();
  }

  // JSON / URLENCODED requests
  express.json()(req, res, next);
});

app.use(express.urlencoded({ extended: true }));

// routes AFTER middleware

app.use("/orders", orderRouter);
app.use("/auth", authRouter);
app.use("/qc", qcRouter);
app.use("/brands", brandRouter);
app.use("/inspectors", inspectorRouter);

app.get("/", (req, res) => {
  res.send({ message: "Server OK" });
});

app.listen(PORT, async () => {
  await connectDB();
  console.log(`Server started on port ${PORT}`);
});
