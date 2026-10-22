import type { AudioAnalysisReport } from './dsp/analysis.js';
import type { RenderSettings } from './rendering/renderer.js';

export type RecommendationProfile =
  | 'streaming_balanced'
  | 'modern_loud'
  | 'warm'
  | 'bright_clean'
  | 'ai_vocal_fix'
  | 'pop'
  | 'hip_hop'
  | 'edm'
  | 'rock'
  | 'metal'
  | 'acoustic'
  | 'jazz_classical'
  | 'vocal_ballad';

export type RecommendationGoal =
  | 'transparent'
  | 'balanced'
  | 'loud'
  | 'punchy'
  | 'warm'
  | 'de_harsh';

export type RecommendationSource = 'rule_based' | 'ai' | 'rule_based_fallback';

export interface MasteringRecommendation {
  profile: RecommendationProfile;
  goal?: RecommendationGoal;
  confidence: number;
  settings: RenderSettings;
  notes: string[];
  warnings: string[];
  source: RecommendationSource;
}

export interface MasteringVersion {
  id: 'safe' | 'balanced' | 'loud';
  name: string;
  intent: string;
  processingIntensity: number;
  recommendation: MasteringRecommendation;
}

export interface SettingsGuardrailResult {
  settings: RenderSettings;
  warnings: string[];
}

type NumericBounds = {
  min: number;
  max: number;
};

const NUMERIC_BOUNDS = {
  inputGain: { min: -6, max: 6 },
  eqLow: { min: -6, max: 6 },
  eqLowMid: { min: -6, max: 6 },
  eqMid: { min: -6, max: 6 },
  eqHighMid: { min: -6, max: 6 },
  eqHigh: { min: -6, max: 6 },
  targetLufs: { min: -16, max: -8 },
  truePeakCeiling: { min: -6, max: -1 },
  stereoWidth: { min: 80, max: 125 },
  sampleRate: { min: 44100, max: 96000 },
  bitDepth: { min: 16, max: 32 }
} satisfies Partial<Record<keyof RenderSettings, NumericBounds>>;

type NumericSettingKey = keyof typeof NUMERIC_BOUNDS;

const BOOLEAN_KEYS = [
  'cleanLowEnd',
  'cutMud',
  'glueCompression',
  'centerBass',
  'deharsh',
  'addAir',
  'tapeWarmth',
  'autoLevel',
  'addPunch',
  'normalizeLoudness',
  'truePeakLimit'
] satisfies Array<keyof RenderSettings>;

const DITHER_MODES = ['none', 'tpdf', 'noise-shaped', 'triangular', 'shaped'] as const;
const SAMPLE_RATES = [44100, 48000, 88200, 96000];
const BIT_DEPTHS = [16, 24, 32];

