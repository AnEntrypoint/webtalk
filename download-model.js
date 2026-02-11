const https = require('https');
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, 'models');
const DEFAULT_MODEL = 'onnx-community/whisper-base';

// Required files for a Whisper model - including onnx/ subdirectory files
const REQUIRED_FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'model_quantized.onnx',  // fallback
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_q4.onnx',
  'onnx/decoder_model_merged.onnx'
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function checkModelExists(modelName) {
  const modelDir = path.join(MODELS_DIR, modelName);
  if (!fs.existsSync(modelDir)) return false;
  
  // Check for the main model files in onnx/ subdirectory
  const encoderPath = path.join(modelDir, 'onnx', 'encoder_model.onnx');
  const decoderPath = path.join(modelDir, 'onnx', 'decoder_model_merged_q4.onnx');
  const decoderFallback = path.join(modelDir, 'onnx', 'decoder_model_merged.onnx');
  
  const hasEncoder = fs.existsSync(encoderPath);
  const hasDecoder = fs.existsSync(decoderPath) || fs.existsSync(decoderFallback);
  
  return hasEncoder && hasDecoder;
}

async function downloadModel(modelName = DEFAULT_MODEL) {
  const modelDir = path.join(MODELS_DIR, modelName);
  ensureDir(modelDir);
  
  console.log(`Downloading model: ${modelName}`);
  console.log(`This will download ~150MB of model files to ${modelDir}`);
  
  const baseUrl = `https://huggingface.co/${modelName}/resolve/main/`;
  
  let downloadedCount = 0;
  let failedCount = 0;
  
  for (const file of REQUIRED_FILES) {
    const destPath = path.join(modelDir, file);
    
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  ✓ ${file} (${sizeMB}MB)`);
      continue;
    }
    
    const url = baseUrl + file;
    process.stdout.write(`  ↓ ${file} ... `);
    
    try {
      await downloadFile(url, destPath);
      const stats = fs.statSync(destPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`done (${sizeMB}MB)`);
      downloadedCount++;
    } catch (err) {
      console.log(`not found`);
      failedCount++;
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }
  }
  
  console.log(`\nDownload complete: ${downloadedCount} files downloaded, ${failedCount} optional files skipped`);
  console.log(`Model ready: ${modelName}`);
}

async function ensureModel(modelName = DEFAULT_MODEL) {
  const exists = await checkModelExists(modelName);
  if (!exists) {
    console.log(`Model not found locally, downloading...`);
    await downloadModel(modelName);
  } else {
    console.log(`Model cached: ${modelName}`);
  }
}

module.exports = {
  ensureModel,
  downloadModel,
  checkModelExists,
  MODELS_DIR,
  DEFAULT_MODEL
};

if (require.main === module) {
  const model = process.argv[2] || DEFAULT_MODEL;
  ensureModel(model).catch(err => {
    console.error('Failed:', err);
    process.exit(1);
  });
}
