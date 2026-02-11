const fs = require('fs');
const path = require('path');

const WORKER_DIR = path.join(__dirname, 'assets');
const WORKER_FILE = 'worker-BPxxCWVT.js';
const WORKER_BACKUP = 'worker-BPxxCWVT-original.js';

const FETCH_PATCH = `// FETCH INTERCEPTOR - Redirect HF requests to local
const originalFetch = self.fetch;
self.fetch = function(input, init) {
  let url = typeof input === 'string' ? input : input.url;
  
  // Intercept Hugging Face requests and redirect to local
  if (url.includes('huggingface.co') && url.includes('/resolve/main/')) {
    const match = url.match(/huggingface\\.co\\/([^\\/]+\\/[^\\/]+)\\/resolve\\/main\\/(.*)/);
    if (match) {
      const [, modelName, filePath] = match;
      const localUrl = '/models/' + modelName + '/' + filePath;
      console.log('[Worker] Redirecting to local:', localUrl);
      return originalFetch(localUrl, init);
    }
  }
  
  return originalFetch(input, init);
};
// END FETCH INTERCEPTOR

`;

function restoreWorker() {
  const workerPath = path.join(WORKER_DIR, WORKER_FILE);
  const backupPath = path.join(WORKER_DIR, WORKER_BACKUP);
  
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, workerPath);
    console.log('Worker restored from backup');
  }
}

function patchWorker() {
  const workerPath = path.join(WORKER_DIR, WORKER_FILE);
  const backupPath = path.join(WORKER_DIR, WORKER_BACKUP);
  
  // Restore first to ensure clean state
  restoreWorker();
  
  const content = fs.readFileSync(workerPath, 'utf8');
  
  // Check if already patched
  if (content.includes('FETCH INTERCEPTOR')) {
    console.log('Worker already patched');
    return;
  }
  
  // Inject at the very beginning
  const patchedContent = FETCH_PATCH + content;
  fs.writeFileSync(workerPath, patchedContent);
  console.log('Worker patched with fetch interceptor');
}

module.exports = { patchWorker, restoreWorker };

if (require.main === module) {
  const command = process.argv[2] || 'patch';
  if (command === 'patch') {
    patchWorker();
  } else if (command === 'restore') {
    restoreWorker();
  }
}
