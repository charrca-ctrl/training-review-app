'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./lib/db');
const session = require('./lib/session');
const { Router } = require('./lib/router');
const { sendError } = require('./lib/http-helpers');
const { serveFile } = require('./lib/staticFile');

const authRoutes = require('./routes/auth');
const moduleRoutes = require('./routes/modules');
const commentRoutes = require('./routes/comments');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const router = new Router();
authRoutes.register(router);
moduleRoutes.register(router);
commentRoutes.register(router);

function attachUser(req) {
  const sess = session.getRequestSession(req);
  if (sess) {
    req.user = db.findUserById(sess.userId) || null;
  } else {
    req.user = null;
  }
}

function tryServePublicFile(req, res, pathname) {
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, relPath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR) + path.sep) && resolved !== path.resolve(PUBLIC_DIR, 'index.html')) {
    sendError(res, 403, 'Forbidden');
    return;
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    serveFile(req, res, resolved, PUBLIC_DIR);
  } else {
    sendError(res, 404, 'Not found');
  }
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  attachUser(req);

  const match = router.match(req.method, pathname);
  if (match) {
    req.params = match.params;
    Promise.resolve(match.handler(req, res)).catch((err) => {
      console.error('[server] Unhandled route error:', err);
      if (!res.headersSent) sendError(res, 500, 'Internal server error');
    });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    tryServePublicFile(req, res, pathname);
    return;
  }

  sendError(res, 404, 'Not found');
});

server.listen(config.port, () => {
  console.log(`Training Review app listening on ${config.baseUrl} (port ${config.port})`);
  if (config.allowDevLogin) {
    console.log(`Dev login enabled: ${config.baseUrl}/auth/dev-login?email=you@example.com&name=Your+Name`);
  }
  if (!config.google.clientId || !config.google.clientSecret) {
    console.log('Google OAuth is not configured yet -- see README.md to set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.');
  }
});

module.exports = server;
