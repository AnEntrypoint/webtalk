const fs = require('fs');
const path = require('path');
const { initState } = require('./persistent-state');
const { ensureModel, downloadFile } = require('./whisper-models');
const { ensureTTSModels, checkTTSModelExists } = require('./tts-models');
const { patchWorker } = require('./worker-patch');
const { serveStatic } = require('./serve-static');
const { createSpeechHandler } = require('./server-middleware');

function webtalk(app, options = {}) {
  const state = initState({ sdkDir: options.sdkDir || __dirname, ...options });
  const config = state.config;
  const mountPath = options.path || config.mountPath;

  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });

  const speechHandler = createSpeechHandler({ prefix: '/api' });
  app.use(async (req, res, next) => {
    const handled = await speechHandler(req, res).catch((err) => {
      if (!res.headersSent) { res.statusCode = 500; res.end(err.message); }
      return true;
    });
    if (!handled) next();
  });

  app.get('/api/tts-status', async (req, res) => {
    try {
      const exists = await checkTTSModelExists(config);
      res.json({ available: exists, modelDir: config.ttsModelsDir });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(mountPath + '/sdk.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(config.sdkDir, 'sdk.js'));
  });

  app.use('/assets', serveStatic(config.assetsDir));
  app.use('/tts', serveStatic(config.ttsDir));
  app.use('/models', serveStatic(config.modelsDir));

  app.get(mountPath + '/demo', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(config.sdkDir, 'app.html'));
  });

  app.use(mountPath, serveStatic(config.sdkDir, {
    dotfiles: 'ignore', index: false,
    extensions: ['html', 'js', 'css', 'png', 'svg', 'ico']
  }));

  const init = async () => {
    try { patchWorker(config); } catch (e) {}
    
    if (!config.skipModelDownload) {
      const ortWasmFile = path.join(config.assetsDir, 'ort-wasm-simd-threaded.jsep.wasm');
      if (!fs.existsSync(ortWasmFile) && config.onnxWasmUrl) {
        await downloadFile(config.onnxWasmUrl, ortWasmFile);
      }
      await ensureModel(config.defaultWhisperModel, config);
      await ensureTTSModels(config);
    }
  };

  return { init };
}

module.exports = { webtalk };
