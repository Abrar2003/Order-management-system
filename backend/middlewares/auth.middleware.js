const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

module.exports = async (req, res, next) => {
  try {
    const jwtSecret = String(process.env.JWT_SECRET || "").trim();
    if (!jwtSecret) {
      console.error("Auth middleware error: JWT_SECRET is not configured");
      return res.status(500).json({ message: "Authentication is not configured" });
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, jwtSecret);
    const decodedUserId = String(decoded?.id || decoded?._id || "").trim();
    if (!decodedUserId) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await User.findById(decodedUserId).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user; // 🔥 THIS IS THE KEY
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
