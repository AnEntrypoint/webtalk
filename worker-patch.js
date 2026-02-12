const fs = require('fs');
const path = require('path');

const FETCH_PATCH = `// FETCH INTERCEPTOR - Redirect HF requests to local
const originalFetch = self.fetch;
self.fetch = function(input, init) {
  let url = typeof input === 'string' ? input : input.url;

  if (url.includes('huggingface.co') && url.includes('/resolve/main/')) {
    const match = url.match(/huggingface\\.co\\/([^\\/]+\\/[^\\/]+)\\/resolve\\/main\\/(.*)/);
    if (match) {
      const [, modelName, filePath] = match;
      const localUrl = '/models/' + modelName + '/' + filePath;
      return originalFetch(localUrl, init);
    }
  }

  return originalFetch(input, init);
};
// END FETCH INTERCEPTOR

`;

function restoreWorker(config) {
  const workerPath = path.join(config.assetsDir, config.workerFile);
  const backupPath = path.join(config.assetsDir, config.workerBackup);

  if (fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(backupPath, workerPath);
    } catch (err) {
      try {
        const content = fs.readFileSync(backupPath, 'utf8');
        fs.writeFileSync(workerPath, content);
      } catch (writeErr) {
        // Continue on failure
      }
    }
  }
}

function patchWorker(config) {
  const workerPath = path.join(config.assetsDir, config.workerFile);

  try {
    restoreWorker(config);

    const content = fs.readFileSync(workerPath, 'utf8');

    if (content.includes('FETCH INTERCEPTOR')) {
      return;
    }

    const patchedContent = FETCH_PATCH + content;
    fs.writeFileSync(workerPath, patchedContent);
  } catch (err) {
    // Continue on failure
  }
}

module.exports = { patchWorker, restoreWorker, FETCH_PATCH };
