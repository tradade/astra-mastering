import type { IAudioBuffer } from './lufs.js';
import { measureLUFS } from './lufs.js';
import { findTruePeak } from './true-peak.js';
import { detectDCOffsetBuffer, getDCOffsetSeverity } from './dc-offset.js';
import type { DCOffsetSeverity } from './dc-offset.js';
import { FFTProcessor } from './fft.js';

export const SPECTRAL_BANDS = {
  sub: { minHz: 20, maxHz: 80 },
  bass: { minHz: 80, maxHz: 250 },
  lowMid: { minHz: 250, maxHz: 1000 },
  mid: { minHz: 1000, maxHz: 3000 },
  presence: { minHz: 3000, maxHz: 6000 },
  brilliance: { minHz: 6000, maxHz: 12000 },
  air: { minHz: 12000, maxHz: 20000 }
} as const;

export type SpectralBandKey = keyof typeof SPECTRAL_BANDS;
export type SpectralBalance = Record<SpectralBandKey, number>;

export interface AudioAnalysisReport {
  durationSec: number;
  sampleRate: number;
  channels: number;
  inputLufs: number;
  truePeakDb: number;
  peakDb: number;
  rmsDb: number;
  crestFactorDb: number;
  dcOffset: {
    averagePercent: number;
    severity: DCOffsetSeverity;
    channels: Array<{ percent: number; severity: DCOffsetSeverity }>;
  };
  clipRisk: number;
  spectralBalance: SpectralBalance;
  mudScore: number;
  harshnessScore: number;
  airScore: number;
  stereoCorrelation: number;
  stereoWidthScore: number;
  lowEndStereoRisk: number;
}

const EMPTY_SPECTRAL_BALANCE: SpectralBalance = {
  sub: 0,
  bass: 0,
  lowMid: 0,
  mid: 0,
  presence: 0,
  brilliance: 0,
  air: 0
};

export const DEFAULT_AUDIO_ANALYSIS_REPORT: AudioAnalysisReport = {
  durationSec: 0,
  sampleRate: 44100,
  channels: 0,
  inputLufs: -120,
  truePeakDb: -120,
  peakDb: -120,
  rmsDb: -120,
  crestFactorDb: 0,
  dcOffset: {
    averagePercent: 0,
    severity: 'none',
    channels: []
  },
  clipRisk: 0,
  spectralBalance: { ...EMPTY_SPECTRAL_BALANCE },
  mudScore: 0,
  harshnessScore: 0,
  airScore: 0,
  stereoCorrelation: 1,
  stereoWidthScore: 0,
  lowEndStereoRisk: 0
};

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const finiteNumber = (value: number | undefined, fallback: number) => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const linearToDb = (value: number) => {
  return value > 1e-12 ? 20 * Math.log10(value) : -120;
};

export function sanitizeAudioAnalysisReport(
  report: Partial<AudioAnalysisReport>
): AudioAnalysisReport {
  const spectralBalance = { ...EMPTY_SPECTRAL_BALANCE };
  for (const key of Object.keys(spectralBalance) as SpectralBandKey[]) {
    spectralBalance[key] = clamp(report.spectralBalance?.[key] ?? 0, 0, 1);
  }

  return {
    durationSec: Math.max(0, finiteNumber(report.durationSec, 0)),
    sampleRate: Math.max(1, Math.round(finiteNumber(report.sampleRate, 44100))),
    channels: Math.max(0, Math.round(finiteNumber(report.channels, 0))),
    inputLufs: finiteNumber(report.inputLufs, -120),
    truePeakDb: finiteNumber(report.truePeakDb, -120),
    peakDb: finiteNumber(report.peakDb, -120),
    rmsDb: finiteNumber(report.rmsDb, -120),
    crestFactorDb: Math.max(0, finiteNumber(report.crestFactorDb, 0)),
    dcOffset: {
      averagePercent: Math.max(0, finiteNumber(report.dcOffset?.averagePercent, 0)),
      severity: report.dcOffset?.severity ?? 'none',
      channels: report.dcOffset?.channels ?? []
    },
    clipRisk: clamp(report.clipRisk ?? 0, 0, 1),
    spectralBalance,
    mudScore: clamp(report.mudScore ?? 0, 0, 1),
    harshnessScore: clamp(report.harshnessScore ?? 0, 0, 1),
    airScore: clamp(report.airScore ?? 0, 0, 1),
    stereoCorrelation: clamp(report.stereoCorrelation ?? 1, -1, 1),
    stereoWidthScore: clamp(report.stereoWidthScore ?? 0, 0, 1),
    lowEndStereoRisk: clamp(report.lowEndStereoRisk ?? 0, 0, 1)
  };
}

