# Webtalk - Buildless STT + TTS SDK

A lightweight, buildless SDK combining Whisper WebGPU (Speech-to-Text) and Pocket TTS ONNX (Text-to-Speech) for Express and WebJSX projects. Use real-time speech recognition and text synthesis directly in the browser with zero build steps.

## Features

- **Speech-to-Text (STT)**: Real-time speech recognition powered by Whisper WebGPU
- **Text-to-Speech (TTS)**: Natural voice synthesis using Pocket TTS ONNX
- **Buildless**: Ship source code directly—no build steps required
- **Express Middleware**: Mount as middleware with automatic model management
- **Browser ESM**: Native ES modules for modern browsers
- **Hot Reload Ready**: State management supports zero-downtime updates
- **Cross-Origin Safe**: COEP/COOP headers configured automatically
- **Self-Healing**: Automatic model recovery on failure
- **No Dependencies**: Pure JavaScript implementation

## Installation

Install via npm:

```bash
npm install webtalk
```

Or clone for development:

```bash
git clone https://github.com/yourusername/realtime-whisper-webgpu.git
cd realtime-whisper-webgpu
npm install
npm start
```

## Quick Start (5 minutes)

### 1. Express Server Setup

```javascript
const express = require('express');
const { webtalk } = require('webtalk');

const app = express();

const webtalkInstance = webtalk(app, { port: 8080 });

await webtalkInstance.init();

app.listen(8080, () => {
  console.log('Server running at http://localhost:8080');
});
```

### 2. Browser Usage

```html
<!DOCTYPE html>
<html>
<body>
  <button id="record">Record</button>
  <button id="stop">Stop</button>
  <button id="speak">Speak</button>
  <div id="transcript"></div>
  <audio id="player"></audio>

  <script type="module">
    import { STT, TTS } from '/webtalk/sdk.js';

    const stt = new STT({
      basePath: '/webtalk',
      language: 'en',
      onTranscript: (text) => {
        document.getElementById('transcript').textContent = text;
      }
    });

    const tts = new TTS({
      basePath: '/webtalk',
      onAudioReady: (audioUrl) => {
        const audio = document.getElementById('player');
        audio.src = audioUrl;
      }
    });

    await Promise.all([stt.init(), tts.init()]);

    document.getElementById('record').onclick = () => stt.startRecording();
    document.getElementById('stop').onclick = async () => {
      const transcript = await stt.stopRecording();
      console.log('Transcribed:', transcript);
    };

    document.getElementById('speak').onclick = async () => {
      const text = document.getElementById('transcript').textContent;
      if (text) {
        await tts.generate(text);
        document.getElementById('player').play();
      }
    };
  </script>
</body>
</html>
```

## Configuration Reference

### Environment Variables

Set any of these to customize behavior:

```bash
PORT=8080                    # Server port
MODELS_DIR=./models          # Whisper model cache directory
TTS_MODELS_DIR=./models/tts  # TTS model cache directory
WHISPER_MODEL=onnx-community/whisper-base  # Model ID
WHISPER_BASE_URL=https://huggingface.co/   # Model download base
TTS_BASE_URL=https://huggingface.co/...    # TTS download base
MOUNT_PATH=/webtalk          # Middleware mount path
API_BASE_PATH=''             # API base path for browser requests
```

### Options Object

Pass options to middleware:

```javascript
webtalk(app, {
  port: 3000,
  modelsDir: './cache/models',
  ttsModelsDir: './cache/tts',
  defaultWhisperModel: 'onnx-community/whisper-small',
  mountPath: '/speech',
  apiBasePath: 'https://api.example.com'
});
```

## Entry Points

| Export | File | Description |
|--------|------|-------------|
| `webtalk` function | `middleware.js` | Express/HTTP middleware for serving SDK and models |
| `STT` class | `sdk.js` | Browser speech-to-text recognition |
| `TTS` class | `sdk.js` | Browser text-to-speech synthesis |
| `createConfig` function | `config.js` | Create configuration with environment variables |
| `createApp` function | `server.js` | Create minimal HTTP app (optional, for standalone use) |

## Configuration

### Environment Variables

