const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWin = process.platform === 'win32';
const VENV_DIR = path.join(os.homedir(), '.gmgui', 'pocket-venv');
const CONFIG = {
  PIP_TIMEOUT: 120000,
  VENV_CREATION_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  RETRY_BACKOFF_MULTIPLIER: 2,
};

function detectPython() {
  const cmds = isWin ? ['python'] : ['python3', 'python'];
  for (const cmd of cmds) {
    try {
      const out = execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' }).trim();
      const m = out.match(/(\d+)\.(\d+)/);
      if (!m) continue;
      const major = parseInt(m[1], 10), minor = parseInt(m[2], 10);
      if (major < 3 || (major === 3 && minor < 9)) continue;
      return { found: true, version: `${major}.${minor}`, cmd };
    } catch (_) {}
  }
  return { found: false };
}

function getPocketTtsPath() {
  if (isWin) return path.join(VENV_DIR, 'Scripts', 'pocket-tts.exe');
  return path.join(VENV_DIR, 'bin', 'pocket-tts');
}

function verify() {
  const p = getPocketTtsPath();
  if (!fs.existsSync(p)) return false;
  try {
    const r = spawnSync(p, ['--help'], { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' });
    return r.status === 0 || (r.stdout && r.stdout.includes('pocket-tts')) || (r.stderr && r.stderr.includes('pocket-tts'));
  } catch (_) { return false; }
}

function cleanup() {
  try { if (fs.existsSync(VENV_DIR)) fs.rmSync(VENV_DIR, { recursive: true, force: true }); } catch (_) {}
}

async function retry(fn, name, max) {
  let last, delay = CONFIG.RETRY_DELAY_MS;
  for (let i = 1; i <= max; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (i < max) await new Promise(r => setTimeout(r, delay));
      delay *= CONFIG.RETRY_BACKOFF_MULTIPLIER;
    }
  }
  throw new Error(`${name} failed after ${max} attempts: ${last.message || last}`);
}

const state = { attempted: false, ready: false, error: null, inProgress: false };

async function ensureInstalled(onProgress) {
  if (state.attempted) return state.ready;
  if (state.inProgress) {
    let w = 0;
    while (state.inProgress && w < 600000) { await new Promise(r => setTimeout(r, 100)); w += 100; }
    return state.ready;
  }
  state.inProgress = true;
  const emit = (step, status, message) => { if (onProgress) onProgress({ step, status, message }); };

  try {
    if (fs.existsSync(getPocketTtsPath()) && verify()) {
      emit('verifying', 'success', 'pocket-tts already installed');
      state.attempted = true; state.ready = true; return true;
    }

    const py = detectPython();
    if (!py.found) {
      emit('detecting-python', 'error', 'Python 3.9+ not found');
      state.attempted = true; state.error = 'Python 3.9+ not found'; return false;
    }
    emit('detecting-python', 'success', `Found Python ${py.version}`);

    emit('creating-venv', 'in-progress', `Creating virtual environment at ${VENV_DIR}`);
    await retry(() => {
      execSync(`${py.cmd} -m venv "${VENV_DIR}"`, { encoding: 'utf-8', stdio: 'pipe', timeout: CONFIG.VENV_CREATION_TIMEOUT });
    }, 'venv creation', 2);
    emit('creating-venv', 'success', 'Virtual environment created');

    emit('installing', 'in-progress', 'Installing pocket-tts via pip');
    await retry((attempt) => {
      if (attempt > 1) emit('installing', 'in-progress', `Installing pocket-tts (attempt ${attempt}/${CONFIG.MAX_RETRIES})`);
      const pip = isWin ? path.join(VENV_DIR, 'Scripts', 'pip') : path.join(VENV_DIR, 'bin', 'pip');
      execSync(`"${pip}" install --no-cache-dir pocket-tts`, {
        encoding: 'utf-8', stdio: 'pipe', timeout: CONFIG.PIP_TIMEOUT,
        env: { ...process.env, PIP_DEFAULT_TIMEOUT: '120' },
      });
    }, 'pip install', CONFIG.MAX_RETRIES);
    emit('installing', 'success', 'pocket-tts installed');

    emit('verifying', 'in-progress', 'Verifying installation');
    if (!verify()) {
      cleanup(); emit('verifying', 'error', 'Verification failed');
      state.attempted = true; state.error = 'verification failed'; return false;
    }

    if (isWin) {
      const binDir = path.join(VENV_DIR, 'bin');
      try { fs.mkdirSync(binDir, { recursive: true }); } catch (_) {}
      const src = getPocketTtsPath(), dst = path.join(binDir, 'pocket-tts.exe');
      if (fs.existsSync(src) && !fs.existsSync(dst)) try { fs.copyFileSync(src, dst); } catch (_) {}
    }

    emit('verifying', 'success', 'pocket-tts ready');
    state.attempted = true; state.ready = true; return true;
  } catch (e) {
    cleanup(); emit('installing', 'error', e.message);
    state.attempted = true; state.error = e.message; return false;
  } finally { state.inProgress = false; }
}

module.exports = { ensureInstalled, detectPython, getPocketTtsPath, verify, cleanup, VENV_DIR, CONFIG };
