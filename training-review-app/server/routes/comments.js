'use strict';

const db = require('../lib/db');
const { requireAuth } = require('../lib/authGuard');
const { readJsonBody, sendJson, sendError } = require('../lib/http-helpers');

function register(router) {
  router.get('/api/modules/:id/comments', (req, res) => {
    if (!requireAuth(req, res)) return;
    const mod = db.getModuleRaw(req.params.id);
    if (!mod) return sendError(res, 404, 'Module not found');
    sendJson(res, 200, db.listCommentsForModule(req.params.id));
  });

  router.post('/api/modules/:id/comments', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const mod = db.getModuleRaw(req.params.id);
    if (!mod) return sendError(res, 404, 'Module not found');

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendError(res, err.statusCode || 400, err.message);
    }

    const text = (body.body || '').trim();
    if (!text) return sendError(res, 400, 'Comment text is required.');
    if (text.length > 5000) return sendError(res, 400, 'Comment is too long (max 5000 characters).');

    let parentId = null;
    if (body.parentId) {
      const parent = db.getComment(body.parentId);
      if (!parent || parent.moduleId !== req.params.id) {
        return sendError(res, 400, 'Invalid parentId.');
      }
      parentId = body.parentId;
    }

    const section = (body.section || '').trim().slice(0, 200) || 'General';

    const comment = db.createComment({
      moduleId: req.params.id,
      section,
      userId: req.user.id,
      body: text,
      parentId
    });
    sendJson(res, 201, comment);
  });

  router.post('/api/comments/:id/resolve', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const existing = db.getComment(req.params.id);
    if (!existing) return sendError(res, 404, 'Comment not found');

    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendError(res, err.statusCode || 400, err.message);
    }
    const resolved = body.resolved !== undefined ? !!body.resolved : !existing.resolved;

    const updated = db.setCommentResolved(req.params.id, resolved);
    sendJson(res, 200, updated);
  });

  router.del('/api/comments/:id', (req, res) => {
    if (!requireAuth(req, res)) return;
    const existing = db.getComment(req.params.id);
    if (!existing) return sendError(res, 404, 'Comment not found');
    if (existing.userId !== req.user.id) {
      return sendError(res, 403, 'You can only delete your own comments.');
    }
    db.deleteComment(req.params.id);
    sendJson(res, 200, { ok: true });
  });
}

module.exports = { register };