```bash
PORT=8080                    # Server port (default: 8080)
MODELS_DIR=./models          # Whisper models directory
TTS_MODELS_DIR=./models/tts  # TTS models directory
WHISPER_MODEL=onnx-community/whisper-base  # Model to use
WHISPER_BASE_URL=https://huggingface.co/   # Hugging Face base URL
TTS_BASE_URL=...             # TTS model download URL
ONNX_WASM_URL=...            # ONNX runtime WASM URL
MOUNT_PATH=/webtalk          # Middleware mount path
API_BASE_PATH=               # API base path for browser requests
```

### Programmatic Configuration

```javascript
const { createConfig } = require('webtalk/config');

const config = createConfig({
  port: 3000,
  modelsDir: './my-models',
  ttsModelsDir: './my-models/tts',
  defaultWhisperModel: 'onnx-community/whisper-base',
  mountPath: '/speech'
});
```

## Complete API Documentation

### STT Class - Speech-to-Text Recognition

#### Constructor and Options

```javascript
import { STT } from '/webtalk/sdk.js';

const stt = new STT({
  basePath: '/webtalk',              // Path to SDK assets (default: '')
  language: 'en',                     // ISO 639-1 language code (default: 'en')
  workerFile: 'worker-BPxxCWVT.js',  // Worker filename (default: 'worker-BPxxCWVT.js')
  onStatus: (status, message) => {}, // Callback: initialization/status changes
  onPartial: (text) => {},           // Callback: partial transcription during recording
  onTranscript: (text) => {}         // Callback: final transcription when complete
});
```

#### Status Values

The `onStatus` callback receives these status values:

- `'loading'` - Worker and models are loading
- `'ready'` - Ready to start recording
- `'recording'` - Currently recording audio from microphone
- `'transcribing'` - Processing audio to generate transcript
- `'error'` - An error occurred

#### Methods

**`init(): Promise<void>`**

Initialize the STT worker and load models. Must be called before recording.

```javascript
try {
  await stt.init();
  console.log('STT ready');
} catch (err) {
  console.error('Failed to initialize:', err.message);
}
```

**`startRecording(): Promise<void>`**

Start recording audio from the user's microphone. Requires user permission.

```javascript
try {
  await stt.startRecording();
  console.log('Recording...');
} catch (err) {
  if (err.name === 'NotAllowedError') {
    console.error('Microphone permission denied');
  }
}
```

**`stopRecording(): Promise<string>`**

Stop recording and return the final transcript.

```javascript
const transcript = await stt.stopRecording();
console.log('You said:', transcript);
```

**`transcribeBlob(blob): Promise<string>`**

Transcribe an audio blob directly (instead of using microphone).

```javascript
const audioFile = document.getElementById('audioInput').files[0];
const transcript = await stt.transcribeBlob(audioFile);
console.log('Transcribed:', transcript);
```

**`getStatus(): Object`**

Get current STT status without callbacks.

```javascript
const status = stt.getStatus();
console.log(status);
// { ready: true, recording: false, language: 'en', hasWorker: true }
```

**`destroy(): void`**

Clean up resources and terminate worker.

```javascript
stt.destroy();
// Worker terminated, resources freed
```

#### Full Example

```javascript
import { STT } from '/webtalk/sdk.js';

const stt = new STT({
  basePath: '/webtalk',
  language: 'en',
  onStatus: (status, msg) => {
    console.log(`[${status}] ${msg || ''}`);
    document.getElementById('status').textContent = status;
  },
  onPartial: (text) => {
    document.getElementById('partial').textContent = text;
  },
  onTranscript: (text) => {
    document.getElementById('transcript').textContent = text;
  }
});

// Initialize
try {
  await stt.init();
} catch (err) {
  console.error('Initialization failed:', err);
  process.exit(1);
}

// Record when button clicked
document.getElementById('recordBtn').onclick = async () => {
  try {
    await stt.startRecording();
    document.getElementById('recordBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
  } catch (err) {
    console.error('Recording failed:', err);
  }
};

document.getElementById('stopBtn').onclick = async () => {
  const transcript = await stt.stopRecording();
  console.log('Final transcript:', transcript);
  document.getElementById('recordBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
};

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stt.destroy();
});
```

### TTS Class - Text-to-Speech Synthesis

#### Constructor and Options

