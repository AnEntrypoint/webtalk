// Pocket-TTS setup wrapper for Windows compatibility
import { setupWindowsPocketTTS } from './server-tts-service.js';

export async function ensureInstalled(onProgress) {
  // This is called when user needs TTS on Windows
  // It sets up the pocket-tts Python environment
  if (process.platform !== 'win32') {
    // On non-Windows, this is a no-op
    if (onProgress) {
      onProgress({
        step: 'detect-platform',
        status: 'success',
        message: 'Not Windows - skipping pocket-tts setup'
      });
    }
    return { installed: true, platform: process.platform };
  }

  try {
    if (onProgress) {
      onProgress({
        step: 'detect-python',
        status: 'in-progress',
        message: 'Checking for Python installation...'
      });
    }

    const result = await setupWindowsPocketTTS(onProgress);
    return result;
  } catch (error) {
    if (onProgress) {
      onProgress({
        step: 'error',
        status: 'error',
        message: 'Failed to setup pocket-tts: ' + error.message
      });
    }
    throw error;
  }
}

export default {
  ensureInstalled
};
