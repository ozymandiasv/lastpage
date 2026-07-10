#!/usr/bin/env node
'use strict';
/**
 * Serves the generated /site directory as-is.
 * This is a plain static server — good enough for previewing locally, or
 * even for production on a small VPS behind a reverse proxy / TLS terminator.
 * For anything higher-traffic, point nginx/Caddy at /site instead.
 *
 * Usage: node scripts/serve.js [port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'site');
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath);
  if (urlPath.endsWith('/')) filePath = path.join(filePath, 'index.html');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, '404.html'), (err2, data2) => {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data2 || 'Not found');
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving /site at http://localhost:${PORT}`));