```javascript
import { TTS } from '/webtalk/sdk.js';

const tts = new TTS({
  basePath: '/webtalk',              // Path to SDK assets (default: '')
  apiBasePath: '',                    // API base path for TTS status (default: '')
  voice: 'alloy',                     // Default voice name (default: null)
  ttsWorkerFile: 'inference-worker.js', // Worker filename (default: 'inference-worker.js')
  onStatus: (status, message) => {},  // Callback: status changes
  onVoicesLoaded: (voices, defaultVoice) => {}, // Callback: available voices loaded
  onAudioReady: (audioUrl) => {},     // Callback: audio blob URL ready
  onAudioChunk: () => {},             // Callback: new audio chunk generated
  onMetrics: (metrics) => {}          // Callback: performance metrics (ttfb, rtfx)
});
```

#### Status Values

- `'loading'` - Models loading
- `'ready'` - Ready for synthesis
- `'speaking'` - Currently generating audio
- `'error'` - Error occurred

#### Methods

**`init(): Promise<void>`**

Initialize the TTS worker and load models.

```javascript
try {
  await tts.init();
  console.log('TTS ready');
} catch (err) {
  console.error('TTS initialization failed:', err);
}
```

**`generate(text, voice?): Promise<string>`**

Generate speech audio from text. Returns a blob URL.

```javascript
const audioUrl = await tts.generate('Hello, world!', 'alloy');
const audio = new Audio(audioUrl);
audio.play();
```

**`uploadVoice(file): Promise<void>`**

Upload custom voice sample for speaker encoding.

```javascript
const voiceFile = document.getElementById('voiceInput').files[0];
await tts.uploadVoice(voiceFile);
console.log('Voice sample uploaded');
```

**`stop(): void`**

Stop current audio generation.

```javascript
tts.stop();
```

**`downloadAudio(): void`**

Download the current audio as a WAV file.

```javascript
document.getElementById('downloadBtn').onclick = () => {
  tts.downloadAudio(); // Downloads as 'tts-output.wav'
};
```

**`getStatus(): Object`**

Get current TTS status.

```javascript
const status = tts.getStatus();
console.log(status);
// { ready: true, voice: 'alloy', hasWorker: true, audioBuffered: 3 }
```

**`destroy(): void`**

Clean up resources and terminate worker.

```javascript
tts.destroy();
```

#### Full Example

```javascript
import { TTS } from '/webtalk/sdk.js';

const tts = new TTS({
  basePath: '/webtalk',
  onStatus: (status, msg) => {
    console.log(`TTS ${status}: ${msg}`);
    document.getElementById('ttsStatus').textContent = status;
  },
  onVoicesLoaded: (voices, defaultVoice) => {
    console.log('Available voices:', voices);
    const select = document.getElementById('voiceSelect');
    voices.forEach(v => {
      const option = document.createElement('option');
      option.value = v.name;
      option.textContent = v.name;
      if (v.name === defaultVoice) option.selected = true;
      select.appendChild(option);
    });
  },
  onAudioReady: (audioUrl) => {
    const audio = document.getElementById('player');
    audio.src = audioUrl;
    audio.play();
  },
  onMetrics: (metrics) => {
    if (metrics.ttfb) {
      console.log(`Time to first byte: ${metrics.ttfb.toFixed(0)}ms`);
    }
    if (metrics.rtfx) {
      console.log(`Real-time factor: ${metrics.rtfx.toFixed(2)}x`);
    }
  }
});

await tts.init();

document.getElementById('generateBtn').onclick = async () => {
  const text = document.getElementById('textInput').value;
  const voice = document.getElementById('voiceSelect').value;
  if (text) {
    await tts.generate(text, voice);
  }
};

document.getElementById('downloadBtn').onclick = () => {
  tts.downloadAudio();
};

window.addEventListener('beforeunload', () => {
  tts.destroy();
});
```

### Express Middleware Function

#### Mount Middleware

```javascript
const express = require('express');
const { webtalk } = require('webtalk');

const app = express();

// Mount with default configuration
const webtalkInstance = webtalk(app);

// Mount with custom configuration
const webtalkInstance = webtalk(app, {
  port: 3000,
  modelsDir: './cache/models',
  ttsModelsDir: './cache/tts',
  defaultWhisperModel: 'onnx-community/whisper-small',
  mountPath: '/speech',
  apiBasePath: ''
});

// Initialize models
await webtalkInstance.init();

app.listen(3000);
```

#### Routes Registered

The middleware automatically registers these routes:

- `GET /webtalk/sdk.js` - Browser SDK module (ESM)
- `GET /webtalk/demo` - Interactive demo page
- `GET /webtalk/api/tts-status` - TTS model availability status
- `GET /api/tts-status` - Root-level TTS status endpoint
- `GET /assets/*` - WASM files and worker scripts
- `GET /models/*` - Cached Whisper models
- `GET /tts/*` - TTS workers and models

