// Canonical mastering DSP chain — single source of truth for preview cache,
// worker export, and main-thread fallback. Pure sample processing over
// IAudioBuffer; no OfflineAudioContext / DynamicsCompressor detour.

import type { IAudioBuffer } from './lufs.js';
import { measureLUFS } from './lufs.js';
import { normalizeToLUFS } from './normalizer.js';
import { applyExciter } from './exciter.js';
import { applyTapeWarmth } from './multiband-saturation.js';
import { applyMultibandTransient } from './multiband-transient.js';
import { processHybridDynamic } from './dynamic-processor.js';
import { applyFinalFilters } from './final-filters.js';
import { applyMasteringSoftClip } from './soft-clipper.js';
import { applyLookaheadLimiter } from './limiter.js';
import { applyDynamicLeveling } from './dynamic-leveler.js';
import {
  applyBiquadFilter,
  calcHighShelfCoeffs,
  type BiquadCoeffs,
} from './utils.js';

/** Settings consumed by the mastering chain (matches RenderSettings fields). */
export interface MasteringChainSettings {
  inputGain?: number;
  eqLow?: number;
  eqLowMid?: number;
  eqMid?: number;
  eqHighMid?: number;
  eqHigh?: number;
  cleanLowEnd?: boolean;
  cutMud?: boolean;
  glueCompression?: boolean;
  stereoWidth?: number;
  centerBass?: boolean;
  deharsh?: boolean;
  addAir?: boolean;
  tapeWarmth?: boolean;
  autoLevel?: boolean;
  addPunch?: boolean;
  normalizeLoudness?: boolean;
  targetLufs?: number;
  truePeakLimit?: boolean;
  truePeakCeiling?: number;
}

export interface MasteringChainProgress {
  (progress: number, status: string): void;
}

export interface MasteringChainResult {
  buffer: IAudioBuffer;
  /** LUFS measured after stereo stage, before loudness normalize. */
  preNormalizeLufs: number;
  /** LUFS of the final limited buffer. */
  measuredLufs: number;
}

/** Minimal mutable buffer usable in workers and tests (no DOM AudioBuffer). */
export class MutableAudioBuffer implements IAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private channels: Float32Array[];

  constructor(opts: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = opts.numberOfChannels;
    this.length = opts.length;
    this.sampleRate = opts.sampleRate;
    this.duration = opts.length / opts.sampleRate;
    this.channels = Array.from({ length: opts.numberOfChannels }, () => new Float32Array(opts.length));
  }

  static from(source: IAudioBuffer): MutableAudioBuffer {
    const out = new MutableAudioBuffer({
      numberOfChannels: source.numberOfChannels,
      length: source.length,
      sampleRate: source.sampleRate,
    });
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      out.channels[ch].set(source.getChannelData(ch));
    }
    return out;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }

  copyToChannel(source: Float32Array, channel: number, startInChannel = 0): void {
    this.channels[channel].set(source, startInChannel);
  }
}

function calcLowShelfCoeffs(sampleRate: number, frequency: number, gainDB: number, Q: number): BiquadCoeffs {
  const A = Math.pow(10, gainDB / 40);
  const w0 = 2 * Math.PI * frequency / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);

  const b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
  const b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
  const a0 = (A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cosW0);
  const a2 = (A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function calcPeakingCoeffs(sampleRate: number, frequency: number, gainDB: number, Q: number): BiquadCoeffs {
  const A = Math.pow(10, gainDB / 40);
  const w0 = 2 * Math.PI * frequency / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosW0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha / A;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 5-band parametric EQ + optional Cut Mud peaking cut. */
export function applyParametricEQ(buffer: IAudioBuffer, settings: MasteringChainSettings): IAudioBuffer {
  const sampleRate = buffer.sampleRate;
  const eqValues = {
    low: Number(settings.eqLow) || 0,
    lowMid: Number(settings.eqLowMid) || 0,
    mid: Number(settings.eqMid) || 0,
    highMid: Number(settings.eqHighMid) || 0,
    high: Number(settings.eqHigh) || 0,
  };

  const out = new MutableAudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate,
  });

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    let data: Float32Array = Float32Array.from(buffer.getChannelData(ch));

    if (eqValues.low !== 0) {
      data = applyBiquadFilter(data, calcLowShelfCoeffs(sampleRate, 80, eqValues.low, 1.0)) as Float32Array;
    }
    if (eqValues.lowMid !== 0) {
      data = applyBiquadFilter(data, calcPeakingCoeffs(sampleRate, 250, eqValues.lowMid, 1.0)) as Float32Array;
    }
    if (eqValues.mid !== 0) {
      data = applyBiquadFilter(data, calcPeakingCoeffs(sampleRate, 1000, eqValues.mid, 1.0)) as Float32Array;
    }
    if (eqValues.highMid !== 0) {
      data = applyBiquadFilter(data, calcPeakingCoeffs(sampleRate, 4000, eqValues.highMid, 1.0)) as Float32Array;
    }
    if (eqValues.high !== 0) {
      data = applyBiquadFilter(data, calcHighShelfCoeffs(sampleRate, 12000, eqValues.high, 1.0)) as Float32Array;
    }
    if (settings.cutMud) {
      data = applyBiquadFilter(data, calcPeakingCoeffs(sampleRate, 250, -3.0, 1.5)) as Float32Array;
    }
    out.copyToChannel(data, ch);
  }
  return out;
}

