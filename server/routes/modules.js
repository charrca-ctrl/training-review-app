'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../lib/db');
const { requireAuth } = require('../lib/authGuard');
const { readBody, sendJson, sendError } = require('../lib/http-helpers');
const { parseMultipart } = require('../lib/multipart');
const { extractZipToDir } = require('../lib/zip');
const { inspectExtractedPackage } = require('../lib/scormManifest');
const { serveFile } = require('../lib/staticFile');
const config = require('../config');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function register(router) {
  router.get('/api/modules', (req, res) => {
    if (!requireAuth(req, res)) return;
    sendJson(res, 200, db.listModules());
  });

  router.get('/api/modules/:id', (req, res) => {
    if (!requireAuth(req, res)) return;
    const raw = db.getModuleRaw(req.params.id);
    if (!raw) return sendError(res, 404, 'Module not found');
    const mod = db.getModule(req.params.id);
    sendJson(res, 200, { ...mod, items: raw.items, launchUrl: `/content/${mod.id}/${raw.launchPath}` });
  });

  router.post('/api/modules', async (req, res) => {
    if (!requireAuth(req, res)) return;

    ensureUploadsDir();
    const maxBytes = config.maxUploadMb * 1024 * 1024;
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength && contentLength > maxBytes) {
      return sendError(res, 413, `Upload too large (limit ${config.maxUploadMb}MB).`);
    }

    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return sendError(res, err.statusCode || 400, err.message);
    }
    if (body.length > maxBytes) {
      return sendError(res, 413, `Upload too large (limit ${config.maxUploadMb}MB).`);
    }

    let parsed;
    try {
      parsed = parseMultipart(body, req.headers['content-type']);
    } catch (err) {
      return sendError(res, 400, 'Expected multipart/form-data with a "file" field containing the SCORM zip.');
    }

    const file = parsed.files.file;
    if (!file || !file.data || file.data.length === 0) {
      return sendError(res, 400, 'No file uploaded. Attach the SCORM zip under the "file" field.');
    }

    const moduleId = crypto.randomUUID();
    const targetDir = path.join(UPLOADS_DIR, moduleId);
    fs.mkdirSync(targetDir, { recursive: true });

    try {
      extractZipToDir(file.data, targetDir);
    } catch (err) {
      rimraf(targetDir);
      return sendError(res, 400, `Could not read the uploaded file as a zip: ${err.message}`);
    }

    let inspected;
    try {
      const fallbackTitle = (parsed.fields.title && parsed.fields.title.trim()) ||
        file.filename.replace(/\.zip$/i, '').replace(/[_-]+/g, ' ').trim();
      inspected = inspectExtractedPackage(targetDir, fallbackTitle);
    } catch (err) {
      rimraf(targetDir);
      return sendError(res, 400, err.message);
    }

    const primary = inspected.items[0];
    const mod = db.createModule({
      id: moduleId,
      title: (parsed.fields.title && parsed.fields.title.trim()) || inspected.title || primary.title || 'Untitled module',
      launchPath: primary.launchPath,
      scormVersion: inspected.scormVersion,
      uploadedBy: req.user.id,
      sizeBytes: file.data.length,
      items: inspected.items
    });

    sendJson(res, 201, mod);
  });

  router.del('/api/modules/:id', (req, res) => {
    if (!requireAuth(req, res)) return;
    const raw = db.getModuleRaw(req.params.id);
    if (!raw) return sendError(res, 404, 'Module not found');
    db.deleteModule(req.params.id);
    rimraf(path.join(UPLOADS_DIR, req.params.id));
    sendJson(res, 200, { ok: true });
  });

  // Serve extracted SCORM package assets. Requires login (same as everything else)
  // so uploaded training content isn't world-readable.
  router.get('/content/:moduleId/*', (req, res) => {
    if (!requireAuth(req, res)) return;
    const raw = db.getModuleRaw(req.params.moduleId);
    if (!raw) return sendError(res, 404, 'Module not found');
    const moduleDir = path.join(UPLOADS_DIR, req.params.moduleId);
    const relPath = req.params.wildcard || ''; // already decoded by the router
    const filePath = path.join(moduleDir, relPath);
    serveFile(req, res, filePath, moduleDir);
  });
}

module.exports = { register, UPLOADS_DIR };
