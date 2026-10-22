/**
 * WAV decoder — the inverse of `encoder.ts`.
 *
 * Parses a RIFF/WAVE file into the minimal `IAudioBuffer` shape so the DSP
 * layer can work on files without a browser `AudioBuffer`. Pure: no DOM, no
 * Node APIs, no file system.
 *
 * Supports the PCM formats a mastering tool realistically meets:
 *   - 8-bit unsigned PCM
 *   - 16-bit signed PCM
 *   - 24-bit signed PCM
 *   - 32-bit signed PCM
 *   - 32-bit float PCM
 * plus WAVE_FORMAT_EXTENSIBLE (0xFFFE) with 16/24/32-bit PCM or float.
 */

import type { IAudioBuffer } from '../dsp/lufs.js';
import { MutableAudioBuffer } from '../dsp/mastering-chain.js';

export interface DecodedWav {
  buffer: IAudioBuffer;
  /** Bit depth of the source file (8/16/24/32). */
  bitDepth: number;
  /** True when the source was IEEE float PCM. */
  isFloat: boolean;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Decode a WAV file into an `IAudioBuffer`.
 *
 * @param bytes - The complete WAV file contents.
 * @throws if the data is not a RIFF/WAVE file or uses an unsupported codec.
 */
export function decodeWAV(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < 12) {
    throw new Error('Not a WAV file: too short to contain a RIFF header');
  }
  if (readTag(view, 0) !== 'RIFF' || readTag(view, 8) !== 'WAVE') {
    throw new Error('Not a WAV file: missing RIFF/WAVE signature');
  }

  let audioFormat = WAVE_FORMAT_PCM;
  let numChannels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let dataOffset = -1;
  let dataSize = 0;

  // Walk the chunk list: `fmt ` gives the format, `data` holds the samples.
  // Chunks are word-aligned, so an odd-sized chunk is followed by a pad byte.
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readTag(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(body, true);
      numChannels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitDepth = view.getUint16(body + 14, true);

      if (audioFormat === WAVE_FORMAT_EXTENSIBLE) {
        // The real format sits in the extension's GUID prefix.
        if (chunkSize >= 26) {
          audioFormat = view.getUint16(body + 24, true);
        }
      }
    } else if (chunkId === 'data') {
      dataOffset = body;
      dataSize = chunkSize;
    }

    offset = body + chunkSize + (chunkSize % 2);
  }

  if (numChannels === 0 || sampleRate === 0) {
    throw new Error('Not a WAV file: missing or malformed "fmt " chunk');
  }
  if (dataOffset < 0) {
    throw new Error('Not a WAV file: missing "data" chunk');
  }

  const isFloat = audioFormat === WAVE_FORMAT_IEEE_FLOAT;
  if (audioFormat !== WAVE_FORMAT_PCM && !isFloat) {
    throw new Error(
      `Unsupported WAV format (0x${audioFormat.toString(16)}). Only PCM and IEEE float are supported.`
    );
  }
  if (![8, 16, 24, 32].includes(bitDepth)) {
    throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
  }

  const bytesPerSample = bitDepth / 8;
  const frameSize = bytesPerSample * numChannels;
  const frameCount = Math.floor(dataSize / frameSize);
  const out = new MutableAudioBuffer({
    numberOfChannels: numChannels,
    length: frameCount,
    sampleRate,
  });

  for (let ch = 0; ch < numChannels; ch++) {
    const channel = out.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) {
      const at = dataOffset + i * frameSize + ch * bytesPerSample;
      channel[i] = readSample(view, at, bitDepth, isFloat);
    }
  }

  return { buffer: out, bitDepth, isFloat };
}

/** Read one sample and normalise it to [-1, 1]. */
function readSample(
  view: DataView,
  at: number,
  bitDepth: number,
  isFloat: boolean
): number {
  if (isFloat) {
    return view.getFloat32(at, true);
  }
  switch (bitDepth) {
    case 8:
      // 8-bit WAV is unsigned, centred on 128.
      return (view.getUint8(at) - 128) / 128;
    case 16:
      return view.getInt16(at, true) / 32768;
    case 24: {
      const b0 = view.getUint8(at);
      const b1 = view.getUint8(at + 1);
      const b2 = view.getUint8(at + 2);
      let value = (b2 << 16) | (b1 << 8) | b0;
      if (value & 0x800000) value -= 0x1000000;
      return value / 8388608;
    }
    case 32:
      return view.getInt32(at, true) / 2147483648;
    default:
      return 0;
  }
}
