const express = require("express");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const auth = require("../middlewares/auth.middleware");
const authorize = require("../middlewares/authorize.middleware");

const router = express.Router();
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
];

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

function createOAuthState(user) {
  return jwt.sign(
    {
      sub: String(user?._id || user?.id || ""),
      purpose: "google-oauth-setup",
    },
    getJwtSecret(),
    { expiresIn: "10m" },
  );
}

function verifyOAuthState(state) {
  const decoded = jwt.verify(String(state || "").trim(), getJwtSecret());
  if (decoded?.purpose !== "google-oauth-setup" || !decoded?.sub) {
    throw new Error("Invalid OAuth state");
  }
  return decoded;
}

// Visit once in browser while logged into the calendar-owner Google account
router.get("/auth", auth, authorize("admin", "dev"), (req, res) => {
  try {
    const oauth2Client = getOAuthClient();
    const state = createOAuthState(req.user);

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: OAUTH_SCOPES,
      state,
    });

    return res.redirect(url);
  } catch (error) {
    console.error("Google OAuth auth URL error:", error);
    return res.status(500).json({ message: "Failed to start Google OAuth flow" });
  }
});

// Google redirects here
router.get("/callback", async (req, res) => {
  try {
    const oauth2Client = getOAuthClient();
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();

    if (!code || !state) {
      return res.status(400).json({ message: "Missing OAuth code or state" });
    }

    verifyOAuthState(state);
    const { tokens } = await oauth2Client.getToken(code);

    // IMPORTANT: Save tokens.refresh_token securely (env/DB/secret store).
    return res.json({
      message: "OAuth success. Copy refresh_token and store it as GOOGLE_REFRESH_TOKEN.",
      refresh_token: tokens.refresh_token,
    });
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return res.status(400).json({ message: "Google OAuth callback failed" });
  }
});

module.exports = router;
