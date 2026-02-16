const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const setup = require('./pocket-tts-setup');
const edgeFallback = require('./edge-tts-fallback');

const isWin = process.platform === 'win32';
const VENV_DIR = setup.VENV_DIR;

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];
const FALLBACK_VOICE = 'alba';
const TTS_CACHE_MAX_BYTES = 10 * 1024 * 1024;
const POCKET_PORT = 8787;

const BASE_VOICES = [
  { id: 'default', name: 'Default', gender: 'male', accent: 'US' },
  { id: 'bdl', name: 'BDL', gender: 'male', accent: 'US' },
  { id: 'slt', name: 'SLT', gender: 'female', accent: 'US' },
  { id: 'clb', name: 'CLB', gender: 'female', accent: 'US' },
  { id: 'rms', name: 'RMS', gender: 'male', accent: 'US' },
  { id: 'awb', name: 'AWB', gender: 'male', accent: 'Scottish' },
  { id: 'jmk', name: 'JMK', gender: 'male', accent: 'Canadian' },
  { id: 'ksp', name: 'KSP', gender: 'male', accent: 'Indian' },
];

// --- Pocket TTS sidecar state ---

const state = {
  process: null, port: POCKET_PORT, status: 'stopped', pid: null,
  restartCount: 0, failureCount: 0, lastError: null,
  healthy: false, voicePath: null, starting: false,
  shutdownRequested: false, healthTimer: null, restartTimer: null,
  voiceCloning: false, adopted: false,
};

// --- TTS cache ---

let ttsCacheBytes = 0;
const ttsCache = new Map();
const ttsInflight = new Map();

// --- Voice directories ---

function getVoiceDirs(extraDirs) {
  const dirs = [];
  const seen = new Set();
  const add = (d) => { const r = path.resolve(d); if (!seen.has(r)) { seen.add(r); dirs.push(r); } };
  const startupCwd = process.env.STARTUP_CWD || process.cwd();
  add(path.join(startupCwd, 'voices'));
  add(path.join(os.homedir(), 'voices'));
  add('/config/voices');
  if (extraDirs) {
    for (const d of extraDirs) add(d);
  }
  return dirs;
}

// --- Binary discovery ---

