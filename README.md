# astra-mastering

Deterministic, local-first audio mastering engine — pure DSP, no DOM required.

The mastering chain that powers [AstraStudio](https://github.com/tradade/astra-studio),
extracted as a standalone package. No audio ever leaves the machine: the engine
runs entirely in your browser, in a Web Worker, or in Node.

```bash
npm install @tradade/astra-mastering
```

---

## CLI

The package ships a CLI so you can master a file without writing any code:

```bash
npx astra-mastering track.wav
```

```
input        track.wav (3m 12s, 2ch, 44100 Hz, 24-bit)
input level  -18.42 LUFS, true peak -6.02 dBTP
output       track-mastered.wav (24-bit)
output level -14.00 LUFS (pre-normalize -16.90)
```

Common options:

```bash
astra-mastering track.wav --lufs -9 --true-peak -0.5   # loud, modern master
astra-mastering track.wav --recommend                  # use the rule-based recommendation
astra-mastering track.wav --json                       # machine-readable report
astra-mastering track.wav -o master.wav --bit-depth 16 # 16-bit output
astra-mastering track.wav --no-normalize --no-limit    # bypass stages
```

Run `astra-mastering --help` for the full list.

---

## Why

Most "AI mastering" tools are a black box: you upload audio, they send it to a
server, and you get a file back with no idea what changed. This engine is the
opposite — every stage is a plain function over sample data, every parameter is
yours to set, and the output is bit-for-bit reproducible.

- **Deterministic.** The same input and settings always produce the same
  output. No randomness, no hidden state, no server round-trip.
- **Pure.** The DSP layer has no DOM dependency — it runs in Node, in a Web
  Worker, or on the main thread, and produces identical results in all three.
- **Auditable.** Loudness, true peak, crest factor and spectral balance are all
  measured, not guessed, and returned in a validation report.

---

## Usage

### Mastering a buffer

```ts
import { runMasteringChain, analyzeAudioBuffer } from '@tradade/astra-mastering';

const analysis = analyzeAudioBuffer(buffer);

const { buffer: mastered, measuredLufs, preNormalizeLufs } = runMasteringChain(buffer, {
  targetLufs: -14,          // loudness target
  normalizeLoudness: true,
  truePeakLimit: true,
  truePeakCeiling: -1,      // dBTP
  glueCompression: true,
  eqLow: 0,                 // 5-band parametric EQ, ±6 dB each
  eqLowMid: 0,
  eqMid: 0,
  eqHighMid: 0,
  eqHigh: 0,
  stereoWidth: 100,         // %
  centerBass: true,
});

console.log(`pre-normalize ${preNormalizeLufs.toFixed(2)} LUFS → final ${measuredLufs.toFixed(2)} LUFS`);
```

`runMasteringChain` is synchronous and never mutates the input buffer.

### Rendering to WAV with a validation report

```ts
import { renderOfflineWithReport } from '@tradade/astra-mastering';

const { wavData, report } = await renderOfflineWithReport(audioBuffer, settings, onProgress, {
  inputAnalysis: analysis,
  recommendationSource: 'rule_based',
});

report.validation.finalLufs;      // measured loudness of the exported file
report.validation.finalTruePeakDb; // measured true peak
report.warnings;                   // e.g. "target not reached"
```

`renderOfflineWithReport` needs the Web Audio API (`AudioBuffer`,
`OfflineAudioContext`). In Node, use `runMasteringChain` + `encodeWAV` instead.

### Rule-based recommendations

```ts
import { recommendMasteringSettings } from '@tradade/astra-mastering';

const { settings, source, confidence } = recommendMasteringSettings(analysis);
// source: 'rule_based'
```

The recommender is deterministic and inspectable — it returns a settings diff
and a confidence score, never applies anything behind your back.

---

## API

### DSP — `@tradade/astra-mastering/dsp`

Pure sample processing. No DOM, no Web Audio nodes.

| Export | Purpose |
|---|---|
| `runMasteringChain(buffer, settings, onProgress?)` | The full mastering chain |
| `analyzeAudioBuffer(buffer, onProgress?)` | LUFS, true peak, crest factor, spectral balance, mud/harshness/air scores |
| `measureLUFS(buffer)` | Integrated loudness (ITU-R BS.1770) |
| `findTruePeak(buffer)` | Inter-sample true peak |
| `normalizeToLUFS(buffer, target, offset, opts?)` | Loudness normalization |
| `applyParametricEQ(buffer, settings)` | 5-band parametric EQ |
| `applyGlueCompressor(buffer, options?)` | Stereo-linked glue compressor |
| `applyStereoProcessing(buffer, width, bassMono, bassFreq)` | Mid/side width + mono bass |
| `applyLookaheadLimiter(buffer, ceilingLinear)` | Lookahead limiter |
| `applyMasteringSoftClip(buffer, options)` | Soft clipper |
| `applyFinalFilters(buffer, options)` | HPF/LPF cleanup |
| `applyExciter`, `applyTapeWarmth`, `applyMultibandTransient`, `applyDynamicLeveling`, `processHybridDynamic` | Individual stages |
| `detectDCOffsetBuffer`, `removeDCOffsetBuffer`, `getDCOffsetSeverity` | DC offset handling |
| `MutableAudioBuffer` | `IAudioBuffer` implementation over `Float32Array` |
| `validateAndClampSettings(settings)` | Clamp every setting to its safe range |
| `DEFAULT_MASTERING_SETTINGS` | The defaults |

### Rendering

| Export | Purpose |
|---|---|
| `renderOfflineWithReport(audioBuffer, settings, onProgress?, options?)` | Chain → validation report → WAV |
| `renderOffline(...)` | Chain → WAV bytes |
| `renderToAudioBuffer(...)` | Chain → `AudioBuffer` (preview cache) |
| `applyDSPChain(buffer, settings, onProgress?)` | The chain, async wrapper |
| `createExportReport({...})` | Build the validation report |
| `validateRenderedBuffer(buffer)` | Measure a rendered buffer |
| `encodeWAV(buffer, sampleRate, bitDepth, options?)` | WAV encoding (16/24-bit, dither) |
| `encodeWAVAsync(...)` | Same, with progress and cancellation |
| `decodeWAV(bytes)` | WAV decoding → `IAudioBuffer` (8/16/24/32-bit PCM, 32-bit float) |

### Settings

`MasteringSettings` / `RenderSettings` cover input gain, 5-band EQ, cut-mud,
de-harsh, glue compression, stereo width, mono bass, exciter/air, tape warmth,
dynamic leveling, transient punch, loudness normalization, true-peak limiting,
sample rate, bit depth and dither mode.

---

## Notes

- **Sample rates.** 44.1 / 48 / 88.2 / 96 kHz. Bit depth 16 or 24.
- **Dither.** `tpdf` (default), `noise-shaped` or `none`. Aliases `triangular`
  and `shaped` are accepted and normalised.
- **Determinism.** The chain always runs the complete export-grade path — there
  is no "preview-only, fewer FX" shortcut — so a preview and an export of the
  same settings are identical.

## Licence

MIT. See [LICENSE](./LICENSE).

The FFmpeg core (`@ffmpeg/core`) is **not** part of this package and is not
required by it. If you bundle it separately, note that the official build links
x264 and is therefore GPL-2.0-or-later.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). New DSP logic needs a unit test.
