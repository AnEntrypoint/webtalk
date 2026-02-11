// Pocket TTS Worker for Local Hosting
console.log('[TTS Worker] Starting...');

let ort = null;

// Model paths - served locally from /models/tts/
const MODELS = {
    mimi_encoder: '/models/tts/mimi_encoder.onnx',
    text_conditioner: '/models/tts/text_conditioner.onnx',
    flow_lm_main: '/models/tts/flow_lm_main_int8.onnx',
    flow_lm_flow: '/models/tts/flow_lm_flow_int8.onnx',
    mimi_decoder: '/models/tts/mimi_decoder_int8.onnx',
    tokenizer: '/models/tts/tokenizer.model',
    voices: '/models/tts/voices.bin'
};

const SAMPLE_RATE = 24000;
const SAMPLES_PER_FRAME = 1920;
const MAX_FRAMES = 500;
const MAX_LSD = 10;

// State
let sessions = {};
let tokenizerProcessor = null;
let predefinedVoices = {};
let stTensors = {};
let currentVoiceEmbedding = null;
let currentVoiceName = null;
let isReady = false;
let isGenerating = false;
let currentLSD = MAX_LSD;

// Import ONNX Runtime
const ORT_VERSION = '1.20.0';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

self.onmessage = async (e) => {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'load':
                await loadModels();
                break;
            case 'generate':
                if (!isReady) throw new Error('Models not loaded');
                await generateSpeech(data.text, data.voice);
                break;
            case 'encode_voice':
                if (!isReady) throw new Error('Models not loaded');
                await encodeCustomVoice(data.audio);
                break;
            case 'set_voice':
                if (!isReady) throw new Error('Models not loaded');
                setVoice(data.voice);
                break;
            case 'stop':
                isGenerating = false;
                break;
        }
    } catch (err) {
        console.error('[TTS Worker] Error:', err);
        self.postMessage({ type: 'error', error: err.message });
    }
};

async function loadModels() {
    self.postMessage({ type: 'status', data: { status: 'Loading ONNX Runtime...', state: 'loading' } });

    try {
        console.log('[TTS Worker] Starting model loading...');

        // Load ONNX Runtime
        const ortModule = await import(`${ORT_CDN}ort.min.mjs`);
        ort = ortModule.default || ortModule;

        console.log('[TTS Worker] ONNX Runtime loaded');

        ort.env.wasm.wasmPaths = ORT_CDN;
        ort.env.wasm.simd = true;

        if (!self.crossOriginIsolated) {
            console.warn('[TTS Worker] Not cross-origin isolated, using single thread');
            ort.env.wasm.numThreads = 1;
        } else {
            ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);
        }

        self.postMessage({ type: 'status', data: { status: 'Loading TTS models...', state: 'loading', progress: 'This may take a moment (140MB total)' } });

        console.log('[TTS Worker] Creating inference sessions...');

        const sessionOptions = {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        };

        // Load all models in parallel with error handling
        const [encoder, textCond, flowMain, flowFlow, decoder] = await Promise.all([
            ort.InferenceSession.create(MODELS.mimi_encoder, sessionOptions).catch(e => { throw new Error(`Failed to load mimi_encoder: ${e.message}`); }),
            ort.InferenceSession.create(MODELS.text_conditioner, sessionOptions).catch(e => { throw new Error(`Failed to load text_conditioner: ${e.message}`); }),
            ort.InferenceSession.create(MODELS.flow_lm_main, sessionOptions).catch(e => { throw new Error(`Failed to load flow_lm_main: ${e.message}`); }),
            ort.InferenceSession.create(MODELS.flow_lm_flow, sessionOptions).catch(e => { throw new Error(`Failed to load flow_lm_flow: ${e.message}`); }),
            ort.InferenceSession.create(MODELS.mimi_decoder, sessionOptions).catch(e => { throw new Error(`Failed to load mimi_decoder: ${e.message}`); })
        ]);

        console.log('[TTS Worker] All models loaded successfully');

        sessions = {
            mimiEncoder: encoder,
            textConditioner: textCond,
            flowLmMain: flowMain,
            flowLmFlow: flowFlow,
            mimiDecoder: decoder
        };

        console.log('[TTS Worker] flowLmMain inputNames:', sessions.flowLmMain.inputNames);
        console.log('[TTS Worker] flowLmMain outputNames:', sessions.flowLmMain.outputNames);

        // Load tokenizer - using simple char-based tokenization
        tokenizerProcessor = {
            encodeIds: (text) => {
                return text.split('').map(c => c.charCodeAt(0));
            }
        };

        self.postMessage({ type: 'status', data: { status: 'Loading voices...', state: 'loading' } });

        // Load voices
        try {
            const voicesResponse = await fetch(MODELS.voices);
            if (voicesResponse.ok) {
                const voicesData = await voicesResponse.arrayBuffer();
                predefinedVoices = parseVoicesBin(voicesData);
            } else {
                console.warn('[TTS Worker] voices.bin not found, using default voice');
                predefinedVoices = {
                    'default': {
                        data: new Float32Array(1 * 32 * 1024).fill(0.1),
                        shape: [1, 32, 1024]
                    }
                };
            }
        } catch (err) {
            console.warn('[TTS Worker] Failed to load voices.bin:', err.message);
            predefinedVoices = {
                'default': {
                    data: new Float32Array(1 * 32 * 1024).fill(0.1),
                    shape: [1, 32, 1024]
                }
            };
        }

        // Set default voice
        const voiceNames = Object.keys(predefinedVoices);
        const defaultVoice = voiceNames.includes('cosette') ? 'cosette' : voiceNames[0];
        currentVoiceEmbedding = predefinedVoices[defaultVoice];
        currentVoiceName = defaultVoice;

        // Pre-allocate s/t tensors for flow matching
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

        self.postMessage({
            type: 'voices_loaded',
            voices: voiceNames,
            defaultVoice: defaultVoice
        });

        self.postMessage({ type: 'loaded' });
        self.postMessage({ type: 'status', data: { status: 'Ready', state: 'ready' } });
    } catch (err) {
        console.error('[TTS Worker] Model loading failed:', err);
        isReady = false;
        self.postMessage({ type: 'status', data: { status: 'TTS models not available: ' + err.message, state: 'error' } });
        self.postMessage({ type: 'error', error: err.message });
    }
}

