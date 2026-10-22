import type { IAudioBuffer } from './lufs.js';

/**
 * Default transient shaper settings
 */
export const TRANSIENT_DEFAULTS = {
  ATTACK: 0.0,          // -1 to 1 (negative = softer, positive = punchier)
  SUSTAIN: 0.0,         // -1 to 1 (negative = tighter, positive = fuller)
  SENSITIVITY: 0.6,     // 0 to 1 (higher = more sensitive)
  ATTACK_TIME_MS: 1,    // Envelope attack time
  RELEASE_TIME_MS: 50,  // Envelope release time
  LOOKBACK_MS: 5,       // Transient detection lookback
};

/**
 * Transient shaper presets
 */
export const TRANSIENT_PRESETS: Record<string, { attack: number; sustain: number; sensitivity: number }> = {
  punch: { attack: 0.5, sustain: -0.2, sensitivity: 0.6 },
  snap: { attack: 0.7, sustain: -0.4, sensitivity: 0.7 },
  smooth: { attack: -0.3, sustain: 0.2, sensitivity: 0.5 },
  tight: { attack: 0.2, sustain: -0.5, sensitivity: 0.6 },
  full: { attack: 0.3, sustain: 0.4, sensitivity: 0.5 },
  drums: { attack: 0.6, sustain: -0.3, sensitivity: 0.8 },
};

/**
 * Transient Shaper class
 */
export class TransientShaper {
  attack: number;
  sustain: number;
  sensitivity: number;
  attackTimeMs: number;
  releaseTimeMs: number;
  lookbackMs: number;

  constructor(options: {
    attack?: number;
    sustain?: number;
    sensitivity?: number;
    attackTimeMs?: number;
    releaseTimeMs?: number;
    lookbackMs?: number;
  } = {}) {
    this.attack = options.attack ?? TRANSIENT_DEFAULTS.ATTACK;
    this.sustain = options.sustain ?? TRANSIENT_DEFAULTS.SUSTAIN;
    this.sensitivity = options.sensitivity ?? TRANSIENT_DEFAULTS.SENSITIVITY;
    this.attackTimeMs = options.attackTimeMs ?? TRANSIENT_DEFAULTS.ATTACK_TIME_MS;
    this.releaseTimeMs = options.releaseTimeMs ?? TRANSIENT_DEFAULTS.RELEASE_TIME_MS;
    this.lookbackMs = options.lookbackMs ?? TRANSIENT_DEFAULTS.LOOKBACK_MS;
  }

  /**
   * Detect envelope using fast attack, slow release
   */
  detectEnvelope(channel: Float32Array, sampleRate: number): Float32Array {
    const envelope = new Float32Array(channel.length);

    const attackSamples = this.attackTimeMs * sampleRate / 1000;
    const releaseSamples = (this.releaseTimeMs + (1 - this.sensitivity) * 100) * sampleRate / 1000;

    const attackCoef = Math.exp(-1 / Math.max(1, attackSamples));
    const releaseCoef = Math.exp(-1 / Math.max(1, releaseSamples));

    let level = 0;

    for (let i = 0; i < channel.length; i++) {
      const abs = Math.abs(channel[i]);

      if (abs > level) {
        level = attackCoef * level + (1 - attackCoef) * abs;
      } else {
        level = releaseCoef * level + (1 - releaseCoef) * abs;
      }

      envelope[i] = level;
    }

    return envelope;
  }

  /**
   * Detect transient regions from envelope derivative
   */
  detectTransients(envelope: Float32Array, sampleRate: number): Float32Array {
    const transients = new Float32Array(envelope.length);
    const lookback = Math.floor(this.lookbackMs * sampleRate / 1000);

    for (let i = lookback; i < envelope.length; i++) {
      const diff = envelope[i] - envelope[i - lookback];

      if (diff > 0) {
        transients[i] = Math.min(1, diff * 20 * (0.5 + this.sensitivity));
      }
    }

    const smoothed = new Float32Array(envelope.length);
    const smoothWindow = Math.floor(0.002 * sampleRate);

    for (let i = smoothWindow; i < envelope.length - smoothWindow; i++) {
      let sum = 0;
      for (let j = -smoothWindow; j <= smoothWindow; j++) {
        sum += transients[i + j];
      }
      smoothed[i] = sum / (smoothWindow * 2 + 1);
    }

    return smoothed;
  }

