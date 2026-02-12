const STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  RECORDING: 'recording',
  TRANSCRIBING: 'transcribing',
  ERROR: 'error'
};

class STT {
  constructor(options = {}) {
    this.language = options.language || 'en';
    this.onTranscript = options.onTranscript || null;
    this.onStatus = options.onStatus || null;
    this.onPartial = options.onPartial || null;
    this.basePath = options.basePath || '';
    this.workerFile = options.workerFile || 'worker-BPxxCWVT.js';
    this.worker = null;
    this.ready = false;
    this.recorder = null;
    this.recordChunks = [];
    this._resolveStop = null;
    this._currentTranscript = '';
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        const workerPath = this.basePath + '/assets/' + this.workerFile;
        this.worker = new Worker(workerPath);
        this.worker.onmessage = (e) => this._handleMessage(e.data);
        this.worker.onerror = (e) => reject(e);
        this._initResolve = resolve;
        this.worker.postMessage({ type: 'load' });
      } catch (err) {
        reject(err);
      }
    });
  }

  _handleMessage(msg) {
    switch (msg.status) {
      case 'loading':
        this.onStatus?.(STATUS.LOADING, typeof msg.data === 'string' ? msg.data : 'Loading...');
        break;
      case 'ready':
        this.ready = true;
        this.onStatus?.(STATUS.READY, 'Ready');
        this._initResolve?.();
        this._initResolve = null;
        break;
      case 'start':
        this.onStatus?.(STATUS.TRANSCRIBING, 'Transcribing...');
        break;
      case 'update': {
        const text = this._extractText(msg.output);
        this._currentTranscript = text;
        this.onPartial?.(text);
        break;
      }
      case 'complete': {
        const text = this._extractText(msg.output);
        this._currentTranscript = text;
        this.onTranscript?.(text);
        this.onStatus?.(STATUS.READY, 'Ready');
        this._resolveStop?.(text);
        this._resolveStop = null;
        break;
      }
    }
  }

  _extractText(output) {
    if (!output) return '';
    if (Array.isArray(output)) return output.map(o => o.text || o).join('');
    return output.text || String(output);
  }

  async startRecording() {
    if (!this.ready) throw new Error('STT not initialized');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recordChunks = [];
    this.recorder = new MediaRecorder(stream);
    this.recorder.ondataavailable = (e) => this.recordChunks.push(e.data);
    this._stream = stream;
    this.recorder.start();
    this.onStatus?.(STATUS.RECORDING, 'Recording...');
  }

  stopRecording() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve(this._currentTranscript);
        return;
      }
      this._resolveStop = resolve;
      this.recorder.onstop = async () => {
        this._stream?.getTracks().forEach(t => t.stop());
        const blob = new Blob(this.recordChunks, { type: 'audio/webm' });
        await this._processAudio(blob);
      };
      this.recorder.stop();
    });
  }

  async transcribeBlob(blob) {
    return new Promise((resolve) => {
      this._resolveStop = resolve;
      this._processAudio(blob);
    });
  }

  async _processAudio(blob) {
    if (!this.worker || !this.ready) return;
    this.onStatus?.(STATUS.TRANSCRIBING, 'Transcribing...');
    const arrayBuf = await blob.arrayBuffer();
    const ctx = new AudioContext({ sampleRate: 16000 });
    const decoded = await ctx.decodeAudioData(arrayBuf);
    const audio = decoded.getChannelData(0);
    ctx.close();
    this.worker.postMessage({ type: 'generate', data: { audio, language: this.language } });
  }

  getStatus() {
    return {
      ready: this.ready,
      recording: this.recorder?.state === 'recording',
      language: this.language,
      workerFile: this.workerFile,
      hasWorker: !!this.worker
    };
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this._stream?.getTracks().forEach(t => t.stop());
  }
}

export { STT };
