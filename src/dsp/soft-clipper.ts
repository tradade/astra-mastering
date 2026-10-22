/**
 * Soft Clipper Module
 * Gentle peak shaving using saturation curves to reduce peak-to-loudness ratio.
 */

import { dbToLinear, linearToDb, interpolateCatmullRom } from './utils.js';
import type { IAudioBuffer } from './lufs.js';

export const SOFT_CLIPPER_DEFAULTS = {
  threshold: -6,      // dB - start clipping above this
  ceiling: -0.5,      // dB - absolute maximum output
  knee: 3,            // dB - soft knee width
  drive: 1.5,         // Saturation intensity (1.0 = gentle, 2.0 = aggressive)
  mix: 1.0            // Wet/dry mix (1.0 = full wet)
};

/**
 * Soft clipping curve using tanh saturation
 */
function softClipSample(sample: number, threshold: number, ceiling: number, drive: number): number {
  const sign = Math.sign(sample);
  const abs = Math.abs(sample);

  if (abs <= threshold) {
    return sample;
  }

  const excess = abs - threshold;
  const range = ceiling - threshold;

  if (range <= 0) {
    return sign * Math.min(abs, ceiling);
  }

  const normalized = excess / range;
  const saturated = Math.tanh(normalized * drive);
  const output = threshold + saturated * range;

  return sign * Math.min(output, ceiling);
}

/**
 * Apply soft clipping to an AudioBuffer
 */
export function applySoftClip(
  buffer: IAudioBuffer,
  options: {
    threshold?: number;
    ceiling?: number;
    knee?: number;
    drive?: number;
    mix?: number;
  } = {},
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const {
    threshold = SOFT_CLIPPER_DEFAULTS.threshold,
    ceiling = SOFT_CLIPPER_DEFAULTS.ceiling,
    drive = SOFT_CLIPPER_DEFAULTS.drive,
    mix = SOFT_CLIPPER_DEFAULTS.mix
  } = options;

  const thresholdLin = dbToLinear(threshold);
  const ceilingLin = dbToLinear(ceiling);

  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  let outputBuffer: IAudioBuffer;
  if (typeof AudioBuffer !== 'undefined') {
    outputBuffer = new AudioBuffer({
      numberOfChannels: numChannels,
      length: length,
      sampleRate: buffer.sampleRate
    });
  } else {
    const data = Array.from({ length: numChannels }, () => new Float32Array(length));
    outputBuffer = {
      sampleRate: buffer.sampleRate,
      numberOfChannels: numChannels,
      length: length,
      duration: length / buffer.sampleRate,
      getChannelData: (ch: number) => data[ch]
    };
  }

  let peakReduction = 0;
  let samplesClipped = 0;

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outputBuffer.getChannelData(ch);

    for (let i = 0; i < length; i++) {
      const sample = input[i];
      const clipped = softClipSample(sample, thresholdLin, ceilingLin, drive);

      output[i] = mix < 1 ? sample * (1 - mix) + clipped * mix : clipped;

      if (Math.abs(clipped) < Math.abs(sample)) {
        samplesClipped++;
        peakReduction = Math.max(peakReduction, Math.abs(sample) - Math.abs(clipped));
      }
    }

    if (onProgress) {
      onProgress((ch + 1) / numChannels);
    }
  }

  const clippedPercent = ((samplesClipped / (length * numChannels)) * 100).toFixed(2);
  const reductionDb = peakReduction > 0 ? linearToDb(1 + peakReduction).toFixed(1) : '0.0';
  console.log(`[Soft Clipper] ${clippedPercent}% samples clipped, max reduction: ${reductionDb} dB`);

  return outputBuffer;
}

/**
 * Two-stage soft clipper
 */
export function applyTwoStageSoftClip(
  buffer: IAudioBuffer,
  ceiling = -1,
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  let result = applySoftClip(buffer, {
    threshold: ceiling + 6,
    ceiling: ceiling + 2,
    drive: 1.2,
    mix: 1.0
  }, onProgress ? (p) => onProgress(p * 0.5) : null);

  result = applySoftClip(result, {
    threshold: ceiling + 3,
    ceiling: ceiling + 0.5,
    drive: 1.8,
    mix: 1.0
  }, onProgress ? (p) => onProgress(0.5 + p * 0.5) : null);

  return result;
}