  /**
   * Detect sustain map (inverse of transients)
   */
  detectSustain(transients: Float32Array, envelope: Float32Array): Float32Array {
    const sustain = new Float32Array(transients.length);
    const threshold = 0.001;

    for (let i = 0; i < transients.length; i++) {
      if (envelope[i] > threshold) {
        sustain[i] = Math.max(0, 1 - transients[i] * 2);
      }
    }

    return sustain;
  }

  /**
   * Process audio buffer with transient shaping
   */
  process(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

    let output: IAudioBuffer;
    if (typeof AudioBuffer !== 'undefined') {
      output = new AudioBuffer({
        numberOfChannels: numChannels,
        length: length,
        sampleRate: sampleRate
      });
    } else {
      const data = Array.from({ length: numChannels }, () => new Float32Array(length));
      output = {
        sampleRate: sampleRate,
        numberOfChannels: numChannels,
        length: length,
        duration: length / sampleRate,
        getChannelData: (ch: number) => data[ch]
      };
    }

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const out = output.getChannelData(ch);

      const envelope = this.detectEnvelope(input, sampleRate);

      if (onProgress) onProgress((ch + 0.3) / numChannels);

      const transients = this.detectTransients(envelope, sampleRate);
      const sustain = this.detectSustain(transients, envelope);

      if (onProgress) onProgress((ch + 0.6) / numChannels);

      for (let i = 0; i < input.length; i++) {
        let gain = 1.0;

        if (transients[i] > 0.1) {
          const attackGain = 1 + this.attack * 0.5 * transients[i];
          gain *= attackGain;
        }

        if (sustain[i] > 0.1) {
          const sustainGain = 1 + this.sustain * 0.3 * sustain[i];
          gain *= sustainGain;
        }

        out[i] = input[i] * gain;
      }

      if (onProgress) onProgress((ch + 1) / numChannels);
    }

    return output;
  }

  /**
   * Apply a preset
   */
  applyPreset(presetName: string) {
    const preset = TRANSIENT_PRESETS[presetName];
    if (preset) {
      this.attack = preset.attack;
      this.sustain = preset.sustain;
      this.sensitivity = preset.sensitivity;
    }
  }
}

/**
 * Convenience function for transient shaping
 */
export function shapeTransients(
  buffer: IAudioBuffer,
  attack = 0.35,
  sustain = -0.15,
  sensitivity = 0.6,
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const shaper = new TransientShaper({ attack, sustain, sensitivity });
  return shaper.process(buffer, onProgress);
}

/**
 * Apply preset-based transient shaping
 */
export function applyTransientPreset(
  buffer: IAudioBuffer,
  preset = 'punch',
  onProgress: ((progress: number) => void) | null = null
): IAudioBuffer {
  const shaper = new TransientShaper();
  shaper.applyPreset(preset);
  return shaper.process(buffer, onProgress);
}

/**
 * Add punch to drums/percussion
 */
export function addPunch(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  return applyTransientPreset(buffer, 'punch', onProgress);
}

/**
 * Smooth out harsh transients
 */
export function smoothTransients(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  return applyTransientPreset(buffer, 'smooth', onProgress);
}

/**
 * Tighten up the sound (more attack, less sustain)
 */
export function tightenSound(buffer: IAudioBuffer, onProgress: ((progress: number) => void) | null = null): IAudioBuffer {
  return applyTransientPreset(buffer, 'tight', onProgress);
}
