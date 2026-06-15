// POST /api/logout — clears the auth cookie.

const { clearAuthCookie } = require("../lib/auth");

module.exports = async (req, res) => {
  clearAuthCookie(res);
  res.statusCode = 200;
  return res.json({ ok: true });
};
