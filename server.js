const http = require('http');
const fs = require('fs');
const path = require('path');
const { webtalk } = require('./middleware');
const { initState, trackRequest, untrackRequest, getCurrentHandlers, setCurrentHandlers, getDebugState } = require('./persistent-state');
const { startFileWatcher, drain, clearRequireCache } = require('./hot-reload');
const { createDebugAPI } = require('./debug');

const state = initState();
const config = state.config;
const debugAPI = createDebugAPI(state);

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
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    };

    const url = require('url');
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

async function reloadMiddleware() {
  try {
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
  } catch (error) {
    throw error;
  }
}

async function startServer() {
  try {
    await init();
    app.get('/api/debug', (req, res) => {
      res.json({
        ...getDebugState(),
        api: debugAPI.getDebugInfo()
      });
    });
    server.listen(config.port, '0.0.0.0', () => {
    });

    const stopWatcher = startFileWatcher(
      ['./middleware.js', './config.js'],
      reloadMiddleware
    );
  } catch (err) {
    process.exit(1);
  }
}

startServer();

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
