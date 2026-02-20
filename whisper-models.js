const fs = require('fs');
const path = require('path');
const https = require('https');
const { createDownloadLock, resolveDownloadLock, rejectDownloadLock, getDownloadPromise, isDownloading } = require('./download-lock');

const WHISPER_REQUIRED_FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged.onnx',
  'onnx/decoder_model_merged_q4.onnx',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadFile(url, dest, maxRetries = 3, attempt = 0) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301 || response.statusCode === 307 || response.statusCode === 308) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest, maxRetries, attempt).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        const error = new Error(`Failed to download: ${response.statusCode}`);
        if (attempt < maxRetries - 1) {
          const delayMs = Math.pow(2, attempt) * 1000;
          setTimeout(() => downloadFile(url, dest, maxRetries, attempt + 1).then(resolve).catch(reject), delayMs);
        } else {
          reject(error);
        }
        return;
      }

      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        process.stdout.write(`\r  ↓ ${path.basename(dest)} ... ${(downloaded / 1024 / 1024).toFixed(2)}MB`);
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        process.stdout.write(' ✓\n');
        resolve();
      });
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      if (attempt < maxRetries - 1) {
        const delayMs = Math.pow(2, attempt) * 1000;
        setTimeout(() => downloadFile(url, dest, maxRetries, attempt + 1).then(resolve).catch(reject), delayMs);
      } else {
        reject(err);
      }
    });
  });
}

function isFileCorrupted(filePath, minSizeBytes = null) {
  try {
    const stats = fs.statSync(filePath);
    if (minSizeBytes !== null && stats.size < minSizeBytes) {
      return true;
    }
    return false;
  } catch (err) {
    return true;
  }
}

async function checkWhisperModelExists(modelName, config) {
  const modelDir = path.join(config.modelsDir, modelName);
  if (!fs.existsSync(modelDir)) return false;

  const encoderPath = path.join(modelDir, 'onnx', 'encoder_model.onnx');
  const decoderPath = path.join(modelDir, 'onnx', 'decoder_model_merged_q4.onnx');
  const decoderFallback = path.join(modelDir, 'onnx', 'decoder_model_merged.onnx');

  const hasEncoder = fs.existsSync(encoderPath);
  const hasDecoder = fs.existsSync(decoderPath) || fs.existsSync(decoderFallback);

  if (!hasEncoder || !hasDecoder) return false;

  const encoderValid = !isFileCorrupted(encoderPath, 40 * 1024 * 1024);
  const decoderValid = isFileCorrupted(decoderPath, 100 * 1024 * 1024) === false ||
                       isFileCorrupted(decoderFallback, 100 * 1024 * 1024) === false;

  return encoderValid && decoderValid;
}

async function downloadWhisperModel(modelName, config) {
  const modelDir = path.join(config.modelsDir, modelName);
  ensureDir(modelDir);

  const baseUrl = config.whisperBaseUrl
    ? (config.whisperBaseUrl.includes('huggingface.co')
        ? `${config.whisperBaseUrl}${modelName}/resolve/main/`
        : `${config.whisperBaseUrl}${modelName}/`)
    : null;

  let downloadedCount = 0;
  let failedCount = 0;

  for (const file of WHISPER_REQUIRED_FILES) {
    const destPath = path.join(modelDir, file);

    if (fs.existsSync(destPath)) {
      if (isFileCorrupted(destPath)) {
        fs.unlinkSync(destPath);
      } else {
        continue;
      }
    }

    if (!baseUrl) {
      console.log(`[WHISPER] Local model not found: ${destPath}`);
      failedCount++;
      continue;
    }

    const url = baseUrl + file;

    try {
      await downloadFile(url, destPath, 3);
      downloadedCount++;
    } catch (err) {
      failedCount++;
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }
  }
}

async function ensureModel(modelName, config) {
  const lockKey = `whisper-${modelName}`;

  if (isDownloading(lockKey)) {
    return getDownloadPromise(lockKey);
  }

  const downloadPromise = (async () => {
    try {
      const exists = await checkWhisperModelExists(modelName, config);
      if (!exists) {
        await downloadWhisperModel(modelName, config);
      }
      resolveDownloadLock(lockKey, true);
    } catch (err) {
      rejectDownloadLock(lockKey, err);
      throw err;
    }
  })();

  createDownloadLock(lockKey);
  return downloadPromise;
}

module.exports = { ensureModel, checkWhisperModelExists, downloadFile, ensureDir, isFileCorrupted };
