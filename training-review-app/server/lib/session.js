'use strict';
/**
 * Minimal cookie session store. Sessions live in memory and are mirrored to
 * disk so logins survive a server restart. Fine for a small internal tool
 * running as a single process; for multi-instance deployments swap this for
 * a shared store (Redis, a DB table) -- every route only calls the
 * functions below, never touches the Map directly.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCookies, serializeCookie, appendSetCookie } = require('./cookies');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const COOKIE_NAME = 'trs_sid';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

let sessions = new Map();

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      sessions = new Map(Object.entries(raw));
      pruneExpired();
    } catch (_) {
      sessions = new Map();
    }
  }
}

let saveQueued = false;
function persist() {
  if (saveQueued) return;
  saveQueued = true;
  setImmediate(() => {
    saveQueued = false;
    const obj = Object.fromEntries(sessions);
    const tmp = SESSIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, SESSIONS_FILE);
  });
}

function pruneExpired() {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (s.expiresAt && s.expiresAt < now) sessions.delete(sid);
  }
}

load();

function createSession(userId) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { userId, createdAt: Date.now(), expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 });
  persist();
  return sid;
}

function destroySession(sid) {
  sessions.delete(sid);
  persist();
}

function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.expiresAt && s.expiresAt < Date.now()) {
    sessions.delete(sid);
    persist();
    return null;
  }
  return s;
}

/** Read the current session (if any) for a request. */
function getRequestSession(req) {
  const cookies = parseCookies(req);
  return getSession(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, sid, opts = {}) {
  appendSetCookie(res, serializeCookie(COOKIE_NAME, sid, {
    maxAge: MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
    secure: !!opts.secure
  }));
}

function clearSessionCookie(res, opts = {}) {
  appendSetCookie(res, serializeCookie(COOKIE_NAME, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure: !!opts.secure
  }));
}

module.exports = {
  COOKIE_NAME,
  createSession,
  destroySession,
  getSession,
  getRequestSession,
  setSessionCookie,
  clearSessionCookie
};
