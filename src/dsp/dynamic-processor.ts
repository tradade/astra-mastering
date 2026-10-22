import { FFTProcessor } from './fft.js';
import { linearToDb, dbToLinear } from './utils.js';
import type { IAudioBuffer } from './lufs.js';

/**
 * Envelope follower with configurable attack/release
 */
export class EnvelopeFollower {
  sampleRate: number;
  envelope: number;
  attackCoef!: number;
  releaseCoef!: number;

  constructor(sampleRate: number, attackMs = 5, releaseMs = 50) {
    this.sampleRate = sampleRate;
    this.envelope = 0;
    this.setTimes(attackMs, releaseMs);
  }

  setTimes(attackMs: number, releaseMs: number) {
    this.attackCoef = Math.exp(-1 / (this.sampleRate * attackMs / 1000));
    this.releaseCoef = Math.exp(-1 / (this.sampleRate * releaseMs / 1000));
  }

  process(input: number): number {
    const abs = Math.abs(input);
    if (abs > this.envelope) {
      this.envelope = this.attackCoef * this.envelope + (1 - this.attackCoef) * abs;
    } else {
      this.envelope = this.releaseCoef * this.envelope + (1 - this.releaseCoef) * abs;
    }
    return this.envelope;
  }

  reset() {
    this.envelope = 0;
  }
}

/**
 * Soft-knee compressor gain computer
 */
export class GainComputer {
  thresholdDb: number;
  ratio: number;
  kneeDb: number;
  kneeStart!: number;
  kneeEnd!: number;

  constructor(thresholdDb = -20, ratio = 4, kneeDb = 6) {
    this.thresholdDb = thresholdDb;
    this.ratio = ratio;
    this.kneeDb = kneeDb;
    this.setParams(thresholdDb, ratio, kneeDb);
  }

  setParams(thresholdDb: number, ratio: number, kneeDb: number) {
    this.thresholdDb = thresholdDb;
    this.ratio = ratio;
    this.kneeDb = kneeDb;
    this.kneeStart = thresholdDb - kneeDb / 2;
    this.kneeEnd = thresholdDb + kneeDb / 2;
  }

  computeGainDb(inputDb: number): number {
    if (inputDb <= this.kneeStart) {
      return 0;
    } else if (inputDb >= this.kneeEnd) {
      const excess = inputDb - this.thresholdDb;
      const compressed = excess / this.ratio;
      return compressed - excess;
    } else {
      const kneeProgress = (inputDb - this.kneeStart) / this.kneeDb;
      const fullReduction = (inputDb - this.thresholdDb) * (1 - 1 / this.ratio);
      return -fullReduction * kneeProgress * kneeProgress;
    }
  }
}

export interface DynamicBand {
  name: string;
  freqLow: number;
  freqHigh: number;
  attackMs: number;
  releaseMs: number;
  thresholdDb: number;
  ratio: number;
  kneeDb: number;
  enabled: boolean;
}

export const DEFAULT_BANDS: DynamicBand[] = [
  {
    name: 'sub',
    freqLow: 0,
    freqHigh: 80,
    attackMs: 30,
    releaseMs: 200,
    thresholdDb: -12,
    ratio: 2,
    kneeDb: 10,
    enabled: true
  },
  {
    name: 'bass',
    freqLow: 80,
    freqHigh: 250,
    attackMs: 20,
    releaseMs: 150,
    thresholdDb: -15,
    ratio: 2.5,
    kneeDb: 8,
    enabled: true
  },
  {
    name: 'lowMid',
    freqLow: 250,
    freqHigh: 1000,
    attackMs: 10,
    releaseMs: 100,
    thresholdDb: -18,
    ratio: 3,
    kneeDb: 6,
    enabled: true
  },
  {
    name: 'mid',
    freqLow: 1000,
    freqHigh: 3000,
    attackMs: 8,
    releaseMs: 80,
    thresholdDb: -20,
    ratio: 3.5,
    kneeDb: 6,
    enabled: true
  },
  {
    name: 'presence',
    freqLow: 3000,
    freqHigh: 6000,
    attackMs: 2,
    releaseMs: 40,
    thresholdDb: -26,
    ratio: 5,
    kneeDb: 4,
    enabled: true
  },
  {
    name: 'brilliance',
    freqLow: 6000,
    freqHigh: 12000,
    attackMs: 2,
    releaseMs: 30,
    thresholdDb: -28,
    ratio: 6,
    kneeDb: 3,
    enabled: true
  },
  {
    name: 'air',
    freqLow: 12000,
    freqHigh: 20000,
    attackMs: 5,
    releaseMs: 50,
    thresholdDb: -22,
    ratio: 3,
    kneeDb: 6,
    enabled: true
  }
];

