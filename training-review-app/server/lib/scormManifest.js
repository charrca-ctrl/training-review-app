'use strict';
/**
 * Reads an extracted SCORM package's imsmanifest.xml and figures out:
 *  - a human title for the module
 *  - the launch file (relative path) to load in the viewer iframe
 *  - the SCORM version, best-effort, for display only
 *  - the flat list of launchable items (for packages with more than one SCO)
 *
 * Falls back to scanning for a plausible index.html when there's no
 * manifest, or it can't be parsed, so a broken/nonstandard package still
 * gets uploaded rather than rejected outright.
 */

const fs = require('fs');
const path = require('path');
const { parseXml, findFirst, findChildren, localName } = require('./xml');

const COMMON_LAUNCH_NAMES = [
  'index.html', 'index.htm',
  'story.html', 'story_html5.html',
  'scormdriver/indexAPI.html',
  'res/index.html',
  'presentation.html',
  'launchpage.html'
];

function joinHref(base, href) {
  if (!href) return base || '';
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href)) return href; // absolute URL, leave as-is
  if (!base) return href;
  const baseDir = base.endsWith('/') ? base : base.replace(/[^/]*$/, '');
  return normalizeRelative(baseDir + href);
}

function normalizeRelative(p) {
  const parts = p.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

function collectItems(node, resourceMap, xmlBaseStack) {
  // Pre-order walk of <item> elements, resolving identifierref -> resource href.
  const results = [];
  function walk(n, baseStack) {
    const nextBase = n.attrs['xml:base'] ? [...baseStack, n.attrs['xml:base']] : baseStack;
    if (localName(n.tag) === 'item') {
      const titleNode = findChildren(n, 'title')[0];
      const title = titleNode ? titleNode.text.trim() : null;
      const ref = n.attrs.identifierref;
      if (ref && resourceMap[ref]) {
        const res = resourceMap[ref];
        const base = [...nextBase, res.xmlBase].filter(Boolean).join('');
        results.push({
          title: title || res.identifier,
          launchPath: joinHref(base, res.href)
        });
      }
    }
    for (const child of n.children) walk(child, nextBase);
  }
  walk(node, xmlBaseStack);
  return results;
}

function parseManifest(manifestXml) {
  const root = parseXml(manifestXml);
  if (!root || localName(root.tag) !== 'manifest') {
    throw new Error('No <manifest> root element found');
  }

  const rootBase = root.attrs['xml:base'] || '';

  // Version hint, best-effort, for display only.
  let scormVersion = null;
  const metadata = findFirst(root, 'metadata');
  if (metadata) {
    const schemaVersion = findFirst(metadata, 'schemaversion');
    if (schemaVersion && schemaVersion.text) scormVersion = schemaVersion.text.trim();
  }
  if (!scormVersion) {
    const manifestVersionAttr = root.attrs.version;
    if (manifestVersionAttr) scormVersion = manifestVersionAttr;
  }

  // Resources map: identifier -> { href, xmlBase }
  const resourcesEl = findFirst(root, 'resources');
  const resourcesBase = [rootBase, resourcesEl ? resourcesEl.attrs['xml:base'] || '' : ''].filter(Boolean).join('');
  const resourceMap = {};
  if (resourcesEl) {
    for (const res of findChildren(resourcesEl, 'resource')) {
      resourceMap[res.attrs.identifier] = {
        identifier: res.attrs.identifier,
        href: res.attrs.href || '',
        xmlBase: res.attrs['xml:base'] || ''
      };
    }
  }

  const organizationsEl = findFirst(root, 'organizations');
  let organization = null;
  let courseTitle = null;
  let items = [];

  if (organizationsEl) {
    const defaultId = organizationsEl.attrs.default;
    const orgs = findChildren(organizationsEl, 'organization');
    organization = (defaultId && orgs.find((o) => o.attrs.identifier === defaultId)) || orgs[0] || null;
    if (organization) {
      const titleNode = findChildren(organization, 'title')[0];
      courseTitle = titleNode ? titleNode.text.trim() : null;
      items = collectItems(organization, resourceMap, [resourcesBase]);
    }
  }

  if (items.length === 0 && Object.keys(resourceMap).length > 0) {
    // No organization/item structure we could resolve -- fall back to the
    // first resource that has an href, which covers minimal/malformed manifests.
    const first = Object.values(resourceMap).find((r) => r.href);
    if (first) {
      items = [{ title: courseTitle || 'Module', launchPath: joinHref(resourcesBase, first.href) }];
    }
  }

  return { title: courseTitle, scormVersion, items };
}

/** Case-insensitively find a file within extractedDir matching one of `names`. */
function findFileCaseInsensitive(extractedDir, relativeCandidates) {
  const allFiles = walkFiles(extractedDir);
  const lowerMap = new Map(allFiles.map((f) => [f.toLowerCase(), f]));
  for (const candidate of relativeCandidates) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function walkFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Inspect an already-extracted SCORM package directory and return:
 * { title, scormVersion, items: [{title, launchPath}] }
 * launchPath entries are relative posix paths that exist on disk (verified),
 * falling back to a best-guess scan when the manifest is missing/broken.
 */
function inspectExtractedPackage(extractedDir, fallbackTitle) {
  const manifestPath = findFileCaseInsensitive(extractedDir, ['imsmanifest.xml']);
  let parsed = { title: null, scormVersion: null, items: [] };

  if (manifestPath) {
    try {
      const xml = fs.readFileSync(path.join(extractedDir, manifestPath), 'utf8');
      parsed = parseManifest(xml);
    } catch (err) {
      console.warn('[scormManifest] failed to parse imsmanifest.xml, falling back:', err.message);
    }
  }

  // Verify each item's launchPath actually exists on disk (case-insensitively);
  // drop ones that don't resolve rather than shipping a broken link.
  const allFiles = walkFiles(extractedDir);
  const lowerMap = new Map(allFiles.map((f) => [f.toLowerCase(), f]));
  const verifiedItems = [];
  for (const item of parsed.items) {
    const clean = item.launchPath.replace(/^\/+/, '');
    const hit = lowerMap.get(clean.toLowerCase());
    if (hit) verifiedItems.push({ title: item.title, launchPath: hit });
  }

  if (verifiedItems.length === 0) {
    const guess = findFileCaseInsensitive(extractedDir, COMMON_LAUNCH_NAMES) ||
      allFiles.find((f) => f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'));
    if (guess) {
      verifiedItems.push({ title: parsed.title || fallbackTitle || 'Module', launchPath: guess });
    }
  }

  if (verifiedItems.length === 0) {
    throw new Error('Could not find a launchable HTML file in this package (no valid imsmanifest.xml and no index.html found).');
  }

  return {
    title: parsed.title || fallbackTitle,
    scormVersion: parsed.scormVersion,
    items: verifiedItems
  };
}

module.exports = { inspectExtractedPackage, parseManifest };
