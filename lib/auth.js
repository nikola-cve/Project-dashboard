// Minimal cookie-based auth for the cloud dashboard.
// A signed (HMAC-SHA256) token is stored in an HttpOnly cookie. No database,
// no third-party dependency — just Node's built-in crypto.

const crypto = require("crypto");

const COOKIE = "dash_auth";

function secret() {
  return process.env.DASH_SECRET || "";
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

// Create a token valid until `expEpoch` (seconds).
function makeToken(expEpoch) {
  const payload = `v1.${expEpoch}`;
  return `${payload}.${sign(payload)}`;
}

// Verify a token; returns true only if the signature matches and it's unexpired.
function verifyToken(token) {
  if (!token || !secret()) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  const got = parts[2];
  if (expected.length !== got.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return false;
  const exp = parseInt(parts[1], 10);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE]);
}

// Constant-time password comparison against DASH_PASSWORD.
function checkPassword(input) {
  const expected = process.env.DASH_PASSWORD || "";
  if (!expected) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function setAuthCookie(res, remember) {
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12; // 30 days or 12h
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const token = makeToken(exp);
  res.setHeader("Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

module.exports = { COOKIE, isAuthed, checkPassword, setAuthCookie, clearAuthCookie };
