const fs = require('fs');
const path = require('path');
const os = require('os');

const SAMPLE_RATE = 16000;
const MIN_WAV_SIZE = 1000;
const STT_RETRY_MS = 30000;

let transformersModule = null;
let sttPipeline = null;
let sttLoading = false;
let sttLoadError = null;
let sttLoadErrorTime = 0;

const PERSISTENT_CACHE = path.join(os.homedir(), '.gmgui', 'models');

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

function decodeWavToFloat32(buffer) {
  const view = new DataView(buffer.buffer || buffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a WAV file');
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  let dataOffset = 44;
  for (let i = 36; i < view.byteLength - 8; i++) {
    if (view.getUint8(i) === 0x64 && view.getUint8(i + 1) === 0x61 &&
        view.getUint8(i + 2) === 0x74 && view.getUint8(i + 3) === 0x61) {
      dataOffset = i + 8;
      break;
    }
  }
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((view.byteLength - dataOffset) / (bytesPerSample * numChannels));
  const audio = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample * numChannels;
    if (bitsPerSample === 16) {
      audio[i] = view.getInt16(offset, true) / 32768;
    } else if (bitsPerSample === 32) {
      audio[i] = view.getFloat32(offset, true);
    } else {
      audio[i] = (view.getUint8(offset) - 128) / 128;
    }
  }
  return { audio, sampleRate };
}

function resampleTo16k(audio, fromRate) {
  if (fromRate === SAMPLE_RATE) return audio;
  const ratio = fromRate / SAMPLE_RATE;
  const newLen = Math.round(audio.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, audio.length - 1);
    const frac = srcIdx - lo;
    result[i] = audio[lo] * (1 - frac) + audio[hi] * frac;
  }
  return result;
}

function encodeWav(float32Audio, sampleRate) {
  const numSamples = float32Audio.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32Audio[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return Buffer.from(buffer);
}

async function decodeAudioFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') {
    const decoded = decodeWavToFloat32(buf);
    return resampleTo16k(decoded.audio, decoded.sampleRate);
  }
  const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
  if (fs.existsSync(wavPath)) {
    const wavBuf = fs.readFileSync(wavPath);
    const decoded = decodeWavToFloat32(wavBuf);
    return resampleTo16k(decoded.audio, decoded.sampleRate);
  }
  const decode = (await import('audio-decode')).default;
  const audioBuffer = await decode(buf);
  const mono = audioBuffer.getChannelData(0);
  return resampleTo16k(mono, audioBuffer.sampleRate);
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
    sttPipeline = await pipeline('automatic-speech-recognition', modelPath, {
      device: 'cpu',
      cache_dir: cacheDir,
      local_files_only: isLocal,
    });
    sttLoadError = null;
    return sttPipeline;
  } catch (err) {
    sttPipeline = null;
    const message = err.message || String(err);
    if (message.includes('JSON') && message.includes('position')) {
      const cacheHint = (options && options.cacheDir) || PERSISTENT_CACHE;
      const whisperCachePath = path.join(cacheHint, 'onnx-community', 'whisper-base');
      sttLoadError = new Error(
        `STT model load failed: Corrupted model files detected. ` +
        `The config.json file in the model cache appears to be corrupted. ` +
        `To fix this, delete the model cache directory at: ${whisperCachePath} ` +
        `Then restart the application to re-download clean model files.`
      );
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
  decodeWavToFloat32,
  resampleTo16k,
  encodeWav,
  decodeAudioFile,
  SAMPLE_RATE,
};
