import { dbToLinear } from './utils.js';
import type { IAudioBuffer } from './lufs.js';

const CROSSOVER_DEFAULTS = {
  LOW_MID: 200,
  MID_HIGH: 4000,
};

interface SaturationBandSettings {
  drive: number;
  bias: number;
  mix: number;
  gain: number;
}

interface SaturationBypassSettings {
  thresholdDb: number;
  kneeDb: number;
  windowMs: number;
  lookaheadMs: number;
}

interface SaturationPreset {
  name: string;
  description: string;
  f1: number;
  f2: number;
  low: SaturationBandSettings;
  mid: SaturationBandSettings;
  high: SaturationBandSettings;
  bypass: SaturationBypassSettings;
}

export const MULTIBAND_SATURATION_PRESETS: Record<string, SaturationPreset> = {
  tapeWarmth: {
    name: 'Tape Warmth',
    description: 'Subtle vintage warmth, gentle harmonics',
    f1: 200,
    f2: 4000,
    low:  { drive: 0.2, bias: 0.0,  mix: 0.3, gain: 0 },
    mid:  { drive: 0.4, bias: 0.1,  mix: 0.5, gain: 0 },
    high: { drive: 0.3, bias: 0.05, mix: 0.4, gain: 0 },
    bypass: { thresholdDb: -24, kneeDb: 6, windowMs: 100, lookaheadMs: 5 }
  },
  analogConsole: {
    name: 'Analog Console',
    description: 'Punchy mix glue, classic desk sound',
    f1: 200,
    f2: 4000,
    low:  { drive: 0.3, bias: 0.0,  mix: 0.4, gain: 0 },
    mid:  { drive: 0.5, bias: 0.15, mix: 0.6, gain: 0 },
    high: { drive: 0.4, bias: 0.1,  mix: 0.5, gain: 0 },
    bypass: { thresholdDb: -24, kneeDb: 6, windowMs: 100, lookaheadMs: 5 }
  },
  tubePreamp: {
    name: 'Tube Preamp',
    description: 'Rich harmonics, vintage character',
    f1: 200,
    f2: 4000,
    low:  { drive: 0.4, bias: 0.1,  mix: 0.5, gain: 0 },
    mid:  { drive: 0.6, bias: 0.2,  mix: 0.7, gain: 0 },
    high: { drive: 0.3, bias: 0.15, mix: 0.4, gain: 0 },
    bypass: { thresholdDb: -24, kneeDb: 6, windowMs: 100, lookaheadMs: 5 }
  }
};

function calcLinkwitzRileyCoeffs(sampleRate: number, frequency: number, type: 'lowpass' | 'highpass') {
  const omega = 2 * Math.PI * frequency / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const Q = 0.7071067811865476;

  const alpha = sin / (2 * Q);

  let b0, b1, b2, a0, a1, a2;

  if (type === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0
  };
}