export const PROFILE_DEFAULTS: Record<RecommendationProfile, RenderSettings> = {
  streaming_balanced: {
    inputGain: 0,
    eqLow: 0,
    eqLowMid: 0,
    eqMid: 0,
    eqHighMid: 0,
    eqHigh: 0,
    cleanLowEnd: true,
    cutMud: false,
    glueCompression: true,
    stereoWidth: 100,
    centerBass: false,
    deharsh: false,
    addAir: false,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: false,
    normalizeLoudness: true,
    targetLufs: -14,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'tpdf'
  },
  modern_loud: {
    inputGain: 0,
    eqLow: 0.5,
    eqLowMid: 0,
    eqMid: 0,
    eqHighMid: 0,
    eqHigh: 0.5,
    cleanLowEnd: true,
    cutMud: false,
    glueCompression: true,
    stereoWidth: 105,
    centerBass: true,
    deharsh: false,
    addAir: false,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: true,
    normalizeLoudness: true,
    targetLufs: -10,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'tpdf'
  },
  warm: {
    inputGain: 0,
    eqLow: 0.7,
    eqLowMid: 0,
    eqMid: 0,
    eqHighMid: -0.5,
    eqHigh: -0.2,
    cleanLowEnd: true,
    cutMud: false,
    glueCompression: true,
    stereoWidth: 100,
    centerBass: false,
    deharsh: false,
    addAir: false,
    tapeWarmth: true,
    autoLevel: false,
    addPunch: false,
    normalizeLoudness: true,
    targetLufs: -14,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'tpdf'
  },
  bright_clean: {
    inputGain: 0,
    eqLow: 0,
    eqLowMid: -0.5,
    eqMid: 0,
    eqHighMid: 0,
    eqHigh: 1,
    cleanLowEnd: true,
    cutMud: false,
    glueCompression: true,
    stereoWidth: 105,
    centerBass: false,
    deharsh: false,
    addAir: true,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: false,
    normalizeLoudness: true,
    targetLufs: -14,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'noise-shaped'
  },
  ai_vocal_fix: {
    inputGain: 0,
    eqLow: 0,
    eqLowMid: -0.8,
    eqMid: 0.3,
    eqHighMid: -0.8,
    eqHigh: 0,
    cleanLowEnd: true,
    cutMud: true,
    glueCompression: true,
    stereoWidth: 100,
    centerBass: true,
    deharsh: true,
    addAir: false,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: false,
    normalizeLoudness: true,
    targetLufs: -14,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'tpdf'
  },
  pop: {
    inputGain: 0,
    eqLow: 0.4,
    eqLowMid: -0.7,
    eqMid: 0.2,
    eqHighMid: 0.4,
    eqHigh: 0.9,
    cleanLowEnd: true,
    cutMud: true,
    glueCompression: true,
    stereoWidth: 108,
    centerBass: true,
    deharsh: false,
    addAir: true,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: true,
    normalizeLoudness: true,
    targetLufs: -11.5,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'noise-shaped'
  },
  hip_hop: {
    inputGain: 0,
    eqLow: 1.2,
    eqLowMid: -0.5,
    eqMid: 0,
    eqHighMid: -0.2,
    eqHigh: 0.4,
    cleanLowEnd: true,
    cutMud: true,
    glueCompression: true,
    stereoWidth: 102,
    centerBass: true,
    deharsh: false,
    addAir: false,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: true,
    normalizeLoudness: true,
    targetLufs: -10.5,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'tpdf'
  },
  edm: {
    inputGain: 0,
    eqLow: 1,
    eqLowMid: -0.8,
    eqMid: -0.2,
    eqHighMid: 0.3,
    eqHigh: 0.8,
    cleanLowEnd: true,
    cutMud: true,
    glueCompression: true,
    stereoWidth: 112,
    centerBass: true,
    deharsh: false,
    addAir: true,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: true,
    normalizeLoudness: true,
    targetLufs: -9.5,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'noise-shaped'
  },
  rock: {
    inputGain: 0,
    eqLow: 0.5,
    eqLowMid: -0.4,
    eqMid: 0.5,
    eqHighMid: -0.3,
    eqHigh: 0.4,
    cleanLowEnd: true,
    cutMud: false,
    glueCompression: true,
    stereoWidth: 100,
    centerBass: true,
    deharsh: true,
    addAir: false,
    tapeWarmth: true,
    autoLevel: false,
    addPunch: true,
    normalizeLoudness: true,
    targetLufs: -11.5,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'tpdf'
  },
  metal: {
    inputGain: 0,
    eqLow: 0.7,
    eqLowMid: -1.1,
    eqMid: 0.4,
    eqHighMid: -0.8,
    eqHigh: 0.2,
    cleanLowEnd: true,
    cutMud: true,
    glueCompression: true,
    stereoWidth: 102,
    centerBass: true,
    deharsh: true,
    addAir: false,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: true,
    normalizeLoudness: true,
    targetLufs: -10.5,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'tpdf'
  },
  acoustic: {
    inputGain: 0,
    eqLow: 0.2,
    eqLowMid: -0.3,
    eqMid: 0.4,
    eqHighMid: 0,
    eqHigh: 0.7,
    cleanLowEnd: true,
    cutMud: false,
    glueCompression: false,
    stereoWidth: 100,
    centerBass: false,
    deharsh: false,
    addAir: true,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: false,
    normalizeLoudness: true,
    targetLufs: -14,
    truePeakLimit: true,
    truePeakCeiling: -1.2,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'noise-shaped'
  },
  jazz_classical: {
    inputGain: 0,
    eqLow: 0.2,
    eqLowMid: 0,
    eqMid: 0,
    eqHighMid: -0.2,
    eqHigh: 0.3,
    cleanLowEnd: true,
    cutMud: false,
    glueCompression: false,
    stereoWidth: 100,
    centerBass: false,
    deharsh: false,
    addAir: false,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: false,
    normalizeLoudness: true,
    targetLufs: -16,
    truePeakLimit: true,
    truePeakCeiling: -1.5,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'noise-shaped'
  },
  vocal_ballad: {
    inputGain: 0,
    eqLow: 0,
    eqLowMid: -0.6,
    eqMid: 0.5,
    eqHighMid: -0.6,
    eqHigh: 0.7,
    cleanLowEnd: true,
    cutMud: true,
    glueCompression: true,
    stereoWidth: 100,
    centerBass: true,
    deharsh: true,
    addAir: true,
    tapeWarmth: false,
    autoLevel: false,
    addPunch: false,
    normalizeLoudness: true,
    targetLufs: -13.5,
    truePeakLimit: true,
    truePeakCeiling: -1,
    sampleRate: 44100,
    bitDepth: 24,
    ditherMode: 'noise-shaped'
  }
};

