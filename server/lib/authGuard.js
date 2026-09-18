'use strict';

const { sendError } = require('./http-helpers');

/** Returns true and does nothing if req.user is set; otherwise responds 401 and returns false. */
function requireAuth(req, res) {
  if (req.user) return true;
  sendError(res, 401, 'You must be signed in.');
  return false;
}

module.exports = { requireAuth };
