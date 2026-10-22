import { linearToDb, dbToLinear } from './utils.js';
import type { IAudioBuffer } from './lufs.js';

/**
 * Default dynamic leveler settings
 */
export const DYNAMIC_LEVELER_DEFAULTS = {
  WINDOW_MS: 200,           // Analysis window size
  QUIET_THRESHOLD_DB: -45,  // Below this is considered quiet
  EXPANSION_RATIO: 1.3,     // Expansion ratio for quiet sections
  MAX_GAIN_DB: 8,           // Maximum gain boost
  MIN_GAIN_DB: -12,         // Maximum gain reduction
  CREST_THRESHOLD_DB: 12,   // Crest factor threshold for transient detection
  ATTACK_MS: 10,            // Gain envelope attack
  RELEASE_MS: 100,          // Gain envelope release
  LOOKAHEAD_MS: 5,          // Lookahead for peak limiting
};

export interface DynamicLevelerOptions {
  windowMs?: number;
  quietThresholdDB?: number;
  expansionRatio?: number;
  maxGainDB?: number;
  minGainDB?: number;
  crestThresholdDB?: number;
  attackMs?: number;
  releaseMs?: number;
  lookaheadMs?: number;
}

export interface LevelerAnalysisData {
  rms: Float32Array;
  peak: Float32Array;
  crestFactor: Float32Array;
  isTransient: Uint8Array;
  isQuiet: Uint8Array;
}

/**
 * Dynamic Leveler class
 * Provides intelligent gain automation
 */
export class DynamicLeveler {
  windowMs: number;
  quietThresholdDB: number;
  expansionRatio: number;
  maxGainDB: number;
  minGainDB: number;
  crestThresholdDB: number;
  attackMs: number;
  releaseMs: number;
  lookaheadMs: number;

  constructor(options: DynamicLevelerOptions = {}) {
    this.windowMs = options.windowMs ?? DYNAMIC_LEVELER_DEFAULTS.WINDOW_MS;
    this.quietThresholdDB = options.quietThresholdDB ?? DYNAMIC_LEVELER_DEFAULTS.QUIET_THRESHOLD_DB;
    this.expansionRatio = options.expansionRatio ?? DYNAMIC_LEVELER_DEFAULTS.EXPANSION_RATIO;
    this.maxGainDB = options.maxGainDB ?? DYNAMIC_LEVELER_DEFAULTS.MAX_GAIN_DB;
    this.minGainDB = options.minGainDB ?? DYNAMIC_LEVELER_DEFAULTS.MIN_GAIN_DB;
    this.crestThresholdDB = options.crestThresholdDB ?? DYNAMIC_LEVELER_DEFAULTS.CREST_THRESHOLD_DB;
    this.attackMs = options.attackMs ?? DYNAMIC_LEVELER_DEFAULTS.ATTACK_MS;
    this.releaseMs = options.releaseMs ?? DYNAMIC_LEVELER_DEFAULTS.RELEASE_MS;
    this.lookaheadMs = options.lookaheadMs ?? DYNAMIC_LEVELER_DEFAULTS.LOOKAHEAD_MS;
  }

  /**
   * Analyze audio and create gain automation curve
   */
  analyze(buffer: IAudioBuffer, targetGain = 1.0, peakLimit = 1.0): { gainCurve: Float32Array; analysisData: LevelerAnalysisData } {
    const sampleRate = buffer.sampleRate;
    const windowSamples = Math.floor(sampleRate * this.windowMs / 1000);
    const numWindows = Math.ceil(buffer.length / windowSamples);

    const gainCurve = new Float32Array(numWindows);
    const analysisData: LevelerAnalysisData = {
      rms: new Float32Array(numWindows),
      peak: new Float32Array(numWindows),
      crestFactor: new Float32Array(numWindows),
      isTransient: new Uint8Array(numWindows),
      isQuiet: new Uint8Array(numWindows)
    };

    const numChannels = buffer.numberOfChannels;
    const mixedChannel = new Float32Array(buffer.length);

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = buffer.getChannelData(ch);
      for (let i = 0; i < buffer.length; i++) {
        mixedChannel[i] += channelData[i] / numChannels;
      }
    }

