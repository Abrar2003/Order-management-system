const express = require("express");
const connectDB = require("./connectDB");
const cors = require("cors");
require("dotenv").config();
// const urlRouter = require("./routes/url.route");
// const analyticsRouter = require("./routes/analytics.route");


const app = express();
const PORT = process.env.PORT;

app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());
//app.use("/", urlRouter)
//app.use("/analytics", analyticsRouter)

app.get("/", (req, res) => {
    const ip = req.ip;
    res.send({message: `Hello, ${ip}`});
});

app.listen(PORT, async() => {
  await connectDB();
  console.log(`server started on port ${PORT}`);
});
module.exports= app;