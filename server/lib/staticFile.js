'use strict';

const fs = require('fs');
const path = require('path');
const { mimeForPath } = require('./mime');

/**
 * Serve a single file from disk with basic Range support (needed for
 * SCORM packages that embed audio/video). `rootDir` bounds the file to
 * prevent path traversal -- callers pass an already-joined absolute path
 * plus the root it must stay under.
 */
function serveFile(req, res, absPath, rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(absPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }

    const mime = mimeForPath(resolved);
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600'
        });
        fs.createReadStream(resolved, { start, end }).pipe(res);
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600'
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

module.exports = { serveFile };