/**
 * Resonance detector for dynamic EQ behavior
 */
export class ResonanceDetector {
  numBins: number;
  smoothingFactor: number;
  averageSpectrum: Float32Array;
  peakSpectrum: Float32Array;
  initialized: boolean;

  constructor(numBins: number, smoothingFactor = 0.3) {
    this.numBins = numBins;
    this.smoothingFactor = smoothingFactor;
    this.averageSpectrum = new Float32Array(numBins);
    this.peakSpectrum = new Float32Array(numBins);
    this.initialized = false;
  }

  analyze(magnitudes: Float32Array): Float32Array {
    const resonance = new Float32Array(this.numBins);

    if (!this.initialized) {
      for (let i = 0; i < this.numBins; i++) {
        this.averageSpectrum[i] = magnitudes[i];
        this.peakSpectrum[i] = magnitudes[i];
      }
      this.initialized = true;
      return resonance;
    }

    for (let i = 0; i < this.numBins; i++) {
      const mag = magnitudes[i];

      this.averageSpectrum[i] =
        this.smoothingFactor * mag +
        (1 - this.smoothingFactor) * this.averageSpectrum[i];

      if (mag > this.peakSpectrum[i]) {
        this.peakSpectrum[i] = mag;
      } else {
        this.peakSpectrum[i] *= 0.999;
      }

      const avg = this.averageSpectrum[i];
      if (avg > 1e-10 && mag > avg * 1.5) {
        const excess = mag / avg;
        resonance[i] = Math.min(1, (excess - 1.5) / 2);
      }
    }

    return resonance;
  }

  reset() {
    this.averageSpectrum.fill(0);
    this.peakSpectrum.fill(0);
    this.initialized = false;
  }
}

/**
 * Main Hybrid Dynamic Processor class
 */
export class HybridDynamicProcessor {
  fftSize: number;
  hopSize: number;
  numBins: number;
  processor: FFTProcessor;
  resonanceDetector: ResonanceDetector;
  bands: DynamicBand[];
  bandEnvelopes: EnvelopeFollower[] | null;
  bandCompressors: GainComputer[] | null;
  sampleRate: number | null;
  dryWetMix: number;
  dynamicEqEnabled: boolean;
  dynamicEqSensitivity: number;
  dynamicEqMaxCut: number;
  aiArtifactMode: boolean;

  constructor(options: {
    fftSize?: number;
    hopSize?: number;
    bands?: DynamicBand[];
    dryWetMix?: number;
    dynamicEqEnabled?: boolean;
    dynamicEqSensitivity?: number;
    dynamicEqMaxCut?: number;
    aiArtifactMode?: boolean;
  } = {}) {
    this.fftSize = options.fftSize || 2048;
    this.hopSize = options.hopSize || 512;
    this.numBins = this.fftSize / 2;

    this.processor = new FFTProcessor(this.fftSize, this.hopSize);
    this.resonanceDetector = new ResonanceDetector(this.numBins);

    this.bands = JSON.parse(JSON.stringify(options.bands || DEFAULT_BANDS));

    this.bandEnvelopes = null;
    this.bandCompressors = null;
    this.sampleRate = null;

    this.dryWetMix = options.dryWetMix ?? 1.0;
    this.dynamicEqEnabled = options.dynamicEqEnabled ?? true;
    this.dynamicEqSensitivity = options.dynamicEqSensitivity ?? 0.5;
    this.dynamicEqMaxCut = options.dynamicEqMaxCut ?? -12;
    this.aiArtifactMode = options.aiArtifactMode ?? true;
  }

