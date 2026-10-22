import type { IAudioBuffer } from './lufs.js';

interface BandSettings {
  fastAttack: number;
  fastRelease: number;
  slowAttack: number;
  slowRelease: number;
  transientGain: number;
  sustainGain: number;
  smoothing: number;
}

/**
 * Apply multiband transient shaping to an AudioBuffer
 */
export function applyMultibandTransient(
  buffer: IAudioBuffer,
  onProgress: (progress: number) => void = () => {}
): IAudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;

  const f1 = 200;
  const f2 = 4000;

  const bands: Record<'low' | 'mid' | 'high', BandSettings> = {
    low: {
      fastAttack: 0.005,
      fastRelease: 0.050,
      slowAttack: 0.025,
      slowRelease: 0.250,
      transientGain: 2,
      sustainGain: -1,
      smoothing: 0.020
    },
    mid: {
      fastAttack: 0.001,
      fastRelease: 0.040,
      slowAttack: 0.020,
      slowRelease: 0.200,
      transientGain: 6,
      sustainGain: 0,
      smoothing: 0.020
    },
    high: {
      fastAttack: 0.003,
      fastRelease: 0.030,
      slowAttack: 0.015,
      slowRelease: 0.150,
      transientGain: 2,
      sustainGain: 0,
      smoothing: 0.020
    }
  };

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

    const lowBand = new Float32Array(length);
    const midBand = new Float32Array(length);
    const highBand = new Float32Array(length);

    splitBands(input, lowBand, midBand, highBand, f1, f2, sampleRate);

    const lowProcessed = processTransients(lowBand, bands.low, sampleRate);
    const midProcessed = processTransients(midBand, bands.mid, sampleRate);
    const highProcessed = processTransients(highBand, bands.high, sampleRate);

    for (let i = 0; i < length; i++) {
      output[i] = lowProcessed[i] + midProcessed[i] + highProcessed[i];
    }

    onProgress((ch + 1) / numChannels);
  }

  return outputBuffer;
}

/**
 * Split audio into 3 bands using Linkwitz-Riley crossover
 */
function splitBands(
  input: Float32Array,
  low: Float32Array,
  mid: Float32Array,
  high: Float32Array,
  f1: number,
  f2: number,
  sampleRate: number
) {
  const length = input.length;

  const lp1a = createBiquadCoeffs('lowpass', f1, sampleRate, 0.707);
  const lp1b = createBiquadCoeffs('lowpass', f1, sampleRate, 0.707);
  const hp1a = createBiquadCoeffs('highpass', f1, sampleRate, 0.707);
  const hp1b = createBiquadCoeffs('highpass', f1, sampleRate, 0.707);

  const lp2a = createBiquadCoeffs('lowpass', f2, sampleRate, 0.707);
  const lp2b = createBiquadCoeffs('lowpass', f2, sampleRate, 0.707);
  const hp2a = createBiquadCoeffs('highpass', f2, sampleRate, 0.707);
  const hp2b = createBiquadCoeffs('highpass', f2, sampleRate, 0.707);

  const temp1 = new Float32Array(length);
  const temp2 = new Float32Array(length);

  // Low band: LP1a -> LP1b
  applyBiquad(input, temp1, lp1a);
  applyBiquad(temp1, low, lp1b);

  // Highpassed at f1: HP1a -> HP1b
  applyBiquad(input, temp1, hp1a);
  applyBiquad(temp1, temp2, hp1b);

  // Mid band: highpassed temp2 -> LP2a -> LP2b
  applyBiquad(temp2, temp1, lp2a);
  applyBiquad(temp1, mid, lp2b);

  // High band: highpassed temp2 -> HP2a -> HP2b
  applyBiquad(temp2, temp1, hp2a);
  applyBiquad(temp1, high, hp2b);
}

/**
 * Create biquad filter coefficients
 */
function createBiquadCoeffs(type: 'lowpass' | 'highpass', freq: number, sampleRate: number, Q: number) {
  const w0 = 2 * Math.PI * freq / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  let b0, b1, b2, a0, a1, a2;

  if (type === 'lowpass') {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0
  };
}

/**
 * Apply biquad filter to signal
 */
function applyBiquad(
  input: Float32Array,
  output: Float32Array,
  coeffs: { b0: number; b1: number; b2: number; a1: number; a2: number }
) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;

    output[i] = y0;
  }
}

/**
 * Process transients for a single band
 */
function processTransients(band: Float32Array, settings: BandSettings, sampleRate: number): Float32Array {
  const length = band.length;
  const output = new Float32Array(length);

  const fastAttackCoeff = Math.exp(-1 / (settings.fastAttack * sampleRate));
  const fastReleaseCoeff = Math.exp(-1 / (settings.fastRelease * sampleRate));
  const slowAttackCoeff = Math.exp(-1 / (settings.slowAttack * sampleRate));
  const slowReleaseCoeff = Math.exp(-1 / (settings.slowRelease * sampleRate));
  const smoothingCoeff = Math.exp(-1 / (settings.smoothing * sampleRate));

  const transientGainLinear = Math.pow(10, settings.transientGain / 20);
  const sustainGainLinear = Math.pow(10, settings.sustainGain / 20);

  let fastEnv = 0;
  let slowEnv = 0;
  let smoothedGain = 1;

  for (let i = 0; i < length; i++) {
    const sample = band[i];
    const absVal = Math.abs(sample);

    if (absVal > fastEnv) {
      fastEnv = fastAttackCoeff * fastEnv + (1 - fastAttackCoeff) * absVal;
    } else {
      fastEnv = fastReleaseCoeff * fastEnv + (1 - fastReleaseCoeff) * absVal;
    }

    if (absVal > slowEnv) {
      slowEnv = slowAttackCoeff * slowEnv + (1 - slowAttackCoeff) * absVal;
    } else {
      slowEnv = slowReleaseCoeff * slowEnv + (1 - slowReleaseCoeff) * absVal;
    }

    const diff = fastEnv - slowEnv;

    let targetGain: number;
    if (diff > 0) {
      const transientStrength = slowEnv > 0.0001
        ? Math.min(diff / slowEnv, 1)
        : Math.min(diff / 0.0001, 1);
      targetGain = 1 + (transientGainLinear - 1) * transientStrength;
    } else {
      const sustainStrength = slowEnv > 0.0001
        ? Math.min(-diff / slowEnv, 1)
        : Math.min(-diff / 0.0001, 1);
      targetGain = 1 + (sustainGainLinear - 1) * sustainStrength;
    }

    smoothedGain = smoothingCoeff * smoothedGain + (1 - smoothingCoeff) * targetGain;

    output[i] = sample * smoothedGain;
  }

  return output;
}
