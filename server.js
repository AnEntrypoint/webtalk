#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { webtalk } = require('./middleware');
const { initState, trackRequest, untrackRequest, getCurrentHandlers, setCurrentHandlers, getDebugState } = require('./persistent-state');
const { startFileWatcher, drain, clearRequireCache } = require('./hot-reload');
const { createDebugAPI } = require('./debug');

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png'
};

const state = initState();
const config = state.config;
const debugAPI = createDebugAPI(state);
let stopWatcher = null;

process.webtalk = debugAPI;

function createApp() {
  function app(req, res) {
    trackRequest();
    const onEnd = () => {
      untrackRequest();
      res.removeListener('finish', onEnd);
      res.removeListener('close', onEnd);
    };
    res.on('finish', onEnd);
    res.on('close', onEnd);

    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    res.status = (code) => { res.statusCode = code; return res; };
    res.sendFile = (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    };

    const parsed = url.parse(req.url);
    req.path = parsed.pathname;

    const handlers = getCurrentHandlers();
    if (!handlers) {
      res.statusCode = 503;
      res.end('Server initializing');
      return;
    }

    let idx = 0;
    const allHandlers = [];

    for (const item of handlers.USE) {
      allHandlers.push({ prefix: item.prefix, handler: item.handler });
    }

    if (req.method === 'GET') {
      for (const [routePath, handler] of Object.entries(handlers.GET)) {
        allHandlers.push({ exactPath: routePath, handler });
      }
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    function next() {
      if (idx >= allHandlers.length) {
        if (req.path === '/' || req.path === '') {
          res.sendFile(path.join(__dirname, 'app.html'));
          return;
        }
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      const h = allHandlers[idx++];
      if (h.exactPath) {
        if (req.path === h.exactPath) {
          h.handler(req, res, next);
        } else {
          next();
        }
      } else if (h.prefix) {
        if (req.path.startsWith(h.prefix)) {
          const originalPath = req.path;
          req.path = req.path.slice(h.prefix.length) || '/';
          req.url = req.path;
          h.handler(req, res, () => {
            req.path = originalPath;
            req.url = originalPath;
            next();
          });
        } else {
          next();
        }
      } else {
        h.handler(req, res, next);
      }
    }

    next();
  }

  app.get = (p, handler) => {
    const handlers = getCurrentHandlers() || { GET: {}, USE: [] };
    handlers.GET[p] = handler;
    setCurrentHandlers(handlers);
  };

  app.use = (prefixOrHandler, handler) => {
    const handlers = getCurrentHandlers() || { GET: {}, USE: [] };
    if (typeof prefixOrHandler === 'function') {
      handlers.USE.push({ prefix: null, handler: prefixOrHandler });
    } else {
      handlers.USE.push({ prefix: prefixOrHandler, handler });
    }
    setCurrentHandlers(handlers);
  };

  return app;
}

const app = createApp();
const { init } = webtalk(app);
const server = http.createServer(app);

server.on('error', (err) => {
  process.stderr.write(err.message + '\n');
  process.exit(1);
});

async function reloadMiddleware() {
  await drain();
  clearRequireCache(['./middleware.js', './config.js']);
  delete require.cache[require.resolve('./middleware.js')];
  delete require.cache[require.resolve('./config.js')];
  const { webtalk: reloadedWebtalk } = require('./middleware.js');
  const newApp = createApp();
  const { init: newInit } = reloadedWebtalk(newApp);
  await newInit();
  newApp.get('/api/debug', (req, res) => {
    res.json(getDebugState());
  });
}

function shutdown() {
  if (stopWatcher) stopWatcher();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

async function startServer() {
  await init();
  app.get('/api/debug', (req, res) => {
    res.json({ ...getDebugState(), api: debugAPI.getDebugInfo() });
  });
  server.listen(config.port, '0.0.0.0');
  stopWatcher = startFileWatcher(
    ['./middleware.js', './config.js'],
    reloadMiddleware
  );
}

startServer().catch((err) => {
  process.stderr.write((err.message || 'Startup failed') + '\n');
  process.exit(1);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
