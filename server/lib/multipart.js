'use strict';
/**
 * Minimal multipart/form-data parser (no npm dependency, no external
 * streaming -- fine for the file sizes a SCORM zip realistically is).
 */

function parseContentType(header) {
  const parts = (header || '').split(';').map((s) => s.trim());
  const type = parts[0];
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    let key = p.slice(0, eq).trim();
    let val = p.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[key] = val;
  }
  return { type, params };
}

/**
 * Parse a full request body Buffer as multipart/form-data.
 * Returns { fields: {name: string}, files: {name: {filename, contentType, data: Buffer}} }
 */
function parseMultipart(bodyBuffer, contentTypeHeader) {
  const { type, params } = parseContentType(contentTypeHeader);
  if (type !== 'multipart/form-data' || !params.boundary) {
    throw new Error('Not a multipart/form-data request');
  }
  const boundary = Buffer.from('--' + params.boundary);
  const fields = {};
  const files = {};

  let start = bodyBuffer.indexOf(boundary);
  while (start !== -1) {
    const nextStart = bodyBuffer.indexOf(boundary, start + boundary.length);
    if (nextStart === -1) break;

    // Content of this part is between end of boundary line and start of next boundary,
    // minus the trailing CRLF right before the next boundary.
    let partStart = start + boundary.length;
    // Skip the CRLF right after the boundary marker.
    if (bodyBuffer[partStart] === 0x2d && bodyBuffer[partStart + 1] === 0x2d) {
      break; // "--" -> final boundary reached
    }
    if (bodyBuffer[partStart] === 0x0d && bodyBuffer[partStart + 1] === 0x0a) {
      partStart += 2;
    }
    let partEnd = nextStart;
    if (bodyBuffer[partEnd - 2] === 0x0d && bodyBuffer[partEnd - 1] === 0x0a) {
      partEnd -= 2;
    }

    const part = bodyBuffer.slice(partStart, partEnd);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString('utf8');
      const data = part.slice(headerEnd + 4);

      const dispositionMatch = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText);
      const contentTypeMatch = /content-type:\s*([^\r\n]*)/i.exec(headerText);
      let name = null;
      let filename = null;
      if (dispositionMatch) {
        const disp = parseContentType('x;' + dispositionMatch[1]).params;
        name = disp.name || null;
        filename = Object.prototype.hasOwnProperty.call(disp, 'filename') ? disp.filename : null;
      }

      if (name) {
        if (filename !== null) {
          files[name] = {
            filename,
            contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
            data
          };
        } else {
          fields[name] = data.toString('utf8');
        }
      }
    }

    start = nextStart;
  }

  return { fields, files };
}

module.exports = { parseMultipart };
