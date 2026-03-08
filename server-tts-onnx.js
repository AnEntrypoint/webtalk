const fs = require('fs');
const path = require('path');
const os = require('os');

function buildTTSProviders() {
  const override = process.env.WEBTALK_TTS_PROVIDERS;
  if (override) return override.split(',').map(s => s.trim());
  const p = os.platform();
  const a = os.arch();
  const list = ['cuda'];
  if (p === 'darwin' && a === 'arm64') list.push('coreml');
  if (p === 'win32') list.push('dml');
  list.push('cpu');
  return list;
}

let ort = null;

// Configuration
const SAMPLE_RATE = 24000;
const SAMPLES_PER_FRAME = 1920;
const MAX_FRAMES = 500;
const MAX_LSD = 10;
const CHUNK_TARGET_TOKENS = 50;
const FRAMES_AFTER_EOS = 3;
const TEMP = 0.7;

// State
let sessions = null;
let tokenizerProcessor = null;
let stTensors = {};
let isReady = false;

// Hardcoded state shapes
const FLOW_LM_STATE_SHAPES = {
  state_0: { shape: [2, 1, 1000, 16, 64], dtype: 'float32' },
  state_1: { shape: [0], dtype: 'float32' },
  state_2: { shape: [1], dtype: 'int64' },
  state_3: { shape: [2, 1, 1000, 16, 64], dtype: 'float32' },
  state_4: { shape: [0], dtype: 'float32' },
  state_5: { shape: [1], dtype: 'int64' },
  state_6: { shape: [2, 1, 1000, 16, 64], dtype: 'float32' },
  state_7: { shape: [0], dtype: 'float32' },
  state_8: { shape: [1], dtype: 'int64' },
  state_9: { shape: [2, 1, 1000, 16, 64], dtype: 'float32' },
  state_10: { shape: [0], dtype: 'float32' },
  state_11: { shape: [1], dtype: 'int64' },
  state_12: { shape: [2, 1, 1000, 16, 64], dtype: 'float32' },
  state_13: { shape: [0], dtype: 'float32' },
  state_14: { shape: [1], dtype: 'int64' },
  state_15: { shape: [2, 1, 1000, 16, 64], dtype: 'float32' },
  state_16: { shape: [0], dtype: 'float32' },
  state_17: { shape: [1], dtype: 'int64' },
};

const MIMI_DECODER_STATE_SHAPES = {
  state_0: { shape: [1], dtype: 'bool' },
  state_1: { shape: [1, 512, 6], dtype: 'float32' },
  state_2: { shape: [1], dtype: 'bool' },
  state_3: { shape: [1, 64, 2], dtype: 'float32' },
  state_4: { shape: [1, 256, 6], dtype: 'float32' },
  state_5: { shape: [1], dtype: 'bool' },
  state_6: { shape: [1, 256, 2], dtype: 'float32' },
  state_7: { shape: [1], dtype: 'bool' },
  state_8: { shape: [1, 128, 0], dtype: 'float32' },
  state_9: { shape: [1, 128, 5], dtype: 'float32' },
  state_10: { shape: [1], dtype: 'bool' },
  state_11: { shape: [1, 128, 2], dtype: 'float32' },
  state_12: { shape: [1], dtype: 'bool' },
  state_13: { shape: [1, 64, 0], dtype: 'float32' },
  state_14: { shape: [1, 64, 4], dtype: 'float32' },
  state_15: { shape: [1], dtype: 'bool' },
  state_16: { shape: [1, 64, 2], dtype: 'float32' },
  state_17: { shape: [1], dtype: 'bool' },
  state_18: { shape: [1, 32, 0], dtype: 'float32' },
  state_19: { shape: [2, 1, 8, 1000, 64], dtype: 'float32' },
  state_20: { shape: [1], dtype: 'int64' },
  state_21: { shape: [1], dtype: 'int64' },
  state_22: { shape: [2, 1, 8, 1000, 64], dtype: 'float32' },
  state_23: { shape: [1], dtype: 'int64' },
  state_24: { shape: [1], dtype: 'int64' },
  state_25: { shape: [1], dtype: 'bool' },
  state_26: { shape: [1, 512, 16], dtype: 'float32' },
  state_27: { shape: [1], dtype: 'bool' },
  state_28: { shape: [1, 1, 6], dtype: 'float32' },
  state_29: { shape: [1], dtype: 'bool' },
  state_30: { shape: [1, 64, 2], dtype: 'float32' },
  state_31: { shape: [1], dtype: 'bool' },
  state_32: { shape: [1, 32, 0], dtype: 'float32' },
  state_33: { shape: [1], dtype: 'bool' },
  state_34: { shape: [1, 512, 2], dtype: 'float32' },
  state_35: { shape: [1], dtype: 'bool' },
  state_36: { shape: [1, 64, 4], dtype: 'float32' },
  state_37: { shape: [1], dtype: 'bool' },
  state_38: { shape: [1, 128, 2], dtype: 'float32' },
  state_39: { shape: [1], dtype: 'bool' },
  state_40: { shape: [1, 64, 0], dtype: 'float32' },
  state_41: { shape: [1], dtype: 'bool' },
  state_42: { shape: [1, 128, 5], dtype: 'float32' },
  state_43: { shape: [1], dtype: 'bool' },
  state_44: { shape: [1, 256, 2], dtype: 'float32' },
  state_45: { shape: [1], dtype: 'bool' },
  state_46: { shape: [1, 128, 0], dtype: 'float32' },
  state_47: { shape: [1], dtype: 'bool' },
  state_48: { shape: [1, 256, 6], dtype: 'float32' },
  state_49: { shape: [2, 1, 8, 1000, 64], dtype: 'float32' },
  state_50: { shape: [1], dtype: 'int64' },
  state_51: { shape: [1], dtype: 'int64' },
  state_52: { shape: [2, 1, 8, 1000, 64], dtype: 'float32' },
  state_53: { shape: [1], dtype: 'int64' },
  state_54: { shape: [1], dtype: 'int64' },
  state_55: { shape: [1, 512, 16], dtype: 'float32' },
};

