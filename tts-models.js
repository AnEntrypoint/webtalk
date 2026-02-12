const fs = require('fs');
const path = require('path');
const { createDownloadLock, resolveDownloadLock, rejectDownloadLock, getDownloadPromise, isDownloading } = require('./download-lock');
const { downloadFile, ensureDir, isFileCorrupted } = require('./whisper-models');

const TTS_FILES = [
  { name: 'mimi_encoder.onnx', size: '73MB', minBytes: 73 * 1024 * 1024 * 0.8 },
  { name: 'text_conditioner.onnx', size: '16MB', minBytes: 16 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_main_int8.onnx', size: '76MB', minBytes: 76 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_flow_int8.onnx', size: '10MB', minBytes: 10 * 1024 * 1024 * 0.8 },
  { name: 'mimi_decoder_int8.onnx', size: '23MB', minBytes: 23 * 1024 * 1024 * 0.8 },
  { name: 'tokenizer.model', size: '59KB', minBytes: 59 * 1024 * 0.8 }
];

const TTS_WEB_FILES = [
  { name: 'sentencepiece.js', url: 'https://cdn.jsdelivr.net/npm/@facebookresearch/fasttext@1.0.2/dist/fasttext.js', size: '4MB' }
];

async function checkTTSModelExists(config) {
  if (!fs.existsSync(config.ttsModelsDir)) return false;

  const mainFiles = [
    { name: 'mimi_encoder.onnx', minBytes: 73 * 1024 * 1024 * 0.8 },
    { name: 'flow_lm_main_int8.onnx', minBytes: 76 * 1024 * 1024 * 0.8 },
    { name: 'mimi_decoder_int8.onnx', minBytes: 23 * 1024 * 1024 * 0.8 }
  ];

  for (const file of mainFiles) {
    const filePath = path.join(config.ttsModelsDir, file.name);
    if (!fs.existsSync(filePath) || isFileCorrupted(filePath, file.minBytes)) {
      return false;
    }
  }
  return true;
}

async function downloadTTSModels(config) {
  ensureDir(config.ttsModelsDir);

  let downloadedCount = 0;

  for (const file of TTS_FILES) {
    const destPath = path.join(config.ttsModelsDir, file.name);

    if (fs.existsSync(destPath)) {
      if (isFileCorrupted(destPath, file.minBytes)) {
        fs.unlinkSync(destPath);
      } else {
        continue;
      }
    }

    const url = config.ttsBaseUrl + file.name;

    try {
      await downloadFile(url, destPath, 3);
      downloadedCount++;
    } catch (err) {
      // Continue on failure
    }
  }
}

async function downloadTTSWebFiles(config) {
  ensureDir(config.ttsDir);

  for (const file of TTS_WEB_FILES) {
    const destPath = path.join(config.ttsDir, file.name);

    if (fs.existsSync(destPath)) {
      continue;
    }

    try {
      await downloadFile(file.url, destPath);
    } catch (err) {
      // Continue on failure
    }
  }
}

async function ensureTTSModels(config) {
  const lockKey = 'tts-models';

  if (isDownloading(lockKey)) {
    return getDownloadPromise(lockKey);
  }

  const downloadPromise = (async () => {
    try {
      const exists = await checkTTSModelExists(config);
      if (!exists) {
        await downloadTTSModels(config);
      }

      await downloadTTSWebFiles(config);
      resolveDownloadLock(lockKey, true);
    } catch (err) {
      rejectDownloadLock(lockKey, err);
      throw err;
    }
  })();

  createDownloadLock(lockKey);
  return downloadPromise;
}

module.exports = { ensureTTSModels, checkTTSModelExists, downloadTTSModels, downloadTTSWebFiles };
