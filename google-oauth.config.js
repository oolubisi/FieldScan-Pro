// ===== google-oauth.config.js =====
//
// Kept SEPARATE from main.js on purpose: every time main.js gets a bug
// fix or update, it's a fresh file that doesn't know your real
// credentials -- which has already caused this exact "invalid_client"
// error twice, from a placeholder silently overwriting a working value.
// Splitting them out here means future main.js updates never touch this
// file, so you only ever enter these once.
//
// Fill in both values below from Google Cloud Console -> Credentials ->
// your "Desktop app" OAuth client.
//
// This file should be in your .gitignore (same as .env) -- it's a
// credential, even though Google doesn't treat a Desktop app's secret as
// strictly confidential the way a web app's would be.

module.exports = {
  GOOGLE_CLIENT_ID:
    "53399870740-rbe2p8r8g9glus9ss1jqb2iq2tvl6k94.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "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",
};
