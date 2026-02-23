const fs = require('fs');
const path = require('path');
const https = require('https');
const { createDownloadLock, resolveDownloadLock, rejectDownloadLock, getDownloadPromise, isDownloading } = require('./download-lock');
const { ensureDir, isFileCorrupted, downloadFile } = require('./whisper-models');

const TTS_FILES = [
  { name: 'mimi_encoder.onnx', minBytes: 73 * 1024 * 1024 * 0.8 },
  { name: 'text_conditioner.onnx', minBytes: 16 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_main_int8.onnx', minBytes: 76 * 1024 * 1024 * 0.8 },
  { name: 'flow_lm_flow_int8.onnx', minBytes: 10 * 1024 * 1024 * 0.8 },
  { name: 'mimi_decoder_int8.onnx', minBytes: 23 * 1024 * 1024 * 0.8 },
  { name: 'tokenizer.model', minBytes: 59 * 1024 * 0.8 }
];

const HF_TTS_BASE = 'https://huggingface.co/datasets/AnEntrypoint/sttttsmodels/resolve/main/tts/';

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

async function downloadTTSModels(config, onProgress) {
  ensureDir(config.ttsModelsDir);

  const totalFiles = TTS_FILES.length;
  let completedFiles = 0;
  let totalBytes = 0;
  let downloadedBytes = 0;

  // Calculate total bytes
  for (const file of TTS_FILES) {
    totalBytes += file.minBytes / 0.8; // Reverse the 0.8 multiplier to get actual size
  }

  for (const file of TTS_FILES) {
    const destPath = path.join(config.ttsModelsDir, file.name);
    if (fs.existsSync(destPath)) {
      if (isFileCorrupted(destPath, file.minBytes)) {
        fs.unlinkSync(destPath);
      } else {
        completedFiles++;
        downloadedBytes += file.minBytes / 0.8;
        if (onProgress) {
          onProgress({
            type: 'tts',
            file: file.name,
            completedFiles,
            totalFiles,
            bytesDownloaded: downloadedBytes,
            totalBytes,
            status: 'skipped'
          });
        }
        continue;
      }
    }

    ensureDir(path.dirname(destPath));
    const url = HF_TTS_BASE + file.name;
    console.log(`[TTS] Downloading ${file.name}...`);
    
    if (onProgress) {
      onProgress({
        type: 'tts',
        file: file.name,
        completedFiles,
        totalFiles,
        bytesDownloaded: downloadedBytes,
        totalBytes,
        status: 'downloading'
      });
    }

    try {
      await downloadFile(url, destPath, 3);
      completedFiles++;
      downloadedBytes += file.minBytes / 0.8;
      console.log(`[TTS] Downloaded ${file.name}`);
      
      if (onProgress) {
        onProgress({
          type: 'tts',
          file: file.name,
          completedFiles,
          totalFiles,
          bytesDownloaded: downloadedBytes,
          totalBytes,
          status: 'completed'
        });
      }
    } catch (err) {
      console.warn(`[TTS] Failed to download ${file.name}:`, err.message);
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      
      if (onProgress) {
        onProgress({
          type: 'tts',
          file: file.name,
          completedFiles,
          totalFiles,
          bytesDownloaded: downloadedBytes,
          totalBytes,
          status: 'error',
          error: err.message
        });
      }
    }
  }
}

async function ensureTTSModels(config, onProgress) {
  const lockKey = 'tts-models';
  if (isDownloading(lockKey)) return getDownloadPromise(lockKey);

  const downloadPromise = (async () => {
    try {
      const exists = await checkTTSModelExists(config);
      if (!exists) await downloadTTSModels(config, onProgress);
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
