'use strict';

const { loadEnv } = require('./lib/loadEnv');
loadEnv();

function bool(val, def) {
  if (val === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(val).toLowerCase());
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || '3000'}`,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    allowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN || ''
  },
  // Dev-only login bypass (no real Google credentials needed) so the app
  // can be tried locally before OAuth is configured. Defaults to on unless
  // Google credentials are present, and can be forced with ALLOW_DEV_LOGIN.
  allowDevLogin: bool(process.env.ALLOW_DEV_LOGIN, !(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)),
  secureCookies: bool(process.env.SECURE_COOKIES, false),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '500', 10)
};
