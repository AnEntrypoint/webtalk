const fs = require('fs');
const path = require('path');
const { createDownloadLock, resolveDownloadLock, rejectDownloadLock, getDownloadPromise, isDownloading } = require('./download-lock');
const { ensureDir, isFileCorrupted } = require('./whisper-models');
const { downloadWithProgress } = require('./download-manager');

const TTS_FILES = [
  { name: 'mimi_encoder.onnx', minBytes: 73 * 1024 * 1024 * 0.8 },
  { name: 'text_conditioner.onnx', minBytes: 16 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_main_int8.onnx', minBytes: 76 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_flow_int8.onnx', minBytes: 10 * 1024 * 1024 * 0.8 },
  { name: 'mimi_decoder_int8.onnx', minBytes: 23 * 1024 * 1024 * 0.8 },
  { name: 'tokenizer.model', minBytes: 59 * 1024 * 0.8 }
];

async function checkTTSModelExists(config) {
  const dir = config.ttsModelsDir;
  if (!fs.existsSync(dir)) return false;
  for (const file of [
    { name: 'mimi_encoder.onnx', minBytes: 73 * 1024 * 1024 * 0.8 },
    { name: 'flow_lm_main_int8.onnx', minBytes: 76 * 1024 * 1024 * 0.8 },
    { name: 'mimi_decoder_int8.onnx', minBytes: 23 * 1024 * 1024 * 0.8 }
  ]) {
    const p = path.join(dir, file.name);
    if (!fs.existsSync(p) || isFileCorrupted(p, file.minBytes)) return false;
  }
  return true;
}

async function downloadTTSModels(config) {
  ensureDir(config.ttsModelsDir);

  for (const file of TTS_FILES) {
    const destPath = path.join(config.ttsModelsDir, file.name);
    if (fs.existsSync(destPath)) {
      if (isFileCorrupted(destPath, file.minBytes)) fs.unlinkSync(destPath);
      else continue;
    }
    const primaryUrl = GATEWAYS[0] + cid + '/tts/' + file.name;
    console.log(`[TTS] Downloading ${file.name}...`);
    try {
      await downloadWithProgress(primaryUrl, destPath);
      console.log(`[TTS] Downloaded ${file.name}`);
    } catch (err) {
      console.warn(`[TTS] Failed to download ${file.name}:`, err.message);
    }
  }
}

async function ensureTTSModels(config) {
  const lockKey = 'tts-models';
  if (isDownloading(lockKey)) return getDownloadPromise(lockKey);

  const downloadPromise = (async () => {
    try {
      const exists = await checkTTSModelExists(config);
      if (!exists) await downloadTTSModels(config);
      resolveDownloadLock(lockKey, true);
    } catch (err) {
      rejectDownloadLock(lockKey, err);
      throw err;
    }
  })();

  createDownloadLock(lockKey);
  return downloadPromise;
}

module.exports = { ensureTTSModels, checkTTSModelExists };
