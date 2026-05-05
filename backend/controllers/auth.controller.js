const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const {
  isAdminLikeRole,
  normalizeUserRole,
} = require("../helpers/userRole");

const isTruthy = (value) =>
  ["1", "true", "yes", "y", "on"].includes(
    String(value ?? "").trim().toLowerCase(),
  );

const getStringField = (source = {}, key) => {
  const value = source?.[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
};

const getRequiredJwtSecret = () => {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
};

/**
 * SIGN UP
 */
const signup = async (req, res) => {
  try {
    if (!isTruthy(process.env.ALLOW_PUBLIC_SIGNUP)) {
      return res.status(403).json({
        message: "Public signup is disabled. Ask an administrator to create the user.",
      });
    }

    const username = getStringField(req.body, "username");
    const password = getStringField(req.body, "password");
    const email = getStringField(req.body, "email").toLowerCase();
    const phone = getStringField(req.body, "phone");
    const name = getStringField(req.body, "name");

    if (!username || !password || !email || !name) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      username,
      password: hashedPassword,
      role: "user",
      email,
      phone,
      name,
    });

    return res.status(201).json({
      message: "User registered successfully",
    });
  } catch (err) {
    console.error("Signup Error:", err);
    return res.status(500).json({ message: "Failed to register user" });
  }
};

/**
 * SIGN IN
 */
const signin = async (req, res) => {
  try {
    const username = getStringField(req.body, "username");
    const password = getStringField(req.body, "password");

    if (!username || !password) {
      return res.status(400).json({ message: "Missing credentials" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const normalizedRole = normalizeUserRole(user.role, String(user.role || "").trim());

    const token = jwt.sign(
      {
        id: user._id,
        role: normalizedRole,
        email: user.email,
        name: user.name,
      },
      getRequiredJwtSecret(),
      { expiresIn: "1d" },
    );

    return res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        role: normalizedRole,
        name: user.name,
      },
    });
  } catch (err) {
    console.error("Signin Error:", err);
    return res.status(500).json({ message: "Failed to sign in" });
  }
};

// GET /users?role=QC
const getUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const requesterRole = normalizeUserRole(req.user?.role);
    const normalizedRequestedRole = role ? normalizeUserRole(role) : "";

    if (
      requesterRole === "user"
      && normalizedRequestedRole !== "QC"
    ) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const filter = {};
    if (role) {
      filter.role = normalizedRequestedRole === "dev"
        ? { $regex: "^dev$", $options: "i" }
        : normalizedRequestedRole;
    }

    const users = await User.find(filter)
      .lean()
      .select("_id name role email username") // never send password
      .sort({ name: 1 });

    res.json(
      users.map((user) => ({
        ...user,
        role: normalizeUserRole(user.role, String(user.role || "").trim()),
      })),
    );
  } catch (err) {
    console.error("Get Users Error:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
};

/**
 * PATCH /auth/change-password
 * Update own password after verifying current password.
 */
const changePassword = async (req, res) => {
  try {
    const currentPassword = String(
      req.body?.current_password ?? req.body?.currentPassword ?? "",
    );
    const newPassword = String(
      req.body?.new_password ?? req.body?.newPassword ?? "",
    );
    const confirmPassword = String(
      req.body?.confirm_password ?? req.body?.confirmPassword ?? "",
    );

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: "Current password, new password, and confirm password are required",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "New passwords do not match" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters",
      });
    }

    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId).select("password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const isSameAsOldPassword = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOldPassword) {
      return res.status(400).json({
        message: "New password must be different from current password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } },
    );

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Change Password Error:", err);
    return res.status(500).json({ message: "Failed to update password" });
  }
};

/**
 * PATCH /auth/force-change-password
 * Force change password of another user (except admin targets).
 */
const forceChangeUserPassword = async (req, res) => {
  try {
    const targetUserId = String(
      req.body?.user_id ?? req.body?.userId ?? "",
    ).trim();
    const newPassword = String(
      req.body?.new_password ?? req.body?.newPassword ?? "",
    );
    const confirmPassword = String(
      req.body?.confirm_password ?? req.body?.confirmPassword ?? "",
    );

    if (!targetUserId || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: "user_id, new_password, and confirm_password are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ message: "Invalid user_id" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "New passwords do not match" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters",
      });
    }

    const targetUser = await User.findById(targetUserId).select("password role name email");
    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    if (isAdminLikeRole(targetUser.role)) {
      return res.status(403).json({
        message: "Admin passwords cannot be force changed by this route",
      });
    }

    const isSameAsOldPassword = await bcrypt.compare(newPassword, targetUser.password);
    if (isSameAsOldPassword) {
      return res.status(400).json({
        message: "New password must be different from current password",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updateOne(
      { _id: targetUser._id },
      { $set: { password: hashedPassword } },
    );

    return res.status(200).json({
      message: "Password force changed successfully",
      data: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
      },
    });
  } catch (err) {
    console.error("Force Change Password Error:", err);
    return res.status(500).json({ message: "Failed to force change password" });
  }
};

module.exports = {
  signup,
  signin,
  getUsers,
  changePassword,
  forceChangeUserPassword,
};
