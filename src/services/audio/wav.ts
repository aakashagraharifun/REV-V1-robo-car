/**
 * Minimal WAV (RIFF) reader. Handles the files this app deals with: the
 * bundled soundboard clips and the phone's text-to-speech output — PCM 8/16/
 * 24/32-bit or 32-bit float, any channel count. Channels are mixed to mono.
 */

export interface DecodedAudio {
  sampleRate: number;
  /** Mono samples, signed 16-bit range. */
  samples: Int16Array;
}

export class WavFormatError extends Error {
  constructor(detail: string) {
    super(`Unsupported WAV: ${detail}`);
    this.name = 'WavFormatError';
  }
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

export function parseWav(bytes: Uint8Array): DecodedAudio {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new WavFormatError('not a RIFF/WAVE file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  // Walk the chunks: encoders often put LIST/fact chunks before "data".
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE && size >= 26 && body + 26 <= bytes.length) {
        format = view.getUint16(body + 24, true); // first two bytes of the SubFormat GUID
      }
    } else if (id === 'data') {
      dataOffset = body;
      // Streaming writers (some TTS engines) leave the size as 0 or 0xFFFFFFFF.
      dataLength = size === 0 || body + size > bytes.length ? bytes.length - body : size;
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (dataOffset < 0) throw new WavFormatError('no data chunk');
  if (channels < 1 || sampleRate < 1) throw new WavFormatError('missing fmt chunk');
  const isFloat = format === FORMAT_FLOAT && bitsPerSample === 32;
  if (!isFloat && (format !== FORMAT_PCM || ![8, 16, 24, 32].includes(bitsPerSample))) {
    throw new WavFormatError(`format ${format}, ${bitsPerSample}-bit`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const frames = Math.floor(dataLength / frameSize);
  const samples = new Int16Array(frames);

  const read = (at: number): number => {
    if (isFloat) return Math.max(-1, Math.min(1, view.getFloat32(at, true))) * 32767;
    switch (bitsPerSample) {
      case 8:
        return ((bytes[at] ?? 128) - 128) << 8; // 8-bit WAV is unsigned
      case 16:
        return view.getInt16(at, true);
      case 24:
        return ((bytes[at + 2] ?? 0) << 24 | (bytes[at + 1] ?? 0) << 16 | (bytes[at] ?? 0) << 8) >> 16;
      default:
        return view.getInt32(at, true) >> 16;
    }
  };

  for (let frame = 0; frame < frames; frame++) {
    const base = dataOffset + frame * frameSize;
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) sum += read(base + ch * bytesPerSample);
    samples[frame] = Math.round(sum / channels);
  }
  return { sampleRate, samples };
}
