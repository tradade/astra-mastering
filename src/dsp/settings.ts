export interface MasteringSettings {
  inputGain: number;         // -6 to +6 dB
  normalizeLoudness: boolean;
  targetLufs: number;        // -16 to -8 LUFS
  truePeakLimit: boolean;
  truePeakCeiling: number;   // -3 to 0 dBTP
  cleanLowEnd: boolean;      // HPF 30Hz
  glueCompression: boolean;
  deharsh: boolean;          // Dynamic harshness control
  stereoWidth: number;       // 50 to 150 %
  centerBass: boolean;       // Mono bass below 200Hz
  cutMud: boolean;           // Dynamic mid-low control
  addAir: boolean;           // High shelf exciter
  tapeWarmth: boolean;       // Tape saturation
  autoLevel: boolean;        // Dynamic leveling
  addPunch: boolean;         // Transient shaping
  eqLow: number;             // -6 to +6 dB
  eqLowMid: number;          // -6 to +6 dB
  eqMid: number;             // -6 to +6 dB
  eqHighMid: number;         // -6 to +6 dB
  eqHigh: number;            // -6 to +6 dB
  sampleRate: number;        // e.g. 44100, 48000
  bitDepth: number;          // 16 or 24
  /** Canonical encoder modes. Aliases triangular→tpdf, shaped→noise-shaped accepted on input. */
  ditherMode: 'none' | 'tpdf' | 'noise-shaped';
}

export const DEFAULT_MASTERING_SETTINGS: MasteringSettings = {
  inputGain: 0,
  normalizeLoudness: true,
  targetLufs: -14,
  truePeakLimit: true,
  truePeakCeiling: -1.0,
  cleanLowEnd: true,
  glueCompression: true,
  deharsh: false,
  stereoWidth: 100,
  centerBass: true,
  cutMud: false,
  addAir: false,
  tapeWarmth: false,
  autoLevel: false,
  addPunch: false,
  eqLow: 0,
  eqLowMid: 0,
  eqMid: 0,
  eqHighMid: 0,
  eqHigh: 0,
  sampleRate: 44100,
  bitDepth: 24,
  ditherMode: 'tpdf',
};

/** Map legacy aliases to encoder-canonical dither modes. */
export function normalizeDitherMode(
  mode: string | undefined | null,
): MasteringSettings['ditherMode'] {
  if (mode === 'none') return 'none';
  if (mode === 'noise-shaped' || mode === 'shaped') return 'noise-shaped';
  // triangular (legacy MasteringSettings) and tpdf (RenderSettings) → tpdf
  return 'tpdf';
}

/**
 * Validates and clamps setting values to their safe bounds.
 */
export function validateAndClampSettings(settings: Partial<MasteringSettings>): MasteringSettings {
  const result = { ...DEFAULT_MASTERING_SETTINGS, ...settings };

  // Clamp gain/levels
  result.inputGain = Math.max(-12, Math.min(12, result.inputGain));
  result.targetLufs = Math.max(-20, Math.min(-6, result.targetLufs));
  result.truePeakCeiling = Math.max(-6, Math.min(0, result.truePeakCeiling));
  result.stereoWidth = Math.max(50, Math.min(200, result.stereoWidth));

  // Clamp EQs to safe -6 to +6 dB boundaries
  result.eqLow = Math.max(-6, Math.min(6, result.eqLow));
  result.eqLowMid = Math.max(-6, Math.min(6, result.eqLowMid));
  result.eqMid = Math.max(-6, Math.min(6, result.eqMid));
  result.eqHighMid = Math.max(-6, Math.min(6, result.eqHighMid));
  result.eqHigh = Math.max(-6, Math.min(6, result.eqHigh));

  // Verify and force sound quality variables
  if (![44100, 48000, 88200, 96000].includes(result.sampleRate)) {
    result.sampleRate = 44100;
  }
  if (![16, 24].includes(result.bitDepth)) {
    result.bitDepth = 24;
  }
  result.ditherMode = normalizeDitherMode(result.ditherMode as string);

  return result;
}
