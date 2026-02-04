const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const Inspector = require("../models/inspector.model");

/**
 * POST /users
 * Create a user (Admin/Manager)
 * If role is QC, create an inspector record and link it.
 */
exports.createUser = async (req, res) => {
  let createdUser = null;
  let inspectorRecord = null;

  try {
    const { username, password, email, phone, name, role } = req.body;

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

    createdUser = await User.create({
      username,
      password: hashedPassword,
      role: role || "user",
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

    return res.status(400).json({ message: err.message });
  }
};
