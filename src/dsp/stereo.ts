import { dbToLinear } from './utils.js';
import type { IAudioBuffer } from './lufs.js';

/**
 * Default stereo processing settings
 */
export const STEREO_DEFAULTS = {
  WIDTH: 1.0,           // 0 = mono, 1 = normal, 2 = extra wide
  BASS_MONO: true,      // Enable bass mono
  BASS_FREQ: 200,       // Frequency below which to mono
  BALANCE: 0.0,         // -1 = left, 0 = center, 1 = right
  MID_GAIN: 0,          // Mid channel gain in dB
  SIDE_GAIN: 0,         // Side channel gain in dB
};

/**
 * Stereo width presets
 */
export const STEREO_PRESETS: Record<string, { width: number; bassMono: boolean; bassFreq: number }> = {
  mono: { width: 0, bassMono: false, bassFreq: 200 },
  narrow: { width: 0.5, bassMono: true, bassFreq: 200 },
  normal: { width: 1.0, bassMono: true, bassFreq: 200 },
  wide: { width: 1.3, bassMono: true, bassFreq: 150 },
  extraWide: { width: 1.6, bassMono: true, bassFreq: 120 },
  superWide: { width: 2.0, bassMono: true, bassFreq: 100 },
};

/**
 * Simple highpass filter coefficients
 */
function calcHighpassCoeffs(sampleRate: number, frequency: number) {
  const omega = 2 * Math.PI * frequency / sampleRate;
  const cos = Math.cos(omega);
  const sin = Math.sin(omega);
  const alpha = sin / (2 * 0.7071);

  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0
  };
}

/**
 * Apply biquad filter
 */
function applyFilter(samples: Float32Array, coeffs: { b0: number; b1: number; b2: number; a1: number; a2: number }): Float32Array {
  const output = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  const { b0, b1, b2, a1, a2 } = coeffs;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;

    output[i] = y0;
  }

  return output;
}

/**
 * Stereo Processor class
 */
export class StereoProcessor {
  width: number;
  bassMono: boolean;
  bassFreq: number;
  balance: number;
  midGain: number;
  sideGain: number;

  constructor(options: {
    width?: number;
    bassMono?: boolean;
    bassFreq?: number;
    balance?: number;
    midGain?: number;
    sideGain?: number;
  } = {}) {
    this.width = options.width ?? STEREO_DEFAULTS.WIDTH;
    this.bassMono = options.bassMono ?? STEREO_DEFAULTS.BASS_MONO;
    this.bassFreq = options.bassFreq ?? STEREO_DEFAULTS.BASS_FREQ;
    this.balance = options.balance ?? STEREO_DEFAULTS.BALANCE;
    this.midGain = options.midGain ?? STEREO_DEFAULTS.MID_GAIN;
    this.sideGain = options.sideGain ?? STEREO_DEFAULTS.SIDE_GAIN;
  }

  /**
   * Encode L/R to M/S
   */
  encodeMS(left: Float32Array, right: Float32Array) {
    const mid = new Float32Array(left.length);
    const side = new Float32Array(left.length);

    for (let i = 0; i < left.length; i++) {
      mid[i] = (left[i] + right[i]) * 0.5;
      side[i] = (left[i] - right[i]) * 0.5;
    }

    return { mid, side };
  }

  /**
   * Decode M/S to L/R
   */
  decodeMS(mid: Float32Array, side: Float32Array) {
    const left = new Float32Array(mid.length);
    const right = new Float32Array(mid.length);

    for (let i = 0; i < mid.length; i++) {
      left[i] = mid[i] + side[i];
      right[i] = mid[i] - side[i];
    }

    return { left, right };
  }

