const mongoose = require("mongoose");

const connectDB = async () => {
  const MONGO_URI = process.env.MONGO_URI
  try {
    const conn = await mongoose.connect(MONGO_URI);
    console.log(`Connected to mongodb ${conn.connection.host}`);
  } catch (err) {
    console.log("Error in mongoDB", err);
  }
};

module.exports = connectDB;