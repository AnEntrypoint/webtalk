const { STT } = require('./stt.js');
const { TTS } = require('./tts.js');

const debug = {
  getSDKVersion() {
    return '1.0.0';
  },
  getLoadedModules() {
    return {
      stt: typeof STT !== 'undefined',
      tts: typeof TTS !== 'undefined'
    };
  },
  getPageInfo() {
    return {
      url: typeof window !== 'undefined' ? window.location.href : 'N/A',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'
    };
  }
};

module.exports = { STT, TTS, debug };