#### Headers Set Automatically

All responses include these cross-origin headers:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: cross-origin
```

These enable SharedArrayBuffer for WebGPU acceleration.

#### Return Value

The middleware returns an object with one method:

- `init(): Promise<void>` - Download and cache models

### createConfig Function

Factory function to create configuration from environment variables and options.

```javascript
const { createConfig } = require('webtalk/config');

const config = createConfig({
  port: 3000,
  modelsDir: './models',
  defaultWhisperModel: 'onnx-community/whisper-base'
});

console.log(config);
// {
//   port: 3000,
//   sdkDir: __dirname,
//   modelsDir: './models',
//   ttsModelsDir: './models/tts',
//   assetsDir: './assets',
//   ttsDir: './tts',
//   defaultWhisperModel: 'onnx-community/whisper-base',
//   whisperBaseUrl: 'https://huggingface.co/',
//   ttsBaseUrl: 'https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/main/onnx/',
//   workerFile: 'worker-BPxxCWVT.js',
//   workerBackup: 'worker-BPxxCWVT-original.js',
//   ttsWorkerFile: 'inference-worker.js',
//   onnxWasmUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort-wasm-simd-threaded.jsep.wasm',
//   mountPath: '/webtalk',
//   apiBasePath: ''
// }
```

## Model Management & Caching

### Automatic Model Downloads

Models are automatically downloaded on first `init()` call:

```javascript
const { init } = webtalk(app);

// First call: Downloads ~150MB Whisper model + ~200MB TTS models
await init();

// Subsequent calls: Uses cached models (fast)
await init(); // ✓ Returns immediately
```

### Features

**Intelligent Caching**
- Models cached in `modelsDir` and `ttsModelsDir`
- Second `init()` skips download (cache hit)
- File integrity validated (detects corruption)

**Concurrent Access Safety**
- Multiple concurrent `init()` calls coordinate safely
- Only one actual download happens (others wait)
- Prevents race conditions and duplicate downloads
- Reduces bandwidth waste on concurrent requests

**Automatic Recovery**
- Network failures: Automatic retry with exponential backoff (1s, 2s, 4s delays)
- Corrupted files: Automatically detected and re-downloaded
- Partial downloads: Detected via file size validation (80% threshold)
- Self-healing: No manual intervention required

**Custom Paths**

```javascript
// Via options parameter
const { init } = webtalk(app, {
  modelsDir: '/var/cache/models',
  ttsModelsDir: '/var/cache/models/tts'
});

// Via environment variables
export MODELS_DIR=/var/cache/models
export TTS_MODELS_DIR=/var/cache/models/tts
```

### Model Directory Structure

```
./models/
├── onnx-community/
│   └── whisper-base/           (STT models ~150MB)
│       ├── config.json
│       ├── tokenizer.json
│       ├── vocab.json
│       ├── merges.txt
│       ├── model_quantized.onnx
│       └── onnx/
│           ├── encoder_model.onnx
│           ├── decoder_model_merged_q4.onnx
│           └── decoder_model_merged.onnx
│
└── tts/                        (TTS models ~200MB)
    ├── mimi_encoder.onnx       (73MB, auto-recovered if <59MB)
    ├── text_conditioner.onnx   (16MB, auto-recovered if <13MB)
    ├── flow_lm_main_int8.onnx  (76MB, auto-recovered if <61MB)
    ├── flow_lm_flow_int8.onnx  (10MB, auto-recovered if <8MB)
    ├── mimi_decoder_int8.onnx  (23MB, auto-recovered if <18MB)
    └── tokenizer.model         (59KB, auto-recovered if <47KB)
```

### Error Handling

Model downloads automatically recover from:
- Transient network failures (HTTP 5xx)
- Network errors (connection timeouts)
- Partial downloads (power loss, interrupted transfer)
- File corruption (detected via size validation)

No error handling code needed in your app:

```javascript
// This just works, even if network fails temporarily
const { init } = webtalk(app);
await init(); // Auto-retries, auto-recovers, self-heals
```

## Import Patterns

### CommonJS (Node.js)

```javascript
// Middleware
const { webtalk } = require('webtalk/middleware');

// Configuration
const { createConfig } = require('webtalk/config');