export function guardRecommendationSettings(input: Record<string, unknown>): SettingsGuardrailResult {
  const settings: RenderSettings = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (!isRenderSettingKey(key)) {
      warnings.push(`Rejected unknown setting "${key}".`);
      continue;
    }

    if (isNumericSettingKey(key)) {
      const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      if (numericValue === undefined) {
        warnings.push(`Rejected non-numeric value for "${key}".`);
        continue;
      }

      let nextValue: number;
      if (key === 'targetLufs') {
        const bounds = getTargetLufsBounds(numericValue);
        nextValue = clampWithWarning(key, numericValue, bounds, warnings);
      } else if (key === 'sampleRate') {
        nextValue = nearestAllowedValue(numericValue, SAMPLE_RATES);
        if (nextValue !== numericValue) warnings.push(`Clamped sampleRate to ${nextValue}.`);
      } else if (key === 'bitDepth') {
        nextValue = nearestAllowedValue(numericValue, BIT_DEPTHS);
        if (nextValue !== numericValue) warnings.push(`Clamped bitDepth to ${nextValue}.`);
      } else {
        nextValue = clampWithWarning(key, numericValue, NUMERIC_BOUNDS[key], warnings);
      }

      settings[key] = nextValue as never;
      continue;
    }

    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') {
        warnings.push(`Rejected non-boolean value for "${key}".`);
        continue;
      }
      settings[key] = value as never;
      continue;
    }

    if (key === 'ditherMode') {
      if (!DITHER_MODES.includes(value as NonNullable<RenderSettings['ditherMode']>)) {
        warnings.push(`Rejected unsupported ditherMode "${String(value)}".`);
        continue;
      }
      settings.ditherMode = value as RenderSettings['ditherMode'];
    }
  }

  if (settings.truePeakLimit !== false && settings.truePeakCeiling !== undefined && settings.truePeakCeiling > -1) {
    settings.truePeakCeiling = -1;
    warnings.push('Clamped truePeakCeiling to -1 dBTP for limiter safety.');
  }

  return { settings, warnings };
}

