import { EXCITER_DEFAULTS } from './constants.js';
import { interpolateCatmullRom } from './utils.js';
import type { IAudioBuffer } from './lufs.js';

/**
 * Calculate 2nd order Butterworth high-pass filter coefficients
 */
function calcHighPassCoeffs(sampleRate: number, frequency: number) {
  const omega = Math.tan(Math.PI * frequency / sampleRate);
  const omega2 = omega * omega;
  const sqrt2 = Math.SQRT2;
  const n = 1 / (1 + sqrt2 * omega + omega2);

  return {
    b0: n,
    b1: -2 * n,
    b2: n,
    a1: 2 * (omega2 - 1) * n,
    a2: (1 - sqrt2 * omega + omega2) * n
  };
}

/**
 * Apply 2nd order high-pass filter to samples
 */
function applyHighPass(
  samples: Float32Array,
  coeffs: { b0: number; b1: number; b2: number; a1: number; a2: number }
): Float32Array {
  const output = new Float32Array(samples.length);
  const { b0, b1, b2, a1, a2 } = coeffs;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = Math.abs(y0) < 1e-25 ? 0 : y0; // Denormal prevention

    output[i] = y1;
  }

  return output;
}

/**
 * Exciter class
 */
export class Exciter {
  hpfFreq: number;
  hpfSlope: number;
  drive: number;
  bias: number;
  mix: number;
  oversample: boolean;

  constructor(options: {
    hpfFreq?: number;
    hpfSlope?: number;
    drive?: number;
    bias?: number;
    mix?: number;
    oversample?: boolean;
  } = {}) {
    this.hpfFreq = options.hpfFreq ?? EXCITER_DEFAULTS.hpfFreq;
    this.hpfSlope = options.hpfSlope ?? EXCITER_DEFAULTS.hpfSlope;
    this.drive = options.drive ?? EXCITER_DEFAULTS.drive;
    this.bias = options.bias ?? EXCITER_DEFAULTS.bias;
    this.mix = options.mix ?? EXCITER_DEFAULTS.mix;
    this.oversample = options.oversample ?? true;
  }

  process(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

    let output: IAudioBuffer;
    if (typeof AudioBuffer !== 'undefined') {
      output = new AudioBuffer({
        numberOfChannels: numChannels,
        length: length,
        sampleRate: sampleRate
      });
    } else {
      const data = Array.from({ length: numChannels }, () => new Float32Array(length));
      output = {
        sampleRate: sampleRate,
        numberOfChannels: numChannels,
        length: length,
        duration: length / sampleRate,
        getChannelData: (ch: number) => data[ch]
      };
    }

    const hpfCoeffs = calcHighPassCoeffs(sampleRate, this.hpfFreq);
    const mixRatio = this.mix / 100;
    const drive = this.drive;
    const bias = this.bias;

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const out = output.getChannelData(ch);

      let filtered = applyHighPass(input, hpfCoeffs);

      if (this.hpfSlope === 12) {
        filtered = applyHighPass(filtered, hpfCoeffs);
      }

      if (onProgress) onProgress((ch + 0.5) / numChannels);

      if (this.oversample) {
        for (let i = 0; i < input.length; i++) {
          const dry = input[i];

          const p1 = filtered[i - 1] || 0;
          const p2 = filtered[i];
          const p3 = filtered[i + 1] || 0;
          const p4 = filtered[i + 2] || 0;

          const wetA = Math.tanh(p2 * drive + bias);

          const sB = interpolateCatmullRom(p1, p2, p3, p4, 0.5);
          const wetB = Math.tanh(sB * drive + bias);

          const wet = (wetA + wetB) * 0.5;

          out[i] = dry + wet * mixRatio;
        }
      } else {
        for (let i = 0; i < input.length; i++) {
          const dry = input[i];
          const wet = Math.tanh(filtered[i] * drive + bias);
          out[i] = dry + wet * mixRatio;
        }
      }

      if (onProgress) onProgress((ch + 1) / numChannels);
    }

    return output;
  }
}

/**
 * Apply exciter with default settings (Add Air replacement)
 */
export function applyExciter(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  const exciter = new Exciter();
  return exciter.process(buffer, onProgress);
}

/**
 * Apply exciter with custom settings
 */
export function applyExciterWithOptions(
  buffer: IAudioBuffer,
  options: {
    hpfFreq?: number;
    hpfSlope?: number;
    drive?: number;
    bias?: number;
    mix?: number;
    oversample?: boolean;
  },
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const exciter = new Exciter(options);
  return exciter.process(buffer, onProgress);
}