async function loadModels(modelDir) {
  if (isReady) return;

  try {
    ort = require('onnxruntime-node');
  } catch (err) {
    throw new Error('onnxruntime-node not installed. Run: npm install onnxruntime-node');
  }

  const modelPaths = {
    mimiEncoder: path.join(modelDir, 'mimi_encoder.onnx'),
    textConditioner: path.join(modelDir, 'text_conditioner.onnx'),
    flowLmMain: path.join(modelDir, 'flow_lm_main_int8.onnx'),
    flowLmFlow: path.join(modelDir, 'flow_lm_flow_int8.onnx'),
    mimiDecoder: path.join(modelDir, 'mimi_decoder_int8.onnx'),
    tokenizer: path.join(modelDir, 'tokenizer.model'),
  };

  // Check if models exist
  for (const [name, filepath] of Object.entries(modelPaths)) {
    if (!fs.existsSync(filepath)) {
      throw new Error(`Model not found: ${filepath}`);
    }
  }

  const sessionOptions = {
    executionProviders: buildTTSProviders(),
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    enableMemPattern: true,
  };
  console.log('[TTS] Using execution providers:', sessionOptions.executionProviders);

  console.log('[TTS] Loading ONNX models...');

  // Load all models in parallel
  const [mimiEncoder, textConditioner, flowLmMain, flowLmFlow, mimiDecoder] = await Promise.all([
    ort.InferenceSession.create(modelPaths.mimiEncoder, sessionOptions),
    ort.InferenceSession.create(modelPaths.textConditioner, sessionOptions),
    ort.InferenceSession.create(modelPaths.flowLmMain, sessionOptions),
    ort.InferenceSession.create(modelPaths.flowLmFlow, sessionOptions),
    ort.InferenceSession.create(modelPaths.mimiDecoder, sessionOptions),
  ]);

  sessions = {
    mimiEncoder,
    textConditioner,
    flowLmMain,
    flowLmFlow,
    mimiDecoder,
  };

  // Load tokenizer
  const tokenizerBuffer = fs.readFileSync(modelPaths.tokenizer);

  // Import sentencepiece for Node.js (ESM module, use dynamic import)
  const { SentencePieceProcessor } = await import('@sctg/sentencepiece-js');
  tokenizerProcessor = new SentencePieceProcessor();
  await tokenizerProcessor.loadFromB64StringModel(tokenizerBuffer.toString('base64'));

  // Pre-allocate st tensors
  for (let lsd = 1; lsd <= MAX_LSD; lsd++) {
    stTensors[lsd] = [];
    const dt = 1.0 / lsd;
    for (let j = 0; j < lsd; j++) {
      const s = j / lsd;
      const t = s + dt;
      stTensors[lsd].push({
        s: new ort.Tensor('float32', new Float32Array([s]), [1, 1]),
        t: new ort.Tensor('float32', new Float32Array([t]), [1, 1]),
      });
    }
  }

  isReady = true;
  console.log('[TTS] Models loaded successfully');
}

