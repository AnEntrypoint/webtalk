const path = require('path');

function createConfig(options = {}) {
  const sdkDir = options.sdkDir || __dirname;

  return {
    // Server configuration
    port: options.port || parseInt(process.env.PORT, 10) || 8080,

    // Path configuration
    sdkDir,
    modelsDir: options.modelsDir || process.env.MODELS_DIR || path.join(sdkDir, 'models'),
    ttsModelsDir: options.ttsModelsDir || process.env.TTS_MODELS_DIR || path.join(sdkDir, 'models', 'tts'),
    assetsDir: options.assetsDir || path.join(sdkDir, 'assets'),
    ttsDir: options.ttsDir || path.join(sdkDir, 'tts'),

    // Model configuration
    defaultWhisperModel: options.defaultWhisperModel || process.env.WHISPER_MODEL || 'onnx-community/whisper-base',
    whisperBaseUrl: options.whisperBaseUrl || process.env.WHISPER_BASE_URL || 'https://huggingface.co/',
    ttsBaseUrl: options.ttsBaseUrl || process.env.TTS_BASE_URL || 'https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/main/onnx/',

    // Worker configuration
    workerFile: options.workerFile || process.env.WORKER_FILE || 'worker-BPxxCWVT.js',
    workerBackup: options.workerBackup || process.env.WORKER_BACKUP || 'worker-BPxxCWVT-original.js',
    ttsWorkerFile: options.ttsWorkerFile || process.env.TTS_WORKER_FILE || 'inference-worker.js',

    // URL configuration
    onnxWasmUrl: options.onnxWasmUrl || process.env.ONNX_WASM_URL || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.jsep.wasm',

    // Mount configuration
    mountPath: options.mountPath || process.env.MOUNT_PATH || '/webtalk',
    apiBasePath: options.apiBasePath || process.env.API_BASE_PATH || '',
  };
}

module.exports = { createConfig };
