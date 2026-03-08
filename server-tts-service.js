const fs = require('fs');
const path = require('path');
const ttsOnnx = require('./server-tts-onnx');
const { encodeWav, decodeAudioFile } = require('./server-stt');

const VOICE_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];

const SAMPLE_RATE = 24000;
const os = require('os');
const DEFAULT_VOICES_DIR = path.join(os.homedir(), '.gmgui', 'voices');
const TTS_MODELS_DIR = path.join(os.homedir(), '.gmgui', 'models', 'tts');

let modelsDir = null;
let loadError = null;
let loadPromise = null;
const voiceCache = {};
const voiceInFlight = {};

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
      const ext = path.extname(file).toLowerCase();
      if (!VOICE_EXTENSIONS.includes(ext)) continue;
      const id = path.basename(file, ext);
      if (!voices[id]) voices[id] = path.join(dir, file);
    }
  }
  return voices;
}

function getVoices(voiceDirs) {
  return Object.keys(scanVoiceDirs(voiceDirs));
}

async function getVoiceEmbedding(voiceId, voiceDirs) {
  const voices = scanVoiceDirs(voiceDirs);
  const stripped = voiceId && voiceId.replace(/^custom_/, '');
  const audioPath = voices[voiceId] || voices[stripped] || Object.values(voices)[0];
  if (!audioPath) throw new Error('No voice files found. Place an audio file in ' + DEFAULT_VOICES_DIR);
  if (voiceCache[audioPath]) return voiceCache[audioPath];
  if (voiceInFlight[audioPath]) return voiceInFlight[audioPath];

  const p = (async () => {
    const audio16k = await decodeAudioFile(audioPath);
    const ratio = 16000 / SAMPLE_RATE;
    const len = Math.round(audio16k.length / ratio);
    const resampled = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, audio16k.length - 1);
      resampled[i] = audio16k[lo] * (1 - (idx - lo)) + audio16k[hi] * (idx - lo);
    }
    const embedding = await ttsOnnx.encodeVoiceAudio(resampled);
    voiceCache[audioPath] = embedding;
    delete voiceInFlight[audioPath];
    return embedding;
  })();
  voiceInFlight[audioPath] = p;
  return p;
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
  const prepared = ttsOnnx.prepareText(text);
  if (!prepared) return;
  for await (const pcm of ttsOnnx.generateSentenceStream(prepared, embedding)) {
    if (pcm && pcm.length > 0) yield encodeWav(pcm, SAMPLE_RATE);
  }
}

ensureLoaded().catch(() => {});

module.exports = { getStatus, getVoices, synthesize, synthesizeStream, ensureLoaded };
