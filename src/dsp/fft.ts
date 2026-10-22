import FFT from 'fft.js';
import { createHannWindow } from './utils.js';

/**
 * FFT Processor class for audio spectral processing
 * Provides overlap-add processing with windowing
 */
export class FFTProcessor {
  size: number;
  hopSize: number;
  fft: any; // We can use the library type or cast
  window: Float32Array;
  inputBuffer: Float32Array;
  outputBuffer: Float32Array;
  spectrum: Float32Array;
  inverseBuffer: Float32Array;

  constructor(size = 2048, hopSize: number | null = null) {
    if ((size & (size - 1)) !== 0) {
      throw new Error('FFT size must be power of 2');
    }

    this.size = size;
    this.hopSize = hopSize || size / 2;
    this.fft = new (FFT as any)(size);
    this.window = createHannWindow(size);

    this.inputBuffer = new Float32Array(size);
    this.outputBuffer = new Float32Array(size);
    this.spectrum = this.fft.createComplexArray();
    this.inverseBuffer = this.fft.createComplexArray();
  }

  /**
   * Perform forward FFT on a windowed block
   */
  forward(input: Float32Array): Float32Array {
    for (let i = 0; i < this.size; i++) {
      this.inputBuffer[i] = (input[i] || 0) * this.window[i];
    }

    this.fft.realTransform(this.spectrum, this.inputBuffer);
    this.fft.completeSpectrum(this.spectrum);

    return this.spectrum;
  }

  /**
   * Perform inverse FFT
   */
  inverse(spectrum: Float32Array): Float32Array {
    this.fft.inverseTransform(this.inverseBuffer, spectrum);

    for (let i = 0; i < this.size; i++) {
      this.outputBuffer[i] = this.inverseBuffer[i * 2] * this.window[i];
    }

    return this.outputBuffer;
  }

  /**
   * Get magnitude spectrum in dB
   */
  getMagnitudeDB(spectrum: Float32Array): Float32Array {
    const numBins = this.size / 2;
    const magnitude = new Float32Array(numBins);

    for (let i = 0; i < numBins; i++) {
      const re = spectrum[i * 2];
      const im = spectrum[i * 2 + 1];
      const mag = Math.sqrt(re * re + im * im);
      magnitude[i] = mag > 0 ? 20 * Math.log10(mag) : -120;
    }

    return magnitude;
  }

  /**
   * Get phase spectrum
   */
  getPhase(spectrum: Float32Array): Float32Array {
    const numBins = this.size / 2;
    const phase = new Float32Array(numBins);

    for (let i = 0; i < numBins; i++) {
      const re = spectrum[i * 2];
      const im = spectrum[i * 2 + 1];
      phase[i] = Math.atan2(im, re);
    }

    return phase;
  }

  /**
   * Set magnitude while preserving phase
   */
  setMagnitude(spectrum: Float32Array, magnitude: Float32Array) {
    const numBins = this.size / 2;

    for (let i = 0; i < numBins; i++) {
      const re = spectrum[i * 2];
      const im = spectrum[i * 2 + 1];
      const currentMag = Math.sqrt(re * re + im * im);

      if (currentMag > 1e-10) {
        const scale = magnitude[i] / currentMag;
        spectrum[i * 2] = re * scale;
        spectrum[i * 2 + 1] = im * scale;
      }
    }
  }

  /**
   * Get frequency for a given bin index
   */
  binToFrequency(binIndex: number, sampleRate: number): number {
    return binIndex * sampleRate / this.size;
  }

  /**
   * Get bin index for a given frequency
   */
  frequencyToBin(frequency: number, sampleRate: number): number {
    return Math.round(frequency * this.size / sampleRate);
  }
}

/**
 * Process an entire audio buffer with overlap-add FFT
 */
export function processWithFFT(
  input: Float32Array,
  fftSize: number,
  hopSize: number,
  processCallback: (spectrum: Float32Array, binFrequencies: Float32Array) => void,
  sampleRate: number
): Float32Array {
  const processor = new FFTProcessor(fftSize, hopSize);
  const output = new Float32Array(input.length);

  const binFrequencies = new Float32Array(fftSize / 2);
  for (let i = 0; i < fftSize / 2; i++) {
    binFrequencies[i] = processor.binToFrequency(i, sampleRate);
  }

  for (let pos = 0; pos + fftSize <= input.length; pos += hopSize) {
    const block = input.subarray(pos, pos + fftSize);
    const spectrum = processor.forward(block);

    processCallback(spectrum, binFrequencies);

    const processed = processor.inverse(spectrum);

    for (let i = 0; i < fftSize; i++) {
      if (pos + i < output.length) {
        output[pos + i] += processed[i];
      }
    }
  }

  const overlapFactor = fftSize / hopSize;
  for (let i = 0; i < output.length; i++) {
    output[i] /= overlapFactor;
  }

  return output;
}

/**
 * Analyze spectrum of a buffer section
 */
export function analyzeSpectrum(input: Float32Array, fftSize: number, sampleRate: number) {
  const processor = new FFTProcessor(fftSize);

  const paddedInput = new Float32Array(fftSize);
  const copyLength = Math.min(input.length, fftSize);
  for (let i = 0; i < copyLength; i++) {
    paddedInput[i] = input[i];
  }

  const spectrum = processor.forward(paddedInput);
  const magnitudeDB = processor.getMagnitudeDB(spectrum);
  const phase = processor.getPhase(spectrum);

  const frequencies = new Float32Array(fftSize / 2);
  for (let i = 0; i < fftSize / 2; i++) {
    frequencies[i] = processor.binToFrequency(i, sampleRate);
  }

  return { magnitudeDB, phase, frequencies };
}

export { FFT };