// Server
const { createApp } = require('webtalk/server');
```

### ESM (Browser & Node.js)

```javascript
// Browser SDK only (client-side)
import { STT, TTS } from 'webtalk/sdk.js';

// Server-side ESM
import { webtalk } from 'webtalk/middleware.js';
import { createConfig } from 'webtalk/config.js';
import { createApp } from 'webtalk/server.js';
```

## Error Handling

All major operations emit errors via callbacks. Catch them and handle gracefully:

```javascript
const stt = new STT({
  onStatus: (status, message) => {
    if (status === 'error') {
      console.error('STT Error:', message);
      // Handle error, retry, or notify user
    }
  }
});

try {
  await stt.init();
  await stt.record();
} catch (err) {
  console.error('Failed to transcribe:', err.message);
}
```

## Model Management

Models are downloaded automatically on first use:

- **Whisper**: Downloaded to `MODELS_DIR/[model-name]/`
- **TTS**: Downloaded to `TTS_MODELS_DIR/`
- **Cache**: Models are cached and reused on subsequent runs
- **Requires**: Disk space for models (~500MB-1GB depending on model size)

## Performance Notes

- **Browser Compatibility**: Requires WebGPU or WebAssembly support
- **Audio Format**: STT accepts 16kHz audio (automatically resampled)
- **TTS Sample Rate**: 24kHz output
- **Threading**: ONNX runtime uses Web Workers for background processing
- **Real-time**: Both STT and TTS support streaming with progress callbacks

## Examples & Patterns

### Example 1: Express App with STT + TTS

Complete server and client setup:

**server.js:**

```javascript
const express = require('express');
const { webtalk } = require('webtalk');

const app = express();

// Mount webtalk middleware
const webtalkInstance = webtalk(app, {
  port: 8080,
  modelsDir: './models',
  ttsModelsDir: './models/tts'
});

// Initialize models
webtalkInstance.init().then(() => {
  console.log('Models loaded');
}).catch(err => {
  console.error('Model initialization failed:', err);
  process.exit(1);
});

// Serve demo page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.listen(8080, () => {
  console.log('Server running on http://localhost:8080');
});
```

**index.html:**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Webtalk Demo</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 50px auto; }
    button { padding: 10px 20px; margin: 5px; }
    #status { padding: 10px; background: #f0f0f0; }
    #transcript { padding: 10px; margin-top: 20px; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>Webtalk Demo</h1>

  <div id="status">Status: loading...</div>

  <div>
    <button id="recordBtn">Record</button>
    <button id="stopBtn" disabled>Stop</button>
  </div>

  <div id="transcript" style="display: none;">
    <h3>Transcript:</h3>
    <p id="text"></p>
  </div>

  <div>
    <input id="textInput" type="text" placeholder="Enter text for TTS" style="width: 100%; padding: 8px;">
    <button id="speakBtn">Speak</button>
    <button id="downloadBtn">Download</button>
  </div>

  <audio id="player" controls style="width: 100%; margin-top: 20px;"></audio>

  <script type="module">
    import { STT, TTS } from '/webtalk/sdk.js';

    const stt = new STT({
      basePath: '/webtalk',
      language: 'en',
      onStatus: (status) => {
        document.getElementById('status').textContent = `Status: ${status}`;
      },
      onTranscript: (text) => {
        document.getElementById('transcript').style.display = 'block';
        document.getElementById('text').textContent = text;
      }
    });

    const tts = new TTS({
      basePath: '/webtalk',
      onAudioReady: (audioUrl) => {
        document.getElementById('player').src = audioUrl;
      }
    });

    await Promise.all([stt.init(), tts.init()]);

    document.getElementById('recordBtn').onclick = () => {
      stt.startRecording();
      document.getElementById('recordBtn').disabled = true;
      document.getElementById('stopBtn').disabled = false;
    };

    document.getElementById('stopBtn').onclick = async () => {
      const transcript = await stt.stopRecording();
      document.getElementById('recordBtn').disabled = false;
      document.getElementById('stopBtn').disabled = true;
      console.log('Transcript:', transcript);
    };

    document.getElementById('speakBtn').onclick = async () => {
      const text = document.getElementById('textInput').value;
      if (text) {
        await tts.generate(text);
        document.getElementById('player').play();
      }
    };

    document.getElementById('downloadBtn').onclick = () => {
      tts.downloadAudio();
    };
  </script>
</body>
</html>
```

