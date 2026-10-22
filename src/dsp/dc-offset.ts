/**
 * DC Offset Detection and Removal Module
 *
 * DC offset occurs when the audio waveform is shifted from the zero line,
 * reducing headroom and potentially causing clicks at edit points.
 */

import type { IAudioBuffer } from './lufs.js';

export interface DCOffsetResult {
  linear: number;
  dB: number;
  percent: number;
  significant: boolean;
}

export interface DCOffsetBufferResult {
  channels: DCOffsetResult[];
  average: {
    linear: number;
    dB: number;
    percent: number;
  };
  significant: boolean;
}

/**
 * Detect DC offset in a channel
 * @param channel - Audio samples
 * @returns DC offset analysis results
 */
export function detectDCOffset(channel: Float32Array): DCOffsetResult {
  let sum = 0;
  const length = channel.length;

  // Calculate mean of all samples
  for (let i = 0; i < length; i++) {
    sum += channel[i];
  }

  const dcOffset = sum / length;
  const absOffset = Math.abs(dcOffset);

  return {
    linear: dcOffset,
    dB: absOffset > 0 ? 20 * Math.log10(absOffset) : -Infinity,
    percent: absOffset * 100,
    significant: absOffset > 0.001  // > 0.1% is considered significant
  };
}

/**
 * Detect DC offset across all channels of a buffer
 * @param buffer - Audio buffer to analyze
 * @returns Combined DC offset analysis results
 */
export function detectDCOffsetBuffer(buffer: IAudioBuffer): DCOffsetBufferResult {
  const results: DCOffsetResult[] = [];
  let totalOffset = 0;

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    const result = detectDCOffset(channelData);
    results.push(result);
    totalOffset += Math.abs(result.linear);
  }

  const averageOffset = totalOffset / buffer.numberOfChannels;

  return {
    channels: results,
    average: {
      linear: averageOffset,
      dB: averageOffset > 0 ? 20 * Math.log10(averageOffset) : -Infinity,
      percent: averageOffset * 100
    },
    significant: results.some(r => r.significant)
  };
}

/**
 * Remove DC offset from a channel by subtracting the mean
 * @param channel - Audio samples (modified in place)
 * @returns The DC offset that was removed
 */
export function removeDCOffset(channel: Float32Array): number {
  const { linear: dcOffset } = detectDCOffset(channel);

  if (Math.abs(dcOffset) > 1e-10) {
    for (let i = 0; i < channel.length; i++) {
      channel[i] -= dcOffset;
    }
  }

  return dcOffset;
}

/**
 * Remove DC offset from all channels of a buffer
 * @param buffer - Audio buffer to process
 * @param onProgress - Progress callback
 * @returns New buffer with DC offset removed
 */
export function removeDCOffsetBuffer(
  buffer: IAudioBuffer,
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  // Check if browser AudioBuffer constructor is available
  let output: IAudioBuffer;

  if (typeof AudioBuffer !== 'undefined') {
    output = new AudioBuffer({
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      sampleRate: buffer.sampleRate
    });
  } else {
    // Custom mock class fallback for test environment
    const data = Array.from({ length: buffer.numberOfChannels }, () => new Float32Array(buffer.length));
    output = {
      sampleRate: buffer.sampleRate,
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      duration: buffer.length / buffer.sampleRate,
      getChannelData: (ch: number) => data[ch]
    };
  }

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch);
    const out = output.getChannelData(ch);

    // Copy data
    out.set(input);

    // Remove DC offset
    removeDCOffset(out);

    if (onProgress) {
      onProgress((ch + 1) / buffer.numberOfChannels);
    }
  }

  return output;
}

/**
 * Remove DC offset using a highpass filter (better for real-time)
 * This gradually removes DC rather than instant subtraction
 * @param channel - Audio samples
 * @param sampleRate - Sample rate
 * @param cutoffHz - Cutoff frequency (default 5Hz)
 * @returns Filtered samples
 */
export function removeDCOffsetFiltered(channel: Float32Array, sampleRate: number, cutoffHz = 5): Float32Array {
  const output = new Float32Array(channel.length);

  // Simple 1-pole highpass filter
  const rc = 1.0 / (2 * Math.PI * cutoffHz);
  const dt = 1.0 / sampleRate;
  const alpha = rc / (rc + dt);

  let prevInput = 0;
  let prevOutput = 0;

  for (let i = 0; i < channel.length; i++) {
    output[i] = alpha * (prevOutput + channel[i] - prevInput);
    prevInput = channel[i];
    prevOutput = output[i];
  }

  return output;
}

/**
 * DC Offset severity levels
 */
export const DC_OFFSET_SEVERITY = {
  NONE: 'none',           // < 0.01%
  MINOR: 'minor',         // 0.01% - 0.1%
  MODERATE: 'moderate',   // 0.1% - 1%
  SEVERE: 'severe'        // > 1%
} as const;

export type DCOffsetSeverity = typeof DC_OFFSET_SEVERITY[keyof typeof DC_OFFSET_SEVERITY];

/**
 * Get severity level of DC offset
 * @param percent - DC offset as percentage
 * @returns Severity level string
 */
export function getDCOffsetSeverity(percent: number): DCOffsetSeverity {
  if (percent < 0.01) return DC_OFFSET_SEVERITY.NONE;
  if (percent < 0.1) return DC_OFFSET_SEVERITY.MINOR;
  if (percent < 1) return DC_OFFSET_SEVERITY.MODERATE;
  return DC_OFFSET_SEVERITY.SEVERE;
}
