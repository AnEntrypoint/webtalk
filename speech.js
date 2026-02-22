const fs = require('fs');
const path = require('path');
const os = require('os');

const serverTTS = require('./server-tts-service');
const serverSTT = require('./server-stt');

const VOICE_DIRS = [
  path.join(os.homedir(), '.gmgui', 'voices'),
  path.join(os.homedir(), 'voices'),
];

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];

const POCKET_TTS_VOICES = [
  { id: 'default', name: 'Default', gender: 'female', accent: 'French' },
  { id: 'alba', name: 'Alba', gender: 'female', accent: 'French' },
  { id: 'marius', name: 'Marius', gender: 'male', accent: 'French' },
  { id: 'javert', name: 'Javert', gender: 'male', accent: 'French' },
  { id: 'jean', name: 'Jean', gender: 'male', accent: 'French' },
  { id: 'fantine', name: 'Fantine', gender: 'female', accent: 'French' },
  { id: 'cosette', name: 'Cosette', gender: 'female', accent: 'French' },
  { id: 'eponine', name: 'Eponine', gender: 'female', accent: 'French' },
  { id: 'azelma', name: 'Azelma', gender: 'female', accent: 'French' },
];

function getSttOptions() {
  if (process.env.PORTABLE_EXE_DIR) {
    return { cacheDir: path.join(process.env.PORTABLE_EXE_DIR, 'models') };
  }
  if (process.env.PORTABLE_DATA_DIR) {
    return { cacheDir: path.join(process.env.PORTABLE_DATA_DIR, 'models') };
  }
  return {};
}

function scanVoiceDir(dir) {
  const voices = [];
  try {
    if (!fs.existsSync(dir)) return voices;
    const seen = new Set();
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;
      const baseName = path.basename(file, ext);
      if (seen.has(baseName)) continue;
      seen.add(baseName);
      voices.push({
        id: 'custom_' + baseName.replace(/[^a-zA-Z0-9_-]/g, '_'),
        name: baseName.replace(/_/g, ' '),
        gender: 'custom',
        accent: 'custom',
        isCustom: true,
      });
    }
  } catch (_) {}
  return voices;
}

function getVoices() {
  const seen = new Set();
  const custom = [];
  for (const dir of VOICE_DIRS) {
    for (const v of scanVoiceDir(dir)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      custom.push(v);
    }
  }
  return [...POCKET_TTS_VOICES, ...custom];
}

function getStatus() {
  const sttStatus = serverSTT.getStatus();
  const ttsStatus = serverTTS.getStatus();
  return {
    sttReady: sttStatus.ready,
    ttsReady: ttsStatus.ready,
    sttLoading: sttStatus.loading,
    ttsLoading: false,
    sttError: sttStatus.error,
    ttsError: ttsStatus.lastError || null,
    ttsBackend: 'onnx-node',
  };
}

function transcribe(audioBuffer) {
  return serverSTT.transcribe(audioBuffer, getSttOptions());
}

function getSTT() {
  return serverSTT.getSTT(getSttOptions());
}

function synthesize(text, voiceId) {
  const voiceName = voiceId && voiceId.startsWith('custom_')
    ? voiceId.replace(/^custom_/, '')
    : voiceId;
  return serverTTS.synthesize(text, voiceName, VOICE_DIRS);
}

async function* synthesizeStream(text, voiceId) {
  const voiceName = voiceId && voiceId.startsWith('custom_')
    ? voiceId.replace(/^custom_/, '')
    : voiceId;
  for await (const chunk of serverTTS.synthesizeStream(text, voiceName, VOICE_DIRS)) {
    yield chunk;
  }
}

function preloadTTS() {
  serverTTS.ensureLoaded && serverTTS.ensureLoaded().catch(e =>
    console.warn('[TTS] preload failed:', e.message)
  );
}

function splitSentences(text) {
  // Split on sentence-ending punctuation followed by whitespace
  // This preserves filenames like "server.js", "index.html", "app.config.json"
  return text.match(/(?:[^.!?]|[.!?](?!\s))+[.!?]*(?:\s+|$)/g)?.map(s => s.trim()).filter(Boolean) || [text];
}

function ttsCacheKey() { return null; }
function ttsCacheGet() { return null; }

module.exports = {
  transcribe,
  synthesize,
  synthesizeStream,
  getSTT,
  getStatus,
  getVoices,
  preloadTTS,
  ttsCacheKey,
  ttsCacheGet,
  splitSentences,
  getSttOptions,
  VOICE_DIRS,
};
