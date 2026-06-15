// POST /api/login  { password, remember }
// Verifies the password against DASH_PASSWORD and sets a signed auth cookie.

const { checkPassword, setAuthCookie } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "method not allowed" });
  }
  if (!process.env.DASH_PASSWORD || !process.env.DASH_SECRET) {
    res.statusCode = 500;
    return res.json({ error: "Server not configured: set DASH_PASSWORD and DASH_SECRET." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  if (!checkPassword(body.password)) {
    res.statusCode = 401;
    return res.json({ error: "Wrong password." });
  }

  setAuthCookie(res, !!body.remember);
  res.statusCode = 200;
  return res.json({ ok: true });
};
