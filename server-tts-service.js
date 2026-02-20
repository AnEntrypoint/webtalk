const fs = require('fs');
const path = require('path');
const ttsOnnx = require('./server-tts-onnx');
const { encodeWav } = require('./server-stt');

const SAMPLE_RATE = 24000;
const os = require('os');
const DEFAULT_VOICES_DIR = path.join(os.homedir(), '.gmgui', 'voices');
const TTS_MODELS_DIR = path.join(os.homedir(), '.gmgui', 'models', 'tts');

let modelsDir = null;
let loadError = null;
let loadPromise = null;
const voiceCache = {};

function getTTSModelsDir() {
  if (!modelsDir) modelsDir = TTS_MODELS_DIR;
  return modelsDir;
}

async function ensureLoaded() {
  const dir = getTTSModelsDir();
  if (!dir) throw new Error('TTS models directory not found');
  if (ttsOnnx.isReady()) return;
  if (loadPromise) return loadPromise;
  loadPromise = ttsOnnx.loadModels(dir).catch(err => {
    loadError = err.message;
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

function getStatus() {
  return {
    ready: ttsOnnx.isReady(),
    lastError: loadError,
    modelsDir: getTTSModelsDir(),
  };
}

function scanVoiceDirs(voiceDirs) {
  const dirs = [DEFAULT_VOICES_DIR, ...(voiceDirs || [])].filter(Boolean);
  const voices = {};
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.wav')) {
        const id = path.basename(file, '.wav');
        voices[id] = path.join(dir, file);
      }
    }
  }
  return voices;
}

function getVoices(voiceDirs) {
  return Object.keys(scanVoiceDirs(voiceDirs));
}

async function getVoiceEmbedding(voiceId, voiceDirs) {
  const voices = scanVoiceDirs(voiceDirs);
  const wavPath = voices[voiceId] || Object.values(voices)[0];
  if (!wavPath) throw new Error('No voice files found');
  if (voiceCache[wavPath]) return voiceCache[wavPath];

  const wavBuf = fs.readFileSync(wavPath);
  const view = new DataView(wavBuf.buffer, wavBuf.byteOffset, wavBuf.byteLength);
  const sampleRate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  const numSamples = dataSize / 2;
  const audio = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const val = view.getInt16(44 + i * 2, true);
    audio[i] = val < 0 ? val / 0x8000 : val / 0x7FFF;
  }

  let resampled = audio;
  if (sampleRate !== SAMPLE_RATE) {
    const ratio = sampleRate / SAMPLE_RATE;
    const len = Math.round(audio.length / ratio);
    resampled = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, audio.length - 1);
      resampled[i] = audio[lo] * (1 - (idx - lo)) + audio[hi] * (idx - lo);
    }
  }

  const embedding = await ttsOnnx.encodeVoiceAudio(resampled);
  voiceCache[wavPath] = embedding;
  return embedding;
}

async function synthesize(text, voiceId, voiceDirs) {
  await ensureLoaded();
  const embedding = await getVoiceEmbedding(voiceId, voiceDirs);
  const dir = getTTSModelsDir();
  const audioFloat = await ttsOnnx.synthesize(text, embedding, dir);
  return encodeWav(audioFloat, SAMPLE_RATE);
}

async function* synthesizeStream(text, voiceId, voiceDirs) {
  await ensureLoaded();
  const embedding = await getVoiceEmbedding(voiceId, voiceDirs);
  const dir = getTTSModelsDir();
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    const audioFloat = await ttsOnnx.synthesize(s, embedding, dir);
    yield encodeWav(audioFloat, SAMPLE_RATE);
  }
}

ensureLoaded().catch(() => {});

module.exports = { getStatus, getVoices, synthesize, synthesizeStream, ensureLoaded };
