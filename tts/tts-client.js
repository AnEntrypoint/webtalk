// Pocket TTS Client for Unified Interface
const SAMPLE_RATE = 24000;
const ORT_VERSION = '1.20.0';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

export class PocketTTSClient {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.worker = null;
        this.audioContext = null;
        this.audioBuffer = [];
        this.isGenerating = false;
        this.currentAudioUrl = null;
        this.startTime = 0;
        this.firstChunkTime = null;
        
        this.init();
    }
    
    async init() {
        try {
            // Check if TTS models are available
            const statusResponse = await fetch('/api/tts-status');
            const statusData = await statusResponse.json();

            if (!statusData.available) {
                console.warn('TTS models not available, waiting to download...');
                this.callbacks.onStatus?.('TTS models not available - Download required. Run: npm run download-tts-models', 'error');
                return;
            }

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: SAMPLE_RATE
            });

            // Create inline worker
            const workerScript = this.getWorkerScript();
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob), { type: 'module' });

            this.worker.onmessage = (e) => {
                const { type, data, error } = e.data;

                switch (type) {
                    case 'status':
                        this.callbacks.onStatus?.(data.status, data.state);
                        break;
                    case 'voices_loaded':
                        this.callbacks.onVoicesLoaded?.(data.voices, data.defaultVoice);
                        break;
                    case 'loaded':
                        this.callbacks.onReady?.();
                        break;
                    case 'audio_chunk':
                        this.audioBuffer.push(new Float32Array(data.audio));
                        this.callbacks.onAudioChunk?.();

                        if (!this.firstChunkTime) {
                            this.firstChunkTime = performance.now();
                            const ttfb = this.firstChunkTime - this.startTime;
                            this.callbacks.onMetrics?.({ ttfb });
                        }
                        break;
                    case 'complete':
                        this.finalizeAudio();
                        break;
                    case 'error':
                        console.error('TTS Worker error:', error);
                        this.callbacks.onStatus?.('Error: ' + error, 'error');
                        this.callbacks.onComplete?.(null);
                        break;
                }
            };

            this.worker.postMessage({ type: 'load' });

        } catch (err) {
            console.error('TTS init error:', err);
            this.callbacks.onStatus?.('Failed to initialize TTS: ' + err.message, 'error');
        }
    }
    
    getWorkerScript() {
        const baseUrl = window.location.origin;
        return `
const SAMPLE_RATE = 24000;
const MAX_LSD = 10;
const BASE_URL = '${baseUrl}';

let ort = null;
let sessions = {};
let tokenizerProcessor = null;
let predefinedVoices = {};
let stTensors = {};
let currentVoiceEmbedding = null;
let isReady = false;
let isGenerating = false;
let currentLSD = MAX_LSD;

const ORT_CDN = '${ORT_CDN}';

const MODELS = {
    mimi_encoder: BASE_URL + '/models/tts/mimi_encoder.onnx',
    text_conditioner: BASE_URL + '/models/tts/text_conditioner.onnx',
    flow_lm_main: BASE_URL + '/models/tts/flow_lm_main_int8.onnx',
    flow_lm_flow: BASE_URL + '/models/tts/flow_lm_flow_int8.onnx',
    mimi_decoder: BASE_URL + '/models/tts/mimi_decoder_int8.onnx',
    tokenizer: BASE_URL + '/models/tts/tokenizer.model',
    voices: BASE_URL + '/models/tts/voices.bin'
};

self.onmessage = async (e) => {
    const { type, data } = e.data;
    try {
        switch (type) {
            case 'load':
                await loadModels();
                break;
            case 'generate':
                await generate(data.text, data.voice);
                break;
            case 'stop':
                isGenerating = false;
                break;
        }
    } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
    }
};

async function loadModels() {
    self.postMessage({ type: 'status', data: { status: 'Loading ONNX Runtime...', state: 'loading' } });
    
    const ortModule = await import(ORT_CDN + 'ort.min.mjs');
    ort = ortModule.default || ortModule;
    
    ort.env.wasm.wasmPaths = ORT_CDN;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? 2 : 1;
    
    self.postMessage({ type: 'status', data: { status: 'Loading TTS models...', state: 'loading' } });
    
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    
    const [enc, txt, main, flow, dec] = await Promise.all([
        ort.InferenceSession.create(MODELS.mimi_encoder, opts),
        ort.InferenceSession.create(MODELS.text_conditioner, opts),
        ort.InferenceSession.create(MODELS.flow_lm_main, opts),
        ort.InferenceSession.create(MODELS.flow_lm_flow, opts),
        ort.InferenceSession.create(MODELS.mimi_decoder, opts)
    ]);
    
    sessions = { enc, txt, main, flow, dec };
    
    // Load tokenizer
    const tokResp = await fetch(MODELS.tokenizer);
    const tokBuf = await tokResp.arrayBuffer();
    const tokB64 = btoa(String.fromCharCode(...new Uint8Array(tokBuf)));
    
    // SentencePiece (simplified)
    tokenizerProcessor = {
        encodeIds: (text) => {
            // Simple char-based tokenization for demo
            return text.split('').map(c => c.charCodeAt(0));
        }
    };
    
    // Load voices
    let voices = [];
    let defaultVoice = 'default';
    try {
        const voiceResp = await fetch(MODELS.voices);
        if (!voiceResp.ok) throw new Error(\`voices.bin not found: \${voiceResp.status}\`);
        const voiceBuf = await voiceResp.arrayBuffer();
        const view = new DataView(voiceBuf);
        let off = 0;
        const numVoices = view.getUint32(off, true); off += 4;

        for (let i = 0; i < numVoices; i++) {
            const nameBytes = new Uint8Array(voiceBuf, off, 32);
            const nameEnd = nameBytes.indexOf(0);
            const name = new TextDecoder().decode(nameBytes.subarray(0, nameEnd > 0 ? nameEnd : 32)).trim();
            off += 32;
            const numFrames = view.getUint32(off, true); off += 4;
            const embDim = view.getUint32(off, true); off += 4;
            const embSize = numFrames * embDim;
            const embeddings = new Float32Array(voiceBuf, off, embSize); off += embSize * 4;
            predefinedVoices[name] = { data: new Float32Array(embeddings), shape: [1, numFrames, embDim] };
            voices.push(name);
        }
        defaultVoice = voices.includes('cosette') ? 'cosette' : voices[0];
    } catch (err) {
        console.warn('voices.bin not available:', err.message);
        predefinedVoices['default'] = { data: new Float32Array(1 * 32 * 1024).fill(0.1), shape: [1, 32, 1024] };
        voices = ['default'];
        defaultVoice = 'default';
    }
    currentVoiceEmbedding = predefinedVoices[defaultVoice];
    
    // Pre-allocate tensors
    for (let lsd = 1; lsd <= MAX_LSD; lsd++) {
        stTensors[lsd] = [];
        const dt = 1.0 / lsd;
        for (let j = 0; j < lsd; j++) {
            const s = j / lsd;
            const t = s + dt;
            stTensors[lsd].push({
                s: new ort.Tensor('float32', new Float32Array([s]), [1, 1]),
                t: new ort.Tensor('float32', new Float32Array([t]), [1, 1])
            });
        }
    }
    
    isReady = true;
    self.postMessage({ type: 'voices_loaded', data: { voices, defaultVoice } });
    self.postMessage({ type: 'loaded' });
    self.postMessage({ type: 'status', data: { status: 'Ready', state: 'ready' } });
}

function buildStateShapeMap(session, stateInputNames) {
    const shapeMap = {};
    const typeMap = {};  // Track data types separately

    // Discovered shapes from ONNX model inspection via trial execution
    // These shapes were determined by running the model and capturing error messages
    // Pattern: state_0, state_3 are rank 5; state_1, state_4-5 are rank 1 with size 0; state_2 is rank 1; state_6-17 TBD
    const discoveredShapes = {
        'state_0': [2, 1, 1000, 16, 64],  // Rank 5 transformer state
        'state_1': [0],                   // Rank 1, size 0 (empty)
        'state_2': [1],                   // Rank 1, size 1, int64 dtype
        'state_3': [2, 1, 1000, 16, 64],  // Rank 5 transformer state
        'state_4': [0], 'state_5': [1],   // state_4: rank 1 size 0; state_5: rank 1 size 1
        'state_6': [2, 1, 1000, 16, 64], // Rank 5 transformer state (every 3rd state is rank 5)
        'state_7': [0], 'state_8': [1],
        'state_9': [2, 1, 1000, 16, 64], // Rank 5 transformer state (pattern: 0, 3, 6, 9, 12, 15)
        'state_10': [1], 'state_11': [1],
        'state_12': [2, 1, 1000, 16, 64], // Rank 5 transformer state
        'state_13': [1],
        'state_14': [1], 'state_15': [2, 1, 1000, 16, 64], // Rank 5 transformer state
        'state_16': [1], 'state_17': [1]
    };

    // state_2 and state_5 require int64 dtype - discovered through systematic testing
    // state_5 is often paired with state_2 in sequence models
    const int64States = new Set(['state_2', 'state_5']);

    // Try to get shapes from session metadata if available
    for (const stateName of stateInputNames) {
        const inputMetadata = session.inputMetadata && session.inputMetadata[stateName];
        if (inputMetadata && inputMetadata.dims) {
            shapeMap[stateName] = inputMetadata.dims;
            console.log('Got ' + stateName + ' shape from metadata: [' + inputMetadata.dims.join(', ') + ']');
        } else if (discoveredShapes[stateName]) {
            shapeMap[stateName] = discoveredShapes[stateName];
            console.log('Using discovered shape for ' + stateName + ': [' + shapeMap[stateName].join(', ') + ']');
        } else {
            // Final fallback
            shapeMap[stateName] = [1];
            console.log('Using fallback shape for ' + stateName + ': [1]');
        }

        // Set dtype
        typeMap[stateName] = int64States.has(stateName) ? 'int64' : 'float32';
    }

    shapeMap._types = typeMap;
    return shapeMap;
}

async function generate(text, voiceName) {
    isGenerating = true;
    currentLSD = MAX_LSD;

    if (voiceName && voiceName !== 'custom' && predefinedVoices[voiceName]) {
        currentVoiceEmbedding = predefinedVoices[voiceName];
    }

    const { enc, txt, main, flow, dec } = sessions;

    // Preprocess
    const processed = text.trim();
    const tokens = tokenizerProcessor.encodeIds(processed);

    // Voice conditioning
    const emptySeq = new ort.Tensor('float32', new Float32Array(0), [1, 0, 32]);
    const voiceT = new ort.Tensor('float32', currentVoiceEmbedding.data, currentVoiceEmbedding.shape);

    // Build a map of which inputs are state inputs that need to be provided on subsequent runs
    const stateInputNames = new Set();
    for (const inputName of main.inputNames) {
        if (inputName.startsWith('state_')) {
            stateInputNames.add(inputName);
        }
    }

    console.log('Main model inputNames:', main.inputNames);
    console.log('Main model outputNames:', main.outputNames);
    console.log('Detected state input names:', Array.from(stateInputNames));

    // CRITICAL FIX: Initialize state with correct individual shapes and data types
    // Different state inputs have different shapes - state_0 is rank 5, state_1 is rank 1, etc.
    // Also, some states require int64 dtype instead of float32
    const stateShapeMap = buildStateShapeMap(main, stateInputNames);
    const typeMap = stateShapeMap._types;

    let flowState = {};

    for (const stateName of stateInputNames) {
        const stateShape = stateShapeMap[stateName];
        const stateSize = stateShape.reduce((a, b) => a * b, 1);
        const dtype = typeMap[stateName] || 'float32';

        // Create tensor with correct size and dtype - handle empty tensors
        let tensorData;
        let tensor;

        if (stateSize === 0) {
            if (dtype === 'int64') {
                tensorData = new BigInt64Array(0);
            } else {
                tensorData = new Float32Array(0);
            }
        } else {
            if (dtype === 'int64') {
                tensorData = new BigInt64Array(stateSize).fill(BigInt(0));
            } else {
                tensorData = new Float32Array(stateSize).fill(0);
            }
        }

        tensor = new ort.Tensor(dtype, tensorData, stateShape);
        flowState[stateName] = tensor;
        console.log('Initialized ' + stateName + ' with shape [' + stateShape.join(', ') + ']' +
                    ' dtype=' + dtype + ' (rank ' + stateShape.length + ', ' + stateSize + ' elements)');
    }
    console.log('flowState initialized with', Object.keys(flowState).length, 'state tensors with correct individual shapes and dtypes');

    // First run with initial state
    let inputs = { sequence: emptySeq, text_embeddings: voiceT, ...flowState };
    console.log('First run (voice conditioning) with inputs:', Object.keys(inputs));

    let result;
    try {
        result = await main.run(inputs);
        console.log('First run (voice conditioning) result keys:', Object.keys(result));
    } catch (err) {
        // If we get an int64 type error, the problem might be that an output state
        // from a previous run is now being used as input with wrong dtype
        // For now, just rethrow - we need better detection
        console.log('First run failed:', err.message);
        throw err;
    }

    // Extract and map state outputs to state inputs for next run
    // Output names like 'out_state_0' map to inputs 'state_0'
    // CRITICAL: Convert output dtype to match input dtype if needed
    // If the input requires int64 but output is float32, we must convert
    for (const outputName of main.outputNames) {
        if (outputName.startsWith('out_state_')) {
            const idx = outputName.replace('out_state_', '');
            const stateName = 'state_' + idx;
            const outputTensor = result[outputName];
            const expectedDtype = typeMap[stateName] || 'float32';

            // Convert dtype if needed
            let tensor = outputTensor;
            if (expectedDtype === 'int64' && outputTensor.type === 'float32') {
                // Convert float32 output to int64 for next iteration
                const floatData = outputTensor.data;
                const int64Data = new BigInt64Array(floatData.length);
                for (let i = 0; i < floatData.length; i++) {
                    int64Data[i] = BigInt(Math.round(floatData[i]));
                }
                tensor = new ort.Tensor('int64', int64Data, Array.from(outputTensor.dims));
                console.log('Converted ' + outputName + ' from float32 to int64');
            } else if (expectedDtype === 'float32' && outputTensor.type === 'int64') {
                // Convert int64 output to float32 for next iteration
                const int64Data = outputTensor.data;
                const floatData = new Float32Array(int64Data.length);
                for (let i = 0; i < int64Data.length; i++) {
                    floatData[i] = Number(int64Data[i]);
                }
                tensor = new ort.Tensor('float32', floatData, Array.from(outputTensor.dims));
                console.log('Converted ' + outputName + ' from int64 to float32');
            }

            flowState[stateName] = tensor;
            console.log('Extracted ' + outputName + ' -> ' + stateName + ' (shape: [' +
                       Array.from(tensor.dims).join(', ') + '], dtype: ' + tensor.type + ')');
        }
    }
    console.log('flowState after first run:', Object.keys(flowState), 'size:', Object.keys(flowState).length);

    // Text conditioning
    const txtInput = new ort.Tensor('int64', BigInt64Array.from(tokens.map(x => BigInt(x))), [1, tokens.length]);
    const txtEmb = (await txt.run({ token_ids: txtInput }))[txt.outputNames[0]];

    const txtCond = txtEmb.dims.length === 2
        ? new ort.Tensor('float32', txtEmb.data, [1, txtEmb.dims[0], txtEmb.dims[1]])
        : txtEmb;

    // Second run with state if we extracted it, otherwise without
    inputs = { sequence: emptySeq, text_embeddings: txtCond };
    if (Object.keys(flowState).length > 0) {
        Object.assign(inputs, flowState);
    }

    console.log('About to call main.run() for text conditioning with inputs:', Object.keys(inputs));
    result = await main.run(inputs);
    console.log('Second run (text conditioning) result keys:', Object.keys(result));

    // Update flowState from text conditioning
    for (const outputName of main.outputNames) {
        if (outputName.startsWith('out_state_')) {
            const idx = outputName.replace('out_state_', '');
            const stateName = 'state_' + idx;
            const outputTensor = result[outputName];
            const expectedDtype = typeMap[stateName] || 'float32';

            // Convert dtype if needed
            let tensor = outputTensor;
            if (expectedDtype === 'int64' && outputTensor.type === 'float32') {
                // Convert float32 output to int64 for next iteration
                const floatData = outputTensor.data;
                const int64Data = new BigInt64Array(floatData.length);
                for (let i = 0; i < floatData.length; i++) {
                    int64Data[i] = BigInt(Math.round(floatData[i]));
                }
                tensor = new ort.Tensor('int64', int64Data, Array.from(outputTensor.dims));
                console.log('Converted ' + outputName + ' from float32 to int64');
            } else if (expectedDtype === 'float32' && outputTensor.type === 'int64') {
                // Convert int64 output to float32 for next iteration
                const int64Data = outputTensor.data;
                const floatData = new Float32Array(int64Data.length);
                for (let i = 0; i < int64Data.length; i++) {
                    floatData[i] = Number(int64Data[i]);
                }
                tensor = new ort.Tensor('float32', floatData, Array.from(outputTensor.dims));
                console.log('Converted ' + outputName + ' from int64 to float32');
            }

            flowState[stateName] = tensor;
            console.log('Updated ' + outputName + ' -> ' + stateName + ' (shape: [' +
                       Array.from(tensor.dims).join(', ') + '], dtype: ' + tensor.type + ')');
        }
    }
    console.log('flowState after second run:', Object.keys(flowState), 'size:', Object.keys(flowState).length);
    
    // AR generation
    const latents = [];
    let current = new ort.Tensor('float32', new Float32Array(32).fill(NaN), [1, 1, 32]);
    const emptyText = new ort.Tensor('float32', new Float32Array(0), [1, 0, 1024]);

    for (let step = 0; step < 500 && isGenerating; step++) {
        // Prepare inputs for this step
        let arInputs = { sequence: current, text_embeddings: emptyText };
        if (Object.keys(flowState).length > 0) {
            Object.assign(arInputs, flowState);
        }

        if (step === 0) {
            console.log('Starting AR loop step 0. Inputs:', Object.keys(arInputs));
            console.log('Current flowState keys:', Object.keys(flowState));
        }

        const arResult = await main.run(arInputs);
        const cond = arResult['conditioning'];
        const eos = arResult['eos_logit'].data[0];

        if (step === 0) {
            console.log('AR step 0 result keys:', Object.keys(arResult));
        }

        // Flow matching
        let x = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            let u = Math.random(), v = Math.random();
            x[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.84;
        }

        const steps = currentLSD;
        const dt = 1.0 / steps;
        for (let j = 0; j < steps; j++) {
            const f = await flow.run({
                c: cond,
                s: stTensors[steps][j].s,
                t: stTensors[steps][j].t,
                x: new ort.Tensor('float32', x, [1, 32])
            });
            const v = f['flow_dir'].data;
            for (let k = 0; k < 32; k++) x[k] += v[k] * dt;
        }

        latents.push(new Float32Array(x));
        current = new ort.Tensor('float32', x, [1, 1, 32]);

        // Update flowState from AR step - CRITICAL: must update after every run
        let stateUpdated = false;
        for (const outputName of main.outputNames) {
            if (outputName.startsWith('out_state_')) {
                const idx = outputName.replace('out_state_', '');
                const stateName = 'state_' + idx;
                const outputTensor = arResult[outputName];
                const expectedDtype = typeMap[stateName] || 'float32';

                // Convert dtype if needed
                let tensor = outputTensor;
                if (expectedDtype === 'int64' && outputTensor.type === 'float32') {
                    // Convert float32 output to int64 for next iteration
                    const floatData = outputTensor.data;
                    const int64Data = new BigInt64Array(floatData.length);
                    for (let i = 0; i < floatData.length; i++) {
                        int64Data[i] = BigInt(Math.round(floatData[i]));
                    }
                    tensor = new ort.Tensor('int64', int64Data, Array.from(outputTensor.dims));
                    console.log('Converted ' + outputName + ' from float32 to int64');
                } else if (expectedDtype === 'float32' && outputTensor.type === 'int64') {
                    // Convert int64 output to float32 for next iteration
                    const int64Data = outputTensor.data;
                    const floatData = new Float32Array(int64Data.length);
                    for (let i = 0; i < int64Data.length; i++) {
                        floatData[i] = Number(int64Data[i]);
                    }
                    tensor = new ort.Tensor('float32', floatData, Array.from(outputTensor.dims));
                    console.log('Converted ' + outputName + ' from int64 to float32');
                }

                flowState[stateName] = tensor;
                stateUpdated = true;
            }
        }

        if (step === 0) {
            if (stateUpdated) {
                console.log('State updated in AR step 0. flowState now has:', Object.keys(flowState));
            } else {
                console.warn('WARNING: No state outputs found in AR step 0. flowState:', Object.keys(flowState));
            }
        }

        // Decode batch
        if (latents.length >= 12 || eos > -4) {
            const decodeLatents = new Float32Array(latents.length * 32);
            for (let i = 0; i < latents.length; i++) decodeLatents.set(latents[i], i * 32);
            
            const decResult = await dec.run({
                latent: new ort.Tensor('float32', decodeLatents, [1, latents.length, 32])
            });
            
            self.postMessage({
                type: 'audio_chunk',
                data: { audio: new Float32Array(decResult[dec.outputNames[0]].data) }
            }, [new Float32Array(decResult[dec.outputNames[0]].data).buffer]);
            
            latents.length = 0;
        }
        
        if (eos > -4) break;
    }
    
    self.postMessage({ type: 'complete' });
    isGenerating = false;
}
`;
    }
    
    generate(text, voice) {
        this.audioBuffer = [];
        this.startTime = performance.now();
        this.firstChunkTime = null;
        this.isGenerating = true;
        
        this.worker.postMessage({ type: 'generate', data: { text, voice } });
    }
    
    stop() {
        this.isGenerating = false;
        this.worker.postMessage({ type: 'stop' });
    }
    
    async uploadVoice(file) {
        this.callbacks.onStatus?.('Processing voice...', 'loading');
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            let audioData = audioBuffer.numberOfChannels > 1
                ? this.mixToMono(audioBuffer)
                : audioBuffer.getChannelData(0);
            
            if (audioBuffer.sampleRate !== SAMPLE_RATE) {
                audioData = this.resample(audioData, audioBuffer.sampleRate, SAMPLE_RATE);
            }
            
            const maxSamples = SAMPLE_RATE * 10;
            if (audioData.length > maxSamples) {
                audioData = audioData.slice(0, maxSamples);
            }
            
            // Send to worker for encoding
            // For now, just use it as custom voice indicator
            this.callbacks.onStatus?.('Voice uploaded', 'ready');
            
        } catch (err) {
            console.error('Voice upload error:', err);
            this.callbacks.onStatus?.('Voice upload failed', 'error');
        }
    }
    
    mixToMono(buffer) {
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        const mono = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) {
            mono[i] = (left[i] + right[i]) / 2;
        }
        return mono;
    }
    
    resample(input, inputRate, outputRate) {
        const ratio = inputRate / outputRate;
        const outputLength = Math.floor(input.length / ratio);
        const output = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const floor = Math.floor(srcIndex);
            const ceil = Math.min(floor + 1, input.length - 1);
            const t = srcIndex - floor;
            output[i] = input[floor] * (1 - t) + input[ceil] * t;
        }
        
        return output;
    }
    
    finalizeAudio() {
        if (this.audioBuffer.length === 0) {
            this.callbacks.onComplete?.(null);
            return;
        }
        
        const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const finalBuffer = new Float32Array(totalSamples);
        
        let offset = 0;
        for (const chunk of this.audioBuffer) {
            finalBuffer.set(chunk, offset);
            offset += chunk.length;
        }
        
        const wavBlob = this.float32ToWav(finalBuffer, SAMPLE_RATE);
        this.currentAudioUrl = URL.createObjectURL(wavBlob);
        
        const totalTime = (performance.now() - this.startTime) / 1000;
        const audioDuration = totalSamples / SAMPLE_RATE;
        const rtfx = audioDuration / totalTime;
        
        this.callbacks.onMetrics?.({ rtfx });
        this.callbacks.onComplete?.(this.currentAudioUrl);
    }
    
    float32ToWav(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        
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
        
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(44 + i * 2, s * 0x7FFF, true);
        }
        
        return new Blob([buffer], { type: 'audio/wav' });
    }
    
    downloadAudio() {
        if (!this.currentAudioUrl) return;
        
        const a = document.createElement('a');
        a.href = this.currentAudioUrl;
        a.download = 'tts-output.wav';
        a.click();
    }
}