export function analyzeAudioBuffer(
  buffer: IAudioBuffer,
  onProgress?: (progress: number) => void
): AudioAnalysisReport {
  const { sampleRate, numberOfChannels, length } = buffer;
  const durationSec = length / sampleRate;
  onProgress?.(0.05);

  const inputLufs = measureLUFS(buffer);
  const truePeakDb = findTruePeak(buffer);
  onProgress?.(0.2);

  let peakLinear = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  let clippedSamples = 0;

  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const value = channelData[i] || 0;
      const abs = Math.abs(value);
      peakLinear = Math.max(peakLinear, abs);
      sumSquares += value * value;
      sampleCount++;
      if (abs >= 0.999) clippedSamples++;
    }
  }

  const rmsLinear = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  const peakDb = linearToDb(peakLinear);
  const rmsDb = linearToDb(rmsLinear);
  const crestFactorDb = Math.max(0, peakDb - rmsDb);
  const truePeakRisk = clamp((finiteNumber(truePeakDb, -120) + 3) / 3, 0, 1);
  const samplePeakRisk = clamp((peakLinear - 0.9) / 0.1, 0, 1);
  const clipDensityRisk = clamp(sampleCount > 0 ? (clippedSamples / sampleCount) * 50 : 0, 0, 1);
  const clipRisk = Math.max(truePeakRisk, samplePeakRisk, clipDensityRisk);
  onProgress?.(0.35);

  const dcOffsetBuffer = detectDCOffsetBuffer(buffer);
  const dcOffset = {
    averagePercent: dcOffsetBuffer.average.percent,
    severity: getDCOffsetSeverity(dcOffsetBuffer.average.percent),
    channels: dcOffsetBuffer.channels.map((channel) => ({
      percent: channel.percent,
      severity: getDCOffsetSeverity(channel.percent)
    }))
  };
  onProgress?.(0.45);

  const stereoMetrics = analyzeStereoMetrics(buffer);
  onProgress?.(0.55);

  const spectralMetrics = analyzeSpectralMetrics(buffer);
  onProgress?.(0.9);

  return sanitizeAudioAnalysisReport({
    durationSec,
    sampleRate,
    channels: numberOfChannels,
    inputLufs,
    truePeakDb,
    peakDb,
    rmsDb,
    crestFactorDb,
    dcOffset,
    clipRisk,
    ...spectralMetrics,
    ...stereoMetrics
  });
}

function analyzeStereoMetrics(buffer: IAudioBuffer) {
  if (buffer.numberOfChannels < 2 || buffer.length === 0) {
    return {
      stereoCorrelation: 1,
      stereoWidthScore: 0,
      lowEndStereoRisk: 0
    };
  }

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let dotProduct = 0;
  let sumSqL = 0;
  let sumSqR = 0;
  let midPowerSum = 0;
  let sidePowerSum = 0;

  for (let i = 0; i < buffer.length; i++) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    dotProduct += l * r;
    sumSqL += l * l;
    sumSqR += r * r;

    const mid = (l + r) / 2;
    const side = (l - r) / 2;
    midPowerSum += mid * mid;
    sidePowerSum += side * side;
  }

  const denominator = Math.sqrt(sumSqL * sumSqR);
  const stereoCorrelation = denominator > 1e-12 ? dotProduct / denominator : 1;
  const stereoTotal = midPowerSum + sidePowerSum;
  const stereoWidthScore = stereoTotal > 1e-12 ? sidePowerSum / stereoTotal : 0;

  return {
    stereoCorrelation,
    stereoWidthScore,
    lowEndStereoRisk: analyzeLowEndStereoRisk(buffer)
  };
}

