import { describe, it, expect } from 'vitest';
import { measureLUFS } from './lufs.js';
import type { IAudioBuffer } from './lufs.js';
import { findTruePeak } from './true-peak.js';
import { detectDCOffset, removeDCOffset } from './dc-offset.js';
import { calculateLufsGain, applyGain } from './normalizer.js';
import { encodeWAV } from '../utils/encoder.js';
import { analyzeAudioBuffer, sanitizeAudioAnalysisReport } from './analysis.js';

// Helper to generate a test audio buffer containing a sine wave
function createSineWaveBuffer(
  frequency: number,
  sampleRate: number,
  durationSec: number,
  amplitude = 0.5,
  dcOffset = 0.0,
  numChannels = 2
): IAudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  const channels = Array.from({ length: numChannels }, () => new Float32Array(length));

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const val = amplitude * Math.sin(2 * Math.PI * frequency * t) + dcOffset;
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][i] = val;
    }
  }

  return {
    sampleRate,
    numberOfChannels: numChannels,
    length,
    duration: durationSec,
    getChannelData: (ch: number) => channels[ch]
  };
}

function createStereoSineBuffer(
  frequency: number,
  sampleRate: number,
  durationSec: number,
  leftAmplitude: number,
  rightAmplitude: number,
  rightPolarity = 1
): IAudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  const channels = [new Float32Array(length), new Float32Array(length)];

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const sine = Math.sin(2 * Math.PI * frequency * t);
    channels[0][i] = leftAmplitude * sine;
    channels[1][i] = rightPolarity * rightAmplitude * sine;
  }

  return {
    sampleRate,
    numberOfChannels: 2,
    length,
    duration: durationSec,
    getChannelData: (ch: number) => channels[ch]
  };
}

