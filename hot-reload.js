const fs = require('fs');
const path = require('path');
const {
  getInFlightCount,
  setSwapping,
  setDraining,
  recordDrain,
  recordSwap,
  recordReload,
  getCurrentHandlers,
  setPendingHandlers,
  setCurrentHandlers,
  state
} = require('./persistent-state');

const DRAIN_TIMEOUT = 5000;
const DRAIN_INTERVAL = 10;
const MAX_DRAIN_INTERVAL = 100;
const WATCH_DEBOUNCE = 300;

let drainInterval = DRAIN_INTERVAL;
let fileWatcher = null;
let pendingReload = null;
let reloadTimer = null;

async function drain(timeout = DRAIN_TIMEOUT) {
  recordDrain();
  setDraining(true);
  const startTime = Date.now();
  let interval = DRAIN_INTERVAL;

  while (getInFlightCount() > 0) {
    if (Date.now() - startTime > timeout) {
      setDraining(false);
      throw new Error(`Drain timeout: ${getInFlightCount()} requests still in flight`);
    }
    await new Promise(r => setTimeout(r, interval));
    interval = Math.min(interval * 2, MAX_DRAIN_INTERVAL);
  }

  setDraining(false);
}

async function swap() {
  setSwapping(true);
  recordSwap();
  const pending = state.handlers.pending;
  if (pending) {
    setCurrentHandlers(pending);
    setPendingHandlers(null);
  }
  setSwapping(false);
}

async function clearRequireCache(modules) {
  modules.forEach(moduleName => {
    const modulePath = path.resolve(moduleName.endsWith('.js') ? moduleName : moduleName + '.js');
    delete require.cache[modulePath];
    delete require.cache[require.resolve(modulePath)];
  });
}

async function reloadModules(modulesToReload, reloadFn) {
  try {
    await drain();
    const newHandlers = await reloadFn();
    setPendingHandlers(newHandlers);
    await swap();
    recordReload();
  } catch (error) {
    recordReload(error);
    throw error;
  }
}

function startFileWatcher(watchedFiles, reloadCallback) {
  if (fileWatcher) {
    try {
      fileWatcher.close();
    } catch (e) {}
  }

  const watchedPaths = new Set();
  watchedFiles.forEach(f => {
    watchedPaths.add(path.resolve(f));
  });

  const onFileChange = (eventType, filename) => {
    if (!filename) return;

    const fullPath = path.resolve(filename);
    if (!watchedPaths.has(fullPath)) return;

    if (reloadTimer) clearTimeout(reloadTimer);
    pendingReload = true;

    reloadTimer = setTimeout(async () => {
      if (pendingReload) {
        pendingReload = false;
        try {
          await reloadCallback();
        } catch (error) {
          recordReload(error);
        }
      }
    }, WATCH_DEBOUNCE);
  };

  try {
    watchedFiles.forEach(filePath => {
      const dir = path.dirname(path.resolve(filePath));
      const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
        if (filename && filename === path.basename(path.resolve(filePath))) {
          onFileChange(eventType, path.resolve(filePath));
        }
      });
      if (!fileWatcher) fileWatcher = watcher;
    });
  } catch (error) {
    recordReload(error);
  }

  return () => {
    if (fileWatcher) {
      try {
        fileWatcher.close();
      } catch (e) {}
      fileWatcher = null;
    }
    if (reloadTimer) clearTimeout(reloadTimer);
  };
}

module.exports = {
  drain,
  swap,
  reloadModules,
  clearRequireCache,
  startFileWatcher,
  DRAIN_TIMEOUT,
  WATCH_DEBOUNCE
};
