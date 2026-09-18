(function () {
  'use strict';

  const state = {
    me: null,
    modules: [],
    activeModuleId: null,
    activeModuleDetail: null,
    comments: [],
    unresolvedOnly: false,
    scorm: null // active ScormShim instance for the currently loaded module
  };

  // ---- tiny fetch helpers ----

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('Not signed in');
    }
    if (!res.ok) {
      let message = res.statusText;
      try { message = (await res.json()).error || message; } catch (e) { /* ignore */ }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : null;
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function initials(name) {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  }

  // ---- auth / bootstrap ----

  const loginScreen = document.getElementById('loginScreen');
  const appEl = document.getElementById('app');

  function showLogin() {
    appEl.classList.add('hidden');
    loginScreen.classList.remove('hidden');
  }

  function showApp() {
    loginScreen.classList.add('hidden');
    appEl.classList.remove('hidden');
  }

  async function bootstrap() {
    let meResp;
    try {
      meResp = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json());
    } catch (e) {
      showLogin();
      return;
    }

    if (!meResp.user) {
      if (meResp.devLoginAvailable) {
        document.getElementById('devLoginBox').classList.remove('hidden');
      }
      if (!meResp.googleConfigured) {
        document.getElementById('googleLoginBtn').classList.add('hidden');
      }
      const params = new URLSearchParams(location.search);
      const authError = params.get('authError');
      if (authError) {
        const box = document.getElementById('loginError');
        box.textContent = 'Sign-in failed: ' + authError;
        box.classList.remove('hidden');
      }
      showLogin();
      return;
    }

    state.me = meResp.user;
    renderTopbarUser();
    showApp();
    await loadModules();
  }

  document.getElementById('devLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('devLoginEmail').value.trim();
    const name = document.getElementById('devLoginName').value.trim();
    const qs = new URLSearchParams({ email, name: name || email.split('@')[0] });
    location.href = '/auth/dev-login?' + qs.toString();
  });

  function renderTopbarUser() {
    const box = document.getElementById('topbarUser');
    const avatar = state.me.avatarUrl
      ? `<img src="${escapeHtml(state.me.avatarUrl)}" alt="" />`
      : `<span class="user-avatar-fallback">${escapeHtml(initials(state.me.name))}</span>`;
    box.innerHTML = `
      ${avatar}
      <span>${escapeHtml(state.me.name)}</span>
      <a href="/auth/logout" class="btn btn-ghost btn-sm">Sign out</a>
    `;
  }

  // ---- modules ----

  async function loadModules() {
    state.modules = await api('/api/modules');
    renderModuleList();
  }

  function renderModuleList() {
    const list = document.getElementById('moduleList');
    const empty = document.getElementById('moduleListEmpty');
    list.innerHTML = '';
    empty.classList.toggle('hidden', state.modules.length > 0);

    for (const mod of state.modules) {
      const item = el(`
        <li class="module-item ${mod.id === state.activeModuleId ? 'active' : ''}" data-id="${mod.id}">
          <div class="module-item-title">${escapeHtml(mod.title)}</div>
          <div class="module-item-meta">
            <span>${escapeHtml(mod.uploadedByName)}</span>
            <span>&middot;</span>
            <span>${timeAgo(mod.createdAt)}</span>
            <button class="module-item-delete" title="Delete module" data-action="delete">Delete</button>
          </div>
        </li>
      `);
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="delete"]')) return;
        selectModule(mod.id);
      });
      item.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${mod.title}"? This also deletes its comments.`)) return;
        await api(`/api/modules/${mod.id}`, { method: 'DELETE' });
        if (state.activeModuleId === mod.id) {
          state.activeModuleId = null;
          state.activeModuleDetail = null;
          showViewerPlaceholder();
          clearComments();
        }
        await loadModules();
      });
      list.appendChild(item);
    }
  }

  function showViewerPlaceholder() {
    document.getElementById('scormFrame').classList.add('hidden');
    document.getElementById('viewerPlaceholder').classList.remove('hidden');
    document.getElementById('viewerTitle').textContent = 'Select a module from the left to review it';
    document.getElementById('itemSelect').classList.add('hidden');
    document.getElementById('locationBadge').classList.add('hidden');
    document.getElementById('commentForm').classList.add('hidden');
  }

  async function selectModule(moduleId) {
    state.activeModuleId = moduleId;
    renderModuleList();
    const detail = await api(`/api/modules/${moduleId}`);
    state.activeModuleDetail = detail;

    document.getElementById('viewerTitle').textContent = detail.title;
    document.getElementById('commentForm').classList.remove('hidden');

    const itemSelect = document.getElementById('itemSelect');
    if (detail.items && detail.items.length > 1) {
      itemSelect.innerHTML = detail.items
        .map((it, i) => `<option value="${i}">${escapeHtml(it.title)}</option>`)
        .join('');
      itemSelect.classList.remove('hidden');
      itemSelect.onchange = () => launchItem(detail, parseInt(itemSelect.value, 10));
    } else {
      itemSelect.classList.add('hidden');
    }

    launchItem(detail, 0);
    await loadComments(moduleId);
  }

  function launchItem(detail, index) {
    const item = detail.items[index] || detail.items[0];
    const frame = document.getElementById('scormFrame');
    document.getElementById('viewerPlaceholder').classList.add('hidden');
    frame.classList.remove('hidden');

    // Fresh SCORM shim per launch so state doesn't leak between modules/items.
    const learnerId = state.me.email;
    const learnerName = state.me.name;
    state.scorm = window.ScormShim.create({ learnerId, learnerName });
    state.scorm.install(window);
    state.scorm.onLocationChange((loc) => {
      updateLocationBadge(loc || item.title);
      updateCommentSectionDefault(loc || item.title);
    });
    updateLocationBadge(item.title);
    updateCommentSectionDefault(item.title);

    frame.src = `/content/${detail.id}/${item.launchPath}`;
  }

  function updateLocationBadge(value) {
    const badge = document.getElementById('locationBadge');
    document.getElementById('locationValue').textContent = value || '--';
    badge.classList.remove('hidden');
  }

  function updateCommentSectionDefault(value) {
    const input = document.getElementById('commentSection');
    // Only auto-fill if the reviewer hasn't already typed a custom section.
    if (!input.dataset.userEdited) {
      input.value = value || 'General';
    }
  }

  document.getElementById('commentSection').addEventListener('input', (e) => {
    e.target.dataset.userEdited = '1';
  });

  // ---- upload ----

  const uploadBtn = document.getElementById('uploadBtn');
  const uploadForm = document.getElementById('uploadForm');
  uploadBtn.addEventListener('click', () => {
    uploadForm.classList.toggle('hidden');
  });
  document.getElementById('uploadCancel').addEventListener('click', () => {
    uploadForm.classList.add('hidden');
    uploadForm.reset();
  });

  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById('uploadFile');
    const titleInput = document.getElementById('uploadTitle');
    const statusEl = document.getElementById('uploadStatus');
    const file = fileInput.files[0];
    if (!file) return;

    const fd = new FormData();
    fd.append('file', file);
    if (titleInput.value.trim()) fd.append('title', titleInput.value.trim());

    statusEl.textContent = 'Uploading and processing package...';
    statusEl.className = 'upload-status';

    try {
      const res = await fetch('/api/modules', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      const mod = await res.json();
      statusEl.textContent = 'Uploaded successfully.';
      statusEl.className = 'upload-status success';
      uploadForm.reset();
      await loadModules();
      selectModule(mod.id);
      setTimeout(() => uploadForm.classList.add('hidden'), 600);
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'upload-status error';
    }
  });

  // ---- comments ----

  function clearComments() {
    state.comments = [];
    document.getElementById('commentList').innerHTML = '';
    document.getElementById('commentsEmpty').classList.remove('hidden');
  }

  async function loadComments(moduleId) {
    state.comments = await api(`/api/modules/${moduleId}/comments`);
    renderComments();
  }

  function renderComments() {
    const list = document.getElementById('commentList');
    const empty = document.getElementById('commentsEmpty');
    list.innerHTML = '';

    let topLevel = state.comments.filter((c) => !c.parentId);
    if (state.unresolvedOnly) topLevel = topLevel.filter((c) => !c.resolved);
    topLevel.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    empty.classList.toggle('hidden', topLevel.length > 0);

    for (const comment of topLevel) {
      list.appendChild(renderCommentNode(comment));
    }
  }

  function repliesFor(commentId) {
    return state.comments
      .filter((c) => c.parentId === commentId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  function renderCommentNode(comment, isReply) {
    const wrapperTag = 'li';
    const node = el(`
      <${wrapperTag} class="comment ${comment.resolved ? 'resolved' : ''}" data-id="${comment.id}">
        <span class="comment-section-tag">${escapeHtml(comment.section)}</span>
        <div class="comment-header">
          <span class="comment-avatar">${comment.userAvatar ? `<img src="${escapeHtml(comment.userAvatar)}" alt="" />` : escapeHtml(initials(comment.userName))}</span>
          <span class="comment-author">${escapeHtml(comment.userName)}</span>
          <span class="comment-time">${timeAgo(comment.createdAt)}</span>
        </div>
        <div class="comment-body"></div>
        <div class="comment-actions">
          <button class="btn-link" data-action="resolve">${comment.resolved ? 'Reopen' : 'Mark resolved'}</button>
          <button class="btn-link" data-action="reply">Reply</button>
          ${comment.resolved ? '<span class="resolved-pill">&#10003; Resolved</span>' : ''}
        </div>
        <div class="reply-form-slot"></div>
        <ul class="reply-list"></ul>
      </${wrapperTag}>
    `);

    node.querySelector('.comment-body').textContent = comment.body;

    node.querySelector('[data-action="resolve"]').addEventListener('click', async () => {
      const updated = await api(`/api/comments/${comment.id}/resolve`, {
        method: 'POST',
        body: { resolved: !comment.resolved }
      });
      const idx = state.comments.findIndex((c) => c.id === comment.id);
      state.comments[idx] = updated;
      renderComments();
    });

    const replySlot = node.querySelector('.reply-form-slot');
    node.querySelector('[data-action="reply"]').addEventListener('click', () => {
      if (replySlot.childElementCount > 0) {
        replySlot.innerHTML = '';
        return;
      }
      const form = el(`
        <form class="reply-form">
          <textarea placeholder="Write a reply..." required></textarea>
          <button type="submit" class="btn btn-primary btn-sm">Reply</button>
        </form>
      `);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const textarea = form.querySelector('textarea');
        const text = textarea.value.trim();
        if (!text) return;
        const created = await api(`/api/modules/${state.activeModuleId}/comments`, {
          method: 'POST',
          body: { body: text, section: comment.section, parentId: comment.id }
        });
        state.comments.push(created);
        replySlot.innerHTML = '';
        renderComments();
      });
      replySlot.innerHTML = '';
      replySlot.appendChild(form);
      form.querySelector('textarea').focus();
    });

    const replyList = node.querySelector('.reply-list');
    for (const reply of repliesFor(comment.id)) {
      replyList.appendChild(renderCommentNode(reply, true));
    }

    return node;
  }

  document.getElementById('filterUnresolved').addEventListener('change', (e) => {
    state.unresolvedOnly = e.target.checked;
    renderComments();
  });

  document.getElementById('commentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activeModuleId) return;
    const sectionInput = document.getElementById('commentSection');
    const bodyInput = document.getElementById('commentBody');
    const text = bodyInput.value.trim();
    if (!text) return;

    const created = await api(`/api/modules/${state.activeModuleId}/comments`, {
      method: 'POST',
      body: { body: text, section: sectionInput.value.trim() || 'General' }
    });
    state.comments.push(created);
    bodyInput.value = '';
    renderComments();
  });

  bootstrap();
})();