describe('DSP Foundation Engine Tests', () => {
  describe('LUFS Measurement', () => {
    it('should measure integrated loudness of a standard 1kHz sine wave close to expected levels', () => {
      // 1kHz sine wave at 0.5 amplitude (~ -6 dB Peak)
      const buffer = createSineWaveBuffer(1000, 44100, 1.0, 0.5);
      const lufs = measureLUFS(buffer);
      
      // Expected LUFS for a full-scale sine is around -3dB compared to peak, K-weighting filters apply minor attenuation
      expect(lufs).toBeGreaterThan(-15);
      expect(lufs).toBeLessThan(-3);
    });

    it('should handle short audio gracefully by falling back to specified default', () => {
      const shortBuffer = createSineWaveBuffer(1000, 44100, 0.1, 0.5); // 100ms
      const lufs = measureLUFS(shortBuffer, -14);
      expect(lufs).toBe(-14);
    });
  });

  describe('True Peak Detection', () => {
    it('should correctly measure the true peak of a standard sine wave', () => {
      const amplitude = 0.707; // ~ -3 dBFS
      const buffer = createSineWaveBuffer(1000, 44100, 0.5, amplitude);
      const peakDb = findTruePeak(buffer);
      
      expect(peakDb).toBeCloseTo(20 * Math.log10(amplitude), 0.5);
    });
  });

  describe('DC Offset Correction', () => {
    it('should detect a DC offset added to the signal', () => {
      const offsetValue = 0.05; // 5% DC offset
      const buffer = createSineWaveBuffer(400, 44100, 0.5, 0.2, offsetValue);
      
      const analysis = detectDCOffset(buffer.getChannelData(0));
      expect(analysis.percent).toBeCloseTo(5.0, 1);
      expect(analysis.significant).toBe(true);
    });

    it('should remove DC offset and center the signal at zero mean', () => {
      const offsetValue = 0.1; // 10% DC offset
      const buffer = createSineWaveBuffer(400, 44100, 0.5, 0.2, offsetValue);
      
      const channel = new Float32Array(buffer.getChannelData(0));
      const removed = removeDCOffset(channel);
      
      expect(removed).toBeCloseTo(offsetValue, 3);
      
      const newAnalysis = detectDCOffset(channel);
      expect(newAnalysis.percent).toBeLessThan(0.01);
      expect(newAnalysis.significant).toBe(false);
    });
  });

  describe('Normalizer Utilities', () => {
    it('should compute exact gain needed to reach target LUFS', () => {
      const buffer = createSineWaveBuffer(1000, 44100, 0.5, 0.2);
      const currentLUFS = measureLUFS(buffer);
      
      const target = -14;
      const gainDB = calculateLufsGain(buffer, target);
      
      expect(gainDB).toBeCloseTo(target - currentLUFS, 4);
    });

    it('should apply gain correctly to the buffer', () => {
      const buffer = createSineWaveBuffer(1000, 44100, 0.2, 0.1);
      const gainDB = 6.02; // double amplitude (~6dB)
      
      const gained = applyGain(buffer, gainDB);
      const originalPeak = buffer.getChannelData(0)[100];
      const newPeak = gained.getChannelData(0)[100];
      
      expect(newPeak).toBeCloseTo(originalPeak * 2, 1);
    });
  });

  describe('WAV Encoding', () => {
    it('should encode audio buffer into valid WAV format with correct RIFF headers', () => {
      const buffer = createSineWaveBuffer(1000, 44100, 0.2, 0.5);
      const wavBytes = encodeWAV(buffer, 44100, 16);
      
      // Check RIFF header bytes
      const headerStr = String.fromCharCode(...wavBytes.subarray(0, 4));
      const waveStr = String.fromCharCode(...wavBytes.subarray(8, 12));
      const fmtStr = String.fromCharCode(...wavBytes.subarray(12, 16));
      const dataStr = String.fromCharCode(...wavBytes.subarray(36, 40));
      
      expect(headerStr).toBe('RIFF');
      expect(waveStr).toBe('WAVE');
      expect(fmtStr).toBe('fmt ');
      expect(dataStr).toBe('data');
      
      // Verify sample rate location (bytes 24-27)
      const view = new DataView(wavBytes.buffer);
      const sampleRate = view.getUint32(24, true);
      const numChannels = view.getUint16(22, true);
      const bitDepth = view.getUint16(34, true);
      
      expect(sampleRate).toBe(44100);
      expect(numChannels).toBe(2);
      expect(bitDepth).toBe(16);
    });
  });

  describe('Audio Analysis Report', () => {
    it('should calculate stable mono level metrics without double-counting the mono channel', () => {
      const amplitude = 0.5;
      const buffer = createSineWaveBuffer(1000, 44100, 1, amplitude, 0, 1);
      const report = analyzeAudioBuffer(buffer);

      expect(report.channels).toBe(1);
      expect(report.peakDb).toBeCloseTo(20 * Math.log10(amplitude), 1);
      expect(report.rmsDb).toBeCloseTo(20 * Math.log10(amplitude / Math.sqrt(2)), 1);
      expect(report.stereoCorrelation).toBe(1);
      expect(report.stereoWidthScore).toBe(0);
    });

    it('should report clip risk from exact sample peaks', () => {
      const buffer = createSineWaveBuffer(1000, 44100, 1, 1.0);
      const report = analyzeAudioBuffer(buffer);

      expect(report.peakDb).toBeCloseTo(0, 1);
      expect(report.clipRisk).toBeGreaterThan(0.9);
    });

    it('should identify the dominant spectral band for a bass tone', () => {
      const buffer = createSineWaveBuffer(120, 44100, 1, 0.5);
      const report = analyzeAudioBuffer(buffer);

      expect(report.spectralBalance.bass).toBeGreaterThan(0.6);
      expect(report.spectralBalance.bass).toBeGreaterThan(report.spectralBalance.presence);
    });

    it('should flag out-of-phase low-end stereo content', () => {
      const buffer = createStereoSineBuffer(80, 44100, 1, 0.5, 0.5, -1);
      const report = analyzeAudioBuffer(buffer);

      expect(report.stereoCorrelation).toBeLessThan(-0.95);
      expect(report.lowEndStereoRisk).toBeGreaterThan(0.8);
    });

    it('should sanitize partial reports into bounded finite values', () => {
      const report = sanitizeAudioAnalysisReport({
        inputLufs: Number.NaN,
        clipRisk: 20,
        stereoCorrelation: -4,
        spectralBalance: {
          sub: 2,
          bass: -1,
          lowMid: Number.POSITIVE_INFINITY,
          mid: 0.2,
          presence: 0.3,
          brilliance: 0.4,
          air: 0.5
        }
      });

      expect(report.inputLufs).toBe(-120);
      expect(report.clipRisk).toBe(1);
      expect(report.stereoCorrelation).toBe(-1);
      expect(report.spectralBalance.sub).toBe(1);
      expect(report.spectralBalance.bass).toBe(0);
      expect(report.spectralBalance.lowMid).toBe(0);
    });
  });
});
