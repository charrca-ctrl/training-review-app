'use strict';

const crypto = require('crypto');
const config = require('../config');
const db = require('../lib/db');
const session = require('../lib/session');
const { parseCookies, serializeCookie, appendSetCookie } = require('../lib/cookies');
const { buildAuthorizeUrl, exchangeCodeForProfile } = require('../lib/googleAuth');
const { sendJson, sendError } = require('../lib/http-helpers');

const STATE_COOKIE = 'trs_oauth_state';

function redirectUri() {
  return `${config.baseUrl.replace(/\/+$/, '')}/auth/google/callback`;
}

function emailAllowed(email, hd) {
  if (!config.google.allowedDomain) return true;
  const domain = config.google.allowedDomain.toLowerCase().replace(/^@/, '');
  const emailDomain = (email || '').split('@')[1]?.toLowerCase();
  return emailDomain === domain || (hd || '').toLowerCase() === domain;
}

function register(router) {
  router.get('/auth/google', (req, res) => {
    if (!config.google.clientId || !config.google.clientSecret) {
      sendError(res, 500, 'Google OAuth is not configured on this server (missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET). See README.md.');
      return;
    }
    const state = crypto.randomBytes(16).toString('hex');
    appendSetCookie(res, serializeCookie(STATE_COOKIE, state, { maxAge: 600, httpOnly: true, sameSite: 'Lax', secure: config.secureCookies }));
    const url = buildAuthorizeUrl({
      clientId: config.google.clientId,
      redirectUri: redirectUri(),
      state,
      hostedDomain: config.google.allowedDomain || undefined
    });
    res.writeHead(302, { Location: url }).end();
  });

  router.get('/auth/google/callback', async (req, res) => {
    const url = new URL(req.url, config.baseUrl);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const cookies = parseCookies(req);

    if (error) {
      res.writeHead(302, { Location: '/?authError=' + encodeURIComponent(error) }).end();
      return;
    }
    if (!code || !state || state !== cookies[STATE_COOKIE]) {
      sendError(res, 400, 'Invalid OAuth state. Please try logging in again.');
      return;
    }

    try {
      const profile = await exchangeCodeForProfile({
        code,
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        redirectUri: redirectUri()
      });

      if (!profile.email || profile.email_verified === false) {
        sendError(res, 403, 'Your Google account email could not be verified.');
        return;
      }
      if (!emailAllowed(profile.email, profile.hd)) {
        sendError(res, 403, `Access is restricted to @${config.google.allowedDomain} accounts.`);
        return;
      }

      const user = db.upsertGoogleUser({
        googleId: profile.sub,
        email: profile.email,
        name: profile.name || profile.email,
        avatarUrl: profile.picture || null
      });

      const sid = session.createSession(user.id);
      session.setSessionCookie(res, sid, { secure: config.secureCookies });
      appendSetCookie(res, serializeCookie(STATE_COOKIE, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax', secure: config.secureCookies }));
      res.writeHead(302, { Location: '/' }).end();
    } catch (err) {
      console.error('[auth] Google OAuth callback failed:', err);
      sendError(res, 502, 'Google sign-in failed: ' + err.message);
    }
  });

  // Dev-only: sign in without real Google credentials, for local testing.
  router.get('/auth/dev-login', (req, res) => {
    if (!config.allowDevLogin) {
      sendError(res, 404, 'Not found');
      return;
    }
    const url = new URL(req.url, config.baseUrl);
    const email = url.searchParams.get('email') || 'reviewer@example.com';
    const name = url.searchParams.get('name') || email.split('@')[0];
    const user = db.upsertGoogleUser({
      googleId: 'dev:' + email,
      email,
      name,
      avatarUrl: null
    });
    const sid = session.createSession(user.id);
    session.setSessionCookie(res, sid, { secure: config.secureCookies });
    res.writeHead(302, { Location: '/' }).end();
  });

  router.get('/auth/logout', (req, res) => {
    const cookies = parseCookies(req);
    const sid = cookies[session.COOKIE_NAME];
    if (sid) session.destroySession(sid);
    session.clearSessionCookie(res, { secure: config.secureCookies });
    res.writeHead(302, { Location: '/' }).end();
  });

  router.get('/api/me', (req, res) => {
    sendJson(res, 200, {
      user: req.user
        ? { id: req.user.id, name: req.user.name, email: req.user.email, avatarUrl: req.user.avatarUrl }
        : null,
      devLoginAvailable: config.allowDevLogin,
      googleConfigured: !!(config.google.clientId && config.google.clientSecret)
    });
  });
}

module.exports = { register, emailAllowed };
