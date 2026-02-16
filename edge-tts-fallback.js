const http = require('http');

let edgeTTS = null;
function getEdgeTTS() {
  if (edgeTTS) return edgeTTS;
  try { edgeTTS = require('edge-tts-universal'); } catch (_) { edgeTTS = null; }
  return edgeTTS;
}

const VOICE_MAP = {
  'default': 'en-US-AriaNeural',
  'bdl': 'en-US-GuyNeural',
  'slt': 'en-US-JennyNeural',
  'clb': 'en-US-MichelleNeural',
  'rms': 'en-US-ChristopherNeural',
  'awb': 'en-GB-RyanNeural',
  'jmk': 'en-CA-LiamNeural',
  'ksp': 'en-IN-PrabhatNeural',
  'alba': 'fr-FR-DeniseNeural',
  'marius': 'fr-FR-HenriNeural',
  'javert': 'fr-FR-HenriNeural',
  'jean': 'fr-FR-HenriNeural',
  'fantine': 'fr-FR-DeniseNeural',
  'cosette': 'fr-FR-DeniseNeural',
  'eponine': 'fr-FR-DeniseNeural',
  'azelma': 'fr-FR-DeniseNeural',
};

function resolveVoice(voiceId) {
  if (!voiceId) return 'en-US-AriaNeural';
  if (voiceId.includes('-') && voiceId.includes('Neural')) return voiceId;
  return VOICE_MAP[voiceId] || 'en-US-AriaNeural';
}

async function available() {
  const mod = getEdgeTTS();
  if (!mod) return false;
  try {
    const voices = await mod.listVoices();
    return voices && voices.length > 0;
  } catch (_) { return false; }
}

async function synthesize(text, voiceId) {
  const mod = getEdgeTTS();
  if (!mod) throw new Error('edge-tts-universal not installed');
  const voice = resolveVoice(voiceId);
  const c = new mod.Communicate(text, voice);
  const chunks = [];
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('edge-tts timeout')), 30000));
  const collect = (async () => {
    for await (const chunk of c.stream()) {
      if (chunk.type === 'audio' && chunk.data) chunks.push(Buffer.from(chunk.data));
    }
  })();
  await Promise.race([collect, timeout]);
  if (!chunks.length) throw new Error('edge-tts returned no audio');
  return Buffer.concat(chunks);
}

async function listVoices() {
  const mod = getEdgeTTS();
  if (!mod) return [];
  try {
    const voices = await mod.listVoices();
    return voices.filter(v => v.Locale && v.Locale.startsWith('en-')).map(v => ({
      id: v.ShortName,
      name: v.FriendlyName.replace(/Microsoft .+ Online \(Natural\) - /, ''),
      gender: v.Gender === 'Female' ? 'female' : 'male',
      accent: v.Locale,
      engine: 'edge-tts',
    }));
  } catch (_) { return []; }
}

module.exports = { synthesize, available, listVoices, resolveVoice };