function parseVoicesBin(buffer) {
    const voices = {};
    const view = new DataView(buffer);
    let offset = 0;

    const numVoices = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < numVoices; i++) {
        const nameBytes = new Uint8Array(buffer, offset, 32);
        const nameEnd = nameBytes.indexOf(0);
        const name = new TextDecoder().decode(nameBytes.subarray(0, nameEnd > 0 ? nameEnd : 32)).trim();
        offset += 32;

        const numFrames = view.getUint32(offset, true);
        offset += 4;
        const embDim = view.getUint32(offset, true);
        offset += 4;

        const embSize = numFrames * embDim;
        const embeddings = new Float32Array(buffer, offset, embSize);
        offset += embSize * 4;

        voices[name] = {
            data: new Float32Array(embeddings),
            shape: [1, numFrames, embDim]
        };
    }

    return voices;
}

async function encodeCustomVoice(audioData) {
    const input = new ort.Tensor('float32', audioData, [1, 1, audioData.length]);
    const outputs = await sessions.mimiEncoder.run({ audio: input });
    const embeddings = outputs[sessions.mimiEncoder.outputNames[0]];

    currentVoiceEmbedding = {
        data: new Float32Array(embeddings.data),
        shape: embeddings.dims
    };
    currentVoiceName = 'custom';

    self.postMessage({ type: 'voice_encoded' });
}

function setVoice(voiceName) {
    if (voiceName === 'custom') return;
    if (predefinedVoices[voiceName]) {
        currentVoiceEmbedding = predefinedVoices[voiceName];
        currentVoiceName = voiceName;
    }
}

async function generateSpeech(text, voiceName) {
    console.log('[TTS Worker] generateSpeech() called');
    isGenerating = true;
    currentLSD = MAX_LSD;

    if (voiceName && voiceName !== 'custom' && predefinedVoices[voiceName]) {
        currentVoiceEmbedding = predefinedVoices[voiceName];
        currentVoiceName = voiceName;
    }

    if (!currentVoiceEmbedding) {
        throw new Error('No voice selected');
    }

    // Simple text preprocessing
    const processedText = preprocessText(text);

    // Tokenize
    const tokenIds = tokenizerProcessor.encodeIds(processedText);

    // Generate audio
    console.log('[TTS Worker] Starting inference...');
    await runInference(tokenIds);

    if (isGenerating) {
        self.postMessage({ type: 'generation_complete' });
    }

    isGenerating = false;
    console.log('[TTS Worker] generateSpeech() completed');
}

function preprocessText(text) {
    // Basic preprocessing
    text = text.trim();
    if (!text) return '';

    // Ensure ending punctuation
    if (!/[.!?]$/.test(text)) {
        text += '.';
    }

    return text;
}