  /**
   * Process audio buffer with stereo enhancement
   */
  process(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
    if (buffer.numberOfChannels !== 2) {
      console.warn('[Stereo] Input is not stereo, returning unchanged');
      return buffer;
    }

    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

    let output: IAudioBuffer;
    if (typeof AudioBuffer !== 'undefined') {
      output = new AudioBuffer({
        numberOfChannels: 2,
        length: length,
        sampleRate: sampleRate
      });
    } else {
      const data = Array.from({ length: 2 }, () => new Float32Array(length));
      output = {
        sampleRate: sampleRate,
        numberOfChannels: 2,
        length: length,
        duration: length / sampleRate,
        getChannelData: (ch: number) => data[ch]
      };
    }

    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const outLeft = output.getChannelData(0);
    const outRight = output.getChannelData(1);

    const { mid, side } = this.encodeMS(left, right);

    if (onProgress) onProgress(0.2);

    let processedSide = side;
    if (this.bassMono && this.bassFreq > 0) {
      const hpCoeffs = calcHighpassCoeffs(sampleRate, this.bassFreq);
      processedSide = applyFilter(side, hpCoeffs) as any;
    }

    if (onProgress) onProgress(0.4);

    const midGainLin = dbToLinear(this.midGain);
    const sideGainLin = dbToLinear(this.sideGain) * this.width;

    const processedMid = new Float32Array(mid.length);
    const processedSideFinal = new Float32Array(processedSide.length);

    for (let i = 0; i < mid.length; i++) {
      processedMid[i] = mid[i] * midGainLin;
      processedSideFinal[i] = processedSide[i] * sideGainLin;
    }

    if (onProgress) onProgress(0.6);

    const decoded = this.decodeMS(processedMid, processedSideFinal);

    const balanceL = this.balance < 0 ? 1 : 1 - this.balance;
    const balanceR = this.balance > 0 ? 1 : 1 + this.balance;

    for (let i = 0; i < decoded.left.length; i++) {
      outLeft[i] = decoded.left[i] * balanceL;
      outRight[i] = decoded.right[i] * balanceR;
    }

    if (onProgress) onProgress(1.0);

    return output;
  }

  /**
   * Apply a preset
   */
  applyPreset(presetName: string) {
    const preset = STEREO_PRESETS[presetName];
    if (preset) {
      this.width = preset.width;
      this.bassMono = preset.bassMono;
      this.bassFreq = preset.bassFreq;
    }
  }
}

/**
 * Convenience function for stereo width adjustment
 */
export function adjustStereoWidth(
  buffer: IAudioBuffer,
  width = 1.0,
  bassMono = true,
  bassFreq = 200,
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const processor = new StereoProcessor({ width, bassMono, bassFreq });
  return processor.process(buffer, onProgress);
}

/**
 * Apply preset-based stereo processing
 */
export function applyStereoPreset(
  buffer: IAudioBuffer,
  preset = 'normal',
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const processor = new StereoProcessor();
  processor.applyPreset(preset);
  return processor.process(buffer, onProgress);
}

/**
 * Convert stereo to mono
 */
export function stereoToMono(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  return applyStereoPreset(buffer, 'mono', onProgress);
}

/**
 * Widen stereo image
 */
export function widenStereo(buffer: IAudioBuffer, amount = 1.3, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  return adjustStereoWidth(buffer, amount, true, 200, onProgress);
}

/**
 * Apply bass mono (mono bass, stereo highs)
 */
export function applyBassMono(buffer: IAudioBuffer, frequency = 200, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  return adjustStereoWidth(buffer, 1.0, true, frequency, onProgress);
}

/**
 * Analyze stereo correlation
 */
export function analyzeStereo(buffer: IAudioBuffer) {
  if (buffer.numberOfChannels !== 2) {
    return { correlation: 1, width: 0, balance: 0 };
  }

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  let sumL = 0, sumR = 0, sumLR = 0;
  let sumL2 = 0, sumR2 = 0;
  let peakL = 0, peakR = 0;

  const length = left.length;
  // Step by 100 to make estimation fast
  let n = 0;
  for (let i = 0; i < length; i += 100) {
    const l = left[i];
    const r = right[i];

    sumL += l;
    sumR += r;
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;

    peakL = Math.max(peakL, Math.abs(l));
    peakR = Math.max(peakR, Math.abs(r));
    n++;
  }

  const meanL = sumL / n;
  const meanR = sumR / n;

  const numerator = sumLR - n * meanL * meanR;
  const denominator = Math.sqrt((sumL2 - n * meanL * meanL) * (sumR2 - n * meanR * meanR));
  const correlation = denominator > 0 ? numerator / denominator : 1;

  const width = 1 - Math.abs(correlation);

  const totalPeak = peakL + peakR;
  const balance = totalPeak > 0 ? (peakR - peakL) / totalPeak : 0;

  return {
    correlation: Math.round(correlation * 100) / 100,
    width: Math.round(width * 100) / 100,
    balance: Math.round(balance * 100) / 100
  };
}
