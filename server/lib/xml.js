'use strict';
/**
 * Minimal, tolerant XML parser -- just enough to read imsmanifest.xml
 * (elements, attributes, nested children, text content). Not a spec-complete
 * XML parser: no DTD/entity expansion beyond the standard 5, no namespaces
 * beyond keeping prefixes literally in tag/attribute names (which is exactly
 * what SCORM manifests need, e.g. `xml:base`, `adlcp:scormtype`).
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(str) {
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X';
      const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, code) ? ENTITIES[code] : m;
  });
}

function parseAttrs(attrString) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.\-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrString))) {
    const name = m[1];
    const value = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
    attrs[name] = value;
  }
  return attrs;
}

/**
 * Parse an XML string into a lightweight tree:
 * { tag, attrs: {}, children: [node...], text: 'concatenated direct text' }
 * Returns the root element node (first element found).
 */
function parseXml(xmlString) {
  // Strip XML declaration, comments, CDATA (kept as text), and DOCTYPE.
  let s = xmlString
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');

  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner);

  const tagRe = /<(\/?)([a-zA-Z_][\w:.\-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let lastIndex = 0;
  let m;

  while ((m = tagRe.exec(s))) {
    const [full, closing, tagName, rawAttrs, selfClose] = m;
    const textBefore = s.slice(lastIndex, m.index);
    if (textBefore.trim()) {
      stack[stack.length - 1].text += decodeEntities(textBefore);
    }
    lastIndex = m.index + full.length;

    if (closing) {
      // Pop until we find the matching open tag (tolerant of mismatches).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tagName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node = { tag: tagName, attrs: parseAttrs(rawAttrs || ''), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) {
      stack.push(node);
    }
  }

  return root.children.find((c) => c.tag && !c.tag.startsWith('#')) || null;
}

/** Find the first descendant element matching tagName (local name, ignores namespace prefix). */
function findFirst(node, tagName) {
  if (!node) return null;
  const local = tagName.includes(':') ? tagName : tagName;
  const stack = [...node.children];
  while (stack.length) {
    const n = stack.shift();
    if (localName(n.tag) === localName(local)) return n;
  }
  for (const child of node.children) {
    const found = findFirst(child, tagName);
    if (found) return found;
  }
  return null;
}

/** Find all direct children matching tagName (local name). */
function findChildren(node, tagName) {
  if (!node) return [];
  return node.children.filter((c) => localName(c.tag) === localName(tagName));
}

function localName(tag) {
  const idx = tag.indexOf(':');
  return idx === -1 ? tag : tag.slice(idx + 1);
}

module.exports = { parseXml, findFirst, findChildren, localName };
