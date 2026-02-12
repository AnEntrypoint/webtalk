const fs = require('fs');
const path = require('path');

function createDebugAPI(state) {
  return {
    getState() {
      return {
        config: {
          port: state.config.port,
          modelsDir: state.config.modelsDir,
          ttsModelsDir: state.config.ttsModelsDir,
          assetsDir: state.config.assetsDir,
          defaultWhisperModel: state.config.defaultWhisperModel,
          mountPath: state.config.mountPath
        },
        requests: {
          inFlight: state.requests.inFlight,
          draining: state.requests.draining
        },
        handlers: {
          hasHandlers: !!state.handlers.current,
          swapping: state.handlers.swapping
        },
        reload: {
          count: state.reload.count,
          lastTime: state.reload.lastTime,
          lastError: state.reload.lastError
        }
      };
    },

    getDebugInfo() {
      const modelsExist = fs.existsSync(state.config.modelsDir);
      const ttsModelsExist = fs.existsSync(state.config.ttsModelsDir);

      let modelFiles = [];
      if (modelsExist) {
        try {
          modelFiles = fs.readdirSync(state.config.modelsDir).filter(f => !f.startsWith('.'));
        } catch (e) {}
      }

      let ttsModelFiles = [];
      if (ttsModelsExist) {
        try {
          ttsModelFiles = fs.readdirSync(state.config.ttsModelsDir).filter(f => !f.startsWith('.'));
        } catch (e) {}
      }

      return {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd(),
        models: {
          whipserDir: state.config.modelsDir,
          ttsDir: state.config.ttsModelsDir,
          whisperFiles: modelFiles.length,
          ttsFiles: ttsModelFiles.length
        }
      };
    },

    getInFlightRequests() {
      return state.requests.inFlight;
    },

    reloadModules() {
      return {
        success: true,
        message: 'Reload triggered (file watcher will handle it)',
        note: 'Files must change for reload to trigger'
      };
    },

    clearCache() {
      try {
        const modelsDir = state.config.modelsDir;
        const ttsDir = state.config.ttsModelsDir;

        if (fs.existsSync(modelsDir)) {
          const files = fs.readdirSync(modelsDir);
          for (const file of files) {
            if (!file.startsWith('.')) {
              const filePath = path.join(modelsDir, file);
              const stat = fs.statSync(filePath);
              if (stat.isFile()) {
                fs.unlinkSync(filePath);
              } else if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
              }
            }
          }
        }

        if (fs.existsSync(ttsDir)) {
          const files = fs.readdirSync(ttsDir);
          for (const file of files) {
            if (!file.startsWith('.')) {
              const filePath = path.join(ttsDir, file);
              const stat = fs.statSync(filePath);
              if (stat.isFile()) {
                fs.unlinkSync(filePath);
              } else if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
              }
            }
          }
        }

        return { success: true, message: 'Cache cleared' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    getRecentEvents() {
      return {
        reloads: state.debug.reloadEvents.slice(-5),
        drains: state.debug.drainEvents.slice(-5),
        swaps: state.debug.swapEvents.slice(-5)
      };
    }
  };
}

module.exports = { createDebugAPI };
