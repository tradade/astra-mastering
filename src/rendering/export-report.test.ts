import { describe, expect, it } from 'vitest';
import type { IAudioBuffer } from '../dsp/index.js';
import { analyzeAudioBuffer } from '../dsp/analysis.js';
import { encodeWAV } from '../utils/encoder.js';
import { recommendMasteringSettings } from '../recommender.js';
import { createExportReport, validateRenderedBuffer } from './export-report.js';

function createFixtureBuffer(
  kind: 'quiet' | 'clipped' | 'muddy' | 'harsh' | 'wide-low-end' | 'short',
  sampleRate = 44100
): IAudioBuffer {
  const duration = kind === 'short' ? 0.1 : 1;
  const length = Math.floor(sampleRate * duration);
  const channels = [new Float32Array(length), new Float32Array(length)];

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const sine = (frequency: number, amp: number) => amp * Math.sin(2 * Math.PI * frequency * t);

    if (kind === 'quiet') {
      channels[0][i] = sine(1000, 0.03);
      channels[1][i] = channels[0][i];
    } else if (kind === 'clipped') {
      channels[0][i] = Math.max(-1, Math.min(1, sine(1000, 1.4)));
      channels[1][i] = channels[0][i];
    } else if (kind === 'muddy') {
      channels[0][i] = sine(220, 0.55) + sine(1000, 0.08);
      channels[1][i] = channels[0][i];
    } else if (kind === 'harsh') {
      channels[0][i] = sine(6000, 0.45) + sine(1000, 0.08);
      channels[1][i] = channels[0][i];
    } else if (kind === 'wide-low-end') {
      const low = sine(80, 0.45);
      channels[0][i] = low;
      channels[1][i] = -low;
    } else {
      channels[0][i] = sine(1000, 0.2);
      channels[1][i] = channels[0][i];
    }
  }

  return {
    sampleRate,
    numberOfChannels: 2,
    length,
    duration,
    getChannelData: (channel: number) => channels[channel]
  };
}

describe('Export QA report', () => {
  it('should validate final loudness, true peak, clipping count, and duration', () => {
    const buffer = createFixtureBuffer('clipped');
    const result = validateRenderedBuffer(buffer, {
      truePeakLimit: true,
      truePeakCeiling: -1,
      targetLufs: -14
    });

    expect(result.validation.finalLufs).toBe(result.analysis.inputLufs);
    expect(result.validation.finalTruePeakDb).toBeGreaterThan(-1);
    expect(result.validation.clippingSamples).toBeGreaterThan(0);
    expect(result.validation.durationSec).toBeCloseTo(1, 3);
    expect(result.validation.warnings.length).toBeGreaterThan(0);
  });

  it('should create a report that reflects actual settings and recommendation source', () => {
    const input = analyzeAudioBuffer(createFixtureBuffer('quiet'));
    const rendered = createFixtureBuffer('quiet');
    const report = createExportReport({
      renderedBuffer: rendered,
      inputAnalysis: input,
      settings: {
        targetLufs: -14,
        truePeakCeiling: -1,
        normalizeLoudness: true
      },
      recommendationSource: 'rule_based'
    });

    expect(report.inputAnalysis?.inputLufs).toBe(input.inputLufs);
    expect(report.settings.targetLufs).toBe(-14);
    expect(report.recommendationSource).toBe('rule_based');
    expect(report.finalAnalysis.durationSec).toBeCloseTo(rendered.duration, 3);
  });

  it('should cover fixture classes used by the export QA workflow', () => {
    const fixtures = ['quiet', 'clipped', 'muddy', 'harsh', 'wide-low-end', 'short'] as const;

    for (const fixture of fixtures) {
      const analysis = analyzeAudioBuffer(createFixtureBuffer(fixture));
      expect(analysis.durationSec).toBeGreaterThan(0);
      expect(Number.isFinite(analysis.truePeakDb)).toBe(true);
    }
  });

  it('should smoke-test analysis, recommendation, report, and WAV output', () => {
    const source = createFixtureBuffer('muddy');
    const analysis = analyzeAudioBuffer(source);
    const recommendation = recommendMasteringSettings(analysis);
    const report = createExportReport({
      renderedBuffer: source,
      inputAnalysis: analysis,
      settings: recommendation.settings,
      recommendationSource: recommendation.source
    });
    const wav = encodeWAV(source, source.sampleRate, 16);
    const riff = String.fromCharCode(...wav.subarray(0, 4));
    const wave = String.fromCharCode(...wav.subarray(8, 12));

    expect(recommendation.settings.cutMud).toBe(true);
    expect(report.recommendationSource).toBe('rule_based');
    expect(riff).toBe('RIFF');
    expect(wave).toBe('WAVE');
  });
});
