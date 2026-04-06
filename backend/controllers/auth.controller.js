const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user.model");

const normalizeRole = (value) => {
  const normalizedRole = String(value || "").trim();
  if (!normalizedRole) return normalizedRole;

  const canonicalRoles = {
    admin: "admin",
    manager: "manager",
    qc: "QC",
    dev: "dev",
    user: "user",
  };

  const byLowerCase = canonicalRoles[normalizedRole.toLowerCase()];
  return byLowerCase || normalizedRole;
};

/**
 * SIGN UP
 */
const signup = async (req, res) => {
  try {
    const { username, password, email, phone, name } = req.body;

    if (!username || !password || !email || !name) {
      return res.status(400).json({ message: "Missing required fields" });
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
    return res.status(500).json({ message: err.message });
  }
};

/**
 * SIGN IN
 */
const signin = async (req, res) => {
  try {
    const { username, password } = req.body;

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

    const normalizedRole = normalizeRole(user.role);

    const token = jwt.sign(
      {
        id: user._id,
        role: normalizedRole,
        email: user.email,
        name: user.name,
      },
      process.env.JWT_SECRET,
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
    return res.status(500).json({ message: err.message });
  }
};

// GET /users?role=QC
const getUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const requesterRole = normalizeRole(req.user?.role);
    const normalizedRequestedRole = role ? normalizeRole(role) : "";

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
        role: normalizeRole(user.role),
      })),
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
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
    return res.status(500).json({ message: err.message });
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

    if (String(targetUser.role || "").trim().toLowerCase() === "admin") {
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
    return res.status(500).json({ message: err.message });
  }
};

module.exports = {
  signup,
  signin,
  getUsers,
  changePassword,
  forceChangeUserPassword,
};
