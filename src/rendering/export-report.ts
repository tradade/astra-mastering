import type { AudioAnalysisReport } from '../dsp/analysis.js';
import { analyzeAudioBuffer } from '../dsp/analysis.js';
import type { IAudioBuffer } from '../dsp/index.js';
import type { RenderSettings } from './renderer.js';

export interface RenderValidation {
  finalLufs: number;
  finalTruePeakDb: number;
  clippingSamples: number;
  clippingRisk: number;
  durationSec: number;
  warnings: string[];
}

export interface ExportReport {
  createdAt: string;
  settings: RenderSettings;
  recommendationSource: string;
  inputAnalysis: AudioAnalysisReport | null;
  finalAnalysis: AudioAnalysisReport;
  validation: RenderValidation;
  warnings: string[];
}

export function validateRenderedBuffer(
  buffer: IAudioBuffer,
  settings: RenderSettings
): { analysis: AudioAnalysisReport; validation: RenderValidation } {
  const analysis = analyzeAudioBuffer(buffer);
  const ceiling = settings.truePeakLimit ? settings.truePeakCeiling ?? -1 : 0;
  let clippingSamples = 0;
  let totalSamples = 0;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) {
      totalSamples++;
      if (Math.abs(channelData[i] || 0) >= 0.999) {
        clippingSamples++;
      }
    }
  }

  const warnings: string[] = [];
  if (settings.truePeakLimit && analysis.truePeakDb > ceiling + 0.2) {
    warnings.push(`Final true peak ${analysis.truePeakDb.toFixed(2)} dBTP exceeds ceiling ${ceiling.toFixed(1)} dBTP.`);
  }
  if (clippingSamples > 0) {
    warnings.push(`${clippingSamples} samples are at or above -0.01 dBFS.`);
  }
  if (analysis.clipRisk > 0.5) {
    warnings.push('Final render has elevated clipping risk.');
  }

  return {
    analysis,
    validation: {
      finalLufs: analysis.inputLufs,
      finalTruePeakDb: analysis.truePeakDb,
      clippingSamples,
      clippingRisk: totalSamples > 0 ? clippingSamples / totalSamples : 0,
      durationSec: analysis.durationSec,
      warnings
    }
  };
}

export function createExportReport({
  renderedBuffer,
  settings,
  inputAnalysis,
  recommendationSource = 'manual',
  warnings = []
}: {
  renderedBuffer: IAudioBuffer;
  settings: RenderSettings;
  inputAnalysis?: AudioAnalysisReport | null;
  recommendationSource?: string;
  warnings?: string[];
}): ExportReport {
  const { analysis, validation } = validateRenderedBuffer(renderedBuffer, settings);
  const allWarnings = [...warnings, ...validation.warnings];

  return {
    createdAt: new Date().toISOString(),
    settings: { ...settings },
    recommendationSource,
    inputAnalysis: inputAnalysis ?? null,
    finalAnalysis: analysis,
    validation,
    warnings: allWarnings
  };
}
