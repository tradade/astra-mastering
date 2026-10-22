/**
 * Normalizer Module
 * LUFS loudness normalization with true peak limiting
 */

import { measureLUFS } from './lufs.js';
import type { IAudioBuffer } from './lufs.js';
import { findTruePeak } from './true-peak.js';
import { applyLookaheadLimiter } from './limiter.js';
import { LIMITER_DEFAULTS, AUDIO_DEFAULTS } from './constants.js';

/**
 * Calculate the gain required to reach target LUFS
 * @param audioBuffer - Input audio buffer
 * @param targetLUFS - Target LUFS
 * @returns Gain in dB
 */
export function calculateLufsGain(audioBuffer: IAudioBuffer, targetLUFS = AUDIO_DEFAULTS.TARGET_LUFS): number {
  const currentLUFS = measureLUFS(audioBuffer);

  if (!isFinite(currentLUFS)) {
    console.warn('[LUFS] Could not measure loudness, returning 0dB gain');
    return 0;
  }

  return targetLUFS - currentLUFS;
}

/**
 * Normalize an AudioBuffer to target LUFS by applying gain
 * Enforces true peak ceiling to prevent clipping unless disabled
 *
 * @param audioBuffer - Input audio buffer
 * @param targetLUFS - Target loudness in LUFS (default -14)
 * @param ceilingDB - Maximum true peak ceiling in dB (default -1)
 * @param options - Options { skipLimiter?: boolean }
 * @returns Normalized audio buffer
 */
export function normalizeToLUFS(
  audioBuffer: IAudioBuffer,
  targetLUFS = AUDIO_DEFAULTS.TARGET_LUFS,
  ceilingDB = LIMITER_DEFAULTS.CEILING_DB,
  options: { skipLimiter?: boolean } = {}
): IAudioBuffer {
  const currentLUFS = measureLUFS(audioBuffer, targetLUFS);
  const currentPeakDB = findTruePeak(audioBuffer);

  console.log('[LUFS] Current:', currentLUFS.toFixed(2), 'LUFS, Peak:', currentPeakDB.toFixed(2), 'dBTP');

  if (!isFinite(currentLUFS)) {
    console.warn('[LUFS] Could not measure loudness, skipping normalization');
    return audioBuffer;
  }

  // Calculate gain needed to reach target LUFS
  const lufsGainDB = targetLUFS - currentLUFS;
  const gainLinear = Math.pow(10, lufsGainDB / 20);

  // Calculate what the peak will be after applying gain
  const projectedPeakDB = currentPeakDB + lufsGainDB;
  const ceilingLinear = Math.pow(10, ceilingDB / 20);

  console.log('[LUFS] Applying gain:', lufsGainDB.toFixed(2), 'dB');

  // Create buffer with gain applied
  let gainedBuffer: IAudioBuffer;
  if (typeof AudioBuffer !== 'undefined') {
    gainedBuffer = new AudioBuffer({
      numberOfChannels: audioBuffer.numberOfChannels,
      length: audioBuffer.length,
      sampleRate: audioBuffer.sampleRate
    });
  } else {
    // Custom mock class fallback for test environment
    const data = Array.from({ length: audioBuffer.numberOfChannels }, () => new Float32Array(audioBuffer.length));
    gainedBuffer = {
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      length: audioBuffer.length,
      duration: audioBuffer.length / audioBuffer.sampleRate,
      getChannelData: (ch: number) => data[ch]
    };
  }

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const input = audioBuffer.getChannelData(ch);
    const output = gainedBuffer.getChannelData(ch);
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] * gainLinear;
    }
  }

  // Skip limiter if requested
  if (options.skipLimiter) {
    console.log('[LUFS] Limiter skipped by options');
    return gainedBuffer;
  }

  // If peaks will exceed ceiling, apply lookahead limiter
  if (projectedPeakDB > ceilingDB) {
    console.log('[LUFS] Projected peak:', projectedPeakDB.toFixed(2), 'dBTP exceeds ceiling, applying limiter');
    const limitedBuffer = applyLookaheadLimiter(gainedBuffer, ceilingLinear, 3, 100);

    // Verify final levels
    const finalPeakDB = findTruePeak(limitedBuffer);
    const finalLUFS = measureLUFS(limitedBuffer);
    console.log('[LUFS] After limiting - Peak:', finalPeakDB.toFixed(2), 'dBTP, LUFS:', finalLUFS.toFixed(2));

    return limitedBuffer;
  }

  return gainedBuffer;
}

/**
 * Apply gain to an AudioBuffer without normalization
 *
 * @param audioBuffer - Input audio buffer
 * @param gainDB - Gain to apply in dB
 * @returns Gained audio buffer
 */
export function applyGain(audioBuffer: IAudioBuffer, gainDB: number): IAudioBuffer {
  const gainLinear = Math.pow(10, gainDB / 20);

  let outputBuffer: IAudioBuffer;
  if (typeof AudioBuffer !== 'undefined') {
    outputBuffer = new AudioBuffer({
      numberOfChannels: audioBuffer.numberOfChannels,
      length: audioBuffer.length,
      sampleRate: audioBuffer.sampleRate
    });
  } else {
    // Custom mock class fallback for test environment
    const data = Array.from({ length: audioBuffer.numberOfChannels }, () => new Float32Array(audioBuffer.length));
    outputBuffer = {
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels,
      length: audioBuffer.length,
      duration: audioBuffer.length / audioBuffer.sampleRate,
      getChannelData: (ch: number) => data[ch]
    };
  }

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const input = audioBuffer.getChannelData(ch);
    const output = outputBuffer.getChannelData(ch);
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] * gainLinear;
    }
  }

  return outputBuffer;
}

/**
 * Normalize to target peak level (not LUFS)
 *
 * @param audioBuffer - Input audio buffer
 * @param targetPeakDB - Target peak level in dB
 * @returns Normalized audio buffer
 */
export function normalizeToPeak(audioBuffer: IAudioBuffer, targetPeakDB = -1): IAudioBuffer {
  const currentPeakDB = findTruePeak(audioBuffer);
  const gainDB = targetPeakDB - currentPeakDB;

  console.log('[Peak] Current peak:', currentPeakDB.toFixed(2), 'dB, applying gain:', gainDB.toFixed(2), 'dB');

  return applyGain(audioBuffer, gainDB);
}
