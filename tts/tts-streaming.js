// TTS streaming interface
const SAMPLE_RATE = 24000;

class PocketTTSClient {
    constructor() {
        this.worker = null;
        this.audioContext = null;
        this.audioBuffer = [];
        this.isGenerating = false;
        this.startTime = 0;
        this.firstChunkTime = null;
        
        this.elements = {
            voiceSelect: document.getElementById('voice-select'),
            voiceUpload: document.getElementById('voice-upload'),
            uploadBtn: document.getElementById('upload-btn'),
            textInput: document.getElementById('text-input'),
            generateBtn: document.getElementById('generate-btn'),
            stopBtn: document.getElementById('stop-btn'),
            status: document.getElementById('status'),
            loadingProgress: document.getElementById('loading-progress'),
            audioSection: document.getElementById('audio-section'),
            audioPlayer: document.getElementById('audio-player'),
            metrics: document.getElementById('metrics'),
            rtfx: document.getElementById('rtfx'),
            ttfb: document.getElementById('ttfb')
        };
        
        this.init();
    }
    
    async init() {
        this.updateStatus('Loading models...', 'loading');
        
        try {
            // Initialize AudioContext
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: SAMPLE_RATE
            });
            
            // Initialize Worker
            this.worker = new Worker('./tts/tts-worker.js', { type: 'module' });
            
            this.worker.onmessage = (e) => {
                const { type, data, error, voices, defaultVoice } = e.data;
                
                switch (type) {
                    case 'status':
                        this.updateStatus(data.status, data.state);
                        if (data.progress) {
                            this.elements.loadingProgress.textContent = data.progress;
                        }
                        break;
                    case 'voices_loaded':
                        this.populateVoices(voices, defaultVoice);
                        break;
                    case 'loaded':
                        this.elements.generateBtn.disabled = false;
                        this.elements.uploadBtn.disabled = false;
                        this.updateStatus('Ready', 'ready');
                        this.elements.loadingProgress.style.display = 'none';
                        break;
                    case 'audio_chunk':
                        this.handleAudioChunk(data);
                        break;
                    case 'generation_complete':
                        this.finalizeAudio();
                        break;
                    case 'error':
                        console.error('Worker error:', error);
                        this.updateStatus('Error: ' + error, 'error');
                        this.resetUI();
                        break;
                }
            };
            
            // Load models
            this.worker.postMessage({ type: 'load' });
            
