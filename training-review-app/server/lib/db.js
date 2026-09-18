'use strict';
/**
 * Minimal file-backed JSON data store.
 *
 * This app ships with zero npm dependencies, so instead of SQLite/Postgres
 * we keep state in a single JSON file, guarded by an in-process write queue
 * so concurrent requests never interleave writes. That's plenty for an
 * internal review tool used by a company team. If you outgrow it, the only
 * file that needs to change is this one -- every route calls the functions
 * below, never the file system directly.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyDb() {
  return { users: [], modules: [], comments: [] };
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const fresh = emptyDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return Object.assign(emptyDb(), parsed);
  } catch (err) {
    // Corrupt file -- back it up rather than silently losing data.
    const backup = DB_FILE + '.corrupt-' + Date.now();
    try { fs.copyFileSync(DB_FILE, backup); } catch (_) { /* ignore */ }
    console.error('[db] db.json was corrupt, backed up to', backup, err);
    const fresh = emptyDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

let state = load();
let saveQueued = false;

function persist() {
  if (saveQueued) return;
  saveQueued = true;
  setImmediate(() => {
    saveQueued = false;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DB_FILE);
  });
}

function id() {
  return crypto.randomUUID();
}

const now = () => new Date().toISOString();

// ---- users ----

function findUserByGoogleId(googleId) {
  return state.users.find((u) => u.googleId === googleId) || null;
}

function findUserById(userId) {
  return state.users.find((u) => u.id === userId) || null;
}

function upsertGoogleUser({ googleId, email, name, avatarUrl }) {
  let user = findUserByGoogleId(googleId);
  if (user) {
    user.email = email;
    user.name = name;
    user.avatarUrl = avatarUrl;
    user.lastLoginAt = now();
  } else {
    user = {
      id: id(),
      googleId,
      email,
      name,
      avatarUrl,
      createdAt: now(),
      lastLoginAt: now()
    };
    state.users.push(user);
  }
  persist();
  return user;
}

// ---- modules ----

function listModules() {
  return state.modules
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicModule);
}

function getModule(moduleId) {
  const m = state.modules.find((mod) => mod.id === moduleId);
  return m ? publicModule(m) : null;
}

function getModuleRaw(moduleId) {
  return state.modules.find((mod) => mod.id === moduleId) || null;
}

function publicModule(m) {
  const uploader = findUserById(m.uploadedBy);
  return {
    id: m.id,
    title: m.title,
    launchPath: m.launchPath,
    scormVersion: m.scormVersion || null,
    createdAt: m.createdAt,
    uploadedBy: m.uploadedBy,
    uploadedByName: uploader ? uploader.name : 'Unknown',
    sizeBytes: m.sizeBytes || 0,
    itemCount: (m.items || []).length
  };
}

function createModule({ id: presetId, title, launchPath, scormVersion, uploadedBy, sizeBytes, items }) {
  const m = {
    id: presetId || id(),
    title,
    launchPath,
    scormVersion: scormVersion || null,
    uploadedBy,
    createdAt: now(),
    sizeBytes: sizeBytes || 0,
    items: items || []
  };
  state.modules.push(m);
  persist();
  return publicModule(m);
}

function deleteModule(moduleId) {
  const before = state.modules.length;
  state.modules = state.modules.filter((m) => m.id !== moduleId);
  state.comments = state.comments.filter((c) => c.moduleId !== moduleId);
  persist();
  return state.modules.length < before;
}

// ---- comments ----

function publicComment(c) {
  const user = findUserById(c.userId);
  return {
    id: c.id,
    moduleId: c.moduleId,
    section: c.section,
    parentId: c.parentId || null,
    body: c.body,
    resolved: !!c.resolved,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt || c.createdAt,
    userId: c.userId,
    userName: user ? user.name : 'Unknown',
    userAvatar: user ? user.avatarUrl : null
  };
}

function listCommentsForModule(moduleId) {
  return state.comments
    .filter((c) => c.moduleId === moduleId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(publicComment);
}

function getComment(commentId) {
  return state.comments.find((c) => c.id === commentId) || null;
}

function createComment({ moduleId, section, userId, body, parentId }) {
  const c = {
    id: id(),
    moduleId,
    section: section || 'General',
    userId,
    body,
    parentId: parentId || null,
    resolved: false,
    createdAt: now(),
    updatedAt: now()
  };
  state.comments.push(c);
  persist();
  return publicComment(c);
}

function setCommentResolved(commentId, resolved) {
  const c = getComment(commentId);
  if (!c) return null;
  c.resolved = !!resolved;
  c.updatedAt = now();
  persist();
  return publicComment(c);
}

function deleteComment(commentId) {
  const before = state.comments.length;
  state.comments = state.comments.filter((c) => c.id !== commentId && c.parentId !== commentId);
  persist();
  return state.comments.length < before;
}

module.exports = {
  findUserByGoogleId,
  findUserById,
  upsertGoogleUser,
  listModules,
  getModule,
  getModuleRaw,
  createModule,
  deleteModule,
  listCommentsForModule,
  getComment,
  createComment,
  setCommentResolved,
  deleteComment
};
