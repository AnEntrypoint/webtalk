const path = require('path');

function createConfig(options = {}) {
  const sdkDir = options.sdkDir || __dirname;
  
  const sttttsmodelsDir = options.sttttsmodelsDir || path.join(sdkDir, '..', 'sttttsmodels');

  return {
    // Server configuration
    port: options.port || parseInt(process.env.PORT, 10) || 8080,

    // Path configuration
    sdkDir,
    modelsDir: options.modelsDir || process.env.MODELS_DIR || path.join(sttttsmodelsDir, 'models'),
    ttsModelsDir: options.ttsModelsDir || process.env.TTS_MODELS_DIR || path.join(sttttsmodelsDir, 'models', 'tts'),
    sttModelsDir: options.sttModelsDir || process.env.STT_MODELS_DIR || path.join(sttttsmodelsDir, 'models', 'stt'),
    assetsDir: options.assetsDir || path.join(sdkDir, 'assets'),
    ttsDir: options.ttsDir || path.join(sdkDir, 'tts'),

    // Model configuration - use local sttttsmodels by default
    defaultWhisperModel: options.defaultWhisperModel || process.env.WHISPER_MODEL || 'onnx-community/whisper-base',
    whisperBaseUrl: options.whisperBaseUrl || process.env.WHISPER_BASE_URL || 'https://gateway.pinata.cloud/ipfs/bafybeidyw252ecy4vs46bbmezrtw325gl2ymdltosmzqgx4edjsc3fbofy/stt/',
    ttsBaseUrl: options.ttsBaseUrl || process.env.TTS_BASE_URL || 'https://gateway.pinata.cloud/ipfs/bafybeidyw252ecy4vs46bbmezrtw325gl2ymdltosmzqgx4edjsc3fbofy/tts/',
    speakerModelDir: options.speakerModelDir || path.join(sttttsmodelsDir, 'models', 'speaker'),

    // Worker configuration
    workerFile: options.workerFile || process.env.WORKER_FILE || 'worker-BPxxCWVT.js',
    workerBackup: options.workerBackup || process.env.WORKER_BACKUP || 'worker-BPxxCWVT-original.js',
    ttsWorkerFile: options.ttsWorkerFile || process.env.TTS_WORKER_FILE || 'inference-worker.js',

    // URL configuration
    onnxWasmUrl: options.onnxWasmUrl || process.env.ONNX_WASM_URL || '',

    // Mount configuration
    mountPath: options.mountPath || process.env.MOUNT_PATH || '/webtalk',
    apiBasePath: options.apiBasePath || process.env.API_BASE_PATH || '',
  };
}

module.exports = { createConfig };
