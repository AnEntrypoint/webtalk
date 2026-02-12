const SAMPLE_RATE = 24000;

function resample(data, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const newLen = Math.round(data.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, data.length - 1);
    const frac = idx - lo;
    out[i] = data[lo] * (1 - frac) + data[hi] * frac;
  }
  return out;
}

function encodeWAV(audioBuffer) {
  const totalLen = audioBuffer.reduce((s, b) => s + b.length, 0);
  const merged = new Float32Array(totalLen);
  let off = 0;
  for (const buf of audioBuffer) {
    merged.set(buf, off);
    off += buf.length;
  }

  const wavBuf = new ArrayBuffer(44 + merged.length * 2);
  const view = new DataView(wavBuf);
  const writeStr = (o, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + merged.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, merged.length * 2, true);
  for (let i = 0; i < merged.length; i++) {
    const s = Math.max(-1, Math.min(1, merged[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return wavBuf;
}

export { SAMPLE_RATE, resample, encodeWAV };
