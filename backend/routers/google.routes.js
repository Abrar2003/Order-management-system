const express = require("express");
const { google } = require("googleapis");

const router = express.Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Visit once in browser while logged into the calendar-owner Google account
router.get("/auth", (req, res) => {
  const oauth2Client = getOAuthClient();

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  res.redirect(url);
});

// Google redirects here
router.get("/callback", async (req, res) => {
  const oauth2Client = getOAuthClient();
  const { code } = req.query;

  const { tokens } = await oauth2Client.getToken(code);

  // IMPORTANT: Save tokens.refresh_token securely (env/DB/secret store)
  res.json({
    message: "OAuth success. Copy refresh_token and store it as GOOGLE_REFRESH_TOKEN.",
    refresh_token: tokens.refresh_token,
  });
});

module.exports = router;
