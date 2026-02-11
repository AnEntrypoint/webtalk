const http = require('http');
const fs = require('fs');
const path = require('path');
const { ensureModel, MODELS_DIR } = require('./download-model');
const { ensureTTSModels, downloadTTSModels, checkModelExists, TTS_MODEL_DIR } = require('./download-tts-model');
const { patchWorker } = require('./patch-worker');
const https = require('https');

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
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.model': 'application/octet-stream'
};

const server = http.createServer((req, res) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // CORS and isolation headers for SharedArrayBuffer (ONNX multi-threading)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

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
    filePath = path.join(PUBLIC_DIR, 'app.html');
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

const ORT_WASM_FILE = path.join(__dirname, 'assets', 'ort-wasm-simd-threaded.jsep.wasm');
const ORT_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.jsep.wasm';

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return downloadToFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let downloaded = 0;
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        process.stdout.write(`\r  ort-wasm ... ${(downloaded / 1024 / 1024).toFixed(1)}MB`);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log(' done'); resolve(); });
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function ensureOrtWasm() {
  if (fs.existsSync(ORT_WASM_FILE)) {
    console.log('  ort-wasm cached');
    return;
  }
  console.log('  Downloading ort-wasm-simd-threaded.jsep.wasm...');
  await downloadToFile(ORT_WASM_URL, ORT_WASM_FILE);
}

async function startServer() {
  console.log('Patching worker for local models...');
  try {
    patchWorker();
  } catch (err) {
    console.warn('Warning: Worker patching failed, continuing anyway...');
  }

  console.log('Checking for ONNX Runtime WASM...');
  await ensureOrtWasm();

  console.log('Checking for Whisper models...');
  await ensureModel();

  console.log('\nChecking for TTS models...');
  await ensureTTSModels();

  server.listen(PORT, '0.0.0.0', () => {
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