/** Stereo-linked glue compressor (mid sidechain). */
export function applyGlueCompressor(
  buffer: IAudioBuffer,
  options: { threshold: number; ratio: number; attack: number; release: number } = {
    threshold: -18,
    ratio: 3,
    attack: 0.02,
    release: 0.25,
  },
): IAudioBuffer {
  const { threshold, ratio, attack, release } = options;
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  const sidechain = new Float32Array(length);
  if (numChannels >= 2) {
    for (let i = 0; i < length; i++) sidechain[i] = (channels[0][i] + channels[1][i]) * 0.5;
  } else {
    sidechain.set(channels[0]);
  }

  const thresholdLin = Math.pow(10, threshold / 20);
  const attackCoef = Math.exp(-1 / (attack * sampleRate));
  const releaseCoef = Math.exp(-1 / (release * sampleRate));

  let envelope = 0;
  const gainCurve = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const inputAbs = Math.abs(sidechain[i]);
    if (inputAbs > envelope) {
      envelope = attackCoef * envelope + (1 - attackCoef) * inputAbs;
    } else {
      envelope = releaseCoef * envelope + (1 - releaseCoef) * inputAbs;
    }
    let gain = 1.0;
    if (envelope > thresholdLin) {
      const overDB = 20 * Math.log10(envelope / thresholdLin);
      const reductionDB = overDB * (1 - 1 / ratio);
      gain = Math.pow(10, -reductionDB / 20);
    }
    gainCurve[i] = gain;
  }

  const out = new MutableAudioBuffer({ numberOfChannels: numChannels, length, sampleRate });
  for (let c = 0; c < numChannels; c++) {
    const input = channels[c];
    const output = out.getChannelData(c);
    for (let i = 0; i < length; i++) output[i] = input[i] * gainCurve[i];
  }
  return out;
}

/**
 * Mid/Side width + optional high-pass on side for mono bass below bassFreq.
 * width is linear (1.0 = unity); stereoWidth settings are percent/100.
 */
export function applyStereoProcessing(
  buffer: IAudioBuffer,
  width = 1.0,
  bassMono = true,
  bassFreq = 200,
): IAudioBuffer {
  if (buffer.numberOfChannels !== 2) return buffer;

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const length = left.length;
  const sampleRate = buffer.sampleRate;

  const mid = new Float32Array(length);
  const side = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    mid[i] = (left[i] + right[i]) * 0.5;
    side[i] = (left[i] - right[i]) * 0.5;
  }

  let processedSide = side;
  if (bassMono && bassFreq > 0) {
    const omega = 2 * Math.PI * bassFreq / sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = sin / (2 * 0.7071);
    const b0 = ((1 + cos) / 2) / (1 + alpha);
    const b1 = (-(1 + cos)) / (1 + alpha);
    const b2 = ((1 + cos) / 2) / (1 + alpha);
    const a1 = (-2 * cos) / (1 + alpha);
    const a2 = (1 - alpha) / (1 + alpha);

    processedSide = new Float32Array(length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < length; i++) {
      const x0 = side[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      processedSide[i] = y0;
    }
  }

  const out = new MutableAudioBuffer({ numberOfChannels: 2, length, sampleRate });
  const outL = out.getChannelData(0);
  const outR = out.getChannelData(1);
  const sideGain = width;
  for (let i = 0; i < length; i++) {
    const m = mid[i];
    const s = processedSide[i] * sideGain;
    outL[i] = m + s;
    outR[i] = m - s;
  }
  return out;
}