function analyzeSpectralMetrics(buffer: IAudioBuffer) {
  const fftSize = 4096;
  const hopSize = 2048;
  const processor = new FFTProcessor(fftSize, hopSize);
  const numBins = fftSize / 2;
  const mixed = mixToMono(buffer);
  const averagePower = new Float32Array(numBins);
  const windowStarts = getWindowStarts(buffer.length, fftSize, hopSize, 250);

  for (const start of windowStarts) {
    const block = new Float32Array(fftSize);
    block.set(mixed.subarray(start, Math.min(start + fftSize, mixed.length)));
    const spectrum = processor.forward(block);

    for (let bin = 1; bin < numBins; bin++) {
      const re = spectrum[bin * 2];
      const im = spectrum[bin * 2 + 1];
      averagePower[bin] += re * re + im * im;
    }
  }

  if (windowStarts.length > 0) {
    for (let bin = 0; bin < numBins; bin++) {
      averagePower[bin] /= windowStarts.length;
    }
  }

  const bandPower = { ...EMPTY_SPECTRAL_BALANCE };
  let mudPower = 0;
  let harshPower = 0;
  let airPower = 0;
  let totalPower = 0;

  for (let bin = 1; bin < numBins; bin++) {
    const frequency = processor.binToFrequency(bin, buffer.sampleRate);
    const power = averagePower[bin];
    if (frequency > 20000) continue;

    totalPower += power;
    const bandKey = findBandKey(frequency);
    if (bandKey) {
      bandPower[bandKey] += power;
    }
    if (frequency >= 150 && frequency <= 400) mudPower += power;
    if (frequency >= 3000 && frequency <= 12000) harshPower += power;
    if (frequency >= 10000 && frequency <= 20000) airPower += power;
  }

  const spectralBalance = normalizeSpectralBalance(bandPower);
  const energyNorm = totalPower > 1e-12 ? totalPower : 1;
  const mudRatio = mudPower / energyNorm;
  const harshRatio = harshPower / energyNorm;
  const airRatio = airPower / energyNorm;

  return {
    spectralBalance,
    mudScore: clamp((mudRatio - 0.08) / 0.18, 0, 1),
    harshnessScore: clamp((harshRatio - 0.12) / 0.28, 0, 1),
    airScore: clamp(airRatio / 0.12, 0, 1)
  };
}

function analyzeLowEndStereoRisk(buffer: IAudioBuffer) {
  const fftSize = 4096;
  const hopSize = 2048;
  const processor = new FFTProcessor(fftSize, hopSize);
  const numBins = fftSize / 2;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const windowStarts = getWindowStarts(buffer.length, fftSize, hopSize, 120);
  let lowMidPower = 0;
  let lowSidePower = 0;

  for (const start of windowStarts) {
    const blockL = new Float32Array(fftSize);
    const blockR = new Float32Array(fftSize);
    blockL.set(left.subarray(start, Math.min(start + fftSize, left.length)));
    blockR.set(right.subarray(start, Math.min(start + fftSize, right.length)));

    const specL = new Float32Array(processor.forward(blockL));
    const specR = processor.forward(blockR);

    for (let bin = 1; bin < numBins; bin++) {
      const frequency = processor.binToFrequency(bin, buffer.sampleRate);
      if (frequency >= 150) break;

      const reMid = (specL[bin * 2] + specR[bin * 2]) / 2;
      const imMid = (specL[bin * 2 + 1] + specR[bin * 2 + 1]) / 2;
      const reSide = (specL[bin * 2] - specR[bin * 2]) / 2;
      const imSide = (specL[bin * 2 + 1] - specR[bin * 2 + 1]) / 2;
      lowMidPower += reMid * reMid + imMid * imMid;
      lowSidePower += reSide * reSide + imSide * imSide;
    }
  }

  const totalLowPower = lowMidPower + lowSidePower;
  if (totalLowPower <= 1e-12) return 0;

  const lowSideRatio = lowSidePower / totalLowPower;
  return clamp((lowSideRatio - 0.05) / 0.25, 0, 1);
}

function mixToMono(buffer: IAudioBuffer) {
  const mixed = new Float32Array(buffer.length);
  if (buffer.numberOfChannels === 0) return mixed;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channel = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) {
      mixed[i] += (channel[i] || 0) / buffer.numberOfChannels;
    }
  }

  return mixed;
}

function getWindowStarts(length: number, fftSize: number, hopSize: number, maxWindows: number) {
  if (length <= 0) return [0];
  if (length <= fftSize) return [0];

  const naturalWindowCount = Math.floor((length - fftSize) / hopSize) + 1;
  const strideWindows = Math.max(1, Math.ceil(naturalWindowCount / maxWindows));
  const starts: number[] = [];

  for (let index = 0; index < naturalWindowCount; index += strideWindows) {
    starts.push(index * hopSize);
  }

  const lastStart = length - fftSize;
  if (starts[starts.length - 1] !== lastStart) {
    starts.push(lastStart);
  }

  return starts;
}

function findBandKey(frequency: number): SpectralBandKey | null {
  for (const key of Object.keys(SPECTRAL_BANDS) as SpectralBandKey[]) {
    const band = SPECTRAL_BANDS[key];
    if (frequency >= band.minHz && frequency < band.maxHz) {
      return key;
    }
  }

  return null;
}

function normalizeSpectralBalance(bandPower: SpectralBalance): SpectralBalance {
  const total = Object.values(bandPower).reduce((sum, value) => sum + value, 0);
  if (total <= 1e-12) return { ...EMPTY_SPECTRAL_BALANCE };

  return {
    sub: bandPower.sub / total,
    bass: bandPower.bass / total,
    lowMid: bandPower.lowMid / total,
    mid: bandPower.mid / total,
    presence: bandPower.presence / total,
    brilliance: bandPower.brilliance / total,
    air: bandPower.air / total
  };
}