function initState(session, stateShapes) {
  const state = {};

  for (const inputName of session.inputNames) {
    if (inputName.startsWith('state_')) {
      const stateInfo = stateShapes[inputName];
      if (!stateInfo) continue;

      const { shape, dtype } = stateInfo;
      const isDynamic = shape.some(d => d === 0);

      if (isDynamic) {
        const emptyShape = shape.map(d => d === 0 ? 0 : d);
        state[inputName] = dtype === 'int64'
          ? new ort.Tensor('int64', new BigInt64Array(0), emptyShape)
          : dtype === 'bool'
            ? new ort.Tensor('bool', new Uint8Array(0), emptyShape)
            : new ort.Tensor('float32', new Float32Array(0), emptyShape);
      } else {
        const size = shape.reduce((a, b) => a * b, 1);
        state[inputName] = dtype === 'int64'
          ? new ort.Tensor('int64', new BigInt64Array(size), shape)
          : dtype === 'bool'
            ? new ort.Tensor('bool', new Uint8Array(size), shape)
            : new ort.Tensor('float32', new Float32Array(size), shape);
      }
    }
  }

  return state;
}

async function encodeVoiceAudio(audioData) {
  const input = new ort.Tensor('float32', audioData, [1, 1, audioData.length]);
  const outputs = await sessions.mimiEncoder.run({ audio: input });
  const embeddings = outputs[sessions.mimiEncoder.outputNames[0]];
  return {
    data: new Float32Array(embeddings.data),
    shape: embeddings.dims,
  };
}

function prepareText(text) {
  // Basic text normalization
  text = text.trim();
  if (!text) return '';

  // Convert to ASCII
  text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Basic normalization
  text = text.replace(/\s+/g, ' ');

  // Ensure proper punctuation
  if (text && !text.match(/[.!?]$/)) {
    text = text + '.';
  }

  return text;
}

function splitTextIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map(s => s.trim()).filter(Boolean);
}

async function synthesize(text, voiceEmbedding, modelDir) {
  if (!isReady) {
    await loadModels(modelDir);
  }

  const preparedText = prepareText(text);
  if (!preparedText) {
    throw new Error('No text to synthesize');
  }

  const sentences = splitTextIntoSentences(preparedText);
  console.log(`[TTS] Processing ${sentences.length} sentence(s)`);

  const allAudioChunks = [];

  for (const sentence of sentences) {
    const audio = await generateSentence(sentence, voiceEmbedding);
    if (audio && audio.length > 0) {
      allAudioChunks.push(audio);
    }
  }

  // Concatenate all audio chunks
  const totalLength = allAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combinedAudio = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of allAudioChunks) {
    combinedAudio.set(chunk, offset);
    offset += chunk.length;
  }

  return combinedAudio;
}