            // Attach event listeners
            this.attachListeners();
            
        } catch (err) {
            console.error('Init error:', err);
            this.updateStatus('Failed to initialize: ' + err.message, 'error');
        }
    }
    
    attachListeners() {
        this.elements.generateBtn.addEventListener('click', () => this.generate());
        this.elements.stopBtn.addEventListener('click', () => this.stop());
        
        this.elements.voiceSelect.addEventListener('change', (e) => {
            const voice = e.target.value;
            if (voice && voice !== 'custom') {
                this.worker.postMessage({ type: 'set_voice', data: { voice } });
            }
        });
        
        this.elements.voiceUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleVoiceUpload(file);
            }
        });
    }
    
    populateVoices(voices, defaultVoice) {
        this.elements.voiceSelect.innerHTML = '';
        
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = voice.charAt(0).toUpperCase() + voice.slice(1);
            if (voice === defaultVoice) {
                option.selected = true;
            }
            this.elements.voiceSelect.appendChild(option);
        });
        
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom Voice';
        this.elements.voiceSelect.appendChild(customOption);
    }
    
    async handleVoiceUpload(file) {
        this.updateStatus('Processing voice...', 'loading');
        this.elements.uploadBtn.disabled = true;
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            // Convert to mono 24kHz
            let audioData;
            if (audioBuffer.numberOfChannels > 1) {
                const left = audioBuffer.getChannelData(0);
                const right = audioBuffer.getChannelData(1);
                audioData = new Float32Array(left.length);
                for (let i = 0; i < left.length; i++) {
                    audioData[i] = (left[i] + right[i]) / 2;
                }
            } else {
                audioData = audioBuffer.getChannelData(0);
            }
            
            // Resample to 24kHz if needed
            if (audioBuffer.sampleRate !== SAMPLE_RATE) {
                audioData = this.resampleAudio(audioData, audioBuffer.sampleRate, SAMPLE_RATE);
            }
            
            // Limit to 10 seconds
            const maxSamples = SAMPLE_RATE * 10;
            if (audioData.length > maxSamples) {
                audioData = audioData.slice(0, maxSamples);
            }
            
            this.worker.postMessage({
                type: 'encode_voice',
                data: { audio: audioData }
            }, [audioData.buffer]);
            
            this.elements.voiceSelect.value = 'custom';
            this.updateStatus('Voice uploaded', 'ready');
            
        } catch (err) {
            console.error('Voice upload error:', err);
            this.updateStatus('Voice upload failed: ' + err.message, 'error');
        } finally {
            this.elements.uploadBtn.disabled = false;
        }
    }
    
    resampleAudio(input, inputRate, outputRate) {
        const ratio = inputRate / outputRate;
        const outputLength = Math.floor(input.length / ratio);
        const output = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
            const t = srcIndex - srcIndexFloor;
            output[i] = input[srcIndexFloor] * (1 - t) + input[srcIndexCeil] * t;
        }
        
        return output;
    }
    
    async generate() {
        const text = this.elements.textInput.value.trim();
        if (!text) return;
        
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        this.isGenerating = true;
        this.audioBuffer = [];
        this.firstChunkTime = null;
        
        this.elements.generateBtn.disabled = true;
        this.elements.stopBtn.disabled = false;
        this.elements.audioSection.style.display = 'none';
        this.elements.metrics.style.display = 'none';
        
        this.startTime = performance.now();
        this.updateStatus('Generating speech...', 'generating');
        
        const voice = this.elements.voiceSelect.value;
        
        this.worker.postMessage({
            type: 'generate',
            data: { text, voice }
        });
    }
    
    stop() {
        if (!this.isGenerating) return;
        
        this.worker.postMessage({ type: 'stop' });
        this.isGenerating = false;
        this.resetUI();
        this.updateStatus('Stopped', 'ready');
    }
    
    handleAudioChunk(float32Array) {
        if (!this.firstChunkTime) {
            this.firstChunkTime = performance.now();
            const ttfb = this.firstChunkTime - this.startTime;
            this.elements.ttfb.textContent = Math.round(ttfb);
            this.elements.metrics.style.display = 'grid';
        }
        
        this.audioBuffer.push(new Float32Array(float32Array));
    }
    
    finalizeAudio() {
        if (this.audioBuffer.length === 0) {
            this.resetUI();
            return;
        }
        
        // Calculate total samples
        const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const finalBuffer = new Float32Array(totalSamples);
        
        let offset = 0;
        for (const chunk of this.audioBuffer) {
            finalBuffer.set(chunk, offset);
            offset += chunk.length;
        }
        
        // Convert to WAV
        const wavBlob = this.float32ToWav(finalBuffer, SAMPLE_RATE);
        const url = URL.createObjectURL(wavBlob);
        
        this.elements.audioPlayer.src = url;
        this.elements.audioSection.style.display = 'block';
        
        // Calculate RTFx
        const totalTime = (performance.now() - this.startTime) / 1000;
        const audioDuration = totalSamples / SAMPLE_RATE;
        const rtfx = audioDuration / totalTime;
        this.elements.rtfx.textContent = rtfx.toFixed(2) + 'x';
        
        this.resetUI();
        this.updateStatus('Complete (RTFx: ' + rtfx.toFixed(2) + 'x)', 'ready');
    }
    
    float32ToWav(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        
        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);
        
        // Convert float32 to int16
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(44 + i * 2, s * 0x7FFF, true);
        }
        
        return new Blob([buffer], { type: 'audio/wav' });
    }
    
    resetUI() {
        this.elements.generateBtn.disabled = false;
        this.elements.stopBtn.disabled = true;
        this.isGenerating = false;
    }
    
    updateStatus(text, state) {
        this.elements.status.textContent = text;
        this.elements.status.className = 'status ' + state;
    }
}

// Initialize
window.ttsClient = new PocketTTSClient();