async function runInference(tokenIds) {
    const { mimiEncoder, textConditioner, flowLmMain, flowLmFlow, mimiDecoder } = sessions;
    if (!ort) {
        throw new Error('ONNX Runtime not initialized');
    }

    // Initialize states
    const emptySeq = new ort.Tensor('float32', new Float32Array(0), [1, 0, 32]);
    const voiceTensor = new ort.Tensor('float32', currentVoiceEmbedding.data, currentVoiceEmbedding.shape);

    // Voice conditioning
    self.postMessage({ type: 'status', data: { status: 'Processing voice...', state: 'generating' } });

    // Initialize flowState
    let flowState = {};

    // CRITICAL FIX: The model requires state_0 through state_17 on EVERY run
    // Initialize them on the first run with appropriate shapes
    console.log('[TTS Worker] Initializing state tensors for first run');

    // Build initial state tensors - ONLY state_0 for now
    // state_1-17 might be optional or have complex initialization requirements
    for (const inputName of flowLmMain.inputNames) {
        if (inputName === 'state_0') {
            // state_0 has shape [2, 1, 1000, 16, 64]
            const shape = [2, 1, 1000, 16, 64];
            const size = shape.reduce((a, b) => a * b, 1);
            flowState[inputName] = new ort.Tensor('float32', new Float32Array(size).fill(0), shape);
        }
        // Don't initialize state_1-17 - let the model handle them or they might be optional
    }

    // Voice conditioning
    const voiceCondInputs = { sequence: emptySeq, text_embeddings: voiceTensor, ...flowState };
    console.log('[TTS Worker] Voice conditioning - inputs:', Object.keys(voiceCondInputs).length);
    let condResult = await flowLmMain.run(voiceCondInputs);
    console.log('[TTS Worker] Voice conditioning - result keys:', Object.keys(condResult));

    // Update flowState with outputs (critical for next runs)
    for (let i = 0; i < flowLmMain.outputNames.length; i++) {
        const name = flowLmMain.outputNames[i];
        if (name.startsWith('out_state_')) {
            const idx = name.replace('out_state_', '');
            flowState['state_' + idx] = condResult[name];
        }
    }

    // Text conditioning
    self.postMessage({ type: 'status', data: { status: 'Processing text...', state: 'generating' } });

    const textInput = new ort.Tensor('int64', BigInt64Array.from(tokenIds.map(x => BigInt(x))), [1, tokenIds.length]);
    const textCondResult = await textConditioner.run({ token_ids: textInput });
    let textEmb = textCondResult[textConditioner.outputNames[0]];

    if (textEmb.dims.length === 2) {
        textEmb = new ort.Tensor('float32', textEmb.data, [1, textEmb.dims[0], textEmb.dims[1]]);
    }

    const emptyTextEmb = new ort.Tensor('float32', new Float32Array(0), [1, 0, 1024]);

    const textCondInputs = { sequence: emptySeq, text_embeddings: textEmb, ...flowState };
    console.log('[TTS Worker] Text conditioning - inputs:', Object.keys(textCondInputs).length);
    const textCondOutput = await flowLmMain.run(textCondInputs);
    console.log('[TTS Worker] Text conditioning - result keys:', Object.keys(textCondOutput));

    // Update flowState from text conditioning
    for (let i = 0; i < flowLmMain.outputNames.length; i++) {
        const name = flowLmMain.outputNames[i];
        if (name.startsWith('out_state_')) {
            const idx = name.replace('out_state_', '');
            flowState['state_' + idx] = textCondOutput[name];
        }
    }

    // AR generation
    self.postMessage({ type: 'status', data: { status: 'Generating audio...', state: 'generating' } });

    const latents = [];
    let currentLatent = new ort.Tensor('float32', new Float32Array(32).fill(NaN), [1, 1, 32]);

    for (let step = 0; step < MAX_FRAMES && isGenerating; step++) {
        const arInputs = { sequence: currentLatent, text_embeddings: emptyTextEmb, ...flowState };

        const arResult = await flowLmMain.run(arInputs);

        const conditioning = arResult['conditioning'];
        const eosLogit = arResult['eos_logit'].data[0];

        // Flow matching
        const TEMP = 0.7;
        const STD = Math.sqrt(TEMP);
        let xData = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            xData[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * STD;
        }

        const lsdSteps = currentLSD;
        const dt = 1.0 / lsdSteps;

        for (let j = 0; j < lsdSteps; j++) {
            const flowInputs = {
                c: conditioning,
                s: stTensors[lsdSteps][j].s,
                t: stTensors[lsdSteps][j].t,
                x: new ort.Tensor('float32', xData, [1, 32])
            };

            const flowResult = await flowLmFlow.run(flowInputs);
            const v = flowResult['flow_dir'].data;

            for (let k = 0; k < 32; k++) {
                xData[k] += v[k] * dt;
            }
        }

        latents.push(new Float32Array(xData));
        currentLatent = new ort.Tensor('float32', xData, [1, 1, 32]);

        // Update flowState from AR step
        for (let i = 0; i < flowLmMain.outputNames.length; i++) {
            const name = flowLmMain.outputNames[i];
            if (name.startsWith('out_state_')) {
                const idx = name.replace('out_state_', '');
                flowState['state_' + idx] = arResult[name];
            }
        }

        // Decode audio every 12 frames
        if (latents.length >= 12 || eosLogit > -4.0) {
            const decodeLatents = new Float32Array(latents.length * 32);
            for (let i = 0; i < latents.length; i++) {
                decodeLatents.set(latents[i], i * 32);
            }

            const latentTensor = new ort.Tensor('float32', decodeLatents, [1, latents.length, 32]);
            const decodeInputs = { latent: latentTensor };

            const decodeResult = await mimiDecoder.run(decodeInputs);
            const audioChunk = decodeResult[mimiDecoder.outputNames[0]].data;

            self.postMessage({
                type: 'audio_chunk',
                data: new Float32Array(audioChunk)
            }, [new Float32Array(audioChunk).buffer]);

            latents.length = 0;
        }

        if (eosLogit > -4.0) {
            console.log('[TTS Worker] EOS detected at step', step);
            break;
        }
    }
}

console.log('[TTS Worker] Loaded');
