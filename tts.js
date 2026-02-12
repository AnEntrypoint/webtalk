import { SAMPLE_RATE, resample, encodeWAV } from './tts-utils.js';

const STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  SPEAKING: 'speaking',
  ERROR: 'error'
};

class TTS {
  constructor(options = {}) {
    this.voice = options.voice || null;
    this.onAudioReady = options.onAudioReady || null;
    this.onStatus = options.onStatus || null;
    this.onVoicesLoaded = options.onVoicesLoaded || null;
    this.onMetrics = options.onMetrics || null;
    this.onAudioChunk = options.onAudioChunk || null;
    this.basePath = options.basePath || '';
    this.apiBasePath = options.apiBasePath || '';
    this.ttsWorkerFile = options.ttsWorkerFile || 'inference-worker.js';
    this.worker = null;
    this.audioContext = null;
    this.audioBuffer = [];
    this.currentAudioUrl = null;
    this.startTime = 0;
    this.firstChunkTime = null;
    this.ready = false;
  }

  async init() {
    const statusUrl = this.apiBasePath + '/api/tts-status';
    const statusResponse = await fetch(statusUrl);
    const statusData = await statusResponse.json();
    if (!statusData.available) throw new Error('TTS models not available');

    this.audioContext = new (globalThis.AudioContext || globalThis.webkitAudioContext)({ sampleRate: SAMPLE_RATE });

    return new Promise((resolve, reject) => {
      try {
        const workerPath = this.basePath + '/tts/' + this.ttsWorkerFile;
        this.worker = new Worker(workerPath, { type: 'module' });
        this.worker.onmessage = (e) => this._handleMessage(e.data, resolve);
        this.worker.onerror = (e) => reject(e);
        this.worker.postMessage({ type: 'load' });
      } catch (err) {
        reject(err);
      }
    });
  }

  _handleMessage(msg, initResolve) {
    switch (msg.type) {
      case 'status':
        this.onStatus?.(msg.status || msg.data?.status, msg.state || msg.data?.state);
        break;
      case 'voices_loaded':
        this.onVoicesLoaded?.(msg.voices, msg.defaultVoice);
        break;
      case 'loaded':
        this.ready = true;
        initResolve?.();
        this.onStatus?.(STATUS.READY, 'ready');
        break;
      case 'audio_chunk':
        this.audioBuffer.push(new Float32Array(msg.data));
        this.onAudioChunk?.();
        if (!this.firstChunkTime) {
          this.firstChunkTime = performance.now();
          this.onMetrics?.({ ttfb: this.firstChunkTime - this.startTime });
        }
        if (msg.metrics) {
          const elapsed = (performance.now() - this.startTime) / 1000;
          const audioDur = this.audioBuffer.reduce((s, b) => s + b.length, 0) / SAMPLE_RATE;
          if (elapsed > 0) this.onMetrics?.({ rtfx: audioDur / elapsed });
        }
        break;
      case 'stream_ended':
        this._finalize();
        break;
      case 'error':
        this.onStatus?.(STATUS.ERROR, 'error');
        this._generateReject?.(new Error(msg.error));
        this._generateReject = null;
        this._generateResolve = null;
        break;
    }
  }

  generate(text, voice) {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.ready) return reject(new Error('TTS not initialized'));
      this.audioBuffer = [];
      this.startTime = performance.now();
      this.firstChunkTime = null;
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }
      this._generateResolve = resolve;
      this._generateReject = reject;
      const v = voice || this.voice;
      if (v && v !== 'custom') {
        this.worker.postMessage({ type: 'set_voice', data: { voiceName: v } });
      }
      this.worker.postMessage({ type: 'generate', data: { text, voice: v } });
    });
  }

  stop() {
    this.worker?.postMessage({ type: 'stop' });
  }

  async uploadVoice(file) {
    if (!this.worker || !this.audioContext) return;
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    let audioData = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      audioData = resample(audioData, audioBuffer.sampleRate, SAMPLE_RATE);
    }
    this.worker.postMessage({ type: 'encode_voice', data: { audio: audioData } });
  }

  _finalize() {
    if (this.audioBuffer.length === 0) {
      this._generateResolve?.(null);
      this._generateResolve = null;
      return;
    }
    const wavBuf = encodeWAV(this.audioBuffer);
    if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.currentAudioUrl = URL.createObjectURL(new Blob([wavBuf], { type: 'audio/wav' }));
    this.onAudioReady?.(this.currentAudioUrl);
    this._generateResolve?.(this.currentAudioUrl);
    this._generateResolve = null;
  }

  downloadAudio() {
    if (this.currentAudioUrl) {
      const a = document.createElement('a');
      a.href = this.currentAudioUrl;
      a.download = 'tts-output.wav';
      a.click();
    }
  }

  getStatus() {
    return {
      ready: this.ready,
      voice: this.voice,
      workerFile: this.ttsWorkerFile,
      hasWorker: !!this.worker,
      hasAudioContext: !!this.audioContext,
      audioBuffered: this.audioBuffer.length
    };
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    if (this.currentAudioUrl) URL.revokeObjectURL(this.currentAudioUrl);
    this.audioContext?.close();
  }
}

export { TTS };