async function generateSentence(text, voiceEmbedding) {
  const { mimiEncoder, textConditioner, flowLmMain, flowLmFlow, mimiDecoder } = sessions;

  // Initialize states
  let mimiState = initState(mimiDecoder, MIMI_DECODER_STATE_SHAPES);
  let flowLmState = initState(flowLmMain, FLOW_LM_STATE_SHAPES);

  const emptySeq = new ort.Tensor('float32', new Float32Array(0), [1, 0, 32]);
  const emptyTextEmb = new ort.Tensor('float32', new Float32Array(0), [1, 0, 1024]);

  // Voice conditioning
  const voiceTensor = new ort.Tensor('float32', voiceEmbedding.data, voiceEmbedding.shape);
  const voiceCondResult = await flowLmMain.run({
    sequence: emptySeq,
    text_embeddings: voiceTensor,
    ...flowLmState,
  });

  for (let i = 2; i < flowLmMain.outputNames.length; i++) {
    const outputName = flowLmMain.outputNames[i];
    if (outputName.startsWith('out_state_')) {
      const stateIdx = parseInt(outputName.replace('out_state_', ''));
      flowLmState[`state_${stateIdx}`] = voiceCondResult[outputName];
    }
  }

  // Tokenize
  const tokenIds = tokenizerProcessor.encodeIds(text);

  // Text conditioning
  const textInput = new ort.Tensor('int64', BigInt64Array.from(tokenIds.map(x => BigInt(x))), [1, tokenIds.length]);
  const textCondResult = await textConditioner.run({ token_ids: textInput });
  let textEmb = textCondResult[textConditioner.outputNames[0]];

  if (textEmb.dims.length === 2) {
    textEmb = new ort.Tensor('float32', textEmb.data, [1, textEmb.dims[0], textEmb.dims[1]]);
  }

  const textCondInputs = {
    sequence: emptySeq,
    text_embeddings: textEmb,
    ...flowLmState,
  };

  const condResult = await flowLmMain.run(textCondInputs);

  for (let i = 2; i < flowLmMain.outputNames.length; i++) {
    const outputName = flowLmMain.outputNames[i];
    if (outputName.startsWith('out_state_')) {
      const stateIdx = parseInt(outputName.replace('out_state_', ''));
      flowLmState[`state_${stateIdx}`] = condResult[outputName];
    }
  }

  // AR generation
  const latents = [];
  const currentLatent = new ort.Tensor('float32', new Float32Array(32).fill(NaN), [1, 1, 32]);
  let eosStep = null;

  for (let step = 0; step < MAX_FRAMES; step++) {
    const arInputs = {
      sequence: currentLatent,
      text_embeddings: emptyTextEmb,
      ...flowLmState,
    };

    const arResult = await flowLmMain.run(arInputs);
    const conditioning = arResult['conditioning'];
    const eosLogit = arResult['eos_logit'].data[0];
    const isEos = eosLogit > -4.0;

    if (isEos && eosStep === null) {
      eosStep = step;
    }

    const shouldStop = eosStep !== null && step >= eosStep + FRAMES_AFTER_EOS;

    // Flow matching
    const STD = Math.sqrt(TEMP);
    const xData = new Float32Array(32);
    for (let i = 0; i < 32; i++) {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      xData[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * STD;
    }

    const lsdSteps = MAX_LSD;
    const dt = 1.0 / lsdSteps;

    for (let j = 0; j < lsdSteps; j++) {
      const flowInputs = {
        c: conditioning,
        s: stTensors[lsdSteps][j].s,
        t: stTensors[lsdSteps][j].t,
        x: new ort.Tensor('float32', xData, [1, 32]),
      };

      const flowResult = await flowLmFlow.run(flowInputs);
      const v = flowResult['flow_dir'].data;

      for (let k = 0; k < 32; k++) {
        xData[k] += v[k] * dt;
      }
    }

    latents.push(new Float32Array(xData));

    // Update state
    currentLatent.data.set(xData);
    for (let i = 2; i < flowLmMain.outputNames.length; i++) {
      const outputName = flowLmMain.outputNames[i];
      if (outputName.startsWith('out_state_')) {
        const stateIdx = parseInt(outputName.replace('out_state_', ''));
        flowLmState[`state_${stateIdx}`] = arResult[outputName];
      }
    }

    if (shouldStop) break;
  }

  // Decode latents to audio
  const audioChunks = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < latents.length; i += BATCH_SIZE) {
    const batchLen = Math.min(BATCH_SIZE, latents.length - i);
    const latentData = new Float32Array(batchLen * 32);
    for (let j = 0; j < batchLen; j++) {
      latentData.set(latents[i + j], j * 32);
    }

    const latentTensor = new ort.Tensor('float32', latentData, [1, batchLen, 32]);
    const decResult = await mimiDecoder.run({ latent: latentTensor, ...mimiState });
    audioChunks.push(new Float32Array(decResult[mimiDecoder.outputNames[0]].data));

    // Update mimi state
    for (let k = 1; k < mimiDecoder.outputNames.length; k++) {
      const outputName = mimiDecoder.outputNames[k];
      if (outputName.startsWith('state_') || outputName.startsWith('out_state_')) {
        mimiState[outputName.replace('out_', '')] = decResult[outputName];
      }
    }
  }

  // Concatenate audio chunks
  const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combinedAudio = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of audioChunks) {
    combinedAudio.set(chunk, offset);
    offset += chunk.length;
  }

  return combinedAudio;
}

module.exports = {
  loadModels,
  synthesize,
  encodeVoiceAudio,
  isReady: () => isReady,
};
