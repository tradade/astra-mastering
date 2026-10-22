import { describe, it, expect } from 'vitest';
import {
  MutableAudioBuffer,
  runMasteringChain,
  applyStereoProcessing,
} from './mastering-chain.js';
import { findTruePeak } from './true-peak.js';
import type { IAudioBuffer } from './lufs.js';

function createSineBuffer(
  frequency: number,
  sampleRate: number,
  durationSec: number,
  amplitude = 0.5,
  numChannels = 2,
): IAudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  const buf = new MutableAudioBuffer({ numberOfChannels: numChannels, length, sampleRate });
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const val = amplitude * Math.sin(2 * Math.PI * frequency * t);
    for (let ch = 0; ch < numChannels; ch++) {
      buf.getChannelData(ch)[i] = val;
    }
  }
  return buf;
}

describe('runMasteringChain', () => {
  it('is deterministic for the same input + settings', () => {
    const input = createSineBuffer(440, 44100, 0.6, 0.4);
    const settings = {
      inputGain: 0,
      normalizeLoudness: true,
      targetLufs: -14,
      truePeakLimit: true,
      truePeakCeiling: -1,
      cleanLowEnd: true,
      glueCompression: true,
      centerBass: true,
      stereoWidth: 100,
      deharsh: false,
      addAir: false,
      tapeWarmth: false,
      addPunch: false,
      cutMud: false,
      autoLevel: false,
      eqLow: 0,
      eqLowMid: -1,
      eqMid: 0,
      eqHighMid: 0.5,
      eqHigh: 0,
    };
    const a = runMasteringChain(input, settings);
    const b = runMasteringChain(input, settings);
    expect(a.buffer.length).toBe(b.buffer.length);
    const ch0a = a.buffer.getChannelData(0);
    const ch0b = b.buffer.getChannelData(0);
    for (let i = 0; i < ch0a.length; i += 64) {
      expect(ch0a[i]).toBeCloseTo(ch0b[i], 5);
    }
  });

  it('respects true-peak ceiling within tolerance', () => {
    // Hot sine that needs limiting.
    const input = createSineBuffer(1000, 48000, 0.5, 0.95);
    const ceiling = -1;
    const result = runMasteringChain(input, {
      normalizeLoudness: true,
      targetLufs: -10,
      truePeakLimit: true,
      truePeakCeiling: ceiling,
      glueCompression: false,
      cleanLowEnd: false,
      centerBass: false,
      stereoWidth: 100,
    });
    const peak = findTruePeak(result.buffer);
    // Allow small overshoot from measurement / oversampling tolerance.
    expect(peak).toBeLessThanOrEqual(ceiling + 0.35);
  });

  it('does not throw with full FX enabled', () => {
    const input = createSineBuffer(220, 44100, 0.5, 0.3);
    expect(() =>
      runMasteringChain(input, {
        autoLevel: true,
        deharsh: true,
        addAir: true,
        tapeWarmth: true,
        addPunch: true,
        cleanLowEnd: true,
        cutMud: true,
        glueCompression: true,
        centerBass: true,
        stereoWidth: 110,
        normalizeLoudness: true,
        targetLufs: -14,
        truePeakLimit: true,
        truePeakCeiling: -1,
        eqLow: 1,
        eqLowMid: -1.5,
        eqMid: 0.5,
        eqHighMid: -0.5,
        eqHigh: 1,
      }),
    ).not.toThrow();
  });

  it('width 100% stereo processing is near identity for correlated content', () => {
    const input = createSineBuffer(500, 44100, 0.2, 0.4);
    const processed = applyStereoProcessing(input, 1.0, false, 200);
    const a = input.getChannelData(0);
    const b = processed.getChannelData(0);
    let maxDiff = 0;
    for (let i = 0; i < a.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    }
    expect(maxDiff).toBeLessThan(1e-5);
  });
});