### Example 2: Error Handling and Recovery

```javascript
import { STT, TTS } from '/webtalk/sdk.js';

const stt = new STT({
  basePath: '/webtalk',
  onStatus: (status, msg) => {
    if (status === 'error') {
      console.error('STT Error:', msg);
      // Implement recovery: retry, show user message, etc.
      showUserMessage('Speech recognition failed. Please try again.');

      // Optionally reinitialize
      setTimeout(() => {
        stt.init().then(() => {
          showUserMessage('Speech recognition restarted. Ready to record.');
        });
      }, 2000);
    }
  }
});

const tts = new TTS({
  basePath: '/webtalk',
  onStatus: (status, msg) => {
    if (status === 'error') {
      console.error('TTS Error:', msg);
      showUserMessage('Text-to-speech failed. Please try again.');
    }
  }
});

async function initializeWithRetry(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await Promise.all([stt.init(), tts.init()]);
      return;
    } catch (err) {
      console.error(`Initialization attempt ${i + 1} failed:`, err);
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      } else {
        throw new Error('Failed to initialize after retries');
      }
    }
  }
}

function showUserMessage(msg) {
  const el = document.getElementById('message');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

initializeWithRetry().catch(err => {
  showUserMessage('Failed to initialize speech recognition. Please refresh the page.');
});
```

### Example 3: Custom Configuration

```javascript
// Development with small model
const devConfig = {
  port: 3000,
  defaultWhisperModel: 'onnx-community/whisper-tiny',
  modelsDir: './models-dev'
};

// Production with larger model
const prodConfig = {
  port: 8080,
  defaultWhisperModel: 'onnx-community/whisper-small',
  modelsDir: '/var/cache/models',
  ttsModelsDir: '/var/cache/models/tts'
};

const config = process.env.NODE_ENV === 'production' ? prodConfig : devConfig;

const { webtalk } = require('webtalk');
const app = require('express')();

const webtalkInstance = webtalk(app, config);
await webtalkInstance.init();
```

### Example 4: WebJSX Component

```jsx
// Reusable STT component
export function STTComponent() {
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('loading');
  const sttRef = useRef(null);

  useEffect(() => {
    const stt = new STT({
      basePath: '/webtalk',
      onStatus: setStatus,
      onTranscript: setTranscript
    });

    stt.init().then(() => {
      sttRef.current = stt;
    });

    return () => stt?.destroy();
  }, []);

  return (
    <div>
      <p>Status: {status}</p>
      <button onClick={() => sttRef.current?.startRecording()}>Record</button>
      <button onClick={() => sttRef.current?.stopRecording()}>Stop</button>
      <p>Transcript: {transcript}</p>
    </div>
  );
}

// Reusable TTS component
export function TTSComponent() {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [text, setText] = useState('');
  const ttsRef = useRef(null);

  useEffect(() => {
    const tts = new TTS({
      basePath: '/webtalk',
      onVoicesLoaded: (voiceList) => {
        setVoices(voiceList);
        if (voiceList.length > 0) setSelectedVoice(voiceList[0].name);
      }
    });

    tts.init().then(() => {
      ttsRef.current = tts;
    });

    return () => tts?.destroy();
  }, []);

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter text to speak"
      />
      <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)}>
        {voices.map(v => (
          <option key={v.name} value={v.name}>{v.name}</option>
        ))}
      </select>
      <button onClick={() => ttsRef.current?.generate(text, selectedVoice)}>
        Speak
      </button>
      <button onClick={() => ttsRef.current?.downloadAudio()}>
        Download
      </button>
    </div>
  );
}
```

### Example 5: Metrics and Performance

```javascript
const tts = new TTS({
  basePath: '/webtalk',
  onMetrics: (metrics) => {
    if (metrics.ttfb !== undefined) {
      console.log(`Time to first byte: ${metrics.ttfb.toFixed(0)}ms`);
    }
    if (metrics.rtfx !== undefined) {
      const rtfx = metrics.rtfx.toFixed(2);
      const speedup = rtfx > 1 ? `${rtfx}x realtime` : `${(1/rtfx).toFixed(2)}x slower`;
      console.log(`Synthesis speed: ${speedup}`);
    }
  }
});

await tts.init();
const startTime = performance.now();
const audioUrl = await tts.generate('Hello, world!');
const duration = performance.now() - startTime;
console.log(`Total synthesis time: ${duration.toFixed(0)}ms`);
```

