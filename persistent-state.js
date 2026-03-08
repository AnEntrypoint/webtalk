const { createConfig } = require('./config');

function createSemaphore(concurrency, maxQueue) {
  const sem = { active: 0, queue: [] };
  return {
    acquire() {
      return new Promise((resolve, reject) => {
        if (sem.active < concurrency) { sem.active++; resolve(); }
        else if (sem.queue.length < maxQueue) sem.queue.push({ resolve, reject });
        else reject(Object.assign(new Error('overloaded'), { overloaded: true }));
      });
    },
    release() {
      if (sem.queue.length > 0) sem.queue.shift().resolve();
      else sem.active--;
    },
    get active() { return sem.active; },
    get queued() { return sem.queue.length; },
  };
}

const state = {
  config: null,
  handlers: { current: null },
  requests: { inFlight: 0, draining: false },
  reload: { count: 0, lastTime: 0, lastError: null },
  debug: { reloadEvents: [], drainEvents: [] },
  semaphores: { tts: null, stt: null },
};

function initState(options = {}) {
  if (!state.config) {
    state.config = createConfig(options);
  }
  if (!state.semaphores.tts) {
    state.semaphores.tts = createSemaphore(state.config.ttsConcurrency, state.config.ttsQueueMax);
  }
  if (!state.semaphores.stt) {
    state.semaphores.stt = createSemaphore(state.config.sttConcurrency, state.config.sttQueueMax);
  }
  return state;
}

function trackRequest() { state.requests.inFlight++; }
function untrackRequest() { state.requests.inFlight--; }
function getInFlightCount() { return state.requests.inFlight; }

function setCurrentHandlers(handlers) { state.handlers.current = handlers; }
function getCurrentHandlers() { return state.handlers.current; }

function setDraining(draining) { state.requests.draining = draining; }

function recordReload(error = null) {
  state.reload.count++;
  state.reload.lastTime = Date.now();
  if (error) state.reload.lastError = error.message;
  state.debug.reloadEvents.push({
    count: state.reload.count,
    time: state.reload.lastTime,
    error: error ? error.message : null
  });
  if (state.debug.reloadEvents.length > 100) state.debug.reloadEvents.shift();
}

function recordDrain() {
  state.debug.drainEvents.push({ time: Date.now(), inFlight: state.requests.inFlight });
  if (state.debug.drainEvents.length > 100) state.debug.drainEvents.shift();
}

function getDebugState() {
  return {
    reloadCount: state.reload.count,
    inFlightRequests: state.requests.inFlight,
    isDraining: state.requests.draining,
    lastReloadTime: state.reload.lastTime,
    lastReloadError: state.reload.lastError,
    recentEvents: {
      reloads: state.debug.reloadEvents.slice(-5),
      drains: state.debug.drainEvents.slice(-5)
    }
  };
}

function getSemaphores() { return state.semaphores; }

module.exports = {
  initState, trackRequest, untrackRequest, getInFlightCount,
  setCurrentHandlers, getCurrentHandlers,
  setDraining, recordReload, recordDrain, getDebugState,
  getSemaphores, createSemaphore,
};