function report(onProgress: MasteringChainProgress | undefined, p: number, status: string) {
  onProgress?.(p, status);
}

/**
 * Full deterministic mastering chain. Always runs the complete export-grade
 * path (no "preview-only heavy FX" shortcut) so cache, worker, and export match.
 */
export function runMasteringChain(
  input: IAudioBuffer,
  settings: MasteringChainSettings,
  onProgress?: MasteringChainProgress,
): MasteringChainResult {
  // Work on a copy so the caller's original buffer is never mutated in-place
  // by stages that write into channel data.
  let buffer: IAudioBuffer = MutableAudioBuffer.from(input);

  // 0. Input gain
  const inputGainDb = Number(settings.inputGain) || 0;
  if (inputGainDb !== 0) {
    report(onProgress, 0.08, 'Applying input gain...');
    const gainLin = Math.pow(10, inputGainDb / 20);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] *= gainLin;
    }
  }

  // 1. Auto Level
  if (settings.autoLevel) {
    report(onProgress, 0.12, 'Applying dynamic range leveler...');
    buffer = applyDynamicLeveling(buffer);
  }

  // 2. De-harsh
  if (settings.deharsh) {
    report(onProgress, 0.18, 'Applying hybrid dynamic processor...');
    buffer = processHybridDynamic(buffer, 'mastering');
  }

  // 3. Exciter / air
  if (settings.addAir) {
    report(onProgress, 0.28, 'Applying exciter...');
    buffer = applyExciter(buffer);
  }

  // 4. Tape warmth
  if (settings.tapeWarmth) {
    report(onProgress, 0.38, 'Applying tape warmth...');
    buffer = applyTapeWarmth(buffer);
  }

  // 5. Punch / transient
  if (settings.addPunch) {
    report(onProgress, 0.48, 'Applying multiband transient...');
    buffer = applyMultibandTransient(buffer);
  }

  // 6. Final HPF/LPF cleanup
  report(onProgress, 0.55, 'Applying final filters...');
  buffer = applyFinalFilters(buffer, {
    highpass: !!settings.cleanLowEnd,
    lowpass: true,
  });

  // 7. Parametric EQ + Cut Mud
  report(onProgress, 0.62, 'Applying EQ...');
  buffer = applyParametricEQ(buffer, settings);

  // 8. Glue compressor
  if (settings.glueCompression) {
    report(onProgress, 0.70, 'Applying glue compressor...');
    buffer = applyGlueCompressor(buffer);
  }

  // 9. Stereo width + mono bass
  if (buffer.numberOfChannels === 2) {
    const stereoWidthValue = Number(settings.stereoWidth);
    const width = Number.isFinite(stereoWidthValue) ? stereoWidthValue / 100 : 1.0;
    const clampedWidth = Math.max(0, Math.min(2, width));
    const bassMono = !!settings.centerBass;
    if (bassMono || Math.abs(clampedWidth - 1.0) > 1e-6) {
      report(onProgress, 0.74, 'Applying stereo processing...');
      buffer = applyStereoProcessing(buffer, clampedWidth, bassMono, 200);
    }
  }

  // 10. Pre-normalize LUFS
  report(onProgress, 0.78, 'Measuring loudness...');
  const preNormalizeLufs = measureLUFS(buffer);

  // 11. Loudness normalize
  if (settings.normalizeLoudness && settings.targetLufs !== undefined) {
    report(onProgress, 0.82, 'Normalizing to target LUFS...');
    buffer = normalizeToLUFS(buffer, settings.targetLufs, 0, { skipLimiter: true });
  }

  // 12–13. Soft clip + true-peak limiter
  if (settings.truePeakLimit) {
    const ceiling = settings.truePeakCeiling ?? -1;
    report(onProgress, 0.88, 'Applying soft clip...');
    buffer = applyMasteringSoftClip(buffer, {
      ceiling,
      lookaheadMs: 0.5,
      releaseMs: 10,
      drive: 1.5,
    });
    report(onProgress, 0.94, 'Applying lookahead limiter...');
    const ceilingLinear = Math.pow(10, ceiling / 20);
    buffer = applyLookaheadLimiter(buffer, ceilingLinear);
  }

  report(onProgress, 1.0, 'Complete');
  const measuredLufs = measureLUFS(buffer);
  return { buffer, preNormalizeLufs, measuredLufs };
}
