const serverSTT = require('./server-stt');
const serverTTS = require('./server-tts-onnx');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('error', reject);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
  });
}

function collectRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * Creates a request handler for speech API routes.
 * Mount this in your server's request handling chain.
 *
 * Options:
 *   prefix: string - URL prefix for routes (default: '/api')
 *   voiceDirs: string[] - extra directories to scan for voice files
 *   sttOptions: object - options passed to STT (e.g. { cacheDir })
 *
 * Routes handled:
 *   POST {prefix}/stt - speech-to-text (raw audio body)
 *   POST {prefix}/tts - text-to-speech (JSON body: { text, voiceId })
 *   POST {prefix}/tts-stream - streaming TTS (JSON body: { text, voiceId })
 *   GET  {prefix}/voices - list available voices
 *   GET  {prefix}/speech-status - STT/TTS status
 */
function createSpeechHandler(options) {
  const prefix = (options && options.prefix) || '/api';
  const voiceDirs = options && options.voiceDirs;
  const sttOptions = options && options.sttOptions;

  return async function handleSpeechRoute(req, res) {
    const pathOnly = req.url.split('?')[0];

    if (pathOnly === prefix + '/stt' && req.method === 'POST') {
      try {
        const audioBuffer = await collectRawBody(req);
        if (audioBuffer.length === 0) {
          sendJSON(res, 400, { error: 'No audio data' });
          return true;
        }
        const text = await serverSTT.transcribe(audioBuffer, sttOptions);
        sendJSON(res, 200, { text: (text || '').trim() });
      } catch (err) {
        if (!res.headersSent) sendJSON(res, 500, { error: err.message || 'STT failed' });
      }
      return true;
    }

    if (pathOnly === prefix + '/voices' && req.method === 'GET') {
      sendJSON(res, 200, { ok: true, voices: serverTTS.getVoices(voiceDirs) });
      return true;
    }

    if (pathOnly === prefix + '/tts' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const text = body.text || '';
        const voiceId = body.voiceId || null;
        if (!text) {
          sendJSON(res, 400, { error: 'No text provided' });
          return true;
        }
        const status = serverTTS.getStatus();
        if (!status.ready) {
          sendJSON(res, 503, { error: status.lastError || 'TTS not ready', retryable: false });
          return true;
        }
        const wavBuffer = await serverTTS.synthesize(text, voiceId, voiceDirs);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wavBuffer.length });
        res.end(wavBuffer);
      } catch (err) {
        const isModelError = /model.*load|pipeline.*failed|failed to load/i.test(err.message);
        const statusCode = isModelError ? 503 : 500;
        if (!res.headersSent) sendJSON(res, statusCode, { error: err.message || 'TTS failed', retryable: !isModelError });
      }
      return true;
    }

    if (pathOnly === prefix + '/tts-stream' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const text = body.text || '';
        const voiceId = body.voiceId || null;
        if (!text) {
          sendJSON(res, 400, { error: 'No text provided' });
          return true;
        }
        const status = serverTTS.getStatus();
        if (!status.ready) {
          sendJSON(res, 503, { error: status.lastError || 'TTS not ready', retryable: false });
          return true;
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Transfer-Encoding': 'chunked',
          'X-Content-Type': 'audio/wav-stream',
          'Cache-Control': 'no-cache'
        });
        for await (const wavChunk of serverTTS.synthesizeStream(text, voiceId, voiceDirs)) {
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32BE(wavChunk.length, 0);
          res.write(lenBuf);
          res.write(wavChunk);
        }
        res.end();
      } catch (err) {
        const isModelError = /model.*load|pipeline.*failed|failed to load/i.test(err.message);
        const statusCode = isModelError ? 503 : 500;
        if (!res.headersSent) sendJSON(res, statusCode, { error: err.message || 'TTS stream failed', retryable: !isModelError });
        else res.end();
      }
      return true;
    }

    if (pathOnly === prefix + '/speech-status' && req.method === 'GET') {
      const sttStatus = serverSTT.getStatus();
      const ttsStatus = serverTTS.getStatus();
      sendJSON(res, 200, {
        sttReady: sttStatus.ready,
        ttsReady: ttsStatus.ready,
        sttLoading: sttStatus.loading,
        ttsLoading: false,
        sttError: sttStatus.error,
        ttsError: ttsStatus.ready ? null : (ttsStatus.lastError || 'pocket-tts not running'),
        pocketTts: ttsStatus,
      });
      return true;
    }

    return false;
  };
}

module.exports = { createSpeechHandler };