  private _initBandProcessors(sampleRate: number) {
    if (this.sampleRate === sampleRate && this.bandEnvelopes) {
      return;
    }

    this.sampleRate = sampleRate;
    this.bandEnvelopes = [];
    this.bandCompressors = [];

    for (const band of this.bands) {
      this.bandEnvelopes.push(
        new EnvelopeFollower(sampleRate, band.attackMs, band.releaseMs)
      );
      this.bandCompressors.push(
        new GainComputer(band.thresholdDb, band.ratio, band.kneeDb)
      );
    }
  }

  private _getBandForFreq(freq: number): number {
    for (let i = 0; i < this.bands.length; i++) {
      if (freq >= this.bands[i].freqLow && freq < this.bands[i].freqHigh) {
        return i;
      }
    }
    return this.bands.length - 1;
  }

  private _computeBinGains(magnitudes: Float32Array, sampleRate: number): Float32Array {
    const gains = new Float32Array(this.numBins);
    gains.fill(1);

    const bandEnergies = new Float32Array(this.bands.length);
    const bandBinCounts = new Float32Array(this.bands.length);

    for (let bin = 0; bin < this.numBins; bin++) {
      const freq = this.processor.binToFrequency(bin, sampleRate);
      const bandIdx = this._getBandForFreq(freq);
      bandEnergies[bandIdx] += magnitudes[bin] * magnitudes[bin];
      bandBinCounts[bandIdx]++;
    }

    for (let i = 0; i < this.bands.length; i++) {
      if (bandBinCounts[i] > 0) {
        bandEnergies[i] = Math.sqrt(bandEnergies[i] / bandBinCounts[i]);
      }
    }

    const bandGainsDb = new Float32Array(this.bands.length);
    for (let i = 0; i < this.bands.length; i++) {
      if (!this.bands[i].enabled || !this.bandEnvelopes || !this.bandCompressors) continue;

      const envelope = this.bandEnvelopes[i].process(bandEnergies[i]);
      const envelopeDb = linearToDb(envelope);

      bandGainsDb[i] = this.bandCompressors[i].computeGainDb(envelopeDb);
    }

    let resonance: Float32Array | null = null;
    if (this.dynamicEqEnabled) {
      resonance = this.resonanceDetector.analyze(magnitudes);
    }

    for (let bin = 0; bin < this.numBins; bin++) {
      const freq = this.processor.binToFrequency(bin, sampleRate);
      const bandIdx = this._getBandForFreq(freq);

      let gainDb = bandGainsDb[bandIdx];

      if (this.dynamicEqEnabled && resonance && resonance[bin] > 0) {
        const dynEqCut = this.dynamicEqMaxCut * resonance[bin] * this.dynamicEqSensitivity;
        gainDb += dynEqCut;
      }

      if (this.aiArtifactMode && freq >= 5000 && freq <= 12000) {
        gainDb += gainDb * 0.3;
      }

      gains[bin] = dbToLinear(gainDb);
    }

    return gains;
  }

  process(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
    this._initBandProcessors(buffer.sampleRate);

    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

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

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = outputBuffer.getChannelData(ch);
      output.fill(0);

      this._resetChannelState();

      this._processChannel(input, output, sampleRate, (progress) => {
        if (onProgress) {
          onProgress((ch + progress) / numChannels);
        }
      });

      if (this.dryWetMix < 1) {
        for (let i = 0; i < output.length; i++) {
          output[i] = input[i] * (1 - this.dryWetMix) + output[i] * this.dryWetMix;
        }
      }
    }

