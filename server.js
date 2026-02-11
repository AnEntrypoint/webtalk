const http = require('http');
const fs = require('fs');
const path = require('path');
const { ensureModel, MODELS_DIR } = require('./download-model');
const { ensureTTSModels, downloadTTSModels, checkModelExists, TTS_MODEL_DIR } = require('./download-tts-model');
const { patchWorker } = require('./patch-worker');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.onnx': 'application/octet-stream'
};

const server = http.createServer((req, res) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // CORS for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API endpoints
  if (req.url === '/api/tts-status') {
    checkModelExists().then(exists => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        available: exists,
        modelDir: TTS_MODEL_DIR
      }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Sanitize URL
  let filePath;
  if (req.url === '/') {
    filePath = path.join(PUBLIC_DIR, 'unified.html');
  } else {
    filePath = path.join(PUBLIC_DIR, req.url);
  }

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // File not found
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        // Server error
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

// Ensure models are available before starting server
async function startServer() {
  console.log('Patching worker for local models...');
  try {
    patchWorker();
  } catch (err) {
    console.warn('Warning: Worker patching failed, continuing anyway...');
  }

  console.log('Checking for Whisper models...');
  await ensureModel();

  console.log('\nChecking for TTS models...');
  await ensureTTSModels();

  server.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`\nUnified interface with:`);
    console.log(`  - Whisper STT (Speech-to-Text)`);
    console.log(`  - Pocket TTS (Text-to-Speech)`);
    console.log(`\nPress Ctrl+C to stop`);
    console.log(`=================================\n`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});
