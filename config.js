const path = require('path');
const os = require('os');

const GMGUI_MODELS = path.join(os.homedir(), '.gmgui', 'models');

function createConfig(options = {}) {
  const sdkDir = options.sdkDir || __dirname;

  return {
    port: options.port || parseInt(process.env.PORT, 10) || 8080,
    sdkDir,
    modelsDir: options.modelsDir || process.env.MODELS_DIR || GMGUI_MODELS,
    ttsModelsDir: options.ttsModelsDir || process.env.TTS_MODELS_DIR || path.join(GMGUI_MODELS, 'tts'),
    sttModelsDir: options.sttModelsDir || process.env.STT_MODELS_DIR || path.join(GMGUI_MODELS, 'stt'),
    assetsDir: options.assetsDir || path.join(sdkDir, 'assets'),
    ttsDir: options.ttsDir || path.join(sdkDir, 'tts'),
    defaultWhisperModel: options.defaultWhisperModel || process.env.WHISPER_MODEL || 'onnx-community/whisper-base',
    whisperBaseUrl: options.whisperBaseUrl || process.env.WHISPER_BASE_URL || 'https://raw.githubusercontent.com/AnEntrypoint/models/main/stt/',
    ttsBaseUrl: options.ttsBaseUrl || process.env.TTS_BASE_URL || 'https://raw.githubusercontent.com/AnEntrypoint/models/main/tts/',
    speakerModelDir: options.speakerModelDir || path.join(GMGUI_MODELS, 'speaker'),
    workerFile: options.workerFile || process.env.WORKER_FILE || 'worker-BPxxCWVT.js',
    workerBackup: options.workerBackup || process.env.WORKER_BACKUP || 'worker-BPxxCWVT-original.js',
    ttsWorkerFile: options.ttsWorkerFile || process.env.TTS_WORKER_FILE || 'inference-worker.js',
    onnxWasmUrl: options.onnxWasmUrl || process.env.ONNX_WASM_URL || '',
    mountPath: options.mountPath || process.env.MOUNT_PATH || '/webtalk',
    apiBasePath: options.apiBasePath || process.env.API_BASE_PATH || '',
    sttDevice: options.sttDevice || process.env.WEBTALK_STT_DEVICE || '',
    ttsProviders: options.ttsProviders || process.env.WEBTALK_TTS_PROVIDERS || '',
  };
}

module.exports = { createConfig };
