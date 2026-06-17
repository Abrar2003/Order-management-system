const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const AuthSession = require("../models/authSession.model");
const User = require("../models/user.model");
const {
  REFRESH_COOKIE_MAX_AGE_MS,
  clearAuthCookies,
  getCookie,
  hashToken,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  REFRESH_COOKIE_NAME,
} = require("../services/authToken.service");
const {
  isAdminLikeRole,
  normalizeUserRole,
} = require("../helpers/userRole");
const {
  logSecurityActivity,
} = require("../services/securityMonitoringService");
const {
  hasDataAccessFilter,
  isQcUser,
} = require("../services/userDataAccess.service");

const isTruthy = (value) =>
  ["1", "true", "yes", "y", "on"].includes(
    String(value ?? "").trim().toLowerCase(),
  );

const normalizeBrandScope = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "giga") return "giga";
  if (normalized === "dutch" || normalized === "dutch_interior") return "dutch";
  return "all";
};

const getStringField = (source = {}, key) => {
  const value = source?.[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
};

const buildSafeUser = (user = {}) => ({
  id: user._id,
  username: user.username,
  role: normalizeUserRole(user.role, String(user.role || "").trim()),
  name: user.name,
  email: user.email,
  brand_scope: isQcUser(user) || hasDataAccessFilter(user)
    ? "all"
    : normalizeBrandScope(user.brand_scope),
  is_qc_user: isQcUser(user),
  has_data_access_filter: hasDataAccessFilter(user),
  requires_brand_scope_choice:
    !isQcUser(user) &&
    !hasDataAccessFilter(user) &&
    !Boolean(user.brand_scope_choice_completed),
});

const logAuthSecurityActivity = (req, payload) => {
  logSecurityActivity(req, payload).catch((error) => {
    console.warn("[security] auth activity log failed", {
      action: payload?.action,
      message: error?.message || String(error),
    });
  });
};

const createAuthSession = async ({
  user,
  req,
  brandScope = "all",
  brandScopeChoiceCompleted = false,
}) => {
  console.log("[LOGIN_DEBUG] createAuthSession called:", { userId: user._id, brandScope, brandScopeChoiceCompleted });
  const session = await AuthSession.create({
    user: user._id,
    token_hash: "pending",
    expires_at: new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_MS),
    user_agent: getStringField(req.headers, "user-agent"),
    ip: getStringField(req.headers, "x-forwarded-for") || req.ip || "",
    brand_scope: normalizeBrandScope(brandScope),
    brand_scope_choice_completed: Boolean(brandScopeChoiceCompleted),
  });
  console.log("[LOGIN_DEBUG] AuthSession created in DB:", session._id);
  const refreshToken = signRefreshToken({ user, sessionId: session._id });
  session.token_hash = hashToken(refreshToken);
  await session.save();
  console.log("[LOGIN_DEBUG] AuthSession token_hash saved");
  return { session, refreshToken };
};

