#!/usr/bin/env node
/**
 * Serve Test Dashboard
 * Starts a simple HTTP server to serve the test dashboard
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  let filePath = req.url === '/' ? '/test-dashboard.html' : req.url;
  filePath = path.join(ROOT_DIR, filePath);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║                                                        ║');
  console.log('║  🧪  Test Dashboard Server Running                     ║');
  console.log('║                                                        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  📊 Dashboard URL:  http://localhost:${PORT}`);
  console.log('');
  console.log('  💡 Tips:');
  console.log('     • Dashboard auto-refreshes every 30s (enable checkbox)');
  console.log('     • Run tests in another terminal: npm run test:quick');
  console.log('     • Results appear automatically in the dashboard');
  console.log('     • Filter by date range (1 day, 7 days, 30 days, custom)');
  console.log('     • Search tests by name or error message');
  console.log('');
  console.log('  🔗 Quick Commands:');
  console.log('     npm run test:api     → Run API tests');
  console.log('     npm run test:smoke   → Run smoke tests');
  console.log('     npm run test:quick   → Run fast tests (unit+contract+api+smoke)');
  console.log('     npm run test:all     → Run all tests');
  console.log('');
  console.log('  Press Ctrl+C to stop the server');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
