import { describe, expect, it } from 'vitest';
import { decodeWAV } from './wav-decoder.js';
import { encodeWAV } from './encoder.js';
import { MutableAudioBuffer } from '../dsp/mastering-chain.js';

function makeBuffer(bitDepth: 16 | 24 | 32, channels = 2, frames = 512, sampleRate = 44100) {
  const buf = new MutableAudioBuffer({ numberOfChannels: channels, length: frames, sampleRate });
  for (let ch = 0; ch < channels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < frames; i++) {
      d[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5 - ch * 0.1;
    }
  }
  return buf;
}

describe('decodeWAV', () => {
  it('round-trips a 16-bit WAV', () => {
    const source = makeBuffer(16);
    // Dither off: this test is about the decoder, not the encoder's noise.
    const decoded = decodeWAV(encodeWAV(source, 44100, 16, { ditherMode: 'none' }));

    expect(decoded.bitDepth).toBe(16);
    expect(decoded.buffer.sampleRate).toBe(44100);
    expect(decoded.buffer.numberOfChannels).toBe(2);
    expect(decoded.buffer.length).toBe(512);

    const original = source.getChannelData(0);
    const round = decoded.buffer.getChannelData(0);
    for (let i = 0; i < original.length; i++) {
      // The encoder scales by 32767 and the decoder divides by 32768, so the
      // round trip drifts by at most one quantisation step (1/32768) on top
      // of the rounding error.
      expect(Math.abs(round[i] - original[i])).toBeLessThan(2 / 32768);
    }
  });

  it('round-trips a 24-bit WAV', () => {
    const source = makeBuffer(24);
    const decoded = decodeWAV(encodeWAV(source, 48000, 24));

    expect(decoded.bitDepth).toBe(24);
    expect(decoded.buffer.sampleRate).toBe(48000);

    const original = source.getChannelData(1);
    const round = decoded.buffer.getChannelData(1);
    for (let i = 0; i < original.length; i++) {
      // Same one-step drift as 16-bit (8388607 vs 8388608).
      expect(Math.abs(round[i] - original[i])).toBeLessThan(2 / 8388608);
    }
  });

  it('decodes a mono file', () => {
    const source = makeBuffer(16, 1);
    const decoded = decodeWAV(encodeWAV(source, 44100, 16, { ditherMode: 'none' }));

    expect(decoded.buffer.numberOfChannels).toBe(1);
    expect(decoded.buffer.length).toBe(512);
  });

  it('rejects data that is not a RIFF/WAVE file', () => {
    expect(() => decodeWAV(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(
      /missing RIFF\/WAVE/
    );
  });

  it('rejects a file that is too short to hold a header', () => {
    expect(() => decodeWAV(new Uint8Array([1, 2, 3]))).toThrow(/too short/);
  });

  it('rejects a WAV with an unsupported codec', () => {
    // Rewrite the format tag of a valid WAV to an unsupported codec id.
    const bytes = encodeWAV(makeBuffer(16), 44100, 16);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(20, 0x0011, true); // IMA ADPCM
    expect(() => decodeWAV(bytes)).toThrow(/Unsupported WAV format/);
  });

  it('rejects a WAV with an unsupported bit depth', () => {
    const bytes = encodeWAV(makeBuffer(16), 44100, 16);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(34, 12, true);
    expect(() => decodeWAV(bytes)).toThrow(/Unsupported WAV bit depth/);
  });
});
