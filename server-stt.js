const fs = require('fs');
const path = require('path');
const os = require('os');

const PLATFORM = os.platform();
const ARCH = os.arch();

function selectSTTDevice() {
  const override = process.env.WEBTALK_STT_DEVICE;
  if (override) return override;
  if (PLATFORM === 'darwin' && ARCH === 'arm64') return 'mps';
  if (PLATFORM === 'linux' && (ARCH === 'arm64' || ARCH === 'arm')) return 'cpu';
  return 'cpu';
}

const { decodeWavToFloat32, resampleTo16k, encodeWav, decodeAudioFile, SAMPLE_RATE } = require('./audio-codec');
const MIN_WAV_SIZE = 1000;
const STT_RETRY_MS = 30000;

let transformersModule = null;
let sttPipeline = null;
let sttLoading = false;
let sttLoadError = null;
let sttLoadErrorTime = 0;

const PERSISTENT_CACHE = path.join(os.homedir(), '.gmgui', 'models');

function resetError() {
  sttPipeline = null;
  sttLoadError = null;
  sttLoadErrorTime = 0;
}

function clearCorruptedCache(options) {
  const cacheDir = (options && options.cacheDir) || PERSISTENT_CACHE;
  const whisperDir = path.join(cacheDir, 'onnx-community', 'whisper-base');
  let cleared = 0;
  if (!fs.existsSync(whisperDir)) return cleared;
  const jsonFiles = ['config.json', 'preprocessor_config.json', 'tokenizer_config.json', 'tokenizer.json', 'vocab.json'];
  for (const file of jsonFiles) {
    const fp = path.join(whisperDir, file);
    if (!fs.existsSync(fp)) continue;
    try {
      JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch {
      try { fs.unlinkSync(fp); cleared++; console.log('[STT] Removed corrupted:', file); } catch {}
    }
  }
  const manifestPath = path.join(cacheDir, '.manifests.json');
  if (fs.existsSync(manifestPath)) {
    try { JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {
      try { fs.unlinkSync(manifestPath); cleared++; } catch {}
    }
  }
  return cleared;
}

async function loadTransformers() {
  if (transformersModule) return transformersModule;
  transformersModule = await import('@huggingface/transformers');
  return transformersModule;
}

function isModelComplete(dir) {
  const encoder = path.join(dir, 'onnx', 'encoder_model.onnx');
  const decoder = path.join(dir, 'onnx', 'decoder_model_merged.onnx');
  const decoderQ4 = path.join(dir, 'onnx', 'decoder_model_merged_q4.onnx');
  const hasEncoder = fs.existsSync(encoder) && fs.statSync(encoder).size > 40 * 1024 * 1024;
  const hasDecoder = (fs.existsSync(decoder) && fs.statSync(decoder).size > 100 * 1024 * 1024) ||
                     (fs.existsSync(decoderQ4) && fs.statSync(decoderQ4).size > 100 * 1024 * 1024);
  return hasEncoder && hasDecoder;
}

function whisperModelPath(options) {
  const webtalkModels = path.join(__dirname, 'models', 'onnx-community', 'whisper-base');
  if (isModelComplete(webtalkModels)) return webtalkModels;

  const cacheDir = (options && options.cacheDir) || PERSISTENT_CACHE;

  const cached = path.join(cacheDir, 'onnx-community', 'whisper-base');
  if (isModelComplete(cached)) return cached;

  const legacyPath = path.join(cacheDir, 'whisper');
  if (isModelComplete(legacyPath)) return legacyPath;

  return 'onnx-community/whisper-base';
}





async function getSTT(options) {
  if (sttPipeline) return sttPipeline;
  if (sttLoadError && (Date.now() - sttLoadErrorTime < STT_RETRY_MS)) throw sttLoadError;
  if (sttLoading) {
    while (sttLoading) await new Promise(r => setTimeout(r, 100));
    if (sttLoadError && (Date.now() - sttLoadErrorTime < STT_RETRY_MS)) throw sttLoadError;
    if (!sttPipeline) throw new Error('STT pipeline failed to load');
    return sttPipeline;
  }
  sttLoading = true;
  try {
    const { pipeline, env } = await loadTransformers();
    const modelPath = whisperModelPath(options);
    const isLocal = !modelPath.includes('/') || fs.existsSync(modelPath);
    const cacheDir = (options && options.cacheDir) || PERSISTENT_CACHE;
    env.allowLocalModels = true;
    env.allowRemoteModels = !isLocal;
    env.cacheDir = cacheDir;
    env.backends.onnx.wasm.proxy = false;
    if (isLocal) env.localModelPath = '';
    const device = selectSTTDevice();
    let loadDevice = device;
    try {
      sttPipeline = await pipeline('automatic-speech-recognition', modelPath, {
        device: loadDevice,
        cache_dir: cacheDir,
        local_files_only: isLocal,
      });
    } catch (deviceErr) {
      if (loadDevice !== 'cpu') {
        console.warn('[STT] Device', loadDevice, 'unavailable, falling back to cpu:', deviceErr.message);
        loadDevice = 'cpu';
        sttPipeline = await pipeline('automatic-speech-recognition', modelPath, {
          device: 'cpu',
          cache_dir: cacheDir,
          local_files_only: isLocal,
        });
      } else {
        throw deviceErr;
      }
    }
    console.log('[STT] Loaded with device:', loadDevice);
    sttLoadError = null;
    return sttPipeline;
  } catch (err) {
    sttPipeline = null;
    const message = err.message || String(err);
    if (message.includes('JSON') && message.includes('position') ||
        message.includes('not valid JSON') || message.includes('Unexpected token')) {
      const cleared = clearCorruptedCache(options);
      console.log('[STT] Detected corrupted JSON files, cleared', cleared, 'files');
      sttLoadError = new Error('STT model load failed: corrupted files cleared, re-downloading on next attempt');
      sttLoadErrorTime = 0;
    } else {
      sttLoadError = new Error('STT model load failed: ' + message);
    }
    sttLoadErrorTime = Date.now();
    throw sttLoadError;
  } finally {
    sttLoading = false;
  }
}

async function transcribe(audioBuffer, options) {
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
  if (buf.length < MIN_WAV_SIZE) {
    throw new Error('Audio too short (' + buf.length + ' bytes)');
  }
  let audio;
  const isWav = buf.length > 4 && buf.toString('ascii', 0, 4) === 'RIFF';
  if (isWav) {
    let decoded;
    try {
      decoded = decodeWavToFloat32(buf);
    } catch (err) {
      throw new Error('WAV decode failed: ' + err.message);
    }
    if (!decoded.audio || decoded.audio.length === 0) {
      throw new Error('WAV contains no audio samples');
    }
    audio = resampleTo16k(decoded.audio, decoded.sampleRate);
  } else {
    const sampleCount = Math.floor(buf.byteLength / 4);
    if (sampleCount === 0) throw new Error('Audio buffer too small');
    const aligned = new ArrayBuffer(sampleCount * 4);
    new Uint8Array(aligned).set(buf.subarray(0, sampleCount * 4));
    audio = new Float32Array(aligned);
  }
  if (audio.length < 100) {
    throw new Error('Audio too short for transcription');
  }
  const stt = await getSTT(options);
  let result;
  try {
    result = await stt(audio);
  } catch (err) {
    throw new Error('Transcription engine error: ' + err.message);
  }
  if (!result || typeof result.text !== 'string') {
    return '';
  }
  return result.text;
}

function getStatus() {
  return {
    ready: !!sttPipeline,
    loading: sttLoading,
    error: sttLoadError ? sttLoadError.message : null,
  };
}

module.exports = {
  transcribe,
  getSTT,
  getStatus,
  resetError,
  clearCorruptedCache,
  decodeWavToFloat32,
  resampleTo16k,
  encodeWav,
  decodeAudioFile,
  SAMPLE_RATE,
};