export function recommendMasteringSettings(
  analysis: AudioAnalysisReport,
  profile: RecommendationProfile = 'streaming_balanced',
  goal: RecommendationGoal = 'balanced',
  currentSettings?: RenderSettings
): MasteringRecommendation {
  const defaults = getGoalAdjustedDefaults(profile, goal);
  const settings: RenderSettings = { ...defaults, ...currentSettings };
  const notes: string[] = [`Started from ${profile.replaceAll('_', ' ')} profile defaults with ${goal.replaceAll('_', '-')} goal.`];
  const warnings: string[] = [];

  if (analysis.mudScore > 0.6) {
    settings.cutMud = true;
    settings.eqLowMid = Math.min(settings.eqLowMid ?? 0, -2);
    notes.push('Detected low-mid buildup, enabling mud reduction and lowering 250 Hz area.');
  } else if (analysis.mudScore > 0.35) {
    settings.eqLowMid = Math.min(settings.eqLowMid ?? 0, -1);
    notes.push('Moderate low-mid buildup, applying a conservative low-mid cut.');
  }

  if (analysis.harshnessScore > 0.6) {
    settings.deharsh = true;
    settings.eqHighMid = Math.min(settings.eqHighMid ?? 0, -2);
    settings.addAir = false;
    notes.push('Detected harsh high-mids, enabling de-harsh and avoiding added air.');
  } else if (analysis.harshnessScore > 0.35) {
    settings.deharsh = true;
    settings.eqHighMid = Math.min(settings.eqHighMid ?? 0, -1);
    notes.push('Moderate harshness, applying light dynamic de-harsh.');
  }

  if (analysis.airScore < 0.3 && analysis.harshnessScore < 0.45 && profile !== 'metal') {
    settings.addAir = true;
    settings.eqHigh = Math.max(settings.eqHigh ?? 0, 1.2);
    notes.push('Top end is restrained without harshness, adding controlled air.');
  }

  if (analysis.lowEndStereoRisk > 0.4) {
    settings.centerBass = true;
    settings.stereoWidth = Math.min(settings.stereoWidth ?? 100, 100);
    notes.push('Detected wide low end, centering bass for mono compatibility.');
  } else if (analysis.stereoWidthScore < 0.08 && analysis.stereoCorrelation > 0.85) {
    settings.stereoWidth = Math.max(settings.stereoWidth ?? 100, 110);
    notes.push('Stereo field is narrow, adding a small width lift.');
  }

  if (analysis.clipRisk > 0.5 || analysis.crestFactorDb < 6) {
    settings.targetLufs = Math.min(settings.targetLufs ?? -14, -14);
    settings.inputGain = Math.min(settings.inputGain ?? 0, -1);
    settings.truePeakLimit = true;
    settings.truePeakCeiling = -1.2;
    notes.push('High clip risk or low crest factor, using conservative loudness and peak ceiling.');
    warnings.push('Avoid aggressive loudness on this source; clipping or limited dynamics were detected.');
  } else if (analysis.inputLufs < -22 && profile !== 'modern_loud') {
    settings.inputGain = Math.max(settings.inputGain ?? 0, 1.5);
    notes.push('Input is quiet, adding modest pre-gain before processing.');
  }

  if (goal === 'transparent') {
    settings.glueCompression = false;
    settings.addPunch = false;
    settings.stereoWidth = Math.min(settings.stereoWidth ?? 100, 105);
    settings.targetLufs = Math.min(settings.targetLufs ?? -14, -14);
    notes.push('Transparent goal selected, preserving dynamics and limiting enhancement intensity.');
  }

  if (goal === 'punchy' && analysis.crestFactorDb >= 8 && analysis.clipRisk < 0.45) {
    settings.addPunch = true;
    settings.glueCompression = true;
    notes.push('Punchy goal selected, enabling transient support while source dynamics are still healthy.');
  }

  if (goal === 'warm') {
    settings.tapeWarmth = true;
    settings.eqHighMid = Math.min(settings.eqHighMid ?? 0, 0);
    notes.push('Warm goal selected, adding controlled warmth and avoiding high-mid emphasis.');
  }

  if (goal === 'de_harsh') {
    settings.deharsh = true;
    settings.addAir = false;
    settings.eqHighMid = Math.min(settings.eqHighMid ?? 0, -1.5);
    notes.push('De-harsh goal selected, prioritizing fatigue control over brightness.');
  }

  if (analysis.dcOffset.severity === 'moderate' || analysis.dcOffset.severity === 'severe') {
    settings.cleanLowEnd = true;
    notes.push('DC offset was detected, keeping low-end cleanup enabled.');
  }

  const guarded = guardRecommendationSettings(settings as Record<string, unknown>);

  return {
    profile,
    goal,
    confidence: calculateConfidence(analysis),
    settings: guarded.settings,
    notes,
    warnings: [...warnings, ...guarded.warnings],
    source: 'rule_based'
  };
}