function applyBiquad(
  samples: Float32Array,
  coeffs: { b0: number; b1: number; b2: number; a1: number; a2: number }
): Float32Array {
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

function splitBands(samples: Float32Array, sampleRate: number, f1: number, f2: number) {
  const lpCoeffs1 = calcLinkwitzRileyCoeffs(sampleRate, f1, 'lowpass');
  const hpCoeffs1 = calcLinkwitzRileyCoeffs(sampleRate, f1, 'highpass');

  let low = applyBiquad(samples, lpCoeffs1);
  low = applyBiquad(low, lpCoeffs1);

  let midHigh = applyBiquad(samples, hpCoeffs1);
  midHigh = applyBiquad(midHigh, hpCoeffs1);

  const lpCoeffs2 = calcLinkwitzRileyCoeffs(sampleRate, f2, 'lowpass');
  const hpCoeffs2 = calcLinkwitzRileyCoeffs(sampleRate, f2, 'highpass');

  let mid = applyBiquad(midHigh, lpCoeffs2);
  mid = applyBiquad(mid, lpCoeffs2);

  let high = applyBiquad(midHigh, hpCoeffs2);
  high = applyBiquad(high, hpCoeffs2);

  return { low, mid, high };
}

export class MultibandSaturator {
  f1: number;
  f2: number;
  bands: {
    low: SaturationBandSettings;
    mid: SaturationBandSettings;
    high: SaturationBandSettings;
  };
  bypassThresholdDb: number;
  bypassKneeDb: number;
  windowMs: number;
  lookaheadMs: number;

  constructor(options: {
    preset?: string;
    f1?: number;
    f2?: number;
    low?: Partial<SaturationBandSettings>;
    mid?: Partial<SaturationBandSettings>;
    high?: Partial<SaturationBandSettings>;
    bypass?: Partial<SaturationBypassSettings>;
  } = {}) {
    const preset = typeof options.preset === 'string'
      ? MULTIBAND_SATURATION_PRESETS[options.preset]
      : null;

    this.f1 = options.f1 ?? preset?.f1 ?? CROSSOVER_DEFAULTS.LOW_MID;
    this.f2 = options.f2 ?? preset?.f2 ?? CROSSOVER_DEFAULTS.MID_HIGH;

    this.bands = {
      low: {
        drive: options.low?.drive ?? preset?.low?.drive ?? 0.3,
        bias: options.low?.bias ?? preset?.low?.bias ?? 0,
        mix: options.low?.mix ?? preset?.low?.mix ?? 0.5,
        gain: options.low?.gain ?? preset?.low?.gain ?? 0
      },
      mid: {
        drive: options.mid?.drive ?? preset?.mid?.drive ?? 0.3,
        bias: options.mid?.bias ?? preset?.mid?.bias ?? 0,
        mix: options.mid?.mix ?? preset?.mid?.mix ?? 0.5,
        gain: options.mid?.gain ?? preset?.mid?.gain ?? 0
      },
      high: {
        drive: options.high?.drive ?? preset?.high?.drive ?? 0.3,
        bias: options.high?.bias ?? preset?.high?.bias ?? 0,
        mix: options.high?.mix ?? preset?.high?.mix ?? 0.5,
        gain: options.high?.gain ?? preset?.high?.gain ?? 0
      }
    };

    this.bypassThresholdDb = options.bypass?.thresholdDb ?? preset?.bypass?.thresholdDb ?? -24;
    this.bypassKneeDb = options.bypass?.kneeDb ?? preset?.bypass?.kneeDb ?? 6;
    this.windowMs = options.bypass?.windowMs ?? preset?.bypass?.windowMs ?? 50;
    this.lookaheadMs = options.bypass?.lookaheadMs ?? preset?.bypass?.lookaheadMs ?? 5;
  }

  createBypassEnvelope(buffer: IAudioBuffer): { envelope: Float32Array; windowSamples: number } {
    const sampleRate = buffer.sampleRate;
    const windowSamples = Math.floor(sampleRate * this.windowMs / 1000);
    const numWindows = Math.ceil(buffer.length / windowSamples);

    const envelope = new Float32Array(numWindows);
    const threshold = dbToLinear(this.bypassThresholdDb);
    const kneeStart = dbToLinear(this.bypassThresholdDb - this.bypassKneeDb);

    const channel = buffer.getChannelData(0);
    const hasSecondChannel = buffer.numberOfChannels > 1;
    const channel2 = hasSecondChannel ? buffer.getChannelData(1) : null;

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSamples;
      const end = Math.min(start + windowSamples, buffer.length);

      let peak = 0;
      for (let i = start; i < end; i += 4) {
        let sample = Math.abs(channel[i]);
        if (channel2) {
          sample = Math.max(sample, Math.abs(channel2[i]));
        }
        if (sample > peak) peak = sample;
      }

      if (peak >= threshold) {
        envelope[w] = 1.0;
      } else if (peak >= kneeStart) {
        const ratio = (peak - kneeStart) / (threshold - kneeStart);
        envelope[w] = ratio * ratio;
      } else {
        envelope[w] = 0.0;
      }
    }

    const smoothed = new Float32Array(numWindows);
    const attackCoef = 0.5;
    const releaseCoef = 0.03;

    smoothed[0] = envelope[0];
    for (let i = 1; i < numWindows; i++) {
      const coef = envelope[i] > smoothed[i - 1] ? attackCoef : releaseCoef;
      smoothed[i] = smoothed[i - 1] + (envelope[i] - smoothed[i - 1]) * coef;
    }

    const lookaheadWindows = Math.ceil(sampleRate * this.lookaheadMs / 1000 / windowSamples);
    if (lookaheadWindows > 0) {
      const lookaheadEnvelope = new Float32Array(numWindows);
      for (let i = 0; i < numWindows; i++) {
        const futureIdx = Math.min(i + lookaheadWindows, numWindows - 1);
        lookaheadEnvelope[i] = smoothed[futureIdx];
      }
      return { envelope: lookaheadEnvelope, windowSamples };
    }

    return { envelope: smoothed, windowSamples };
  }

  saturateBand(
    samples: Float32Array,
    bandSettings: SaturationBandSettings,
    envelope: Float32Array,
    windowSamples: number
  ): Float32Array {
    const { drive, bias, mix, gain } = bandSettings;
    const output = new Float32Array(samples.length);

    const biasOffset = Math.tanh(drive * bias);
    const gainLinear = Math.pow(10, gain / 20);
    const makeupGain = 1 / Math.tanh(Math.max(drive, 0.1));

    for (let i = 0; i < samples.length; i++) {
      const dry = samples[i];

      const wet = (Math.tanh(drive * (dry + bias)) - biasOffset) * makeupGain;

      const windowIdx = Math.floor(i / windowSamples);
      const envValue = envelope[Math.min(windowIdx, envelope.length - 1)];

      const satAmount = envValue * mix;
      output[i] = (dry * (1 - satAmount) + wet * satAmount) * gainLinear;
    }

    return output;
  }

  process(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
    const { envelope, windowSamples } = this.createBypassEnvelope(buffer);

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

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const out = output.getChannelData(ch);

      const { low, mid, high } = splitBands(input, sampleRate, this.f1, this.f2);

      if (onProgress) onProgress((ch + 0.2) / numChannels);

      const satLow = this.saturateBand(low, this.bands.low, envelope, windowSamples);
      const satMid = this.saturateBand(mid, this.bands.mid, envelope, windowSamples);
      const satHigh = this.saturateBand(high, this.bands.high, envelope, windowSamples);

      if (onProgress) onProgress((ch + 0.8) / numChannels);

      for (let i = 0; i < input.length; i++) {
        out[i] = satLow[i] + satMid[i] + satHigh[i];
      }

      if (onProgress) onProgress((ch + 1) / numChannels);
    }

    return output;
  }
}

export function applyTapeWarmth(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  const saturator = new MultibandSaturator({ preset: 'tapeWarmth' });
  return saturator.process(buffer, onProgress);
}

export function applyAnalogConsole(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  const saturator = new MultibandSaturator({ preset: 'analogConsole' });
  return saturator.process(buffer, onProgress);
}

export function applyTubePreamp(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  const saturator = new MultibandSaturator({ preset: 'tubePreamp' });
  return saturator.process(buffer, onProgress);
}

export function applyMultibandSaturation(
  buffer: IAudioBuffer,
  options = {},
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const saturator = new MultibandSaturator(options);
  return saturator.process(buffer, onProgress);
}