const issueAuthCookies = async ({
  res,
  req,
  user,
  session = null,
  brandScope = null,
  brandScopeChoiceCompleted = null,
}) => {
  console.log("[LOGIN_DEBUG] issueAuthCookies called for user:", user?._id || user?.id);
  const normalizedBrandScope = normalizeBrandScope(
    brandScope ?? session?.brand_scope ?? user?.brand_scope,
  );
  const normalizedBrandScopeChoiceCompleted = Boolean(
    brandScopeChoiceCompleted ??
      session?.brand_scope_choice_completed ??
      user?.brand_scope_choice_completed,
  );
  const tokenUser = {
    ...user,
    brand_scope: normalizedBrandScope,
    brand_scope_choice_completed: normalizedBrandScopeChoiceCompleted,
  };
  console.log("[LOGIN_DEBUG] Generating access token for user properties:", {
    id: tokenUser._id || tokenUser.id,
    role: tokenUser.role,
    brand_scope: tokenUser.brand_scope,
    brand_scope_choice_completed: tokenUser.brand_scope_choice_completed
  });
  const accessToken = signAccessToken(tokenUser);
  let refreshToken = "";
  let activeSession = session;

  if (activeSession) {
    console.log("[LOGIN_DEBUG] Reusing active session:", activeSession._id);
    refreshToken = signRefreshToken({ user, sessionId: activeSession._id });
    activeSession.token_hash = hashToken(refreshToken);
    activeSession.expires_at = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE_MS);
    activeSession.rotated_at = new Date();
    activeSession.last_used_at = new Date();
    activeSession.brand_scope = normalizedBrandScope;
    activeSession.brand_scope_choice_completed = normalizedBrandScopeChoiceCompleted;
    await activeSession.save();
    console.log("[LOGIN_DEBUG] Active session updated in DB");
  } else {
    console.log("[LOGIN_DEBUG] Creating new session...");
    const created = await createAuthSession({
      user,
      req,
      brandScope: normalizedBrandScope,
      brandScopeChoiceCompleted: normalizedBrandScopeChoiceCompleted,
    });
    activeSession = created.session;
    refreshToken = created.refreshToken;
  }

  console.log("[LOGIN_DEBUG] Setting auth cookies on response");
  setAuthCookies(res, { accessToken, refreshToken });
  return activeSession;
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
    const brandScope = "all";

    console.log("[LOGIN_DEBUG] Signin request received:", {
      username,
      hasPassword: !!password,
      passwordLength: password ? password.length : 0,
      bodyKeys: Object.keys(req.body)
    });

    if (!username || !password) {
      console.log("[LOGIN_DEBUG] Missing credentials");
      logAuthSecurityActivity(req, {
        action: "login_failed",
        resource_type: "auth",
        metadata: { username, reason: "missing_credentials" },
      });
      return res.status(400).json({ message: "Missing credentials" });
    }

    console.log("[LOGIN_DEBUG] Querying DB for user strictly matching username (case-sensitive):", username);
    const user = await User.findOne({ username });
    
    if (!user) {
      console.log("[LOGIN_DEBUG] User not found in database for strict username:", username);
      logAuthSecurityActivity(req, {
        action: "login_failed",
        resource_type: "auth",
        metadata: { username, reason: "invalid_username" },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    console.log("[LOGIN_DEBUG] User found in database:", {
      _id: user._id,
      username: user.username,
      role: user.role,
      email: user.email,
      hasHashedPassword: !!user.password
    });

    console.log("[LOGIN_DEBUG] Comparing passwords using bcrypt...");
    const isMatch = await bcrypt.compare(password, user.password);
    console.log("[LOGIN_DEBUG] Bcrypt compare result:", isMatch);

    if (!isMatch) {
      console.log("[LOGIN_DEBUG] Password did not match for user:", username);
      logAuthSecurityActivity(
        { ...req, user },
        {
          action: "login_failed",
          resource_type: "auth",
          resource_id: user._id,
          metadata: {
            user_id: user._id,
            username,
            role: user.role,
            reason: "invalid_password",
          },
        },
      );
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const normalizedRole = normalizeUserRole(user.role, String(user.role || "").trim());
    console.log("[LOGIN_DEBUG] User role normalized:", {
      originalRole: user.role,
      normalizedRole
    });

    console.log("[LOGIN_DEBUG] Issuing auth cookies for user session...");
    await issueAuthCookies({
      res,
      req,
      user: {
        ...user.toObject(),
        role: normalizedRole,
        brand_scope: brandScope,
        brand_scope_choice_completed: false,
      },
      brandScope,
      brandScopeChoiceCompleted: false,
    });
    console.log("[LOGIN_DEBUG] Auth cookies issued successfully");

    logAuthSecurityActivity(
      { ...req, user: { ...user.toObject(), role: normalizedRole } },
      {
        action: "login_success",
        resource_type: "auth",
        resource_id: user._id,
        metadata: {
          user_id: user._id,
          username,
          role: normalizedRole,
          brand_scope: brandScope,
          brand_scope_choice_completed: false,
        },
      },
    );

    console.log("[LOGIN_DEBUG] Login flow successful, sending response user:", buildSafeUser({
      ...user.toObject(),
      role: normalizedRole,
      brand_scope: brandScope,
      brand_scope_choice_completed: false,
    }));

    return res.json({
      user: buildSafeUser({
        ...user.toObject(),
        role: normalizedRole,
        brand_scope: brandScope,
        brand_scope_choice_completed: false,
      }),
    });
  } catch (err) {
    console.error("[LOGIN_DEBUG] Exception in signin flow:", err);
    return res.status(500).json({ message: "Failed to sign in" });
  }
};

const refresh = async (req, res) => {
  try {
    const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Refresh token is required" });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const sessionId = getStringField(decoded, "sid");
    const userId = getStringField(decoded, "sub");
    if (
      decoded?.typ !== "refresh" ||
      !mongoose.Types.ObjectId.isValid(sessionId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const session = await AuthSession.findById(sessionId);
    if (!session || String(session.user) !== userId) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Invalid refresh session" });
    }

    if (session.revoked_at || session.expires_at <= new Date()) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Refresh session expired" });
    }

    if (session.token_hash !== hashToken(refreshToken)) {
      await AuthSession.updateMany(
        { user: session.user, revoked_at: null },
        { $set: { revoked_at: new Date() } },
      );
      clearAuthCookies(res);
      return res.status(401).json({ message: "Refresh token was reused" });
    }

    const user = await User.findById(userId).select("-password");
    if (!user) {
      session.revoked_at = new Date();
      await session.save();
      clearAuthCookies(res);
      return res.status(401).json({ message: "User not found" });
    }

    await issueAuthCookies({
      res,
      req,
      user: {
        ...user.toObject(),
        brand_scope: session.brand_scope,
        brand_scope_choice_completed: session.brand_scope_choice_completed,
      },
      session,
    });

    return res.json({
      user: buildSafeUser({
        ...user.toObject(),
        brand_scope: session.brand_scope,
        brand_scope_choice_completed: session.brand_scope_choice_completed,
      }),
    });
  } catch (err) {
    clearAuthCookies(res);
    return res.status(401).json({ message: "Invalid refresh token" });
  }
};

const logout = async (req, res) => {
  try {
    const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
    let decodedUserId = "";
    if (refreshToken) {
      try {
        const decoded = verifyRefreshToken(refreshToken);
        const sessionId = getStringField(decoded, "sid");
        decodedUserId = getStringField(decoded, "sub");
        if (mongoose.Types.ObjectId.isValid(sessionId)) {
          await AuthSession.findByIdAndUpdate(sessionId, {
            $set: { revoked_at: new Date() },
          });
        }
      } catch {
        // Always clear cookies even if the refresh token is already invalid.
      }
    }

    logAuthSecurityActivity(req, {
      action: "logout",
      resource_type: "auth",
      resource_id: decodedUserId,
      metadata: {
        user_id: decodedUserId,
      },
    });

    clearAuthCookies(res);
    return res.json({ message: "Logged out successfully" });
  } catch (err) {
    clearAuthCookies(res);
    return res.json({ message: "Logged out successfully" });
  }
};

const me = async (req, res) =>
  res.json({
    user: buildSafeUser(req.user),
  });

const updateBrandScope = async (req, res) => {
  try {
    const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Refresh token is required" });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const sessionId = getStringField(decoded, "sid");
    const userId = getStringField(decoded, "sub");
    const requestUserId = getStringField(req.user, "_id") || getStringField(req.user, "id");

    if (
      decoded?.typ !== "refresh" ||
      !mongoose.Types.ObjectId.isValid(sessionId) ||
      !mongoose.Types.ObjectId.isValid(userId) ||
      String(userId) !== String(requestUserId)
    ) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const session = await AuthSession.findById(sessionId);
    if (!session || String(session.user) !== userId) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Invalid refresh session" });
    }

    if (session.revoked_at || session.expires_at <= new Date()) {
      clearAuthCookies(res);
      return res.status(401).json({ message: "Refresh session expired" });
    }

    if (session.token_hash !== hashToken(refreshToken)) {
      await AuthSession.updateMany(
        { user: session.user, revoked_at: null },
        { $set: { revoked_at: new Date() } },
      );
      clearAuthCookies(res);
      return res.status(401).json({ message: "Refresh token was reused" });
    }

    const requestedScope = normalizeBrandScope(
      req.body?.brand_scope ?? req.body?.brandScope,
    );
    const nextBrandScope = isQcUser(req.user) || hasDataAccessFilter(req.user)
      ? "all"
      : requestedScope;

    await issueAuthCookies({
      res,
      req,
      user: {
        ...req.user,
        brand_scope: nextBrandScope,
        brand_scope_choice_completed: true,
      },
      session,
      brandScope: nextBrandScope,
      brandScopeChoiceCompleted: true,
    });

    return res.json({
      user: buildSafeUser({
        ...req.user,
        brand_scope: nextBrandScope,
        brand_scope_choice_completed: true,
      }),
    });
  } catch (err) {
    clearAuthCookies(res);
    return res.status(401).json({ message: "Invalid refresh token" });
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
      .select("_id name role email username allowed_brands allowed_vendors") // never send password
      .populate("allowed_brands", "name")
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
  refresh,
  logout,
  me,
  updateBrandScope,
  getUsers,
  changePassword,
  forceChangeUserPassword,
};