export function generateMasteringVersions(
  analysis: AudioAnalysisReport,
  profile: RecommendationProfile = 'streaming_balanced',
  currentSettings?: RenderSettings
): MasteringVersion[] {
  return [
    {
      id: 'safe',
      name: 'Safe / Clean',
      intent: 'Preserve dynamics and avoid over-processing.',
      processingIntensity: 0.4,
      recommendation: tuneVersionRecommendation(
        recommendMasteringSettings(analysis, profile, 'transparent', currentSettings),
        analysis,
        'safe'
      )
    },
    {
      id: 'balanced',
      name: 'Balanced / Release',
      intent: 'Streaming-ready release master with controlled loudness.',
      processingIntensity: 0.65,
      recommendation: tuneVersionRecommendation(
        recommendMasteringSettings(analysis, profile, 'balanced', currentSettings),
        analysis,
        'balanced'
      )
    },
    {
      id: 'loud',
      name: 'Loud / Impact',
      intent: 'More aggressive master for impact while staying inside safety guardrails.',
      processingIntensity: 0.85,
      recommendation: tuneVersionRecommendation(
        recommendMasteringSettings(analysis, profile, 'loud', currentSettings),
        analysis,
        'loud'
      )
    }
  ];
}

function getGoalAdjustedDefaults(profile: RecommendationProfile, goal: RecommendationGoal): RenderSettings {
  const defaults: RenderSettings = { ...PROFILE_DEFAULTS[profile] };

  if (goal === 'transparent') {
    defaults.targetLufs = getProfileTargetLufs(profile, 'transparent');
    defaults.glueCompression = false;
    defaults.addPunch = false;
    defaults.addAir = false;
    defaults.stereoWidth = Math.min(defaults.stereoWidth ?? 100, 105);
  } else if (goal === 'loud') {
    defaults.targetLufs = getProfileTargetLufs(profile, 'loud');
    defaults.glueCompression = true;
    defaults.addPunch = true;
    defaults.truePeakLimit = true;
    defaults.truePeakCeiling = -1;
  } else if (goal === 'punchy') {
    defaults.targetLufs = -12.5;
    defaults.glueCompression = true;
    defaults.addPunch = true;
  } else if (goal === 'warm') {
    defaults.targetLufs = -14;
    defaults.tapeWarmth = true;
    defaults.addAir = false;
  } else if (goal === 'de_harsh') {
    defaults.targetLufs = -14;
    defaults.deharsh = true;
    defaults.addAir = false;
    defaults.eqHighMid = Math.min(defaults.eqHighMid ?? 0, -1);
  } else {
    defaults.targetLufs = getProfileTargetLufs(profile, 'balanced');
  }

  return defaults;
}

