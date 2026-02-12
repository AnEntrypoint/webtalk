const { createConfig } = require('./config');

const state = {
  config: null,
  routes: { GET: {}, USE: [] },
  handlers: {
    current: null,
    pending: null,
    swapping: false
  },
  requests: {
    inFlight: 0,
    draining: false
  },
  reload: {
    count: 0,
    lastTime: 0,
    lastError: null
  },
  debug: {
    reloadEvents: [],
    drainEvents: [],
    swapEvents: []
  }
};

function initState(options = {}) {
  if (!state.config) {
    state.config = createConfig(options);
  }
  return state;
}

function trackRequest() {
  state.requests.inFlight++;
}

function untrackRequest() {
  state.requests.inFlight--;
}

function getInFlightCount() {
  return state.requests.inFlight;
}

function registerRoute(method, path, handler) {
  if (method === 'GET') {
    state.routes.GET[path] = handler;
  } else if (method === 'USE') {
    state.routes.USE.push({ path, handler });
  }
}

function getRoutes() {
  return state.routes;
}

function setCurrentHandlers(handlers) {
  state.handlers.current = handlers;
}

function getCurrentHandlers() {
  return state.handlers.current;
}

function setPendingHandlers(handlers) {
  state.handlers.pending = handlers;
}

function getPendingHandlers() {
  return state.handlers.pending;
}

function setSwapping(swapping) {
  state.handlers.swapping = swapping;
}

function isSwapping() {
  return state.handlers.swapping;
}

function setDraining(draining) {
  state.requests.draining = draining;
}

function isDraining() {
  return state.requests.draining;
}

function recordReload(error = null) {
  state.reload.count++;
  state.reload.lastTime = Date.now();
  if (error) {
    state.reload.lastError = error.message;
  }
  state.debug.reloadEvents.push({
    count: state.reload.count,
    time: state.reload.lastTime,
    error: error ? error.message : null
  });
  if (state.debug.reloadEvents.length > 100) {
    state.debug.reloadEvents.shift();
  }
}

function recordDrain() {
  state.debug.drainEvents.push({
    time: Date.now(),
    inFlight: state.requests.inFlight
  });
  if (state.debug.drainEvents.length > 100) {
    state.debug.drainEvents.shift();
  }
}

function recordSwap() {
  state.debug.swapEvents.push({
    time: Date.now(),
    reloadCount: state.reload.count
  });
  if (state.debug.swapEvents.length > 100) {
    state.debug.swapEvents.shift();
  }
}

function getDebugState() {
  return {
    reloadCount: state.reload.count,
    inFlightRequests: state.requests.inFlight,
    isSwapping: state.handlers.swapping,
    isDraining: state.requests.draining,
    lastReloadTime: state.reload.lastTime,
    lastReloadError: state.reload.lastError,
    recentEvents: {
      reloads: state.debug.reloadEvents.slice(-5),
      drains: state.debug.drainEvents.slice(-5),
      swaps: state.debug.swapEvents.slice(-5)
    }
  };
}

module.exports = {
  state,
  initState,
  trackRequest,
  untrackRequest,
  getInFlightCount,
  registerRoute,
  getRoutes,
  setCurrentHandlers,
  getCurrentHandlers,
  setPendingHandlers,
  getPendingHandlers,
  setSwapping,
  isSwapping,
  setDraining,
  isDraining,
  recordReload,
  recordDrain,
  recordSwap,
  getDebugState
};
