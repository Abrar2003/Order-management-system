const express = require("express");
const connectDB = require("./config/connectDB");
const cors = require("cors");
require("dotenv").config();
const orderRouter = require("./routers/orders.route");

const app = express();
const PORT = process.env.PORT;

// 🔥 CORS MUST COME FIRST
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  })
);
app.use("/orders", orderRouter);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// routes AFTER middleware


app.get("/", (req, res) => {
  res.send({ message: "Server OK" });
});

app.listen(PORT, async () => {
  await connectDB();
  console.log(`Server started on port ${PORT}`);
});