## Troubleshooting

### Microphone Permission Denied

**Issue**: `NotAllowedError` when calling `startRecording()`

**Solutions**:
- Ensure your app is served over HTTPS (or localhost for testing)
- Check browser settings for microphone permissions
- Clear browser cache and try again
- Verify not running in an iframe with restrictive permissions

```javascript
stt.startRecording().catch(err => {
  if (err.name === 'NotAllowedError') {
    console.error('Microphone permission denied');
    // Show user instructions to enable microphone
  }
});
```

### Models Not Downloading

**Issue**: Models fail to download or initialization hangs

**Solutions**:
- Check internet connectivity
- Verify `MODELS_DIR` and `TTS_MODELS_DIR` are writable
- Check available disk space (need ~700MB)
- Verify HuggingFace URLs are not blocked

```bash
mkdir -p ./models ./models/tts
chmod 755 ./models ./models/tts
df -h ./models  # Check disk space
```

### Worker File Not Found

**Issue**: Browser console shows 404 for worker files

**Solutions**:
- Verify worker files exist: `ls assets/worker-*.js tts/inference-worker.js`
- Ensure `basePath` is correctly set to SDK mount path
- Check mount path configuration matches middleware

```javascript
const stt = new STT({
  basePath: '/webtalk',  // Must match middleware mount path
  workerFile: 'worker-BPxxCWVT.js'
});
```

### Cross-Origin Errors

**Issue**: Errors about cross-origin requests or SharedArrayBuffer

**Solutions**:
- Middleware automatically sets required headers
- Ensure middleware is mounted early in Express app
- Check that headers are being sent (browser DevTools)

```javascript
const { webtalk } = require('webtalk');
const app = require('express')();

// Mount FIRST
const webtalkInstance = webtalk(app);

// Other routes AFTER
app.get('/api/other', handler);
```

### Browser Compatibility

**Issue**: Features not working in specific browser

**Supported**: Chrome 91+, Firefox 79+, Safari 14.1+, Edge 91+

Verify support:

```javascript
const hasWebWorker = typeof Worker !== 'undefined';
const hasWebGPU = typeof navigator.gpu !== 'undefined';
const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

if (!hasWebWorker || !hasMediaRecorder) {
  console.warn('Your browser may not support all features');
}
```

### Performance Issues

**Issue**: Slow transcription or synthesis

**Solutions**:
- Use smaller models in development (whisper-tiny)
- For production, use whisper-small or whisper-medium
- Check CPU usage and available RAM
- Close other applications
- Use faster network for initial model download

```javascript
// Development (fast, lower accuracy)
const stt = new STT({
  basePath: '/webtalk',
  // Uses whisper-tiny by default
});

// Production (slower, higher accuracy)
const webtalkInstance = webtalk(app, {
  defaultWhisperModel: 'onnx-community/whisper-small'
});
```

### Memory Usage

**Issue**: High memory consumption

**Solutions**:
- Memory is normal (~500MB Whisper, ~200MB TTS)
- Call `destroy()` when done to free resources
- Close unused instances
- Reload page if memory grows over time (memory leak)

```javascript
window.addEventListener('beforeunload', () => {
  stt.destroy();
  tts.destroy();
});
```

## Performance Benchmarks

Typical performance on modern hardware:

| Operation | Speed | Notes |
|-----------|-------|-------|
| Model initialization | 30-120s | Only on first run, then cached |
| STT recording (1 min audio) | 1-5x realtime | Depends on model size and CPU |
| TTS synthesis (10 words) | 0.5-2s | Depends on voice and text length |
| Partial STT results | <100ms | Latency for interim transcription |
| First audio chunk (TTS) | 100-500ms | TTFB metric |

## Browser Support

| Browser | Version | Support | Notes |
|---------|---------|---------|-------|
| Chrome | 91+ | Full | WebGPU, Web Workers |
| Firefox | 79+ | Full | WebGPU, Web Workers |
| Safari | 14.1+ | Full | Web Workers |
| Edge | 91+ | Full | WebGPU, Web Workers |

## License

MIT

## Support & Contributing

For issues, questions, or contributions:
- GitHub Issues: Report bugs and request features
- GitHub Discussions: Ask questions and share ideas
- Pull Requests: Contributions welcome (maintain buildless philosophy)