/**
 * Mastering-grade soft clipper with lookahead
 */
export function applyMasteringSoftClip(
  buffer: IAudioBuffer,
  options: {
    ceiling?: number;
    lookaheadMs?: number;
    releaseMs?: number;
    drive?: number;
  } = {},
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const {
    ceiling = -1,
    lookaheadMs = 0.5,
    releaseMs = 10,
    drive = 1.5
  } = options;

  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const ceilingLin = dbToLinear(ceiling);
  const thresholdLin = dbToLinear(ceiling + 3);
  const lookaheadSamples = Math.max(1, Math.floor(sampleRate * lookaheadMs / 1000));
  const releaseCoef = Math.exp(-1 / (releaseMs * sampleRate / 1000));

  let outputBuffer: IAudioBuffer;
  if (typeof AudioBuffer !== 'undefined') {
    outputBuffer = new AudioBuffer({
      numberOfChannels: numChannels,
      length: length,
      sampleRate: sampleRate
    });
  } else {
    const data = Array.from({ length: numChannels }, () => new Float32Array(length));
    outputBuffer = {
      sampleRate: sampleRate,
      numberOfChannels: numChannels,
      length: length,
      duration: length / sampleRate,
      getChannelData: (ch: number) => data[ch]
    };
  }

  const gainEnvelope = new Float32Array(length);
  gainEnvelope.fill(1.0);

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);

    for (let i = 0; i < length; i++) {
      const abs = Math.abs(input[i]);

      if (abs > thresholdLin) {
        const excess = abs - thresholdLin;
        const range = ceilingLin - thresholdLin;
        const normalized = excess / Math.max(range, 0.001);
        const saturated = Math.tanh(normalized * drive);
        const targetLevel = thresholdLin + saturated * range;
        const requiredGain = targetLevel / abs;

        const startIdx = Math.max(0, i - lookaheadSamples);
        for (let j = startIdx; j <= i; j++) {
          const t = (j - startIdx) / Math.max(1, i - startIdx);
          const interpolatedGain = 1.0 + (requiredGain - 1.0) * t;
          gainEnvelope[j] = Math.min(gainEnvelope[j], interpolatedGain);
        }
      }
    }
  }

  let currentGain = 1.0;
  for (let i = 0; i < length; i++) {
    if (gainEnvelope[i] < currentGain) {
      currentGain = gainEnvelope[i];
    } else {
      currentGain = releaseCoef * currentGain + (1 - releaseCoef) * 1.0;
      currentGain = Math.min(currentGain, 1.0);
    }
    gainEnvelope[i] = currentGain;
  }

  for (let ch = 0; ch < numChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outputBuffer.getChannelData(ch);

    for (let i = 0; i < length; i++) {
      const p1 = input[i - 1] || 0;
      const p2 = input[i];
      const p3 = input[i + 1] || 0;
      const p4 = input[i + 2] || 0;

      const g1 = gainEnvelope[i - 1] || 1;
      const g2 = gainEnvelope[i];
      const g3 = gainEnvelope[i + 1] || 1;
      const g4 = gainEnvelope[i + 2] || 1;

      const s1 = p2 * g2;

      const sampleA = s1;
      const sampleB = interpolateCatmullRom(
        p1 * g1,
        p2 * g2,
        p3 * g3,
        p4 * g4,
        0.5
      );

      const saturate = (val: number) => {
        const absVal = Math.abs(val);
        if (absVal > ceilingLin) {
          const excess = (absVal - ceilingLin) / ceilingLin;
          const reduction = 1 - Math.tanh(excess * 2) * 0.1;
          return Math.sign(val) * Math.min(absVal * reduction, ceilingLin);
        }
        return val;
      };

      const satA = saturate(sampleA);
      const satB = saturate(sampleB);

      output[i] = (satA + satB) * 0.5;
    }

    if (onProgress) {
      onProgress((ch + 1) / numChannels);
    }
  }

  return outputBuffer;
}
