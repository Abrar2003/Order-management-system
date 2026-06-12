const User = require("../models/user.model");
const {
  ACCESS_COOKIE_NAME,
  getCookie,
  verifyAccessToken,
} = require("../services/authToken.service");
const {
  getUserBrandScope,
} = require("../services/userDataAccess.service");

const normalizeText = (value) => String(value || "").trim();

const getRequestToken = (req) => {
  const cookieToken = normalizeText(getCookie(req, ACCESS_COOKIE_NAME));
  if (cookieToken) return cookieToken;

  const authHeader = normalizeText(req.headers.authorization);
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return normalizeText(authHeader.slice("bearer ".length));
  }

  return "";
};

module.exports = async (req, res, next) => {
  try {
    const jwtSecret = String(process.env.JWT_SECRET || "").trim();
    if (!jwtSecret) {
      console.error("Auth middleware error: JWT_SECRET is not configured");
      return res.status(500).json({ message: "Authentication is not configured" });
    }

    const token = getRequestToken(req);
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = verifyAccessToken(token);
    const decodedUserId = String(decoded?.id || decoded?._id || "").trim();
    if (!decodedUserId) {
      return res.status(401).json({ message: "Invalid token" });
    }

    const user = await User.findById(decodedUserId)
      .select("-password")
      .populate("allowed_brands", "name")
      .lean();

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = {
      ...user,
      id: String(user._id || decodedUserId),
      brand_scope: getUserBrandScope({
        ...user,
        brand_scope: decoded?.brand_scope,
      }),
      brand_scope_choice_completed: Boolean(decoded?.brand_scope_choice_completed),
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
