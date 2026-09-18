'use strict';
/**
 * Google OAuth 2.0 "authorization code" flow implemented directly against
 * Google's HTTPS endpoints (no passport dependency). This is the same flow
 * passport-google-oauth20 wraps -- authorize redirect, code-for-token
 * exchange, fetch userinfo -- just written out explicitly.
 */

const https = require('https');
const querystring = require('querystring');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function postJson(urlString, formBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = querystring.stringify(formBody);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`Google OAuth token request failed (${res.statusCode}): ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getJson(urlString, accessToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`Google userinfo request failed (${res.statusCode}): ${data}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildAuthorizeUrl({ clientId, redirectUri, state, hostedDomain }) {
  const params = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account'
  };
  if (hostedDomain) params.hd = hostedDomain;
  return `${AUTH_URL}?${querystring.stringify(params)}`;
}

async function exchangeCodeForProfile({ code, clientId, clientSecret, redirectUri }) {
  const tokenResp = await postJson(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  if (!tokenResp.access_token) {
    throw new Error('Google did not return an access token: ' + JSON.stringify(tokenResp));
  }
  const profile = await getJson(USERINFO_URL, tokenResp.access_token);
  return profile; // { sub, email, email_verified, name, picture, hd, ... }
}

module.exports = { buildAuthorizeUrl, exchangeCodeForProfile };
