const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const Inspector = require("../models/inspector.model");
const { USER_ROLES, normalizeUserRole } = require("../helpers/userRole");

const ALLOWED_ROLES = new Set(USER_ROLES);

const getStringField = (source = {}, key) => {
  const value = source?.[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
};

/**
 * POST /users
 * Create a user (Admin/Manager)
 * If role is QC, create an inspector record and link it.
 */
exports.createUser = async (req, res) => {
  let createdUser = null;
  let inspectorRecord = null;

  try {
    const username = getStringField(req.body, "username");
    const password = getStringField(req.body, "password");
    const email = getStringField(req.body, "email").toLowerCase();
    const phone = getStringField(req.body, "phone");
    const name = getStringField(req.body, "name");
    const role = normalizeUserRole(getStringField(req.body, "role"), "user");

    if (!username || !password || !email || !name) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    createdUser = await User.create({
      username,
      password: hashedPassword,
      role,
      email,
      phone,
      name,
      isQC: role === "QC",
    });

    if (createdUser.role === "QC") {
      inspectorRecord = await Inspector.create({
        user: createdUser._id,
      });

      createdUser.isQC = true;
      createdUser.inspector_id = inspectorRecord._id;
      await createdUser.save();
    }

    const safeUser = await User.findById(createdUser._id).select("-password");

    return res.status(201).json({
      message: "User created successfully",
      data: safeUser,
      inspector: inspectorRecord,
    });
  } catch (err) {
    if (createdUser?.role === "QC") {
      await Inspector.deleteOne({ user: createdUser._id });
      await User.findByIdAndDelete(createdUser._id);
    }

    console.error("Create User Error:", err);

    if (Number(err?.code || 0) === 11000) {
      return res.status(409).json({ message: "User already exists" });
    }

    return res.status(400).json({ message: "Failed to create user" });
  }
};
