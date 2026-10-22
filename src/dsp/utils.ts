/**
 * DSP Utility Functions
 * Biquad filter implementations and coefficient calculators
 */

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Apply biquad filter to audio samples
 * @param samples - Input samples
 * @param coeffs - Filter coefficients {b0, b1, b2, a1, a2}
 * @returns Filtered output samples
 */
export function applyBiquadFilter(samples: Float32Array, coeffs: BiquadCoeffs): Float32Array {
  const output = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const { b0, b1, b2, a1, a2 } = coeffs;

  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return output;
}

/**
 * Calculate biquad coefficients for high shelf filter (K-weighting)
 * @param sampleRate - Sample rate in Hz
 * @param frequency - Center frequency in Hz
 * @param gainDB - Gain in dB
 * @param Q - Q factor
 * @returns Biquad coefficients
 */
export function calcHighShelfCoeffs(sampleRate: number, frequency: number, gainDB: number, Q: number): BiquadCoeffs {
  const A = Math.pow(10, gainDB / 40);
  const w0 = 2 * Math.PI * frequency / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);

  const b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
  const b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
  const a0 = (A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cosW0);
  const a2 = (A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * Calculate biquad coefficients for high pass filter (K-weighting)
 * @param sampleRate - Sample rate in Hz
 * @param frequency - Cutoff frequency in Hz
 * @param Q - Q factor
 * @returns Biquad coefficients
 */
export function calcHighPassCoeffs(sampleRate: number, frequency: number, Q: number): BiquadCoeffs {
  const w0 = 2 * Math.PI * frequency / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);

  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * Convert dB to linear gain
 * @param db - Value in dB
 * @returns Linear gain
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Convert linear gain to dB
 * @param linear - Linear gain
 * @returns Value in dB
 */
export function linearToDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

/**
 * Create a Hann window of specified size
 * @param size - Window size
 * @returns Hann window coefficients
 */
export function createHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
  }
  return window;
}

/**
 * Calculate RMS of a sample array
 * @param samples - Input samples
 * @returns RMS value
 */
export function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Find peak value in a sample array
 * @param samples - Input samples
 * @returns Peak absolute value
 */
export function findPeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Catmull-Rom interpolation
 * Useful for oversampling and true-peak detection
 *
 * @param y0 - Sample at t-1
 * @param y1 - Sample at t=0
 * @param y2 - Sample at t=1
 * @param y3 - Sample at t=2
 * @param t - Interpolation factor (0 to 1)
 * @returns Interpolated value
 */
export function interpolateCatmullRom(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  const a3 = y1;

  const t2 = t * t;
  const t3 = t2 * t;

  return a0 * t3 + a1 * t2 + a2 * t + a3;
}
