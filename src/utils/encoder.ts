/**
 * Audio Encoder Module
 * WAV encoding utilities
 */

import type { IAudioBuffer } from '../dsp/lufs.js';

const DITHER_BUFFER_SIZE = 256;
const ditherBuffer = new Float32Array(DITHER_BUFFER_SIZE);
for (let i = 0; i < DITHER_BUFFER_SIZE; i++) {
  ditherBuffer[i] = (Math.random() + Math.random()) - 1;
}
let ditherIndex = 0;
const NOISE_SHAPING_COEFF = 0.85;

function triangularDither(): number {
  // TPDF in integer (LSB) domain: [-1, 1]
  const dither = ditherBuffer[ditherIndex];
  ditherIndex += 1;
  if (ditherIndex >= DITHER_BUFFER_SIZE) {
    for (let i = 0; i < DITHER_BUFFER_SIZE; i++) {
      ditherBuffer[i] = (Math.random() + Math.random()) - 1;
    }
    ditherIndex = 0;
  }
  return dither;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveDitherMode(requestedMode?: string, safeBitDepth?: number): 'tpdf' | 'noise-shaped' | 'none' {
  if (safeBitDepth !== 16) return 'none';
  if (requestedMode === 'none') return 'none';
  // Accept legacy aliases used by older MasteringSettings.
  if (requestedMode === 'noise-shaped' || requestedMode === 'shaped') return 'noise-shaped';
  // triangular / tpdf / default
  return 'tpdf';
}

export interface EncodeWAVOptions {
  ditherMode?: 'tpdf' | 'noise-shaped' | 'none';
}

/**
 * Encode an AudioBuffer or custom interface to WAV format (supports 16-bit and 24-bit)
 * @param audioBuffer - Source audio buffer
 * @param targetSampleRate - Target sample rate
 * @param bitDepth - Bit depth (16 or 24)
 * @param options - Encoding options
 * @returns WAV file data
 */
export function encodeWAV(
  audioBuffer: IAudioBuffer,
  targetSampleRate: number | null,
  bitDepth: number,
  options: EncodeWAVOptions = {}
): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const safeBitDepth = bitDepth === 24 ? 24 : 16;
  const sampleRate = targetSampleRate || audioBuffer.sampleRate;
  const bytesPerSample = safeBitDepth / 8;
  const ditherMode = resolveDitherMode(options?.ditherMode, safeBitDepth);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  const numSamples = channelData[0].length;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, safeBitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  const maxVal = safeBitDepth === 16 ? 32767 : 8388607;
  const noiseShapeError = ditherMode === 'noise-shaped' ? new Float32Array(numChannels) : null;

  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const scaled = sample * maxVal;

      if (safeBitDepth === 16) {
        let quantizeInput = scaled;
        if (ditherMode === 'noise-shaped' && noiseShapeError) {
          quantizeInput += noiseShapeError[ch];
        }
        if (ditherMode !== 'none') {
          quantizeInput += triangularDither();
        }

        const intSample = Math.round(quantizeInput);
        const clampedSample = clamp(intSample, -32768, 32767);
        view.setInt16(offset, clampedSample, true);

        if (ditherMode === 'noise-shaped' && noiseShapeError) {
          const quantError = quantizeInput - clampedSample;
          noiseShapeError[ch] = clamp(quantError * NOISE_SHAPING_COEFF, -2, 2);
        }

        offset += 2;
      } else {
        const intSample = Math.round(scaled);
        const clampedSample = clamp(intSample, -8388607, 8388607);
        view.setUint8(offset, clampedSample & 0xFF);
        view.setUint8(offset + 1, (clampedSample >> 8) & 0xFF);
        view.setUint8(offset + 2, (clampedSample >> 16) & 0xFF);
        offset += 3;
      }
    }
  }

  return new Uint8Array(buffer);
}

export interface EncodeWAVAsyncOptions extends EncodeWAVOptions {
  onProgress?: (progress: number) => void;
  shouldCancel?: () => boolean;
  chunkSize?: number;
}

/**
 * Async WAV encoder with progress + yielding so the UI can repaint.
 * @param audioBuffer - Source audio buffer
 * @param targetSampleRate - Target sample rate (header value)
 * @param bitDepth - Bit depth (16 or 24)
 * @param options - Async encoding options
 * @returns Promise resolving to WAV file data array
 */
export async function encodeWAVAsync(
  audioBuffer: IAudioBuffer,
  targetSampleRate: number | null,
  bitDepth: number,
  options: EncodeWAVAsyncOptions = {}
): Promise<Uint8Array> {
  const {
    onProgress = null,
    shouldCancel = null,
    chunkSize = 65536,
    ditherMode: requestedDitherMode = 'tpdf'
  } = options || {};

  const safeBitDepth = bitDepth === 24 ? 24 : 16;
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = targetSampleRate || audioBuffer.sampleRate;
  const bytesPerSample = safeBitDepth / 8;
  const ditherMode = resolveDitherMode(requestedDitherMode, safeBitDepth);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  const numSamples = channelData[0].length;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, safeBitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const maxVal = safeBitDepth === 16 ? 32767 : 8388607;
  let offset = 44;
  const safeChunkSize = Math.max(1024, Number(chunkSize) || 65536);
  const noiseShapeError = ditherMode === 'noise-shaped' ? new Float32Array(numChannels) : null;

  const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  for (let i = 0; i < numSamples; i += safeChunkSize) {
    if (shouldCancel && shouldCancel()) {
      throw new Error('Cancelled');
    }

    const end = Math.min(i + safeChunkSize, numSamples);

    for (let s = i; s < end; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channelData[ch][s]));
        const scaled = sample * maxVal;

        if (safeBitDepth === 16) {
          let quantizeInput = scaled;
          if (ditherMode === 'noise-shaped' && noiseShapeError) {
            quantizeInput += noiseShapeError[ch];
          }
          if (ditherMode !== 'none') {
            quantizeInput += triangularDither();
          }

          const intSample = Math.round(quantizeInput);
          const clampedSample = clamp(intSample, -32768, 32767);
          view.setInt16(offset, clampedSample, true);

          if (ditherMode === 'noise-shaped' && noiseShapeError) {
            const quantError = quantizeInput - clampedSample;
            noiseShapeError[ch] = clamp(quantError * NOISE_SHAPING_COEFF, -2, 2);
          }

          offset += 2;
        } else {
          const intSample = Math.round(scaled);
          const clampedSample = clamp(intSample, -8388607, 8388607);
          view.setUint8(offset, clampedSample & 0xFF);
          view.setUint8(offset + 1, (clampedSample >> 8) & 0xFF);
          view.setUint8(offset + 2, (clampedSample >> 16) & 0xFF);
          offset += 3;
        }
      }
    }

    if (onProgress) onProgress(end / numSamples);
    if (end < numSamples) {
      await yieldToUI();
    }
  }

  if (onProgress) onProgress(1);
  return new Uint8Array(buffer);
}

/**
 * Convert AudioBuffer or custom interface to WAV Blob (16-bit)
 * @param buffer - Source audio buffer
 * @returns WAV blob
 */
export function audioBufferToBlob(buffer: IAudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = Math.round(sample * 32767);
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