function tuneVersionRecommendation(
  recommendation: MasteringRecommendation,
  analysis: AudioAnalysisReport,
  versionId: MasteringVersion['id']
): MasteringRecommendation {
  const settings: RenderSettings = { ...recommendation.settings };
  const notes = [...recommendation.notes];
  const warnings = [...recommendation.warnings];

  if (versionId === 'safe') {
    settings.targetLufs = getProfileTargetLufs(recommendation.profile, 'transparent');
    settings.inputGain = Math.min(settings.inputGain ?? 0, 0);
    settings.stereoWidth = Math.min(settings.stereoWidth ?? 100, 105);
    settings.glueCompression = false;
    settings.addPunch = false;
    notes.push('Safe version keeps loudness and enhancement conservative.');
  }

  if (versionId === 'balanced') {
    settings.targetLufs = getProfileTargetLufs(recommendation.profile, 'balanced');
    settings.glueCompression = recommendation.profile !== 'acoustic' && recommendation.profile !== 'jazz_classical';
    settings.truePeakLimit = true;
    settings.truePeakCeiling = Math.min(settings.truePeakCeiling ?? -1, -1);
    notes.push('Balanced version targets a release-ready master without max loudness.');
  }

  if (versionId === 'loud') {
    settings.targetLufs = analysis.clipRisk > 0.5 || analysis.crestFactorDb < 8
      ? Math.min(getProfileTargetLufs(recommendation.profile, 'balanced'), -12)
      : getProfileTargetLufs(recommendation.profile, 'loud');
    settings.glueCompression = true;
    settings.addPunch = analysis.crestFactorDb >= 7;
    settings.truePeakLimit = true;
    settings.truePeakCeiling = -1;
    notes.push('Loud version increases impact but remains constrained by source safety checks.');

    if (analysis.clipRisk > 0.45 || analysis.harshnessScore > 0.65 || analysis.crestFactorDb < 8) {
      warnings.push('Loud version may expose clipping, harshness, or limited dynamics. Check by ear before export.');
    }
  }

  const guarded = guardRecommendationSettings(settings as Record<string, unknown>);

  return {
    ...recommendation,
    settings: guarded.settings,
    notes,
    warnings: [...warnings, ...guarded.warnings]
  };
}

function getProfileTargetLufs(profile: RecommendationProfile, goal: 'transparent' | 'balanced' | 'loud') {
  if (goal === 'transparent') {
    return profile === 'jazz_classical' ? -16 : -14;
  }

  if (goal === 'loud') {
    if (profile === 'modern_loud' || profile === 'hip_hop') return -10;
    if (profile === 'edm') return -9.5;
    if (profile === 'pop' || profile === 'rock') return -11;
    if (profile === 'metal') return -10;
    if (profile === 'acoustic' || profile === 'jazz_classical') return -13;
    return -11;
  }

  if (profile === 'modern_loud') return -11;
  if (
    profile === 'streaming_balanced' ||
    profile === 'warm' ||
    profile === 'bright_clean' ||
    profile === 'ai_vocal_fix'
  ) {
    return -12.5;
  }

  return PROFILE_DEFAULTS[profile].targetLufs ?? -12.5;
}

function isRenderSettingKey(key: string): key is keyof RenderSettings {
  return (
    isNumericSettingKey(key) ||
    (BOOLEAN_KEYS as readonly string[]).includes(key) ||
    key === 'ditherMode'
  );
}

function isNumericSettingKey(key: string): key is NumericSettingKey {
  return key in NUMERIC_BOUNDS;
}

function getTargetLufsBounds(value: number): NumericBounds {
  if (value > -12) return { min: -11, max: -8 };
  return { min: -16, max: -12 };
}

function clampWithWarning(
  key: keyof RenderSettings,
  value: number,
  bounds: NumericBounds,
  warnings: string[]
) {
  const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
  if (clamped !== value) {
    warnings.push(`Clamped ${String(key)} from ${value} to ${clamped}.`);
  }
  return clamped;
}

function nearestAllowedValue(value: number, allowed: number[]) {
  return allowed.reduce((nearest, current) => {
    return Math.abs(current - value) < Math.abs(nearest - value) ? current : nearest;
  }, allowed[0]);
}

function calculateConfidence(analysis: AudioAnalysisReport) {
  let confidence = 0.72;

  if (analysis.durationSec >= 20) confidence += 0.08;
  if (analysis.inputLufs > -60) confidence += 0.06;
  if (analysis.clipRisk > 0.7) confidence -= 0.08;
  if (analysis.stereoCorrelation < -0.2) confidence -= 0.06;

  return Math.round(Math.min(0.92, Math.max(0.45, confidence)) * 100) / 100;
}
