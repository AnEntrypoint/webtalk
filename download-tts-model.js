const https = require('https');
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, 'models');
const TTS_MODEL_DIR = path.join(MODELS_DIR, 'tts');

// Pocket TTS ONNX model files
const TTS_FILES = [
  { name: 'mimi_encoder.onnx', size: '23MB' },
  { name: 'text_conditioner.onnx', size: '23MB' },
  { name: 'flow_lm_main_int8.onnx', size: '45MB' },
  { name: 'flow_lm_flow_int8.onnx', size: '23MB' },
  { name: 'mimi_decoder_int8.onnx', size: '23MB' },
  { name: 'tokenizer.model', size: '59KB' },
  { name: 'voices.bin', size: '1.5MB' }
];

const TTS_WEB_FILES = [
  { name: 'sentencepiece.js', url: 'https://huggingface.co/spaces/KevinAHM/pocket-tts-web/resolve/main/sentencepiece.js', size: '4MB' }
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301 || response.statusCode === 307 || response.statusCode === 308) {
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
      
      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        process.stdout.write(`\r  ↓ ${path.basename(dest)} ... ${(downloaded / 1024 / 1024).toFixed(2)}MB`);
      });
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(' ✓');
        resolve();
      });
    }).on('error', (err) => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function checkModelExists() {
  if (!fs.existsSync(TTS_MODEL_DIR)) return false;
  
  // Check if main model files exist
  const mainFiles = ['mimi_encoder.onnx', 'flow_lm_main_int8.onnx', 'mimi_decoder_int8.onnx'];
  for (const file of mainFiles) {
    if (!fs.existsSync(path.join(TTS_MODEL_DIR, file))) {
      return false;
    }
  }
  return true;
}

async function downloadTTSModels() {
  ensureDir(TTS_MODEL_DIR);
  
  console.log(`Downloading Pocket TTS models...`);
  console.log(`Destination: ${TTS_MODEL_DIR}`);
  console.log('');
  
  const baseUrl = 'https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/main/';
  
  let downloadedCount = 0;
  
  for (const file of TTS_FILES) {
    const destPath = path.join(TTS_MODEL_DIR, file.name);
    
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  ✓ ${file.name} (${sizeMB}MB) - exists`);
      continue;
    }
    
    const url = baseUrl + file.name;
    
    try {
      await downloadFile(url, destPath);
      downloadedCount++;
    } catch (err) {
      console.log(`\n  ✗ ${file.name} failed: ${err.message}`);
    }
  }
  
  console.log(`\nDownload complete: ${downloadedCount} files downloaded`);
  console.log(`TTS models ready in: ${TTS_MODEL_DIR}`);
}

async function downloadTTSWebFiles() {
  const ttsDir = path.join(__dirname, 'tts');
  ensureDir(ttsDir);
  
  console.log('\nDownloading TTS web files...');
  
  for (const file of TTS_WEB_FILES) {
    const destPath = path.join(ttsDir, file.name);
    
    if (fs.existsSync(destPath)) {
      const stats = fs.statSync(destPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  ✓ ${file.name} (${sizeMB}MB) - exists`);
      continue;
    }
    
    try {
      await downloadFile(file.url, destPath);
    } catch (err) {
      console.log(`\n  ✗ ${file.name} failed: ${err.message}`);
    }
  }
}

async function ensureTTSModels() {
  const exists = await checkModelExists();
  if (!exists) {
    console.log('Pocket TTS models not found locally, downloading...');
    await downloadTTSModels();
  } else {
    console.log('Pocket TTS models cached');
  }
  
  // Always ensure web files exist
  await downloadTTSWebFiles();
}

module.exports = {
  ensureTTSModels,
  downloadTTSModels,
  checkModelExists,
  TTS_MODEL_DIR
};

if (require.main === module) {
  ensureTTSModels().catch(err => {
    console.error('Failed:', err);
    process.exit(1);
  });
}
