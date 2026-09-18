'use strict';
/**
 * Tiny router: register(method, '/api/modules/:id', handler) then match(method, pathname).
 * No dependency -- Express-lite, just enough for this app's route table.
 */

function compilePattern(pattern) {
  const paramNames = [];
  const regexStr = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      if (seg === '*') {
        paramNames.push('wildcard');
        return '(.*)';
      }
      return seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp('^' + regexStr + '$'), paramNames };
}

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const { regex, paramNames } = compilePattern(pattern);
    this.routes.push({ method, regex, paramNames, handler });
    return this;
  }

  get(pattern, handler) { return this.add('GET', pattern, handler); }
  post(pattern, handler) { return this.add('POST', pattern, handler); }
  put(pattern, handler) { return this.add('PUT', pattern, handler); }
  del(pattern, handler) { return this.add('DELETE', pattern, handler); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return { handler: route.handler, params };
    }
    return null;
  }
}

module.exports = { Router };