    const quietThreshold = dbToLinear(this.quietThresholdDB);
    const maxGain = dbToLinear(this.maxGainDB);
    const minGain = dbToLinear(this.minGainDB);

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSamples;
      const end = Math.min(start + windowSamples, buffer.length);
      const windowData = mixedChannel.subarray(start, end);

      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < windowData.length; i++) {
        const sample = Math.abs(windowData[i]);
        sumSq += sample * sample;
        if (sample > peak) peak = sample;
      }
      const rms = Math.sqrt(sumSq / windowData.length);

      analysisData.rms[w] = rms;
      analysisData.peak[w] = peak;

      const crestFactorDB = rms > 1e-6 ? linearToDb(peak / rms) : 0;
      analysisData.crestFactor[w] = crestFactorDB;

      analysisData.isTransient[w] = (crestFactorDB > this.crestThresholdDB && peak > 0.05) ? 1 : 0;

      analysisData.isQuiet[w] = (rms < quietThreshold && rms > 1e-8) ? 1 : 0;

      let gain = targetGain;

      if (analysisData.isTransient[w]) {
        gain = Math.min(gain, 1.12);
      }

      if (analysisData.isQuiet[w]) {
        const rmsDB = linearToDb(rms);
        const expansionDB = (rmsDB - this.quietThresholdDB) * (this.expansionRatio - 1);
        gain *= dbToLinear(Math.min(expansionDB, 6));
      }

      const projectedPeak = peak * gain;
      if (projectedPeak > peakLimit) {
        gain *= peakLimit / projectedPeak;
      }

      gainCurve[w] = Math.max(minGain, Math.min(maxGain, gain));
    }

    const smoothedCurve = this._smoothGainCurve(gainCurve, sampleRate);

    return {
      gainCurve: smoothedCurve,
      analysisData
    };
  }

  /**
   * Smooth gain curve with attack/release envelope
   */
  private _smoothGainCurve(curve: Float32Array, sampleRate: number): Float32Array {
    const windowSamples = Math.floor(sampleRate * this.windowMs / 1000);
    const attackCoef = Math.exp(-1 / (this.attackMs * sampleRate / 1000 / windowSamples));
    const releaseCoef = Math.exp(-1 / (this.releaseMs * sampleRate / 1000 / windowSamples));

    const smoothed = new Float32Array(curve.length);
    smoothed[0] = curve[0];

    for (let i = 1; i < curve.length; i++) {
      const coef = curve[i] < smoothed[i - 1] ? attackCoef : releaseCoef;
      smoothed[i] = coef * smoothed[i - 1] + (1 - coef) * curve[i];
    }

    const smoothed2 = new Float32Array(curve.length);
    for (let i = 0; i < curve.length; i++) {
      const prev = smoothed[Math.max(0, i - 1)];
      const curr = smoothed[i];
      const next = smoothed[Math.min(curve.length - 1, i + 1)];
      smoothed2[i] = (prev + curr * 2 + next) / 4;
    }

    return smoothed2;
  }

  /**
   * Apply gain curve to audio buffer
   */
  apply(buffer: IAudioBuffer, gainCurve: Float32Array, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
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

    const windowSamples = Math.floor(sampleRate * this.windowMs / 1000);

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const out = output.getChannelData(ch);

      for (let i = 0; i < input.length; i++) {
        const windowIdx = Math.min(
          Math.floor(i / windowSamples),
          gainCurve.length - 1
        );

        const nextIdx = Math.min(windowIdx + 1, gainCurve.length - 1);
        const windowPos = (i % windowSamples) / windowSamples;
        const gain = gainCurve[windowIdx] * (1 - windowPos) + gainCurve[nextIdx] * windowPos;

        out[i] = input[i] * gain;
      }

      if (onProgress) {
        onProgress((ch + 1) / numChannels);
      }
    }

    return output;
  }

  /**
   * Process audio buffer with dynamic leveling
   */
  process(buffer: IAudioBuffer, targetGain = 1.0, peakLimit = 1.0, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
    const { gainCurve, analysisData } = this.analyze(buffer, targetGain, peakLimit);

    const numTransients = analysisData.isTransient.reduce((a, b) => a + b, 0);
    const numQuiet = analysisData.isQuiet.reduce((a, b) => a + b, 0);
    const avgGainDB = linearToDb(gainCurve.reduce((a, b) => a + b, 0) / gainCurve.length);

    console.log(`[DynamicLeveler] Transient windows: ${numTransients}, Quiet windows: ${numQuiet}, Avg gain: ${avgGainDB.toFixed(2)}dB`);

    return this.apply(buffer, gainCurve, onProgress);
  }
}

/**
 * Convenience function for dynamic leveling
 */
export function applyDynamicLeveling(
  buffer: IAudioBuffer,
  options: DynamicLevelerOptions & { targetGain?: number; peakLimit?: number } = {},
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const leveler = new DynamicLeveler(options);
  return leveler.process(buffer, options.targetGain || 1.0, options.peakLimit || 1.0, onProgress);
}

/**
 * Analyze dynamics without processing
 */
export function analyzeDynamics(
  buffer: IAudioBuffer,
  options: DynamicLevelerOptions = {}
): { gainCurve: Float32Array; analysisData: LevelerAnalysisData } {
  const leveler = new DynamicLeveler(options);
  return leveler.analyze(buffer);
}

/**
 * Apply gentle leveling for podcast/voice content
 */
export function applyVoiceLeveling(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  const leveler = new DynamicLeveler({
    windowMs: 300,
    quietThresholdDB: -40,
    expansionRatio: 1.5,
    maxGainDB: 10,
    crestThresholdDB: 15,
    attackMs: 20,
    releaseMs: 200
  });
  return leveler.process(buffer, 1.0, 0.95, onProgress);
}

/**
 * Apply aggressive leveling for music mastering
 */
export function applyMusicLeveling(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  const leveler = new DynamicLeveler({
    windowMs: 150,
    quietThresholdDB: -50,
    expansionRatio: 1.2,
    maxGainDB: 6,
    crestThresholdDB: 10,
    attackMs: 5,
    releaseMs: 80
  });
  return leveler.process(buffer, 1.0, 0.98, onProgress);
}
