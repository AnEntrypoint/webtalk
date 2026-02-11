# Webtalk - Real-time Speech Processing

Real-time speech-to-text and text-to-speech in your browser. Unified interface combining Whisper STT with TTS capabilities.

**Features:**
- **✓ Whisper STT** - Speech-to-text recognition (fully operational)
- **◐ Pocket TTS** - Text-to-speech (UI ready, models optional)
- **Recording**: Microphone input and audio file upload
- **Integration**: Bidirectional workflow - transcribe audio then synthesize speech

## Quick Start

```bash
npm start
```

Opens at **http://localhost:8080**

### What Happens on Startup
1. Server initializes on port 8080
2. Whisper model is cached locally if available
3. Service worker registers for offline caching
4. Unified interface loads with both STT and TTS panels
5. Xenova/Transformers loads Whisper model from CDN on first use

## Unified Interface

Single page with **two-panel layout**:

- **Left Panel (STT)**:
  - Record audio with microphone
  - Upload audio files
  - View transcription output
  - Copy or clear results

- **Right Panel (TTS)**:
  - Text input for synthesis
  - "Use Transcription" button to transfer from STT
  - Placeholder for audio output (when models available)

## How It Works

**STT (Speech-to-Text):**
1. Uses Xenova/Transformers.js library
2. Loads Whisper-base model from CDN (on-demand)
3. Records audio via Web Audio API
4. Transcribes in browser (no server processing)
5. Results displayed in real-time

**TTS (Text-to-Speech):**
- UI ready and integrated
- Can optionally add Pocket TTS models later
- Gracefully disabled if models unavailable

## Requirements

- **Node.js** 14+
- **Browser** - Modern browser with support for:
  - Web Audio API
  - MediaRecorder API
  - Service Workers
  - ES modules
  - Recommended: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Microphone** - For recording audio input
- **No additional packages required** - All dependencies are provided via CDN

## Browser Compatibility

| Browser | Status | Notes |
|---------|--------|-------|
| Chrome 90+ | ✓ Full | All features working |
| Firefox 88+ | ✓ Full | All features working |
| Safari 14+ | ✓ Full | All features working |
| Edge 90+ | ✓ Full | All features working |
| Mobile Safari | ◐ Limited | Works but may have performance limits |
| Mobile Chrome | ✓ Full | Works well on modern devices |

## File Structure

```
realtime-whisper-webgpu/
├── unified.html           # Main application (STT + TTS unified interface)
├── server.js             # HTTP server
├── package.json          # Node.js configuration
├── sw.js                 # Service worker for caching
├── models/               # Local model storage (auto-created)
│   ├── onnx-community/   # Whisper model
│   └── tts/              # TTS models (optional)
├── assets/               # Pre-built assets
├── tts/                  # TTS module files
└── README.md             # This file
```

## Publishing to GitHub

```bash
# On Linux/Mac
./publish.sh

# On Windows
publish.bat
```

Or manually:
```bash
gh repo create AnEntrypoint/webtalk --public --source=. --push
git push -u origin main --force
```

## Credits

- **Whisper**: OpenAI / Xenova (Transformers.js)
- **Pocket TTS**: Kyutai Labs (ONNX export by KevinAHM)
- **Web Demo**: Based on KevinAHM's Pocket TTS Web implementation

## Development

This is a production build. For source development:
- Whisper: https://github.com/xenova/whisper-web
- Pocket TTS: https://github.com/kyutai-labs/pocket-tts
