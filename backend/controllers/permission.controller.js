const {
  getAllRolePermissions,
  getEffectivePermissionsForUser,
  resetRolePermissions,
  saveRolePermissions,
} = require("../services/permission.service");
const { ROLE_KEYS, normalizeRoleKey } = require("../helpers/permissions");
const User = require("../models/user.model");
const Brand = require("../models/brand.model");
const Vendor = require("../models/vendor.model");
const {
  assertBrandIdsExist,
  buildUserAccessUpdate,
  serializeUserDataAccess,
} = require("../services/userDataAccess.service");

const getPermissions = async (_req, res) => {
  try {
    const payload = await getAllRolePermissions();
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("Get permissions error:", error);
    return res.status(500).json({ message: "Failed to fetch permissions" });
  }
};

const getMyPermissions = async (req, res) => {
  try {
    const payload = await getEffectivePermissionsForUser(req.user);
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("Get current permissions error:", error);
    return res.status(500).json({ message: "Failed to fetch current permissions" });
  }
};

const updateRolePermissions = async (req, res) => {
  try {
    const role = normalizeRoleKey(req.params.role);
    if (!ROLE_KEYS.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const updated = await saveRolePermissions({
      role,
      permissions: req.body?.permissions || {},
      actor: req.user,
      auditAction: "update",
    });

    return res.json({
      success: true,
      role: updated,
      message: "Permissions updated successfully",
    });
  } catch (error) {
    console.error("Update permissions error:", error);
    return res.status(500).json({ message: "Failed to update permissions" });
  }
};

const getUserDataAccessSettings = async (_req, res) => {
  try {
    const [users, brands, vendors] = await Promise.all([
      User.find({})
        .select("_id name username email role allowed_brands allowed_vendors")
        .populate("allowed_brands", "name")
        .sort({ name: 1, username: 1 })
        .lean(),
      Brand.find({}).select("_id name").sort({ name: 1 }).lean(),
      Vendor.find({}).select("_id name").sort({ name: 1 }).lean(),
    ]);

    return res.json({
      success: true,
      brands: brands.map((brand) => ({
        _id: String(brand._id),
        name: brand.name,
      })),
      vendors: vendors.map((vendor) => ({
        _id: String(vendor._id),
        name: vendor.name,
      })),
      users: users.map((user) => ({
        _id: String(user._id),
        name: user.name,
        username: user.username,
        email: user.email,
        role: normalizeRoleKey(user.role),
        data_access: serializeUserDataAccess(user),
      })),
    });
  } catch (error) {
    console.error("Get user data access settings error:", error);
    return res.status(500).json({ message: "Failed to fetch user data access settings" });
  }
};

const updateUserDataAccessSettings = async (req, res) => {
  try {
    const accessUpdate = buildUserAccessUpdate(req.body);
    await assertBrandIdsExist(accessUpdate.allowed_brands);

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      {
        $set: {
          allowed_brands: accessUpdate.allowed_brands,
          allowed_vendors: accessUpdate.allowed_vendors,
        },
      },
      { new: true },
    )
      .select("_id name username email role allowed_brands allowed_vendors")
      .populate("allowed_brands", "name")
      .lean();

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      success: true,
      message: "User data access updated successfully",
      user: {
        _id: String(updatedUser._id),
        name: updatedUser.name,
        username: updatedUser.username,
        email: updatedUser.email,
        role: normalizeRoleKey(updatedUser.role),
        data_access: serializeUserDataAccess(updatedUser),
      },
    });
  } catch (error) {
    console.error("Update user data access settings error:", error);
    return res.status(error?.statusCode || 500).json({
      message: error?.message || "Failed to update user data access settings",
    });
  }
};

const resetRolePermissionDefaults = async (req, res) => {
  try {
    const role = normalizeRoleKey(req.params.role);
    if (!ROLE_KEYS.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const updated = await resetRolePermissions({ role, actor: req.user });
    return res.json({
      success: true,
      role: updated,
      message: "Permissions reset to default",
    });
  } catch (error) {
    console.error("Reset permissions error:", error);
    return res.status(500).json({ message: "Failed to reset permissions" });
  }
};

module.exports = {
  getMyPermissions,
  getPermissions,
  getUserDataAccessSettings,
  resetRolePermissionDefaults,
  updateUserDataAccessSettings,
  updateRolePermissions,
};