    return outputBuffer;
  }

  private _resetChannelState() {
    if (!this.bandEnvelopes) return;
    for (const env of this.bandEnvelopes) {
      env.reset();
    }
    this.resonanceDetector.reset();
  }

  private _processChannel(
    input: Float32Array,
    output: Float32Array,
    sampleRate: number,
    onProgress: (progress: number) => void
  ) {
    const numFrames = Math.floor((input.length - this.fftSize) / this.hopSize);
    const magnitudes = new Float32Array(this.numBins);

    for (let frame = 0; frame < numFrames; frame++) {
      const pos = frame * this.hopSize;
      const block = input.subarray(pos, pos + this.fftSize);

      const spectrum = this.processor.forward(block);

      for (let bin = 0; bin < this.numBins; bin++) {
        const re = spectrum[bin * 2];
        const im = spectrum[bin * 2 + 1];
        magnitudes[bin] = Math.sqrt(re * re + im * im);
      }

      const gains = this._computeBinGains(magnitudes, sampleRate);

      for (let bin = 0; bin < this.numBins; bin++) {
        const gain = gains[bin];
        spectrum[bin * 2] *= gain;
        spectrum[bin * 2 + 1] *= gain;

        if (bin > 0 && bin < this.numBins) {
          const mirrorBin = this.fftSize - bin;
          spectrum[mirrorBin * 2] = spectrum[bin * 2];
          spectrum[mirrorBin * 2 + 1] = -spectrum[bin * 2 + 1];
        }
      }

      const processed = this.processor.inverse(spectrum);

      for (let i = 0; i < this.fftSize; i++) {
        if (pos + i < output.length) {
          output[pos + i] += processed[i];
        }
      }

      if (frame % 100 === 0) {
        onProgress(frame / numFrames);
      }
    }

    const overlapFactor = this.fftSize / this.hopSize;
    for (let i = 0; i < output.length; i++) {
      output[i] /= overlapFactor;
    }
  }

  getBands(): DynamicBand[] {
    return JSON.parse(JSON.stringify(this.bands));
  }

  updateBand(bandIndex: number, settings: Partial<DynamicBand>) {
    if (bandIndex < 0 || bandIndex >= this.bands.length) {
      throw new Error(`Invalid band index: ${bandIndex}`);
    }

    Object.assign(this.bands[bandIndex], settings);

    if (this.bandEnvelopes && this.bandCompressors) {
      const band = this.bands[bandIndex];
      this.bandEnvelopes[bandIndex].setTimes(band.attackMs, band.releaseMs);
      this.bandCompressors[bandIndex].setParams(
        band.thresholdDb,
        band.ratio,
        band.kneeDb
      );
    }
  }

  static createGentlePreset() {
    return new HybridDynamicProcessor({
      dynamicEqSensitivity: 0.3,
      dynamicEqMaxCut: -6,
      aiArtifactMode: true,
      bands: DEFAULT_BANDS.map(band => ({
        ...band,
        thresholdDb: band.thresholdDb + 6,
        ratio: Math.max(2, band.ratio - 1)
      }))
    });
  }

  static createAggressivePreset() {
    return new HybridDynamicProcessor({
      dynamicEqSensitivity: 0.8,
      dynamicEqMaxCut: -18,
      aiArtifactMode: true,
      bands: DEFAULT_BANDS.map(band => ({
        ...band,
        thresholdDb: band.thresholdDb - 6,
        ratio: band.ratio + 2
      }))
    });
  }

  static createMasteringPreset() {
    return new HybridDynamicProcessor({
      dynamicEqSensitivity: 0.2,
      dynamicEqMaxCut: -3,
      aiArtifactMode: false,
      dryWetMix: 0.15,
      bands: DEFAULT_BANDS.map(band => ({
        ...band,
        thresholdDb: band.thresholdDb + 12,
        kneeDb: band.kneeDb + 8,
        ratio: Math.max(1.2, band.ratio - 1.5)
      }))
    });
  }
}

/**
 * Convenience function for quick processing
 */
export function processHybridDynamic(
  buffer: IAudioBuffer,
  preset = 'gentle',
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  let processor: HybridDynamicProcessor;
  switch (preset) {
    case 'aggressive':
      processor = HybridDynamicProcessor.createAggressivePreset();
      break;
    case 'mastering':
      processor = HybridDynamicProcessor.createMasteringPreset();
      break;
    case 'gentle':
    default:
      processor = HybridDynamicProcessor.createGentlePreset();
  }
  return processor.process(buffer, onProgress);
}