function findBinary(extraPaths) {
  const candidates = [];
  if (isWin) {
    candidates.push(
      path.join(VENV_DIR, 'Scripts', 'pocket-tts.exe'),
      path.join(VENV_DIR, 'bin', 'pocket-tts.exe'),
      path.join(VENV_DIR, 'bin', 'pocket-tts'),
    );
  }
  candidates.push(
    '/config/workspace/agentgui/data/pocket-venv/bin/pocket-tts',
    path.join(VENV_DIR, 'bin', 'pocket-tts'),
  );
  if (extraPaths) {
    for (const p of extraPaths) candidates.unshift(p);
  }
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

function isInstalled(extraPaths) { return !!findBinary(extraPaths); }

// --- Voice file discovery ---

function findVoiceFile(voiceId, extraDirs) {
  if (!voiceId || voiceId === 'default') return null;
  const baseName = voiceId.replace(/^custom_/, '');
  for (const dir of getVoiceDirs(extraDirs)) {
    for (const ext of AUDIO_EXTENSIONS) {
      const p = path.join(dir, baseName + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function scanVoiceDir(dir) {
  const voices = [];
  try {
    if (!fs.existsSync(dir)) return voices;
    const listed = new Set();
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;
      const baseName = path.basename(file, ext);
      if (ext !== '.wav') {
        const wavExists = fs.existsSync(path.join(dir, baseName + '.wav'));
        if (wavExists) continue;
      }
      if (listed.has(baseName)) continue;
      listed.add(baseName);
      const id = 'custom_' + baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const name = baseName.replace(/_/g, ' ');
      voices.push({ id, name, gender: 'custom', accent: 'custom', isCustom: true, sourceDir: dir });
    }
  } catch (err) {
    // ignore scan errors
  }
  return voices;
}

function getVoices(extraDirs) {
  const seen = new Set();
  const custom = [];
  for (const dir of getVoiceDirs(extraDirs)) {
    for (const v of scanVoiceDir(dir)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      custom.push(v);
    }
  }
  return [...BASE_VOICES, ...custom];
}

// --- Pocket TTS sidecar management ---

function healthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${state.port}/health`, { timeout: 3000 }, (res) => {
      res.resume();
      res.on('end', () => { state.healthy = res.statusCode === 200; resolve(state.healthy); });
    });
    req.on('error', () => { state.healthy = false; resolve(false); });
    req.on('timeout', () => { req.destroy(); state.healthy = false; resolve(false); });
  });
}

function killProcess() {
  if (state.process) { try { state.process.kill('SIGTERM'); } catch (_) {} }
  state.process = null; state.pid = null; state.healthy = false; state.status = 'stopped';
}

function scheduleRestart(extraPaths) {
  if (state.shutdownRequested) return;
  if (!state.adopted) killProcess();
  const delay = Math.min(1000 * Math.pow(2, state.restartCount), 30000);
  state.restartCount++;
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    state.adopted = false;
    start(state.voicePath, { binaryPaths: extraPaths }).catch(() => {});
  }, delay);
}

function spawnSidecar(voice, extraPaths) {
  const bin = findBinary(extraPaths);
  if (!bin) throw new Error('pocket-tts binary not found');
  const args = ['serve', '--host', '0.0.0.0', '--port', String(state.port)];
  if (voice) args.push('--voice', voice);
  return spawn(bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
}

function attachProc(proc) {
  state.process = proc; state.pid = proc.pid; state.status = 'starting';
  proc.stdout.on('data', d => { const l = d.toString().trim(); if (l) console.log('[POCKET-TTS]', l); });
  proc.stderr.on('data', d => { const l = d.toString().trim(); if (l) console.error('[POCKET-TTS]', l); });
  proc.on('error', e => { state.lastError = e.message; });
}

async function waitForReady(proc, timeoutSec) {
  let exited = false;
  proc.on('exit', () => { exited = true; });
  for (let i = 0; i < timeoutSec; i++) {
    if (exited) return false;
    await new Promise(r => setTimeout(r, 1000));
    if (await healthCheck()) return true;
  }
  return false;
}

async function adoptRunning() {
  if (await healthCheck()) {
    state.status = 'running'; state.healthy = true; state.adopted = true;
    state.restartCount = 0; state.failureCount = 0; state.lastError = null;
    if (!state.healthTimer) state.healthTimer = setInterval(async () => {
      if (state.status !== 'running') return;
      const ok = await healthCheck();
      if (!ok && !state.shutdownRequested) {
        state.failureCount++;
        if (state.failureCount >= 3) { state.adopted = false; scheduleRestart(); }
      } else if (ok) state.failureCount = 0;
    }, 10000);
    return true;
  }
  return false;
}

async function start(voicePath, options) {
  const extraPaths = options && options.binaryPaths;
  if (state.starting) return false;
  if (state.status === 'running' && state.healthy) return true;
  if (await adoptRunning()) {
    if (voicePath) {
      state.voicePath = voicePath;
      state.voiceCloning = true;
    }
    return true;
  }
  if (!isInstalled(extraPaths)) { state.lastError = 'not installed'; state.status = 'unavailable'; return false; }
  state.starting = true; state.shutdownRequested = false;
  const requestedVoice = voicePath || state.voicePath;
  try {
    killProcess();
    let proc = spawnSidecar(requestedVoice, extraPaths);
    attachProc(proc);
    let ready = await waitForReady(proc, 120);
    if (!ready && requestedVoice && requestedVoice !== FALLBACK_VOICE) {
      killProcess();
      proc = spawnSidecar(FALLBACK_VOICE, extraPaths);
      attachProc(proc);
      state.voiceCloning = false;
      ready = await waitForReady(proc, 120);
      if (ready) state.voicePath = FALLBACK_VOICE;
    } else if (ready) {
      state.voicePath = requestedVoice;
      state.voiceCloning = !!requestedVoice && !['alba', 'marius', 'javert', 'jean', 'fantine', 'cosette', 'eponine', 'azelma'].includes(requestedVoice);
    }
    if (ready) {
      state.status = 'running'; state.restartCount = 0; state.failureCount = 0; state.lastError = null;
      proc.on('exit', (code, sig) => {
        state.process = null; state.pid = null; state.healthy = false; state.status = 'stopped';
        if (!state.shutdownRequested) scheduleRestart(extraPaths);
      });
      if (!state.healthTimer) state.healthTimer = setInterval(async () => {
        if (state.status !== 'running') return;
        const ok = await healthCheck();
        if (!ok && !state.shutdownRequested) {
          state.failureCount++;
          if (state.failureCount >= 3) scheduleRestart(extraPaths);
        } else if (ok) state.failureCount = 0;
      }, 10000);
      return true;
    }
    state.lastError = 'Start timeout'; state.status = 'error'; killProcess(); return false;
  } catch (err) {
    state.lastError = err.message; state.status = 'error'; return false;
  } finally { state.starting = false; }
}

async function stop() {
  state.shutdownRequested = true;
  if (state.healthTimer) { clearInterval(state.healthTimer); state.healthTimer = null; }
  if (state.restartTimer) { clearTimeout(state.restartTimer); state.restartTimer = null; }
  killProcess();
}

// --- TTS cache helpers ---

function cachePut(key, buf) {
  if (ttsCache.has(key)) {
    ttsCacheBytes -= ttsCache.get(key).length;
    ttsCache.delete(key);
  }
  while (ttsCacheBytes + buf.length > TTS_CACHE_MAX_BYTES && ttsCache.size > 0) {
    const oldest = ttsCache.keys().next().value;
    ttsCacheBytes -= ttsCache.get(oldest).length;
    ttsCache.delete(oldest);
  }
  ttsCache.set(key, buf);
  ttsCacheBytes += buf.length;
}

function ttsCacheKey(text, voiceId) {
  return (voiceId || 'default') + ':' + text;
}

function ttsCacheGet(key) {
  const cached = ttsCache.get(key);
  if (cached) { ttsCache.delete(key); ttsCache.set(key, cached); }
  return cached || null;
}

function splitSentences(text) {
  const raw = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g);
  if (!raw) return [text];
  return raw.map(s => s.trim()).filter(s => s.length > 0);
}

function resolveVoicePath(voiceId, extraDirs) {
  if (!voiceId || voiceId === 'default') return null;
  return findVoiceFile(voiceId, extraDirs);
}

// --- Synthesis ---

async function synthesizeAny(text, voiceId, extraDirs) {
  if (state.healthy) return synthesizeViaPocket(text, voiceId, extraDirs);
  return edgeFallback.synthesize(text, voiceId);
}

async function synthesizeViaPocket(text, voiceId, extraDirs) {
  if (!state.healthy) throw new Error('pocket-tts not healthy');
  const voicePath = resolveVoicePath(voiceId, extraDirs);
  const boundary = '----PocketTTS' + Date.now();
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n${text}\r\n`);
  if (voicePath) {
    const data = fs.readFileSync(voicePath);
    const name = path.basename(voicePath);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="voice_wav"; filename="${name}"\r\nContent-Type: audio/wav\r\n\r\n`);
    parts.push(data); parts.push('\r\n');
  }
  parts.push(`--${boundary}--\r\n`);
  const body = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: state.port, path: '/tts', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      timeout: 60000,
    }, res => {
      if (res.statusCode !== 200) {
        let e = ''; res.on('data', d => e += d);
        res.on('end', () => reject(new Error(`pocket-tts HTTP ${res.statusCode}: ${e}`)));
        return;
      }
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('pocket-tts timeout')); });
    req.write(body); req.end();
  });
}

async function synthesize(text, voiceId, extraDirs) {
  const cacheKey = (voiceId || 'default') + ':' + text;
  const cached = ttsCache.get(cacheKey);
  if (cached) {
    ttsCache.delete(cacheKey);
    ttsCache.set(cacheKey, cached);
    return cached;
  }
  const inflight = ttsInflight.get(cacheKey);
  if (inflight) return inflight;
  const promise = (async () => {
    const wav = await synthesizeAny(text, voiceId, extraDirs);
    cachePut(cacheKey, wav);
    return wav;
  })();
  ttsInflight.set(cacheKey, promise);
  try { return await promise; } finally { ttsInflight.delete(cacheKey); }
}

async function* synthesizeStream(text, voiceId, extraDirs) {
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    const cacheKey = (voiceId || 'default') + ':' + sentence;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      ttsCache.delete(cacheKey);
      ttsCache.set(cacheKey, cached);
      yield cached;
      continue;
    }
    const wav = await synthesizeAny(sentence, voiceId, extraDirs);
    cachePut(cacheKey, wav);
    yield wav;
  }
}

function getStatus() {
  return {
    ready: state.healthy,
    status: state.status,
    pid: state.pid,
    port: state.port,
    restartCount: state.restartCount,
    failureCount: state.failureCount,
    lastError: state.lastError,
    installed: isInstalled(),
    voiceCloning: state.voiceCloning,
    edgeTtsFallback: true,
  };
}

function preload(defaultVoicePath, options) {
  const voicePath = defaultVoicePath && fs.existsSync(defaultVoicePath) ? defaultVoicePath : null;
  return start(voicePath, options);
}

module.exports = {
  start,
  stop,
  synthesize,
  synthesizeStream,
  healthCheck,
  getStatus,
  getVoices,
  findVoiceFile,
  isInstalled,
  preload,
  ttsCacheKey,
  ttsCacheGet,
  splitSentences,
  ensureInstalled: setup.ensureInstalled,
  detectPython: setup.detectPython,
  getPocketTtsPath: setup.getPocketTtsPath,
  VENV_DIR: setup.VENV_DIR,
  SETUP_CONFIG: setup.CONFIG,
};
