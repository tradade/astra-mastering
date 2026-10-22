// Offline render + main-thread mastering fallback.
//
// The canonical DSP path lives in `dsp/mastering-chain.ts`. This module:
//   - wraps it for AudioBuffer I/O
//   - encodes WAV + export reports
//   - provides a main-thread fallback when the worker is unavailable

import { measureLUFS, runMasteringChain, normalizeDitherMode } from '../dsp/index.js';
import type { IAudioBuffer } from '../dsp/index.js';
import { encodeWAVAsync } from '../utils/encoder.js';
import { createExportReport } from './export-report.js';
import type { ExportReport } from './export-report.js';
import type { AudioAnalysisReport } from '../dsp/analysis.js';

/**
 * Interface for audio rendering settings
 */
export interface RenderSettings {
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
  sampleRate?: number;
  bitDepth?: number;
  /** Canonical: tpdf | noise-shaped | none. Aliases triangular/shaped accepted by encoder. */
  ditherMode?: 'tpdf' | 'noise-shaped' | 'none' | 'triangular' | 'shaped';
}

export interface RenderOptions {
  shouldCancel?: () => boolean;
  inputAnalysis?: AudioAnalysisReport | null;
  recommendationSource?: string;
}

export interface OfflineRenderResult {
  wavData: Uint8Array;
  renderedBuffer: AudioBuffer;
  report: ExportReport;
}

/** Copy an IAudioBuffer into a real AudioBuffer (DOM / main thread). */
export function iAudioBufferToAudioBuffer(source: IAudioBuffer): AudioBuffer {
  if (typeof AudioBuffer !== 'undefined' && source instanceof AudioBuffer) {
    return source;
  }
  const out = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length: source.length,
    sampleRate: source.sampleRate,
  });
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    out.copyToChannel(Float32Array.from(source.getChannelData(ch)), ch);
  }
  return out;
}

/**
 * Apply the canonical mastering chain on the main thread.
 * Same algorithm as the DSP worker — used as fallback when the worker is down.
 */
export async function applyDSPChain(
  buffer: IAudioBuffer,
  settings: RenderSettings,
  onProgress: ((progress: number) => void) | null = null,
  _logPrefix = '[DSP]',
): Promise<{ buffer: IAudioBuffer; measuredLufs: number; preNormalizeLufs: number }> {
  // Yield once so UI can paint before a long sync chain.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const result = runMasteringChain(buffer, settings, (p, _status) => {
    onProgress?.(p);
  });

  return {
    buffer: result.buffer,
    measuredLufs: result.measuredLufs,
    preNormalizeLufs: result.preNormalizeLufs,
  };
}

/**
 * Resample an AudioBuffer using OfflineAudioContext
 */
export async function resampleAudioBuffer(
  sourceBuffer: AudioBuffer,
  targetSampleRate: number,
): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('OfflineAudioContext is not supported in this environment');
  }

  if (!sourceBuffer || !targetSampleRate || sourceBuffer.sampleRate === targetSampleRate) {
    return sourceBuffer;
  }

  const numChannels = sourceBuffer.numberOfChannels;
  const numSamples = Math.ceil(sourceBuffer.duration * targetSampleRate);
  const offlineCtx = new OfflineAudioContext(numChannels, numSamples, targetSampleRate);
  const source = offlineCtx.createBufferSource();

  source.buffer = sourceBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  return offlineCtx.startRendering();
}

/**
 * Main offline render function to produce WAV data
 */
export async function renderOffline(
  sourceBuffer: AudioBuffer,
  settings: RenderSettings,
  onProgress?: (progress: number) => void,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const result = await renderOfflineWithReport(sourceBuffer, settings, onProgress, options);
  return result.wavData;
}

/**
 * Full offline render: canonical mastering chain → validation report → WAV.
 * Does NOT use OfflineAudioContext DynamicsCompressor (true peak path only).
 */
export async function renderOfflineWithReport(
  sourceBuffer: AudioBuffer,
  settings: RenderSettings,
  onProgress?: (progress: number) => void,
  options: RenderOptions = {},
): Promise<OfflineRenderResult> {
  const { shouldCancel = null } = options;
  const throwIfCancelled = () => {
    if (shouldCancel && shouldCancel()) {
      throw new Error('Cancelled');
    }
  };

  const targetSampleRate = settings.sampleRate || sourceBuffer.sampleRate || 44100;
  console.log('[Offline Render] Starting (canonical chain)...', {
    duration: sourceBuffer.duration,
    targetSampleRate,
  });

  throwIfCancelled();
  if (onProgress) onProgress(0.05);

  // Optional resample first so the chain runs at the export sample rate.
  let working: AudioBuffer = sourceBuffer;
  if (sourceBuffer.sampleRate !== targetSampleRate) {
    if (onProgress) onProgress(0.08);
    working = await resampleAudioBuffer(sourceBuffer, targetSampleRate);
  }
  throwIfCancelled();

  const dspResult = await applyDSPChain(
    working,
    settings,
    (p) => {
      if (onProgress) onProgress(0.1 + p * 0.65);
    },
    '[Offline Render]',
  );
  throwIfCancelled();

  const renderedBuffer = iAudioBufferToAudioBuffer(dspResult.buffer);
  if (onProgress) onProgress(0.78);

  const report = createExportReport({
    renderedBuffer,
    settings,
    inputAnalysis: options.inputAnalysis,
    recommendationSource: options.recommendationSource,
  });
  throwIfCancelled();
  if (onProgress) onProgress(0.85);

  const ditherMode = normalizeDitherMode(settings.ditherMode);
  const wavData = await encodeWAVAsync(
    renderedBuffer,
    targetSampleRate,
    settings.bitDepth || 24,
    {
      onProgress: (p) => {
        if (onProgress) onProgress(0.85 + p * 0.14);
      },
      ditherMode,
      shouldCancel: shouldCancel || undefined,
    },
  );
  if (onProgress) onProgress(1.0);

  console.log('[Offline Render] Complete!', {
    outputSize: wavData.byteLength,
    finalLufs: report.validation.finalLufs,
    finalTruePeakDb: report.validation.finalTruePeakDb,
    warnings: report.warnings,
  });
  return { wavData, renderedBuffer, report };
}

/**
 * Cache/preview rendering helper — always full chain (same as export DSP).
 */
export async function renderToAudioBuffer(
  sourceBuffer: AudioBuffer,
  settings: RenderSettings,
  _mode: 'preview' | 'export' = 'export',
): Promise<{ buffer: AudioBuffer; lufs: number }> {
  const dspResult = await applyDSPChain(sourceBuffer, settings, undefined, '[Cache Render]');
  const buffer = iAudioBufferToAudioBuffer(dspResult.buffer);
  const lufs = measureLUFS(buffer);
  return { buffer, lufs };
}
