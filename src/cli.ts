#!/usr/bin/env node
/**
 * astra-mastering CLI — master a WAV file from the terminal.
 *
 * Reads a WAV file, runs the mastering chain, and writes the result. Useful
 * for batch mastering and for checking the engine outside a browser.
 *
 *   astra-mastering input.wav -o output.wav --lufs -14 --true-peak -1
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { analyzeAudioBuffer } from './dsp/analysis.js';
import { runMasteringChain } from './dsp/mastering-chain.js';
import { validateAndClampSettings, normalizeDitherMode, type MasteringSettings } from './dsp/settings.js';
import { decodeWAV } from './utils/wav-decoder.js';
import { encodeWAV } from './utils/encoder.js';
import { recommendMasteringSettings } from './recommender.js';

interface CliOptions {
  input: string;
  output: string;
  settings: Partial<MasteringSettings>;
  /** Use the rule-based recommendation instead of the explicit flags. */
  recommend: boolean;
  json: boolean;
}

const USAGE = `astra-mastering — deterministic local-first audio mastering

Usage:
  astra-mastering <input.wav> [options]

Options:
  -o, --out <file>       Output WAV path (default: <input>-mastered.wav)
  -l, --lufs <value>     Loudness target in LUFS (default: -14)
      --true-peak <db>   True-peak ceiling in dBTP (default: -1)
      --bit-depth <n>    Output bit depth, 16 or 24 (default: 24)
      --width <percent>  Stereo width, 50-200 (default: 100)
      --no-normalize     Skip loudness normalisation
      --no-limit         Skip the true-peak limiter
      --no-glue          Skip the glue compressor
      --no-center-bass   Keep the low end in stereo
      --recommend        Use the rule-based recommendation instead of the flags
      --json             Print the report as JSON
  -h, --help             Show this help

Examples:
  astra-mastering track.wav
  astra-mastering track.wav -o master.wav --lufs -9 --true-peak -0.5
  astra-mastering track.wav --recommend --json
`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    input: '',
    output: '',
    settings: {},
    recommend: false,
    json: false,
  };

  const rest = [...argv];
  const takeValue = (flag: string): string => {
    const value = rest.shift();
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  while (rest.length > 0) {
    const arg = rest.shift()!;
    switch (arg) {
      case '-h':
      case '--help':
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      case '-o':
      case '--out':
        options.output = takeValue(arg);
        break;
      case '-l':
      case '--lufs':
        options.settings.targetLufs = Number(takeValue(arg));
        break;
      case '--true-peak':
        options.settings.truePeakCeiling = Number(takeValue(arg));
        break;
      case '--bit-depth':
        options.settings.bitDepth = Number(takeValue(arg));
        break;
      case '--width':
        options.settings.stereoWidth = Number(takeValue(arg));
        break;
      case '--no-normalize':
        options.settings.normalizeLoudness = false;
        break;
      case '--no-limit':
        options.settings.truePeakLimit = false;
        break;
      case '--no-glue':
        options.settings.glueCompression = false;
        break;
      case '--no-center-bass':
        options.settings.centerBass = false;
        break;
      case '--recommend':
        options.recommend = true;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (options.input) {
          throw new Error('Only one input file can be processed at a time');
        }
        options.input = arg;
    }
  }

  if (!options.input) {
    throw new Error('No input file given');
  }
  if (extname(options.input).toLowerCase() !== '.wav') {
    throw new Error(`Only .wav files are supported (got "${options.input}")`);
  }
  if (!options.output) {
    const stem = basename(options.input, '.wav');
    options.output = `${stem}-mastered.wav`;
  }
  return options;
}

function formatDb(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const bytes = new Uint8Array(await readFile(options.input));
  const { buffer, bitDepth: sourceBitDepth } = decodeWAV(bytes);

  const analysis = analyzeAudioBuffer(buffer);

  let settings: MasteringSettings;
  let recommendationSource = 'manual';
  if (options.recommend) {
    const recommendation = recommendMasteringSettings(analysis);
    // The recommendation carries the wider RenderSettings dither union
    // (legacy aliases included); narrow it before clamping.
    settings = validateAndClampSettings({
      ...recommendation.settings,
      ditherMode: normalizeDitherMode(recommendation.settings.ditherMode),
    });
    recommendationSource = recommendation.source;
  } else {
    settings = validateAndClampSettings(options.settings);
  }

  const { buffer: mastered, measuredLufs, preNormalizeLufs } = runMasteringChain(
    buffer,
    settings,
    (progress, status) => {
      if (!options.json) {
        process.stderr.write(`\r${status.padEnd(40)} ${Math.round(progress * 100)}%`);
      }
    }
  );
  if (!options.json) {
    process.stderr.write('\n');
  }

  const outputBytes = encodeWAV(mastered, mastered.sampleRate, settings.bitDepth, {
    ditherMode: settings.ditherMode,
  });
  await writeFile(options.output, outputBytes);

  const report = {
    input: options.input,
    output: options.output,
    sourceBitDepth,
    outputBitDepth: settings.bitDepth,
    sampleRate: mastered.sampleRate,
    channels: mastered.numberOfChannels,
    durationSec: Number(buffer.duration.toFixed(3)),
    inputLufs: Number(analysis.inputLufs.toFixed(2)),
    inputTruePeakDb: Number(analysis.truePeakDb.toFixed(2)),
    preNormalizeLufs: Number(preNormalizeLufs.toFixed(2)),
    finalLufs: Number(measuredLufs.toFixed(2)),
    recommendationSource,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `input        ${report.input} (${report.durationSec}s, ${report.channels}ch, ${report.sampleRate} Hz, ${sourceBitDepth}-bit)`,
        `input level  ${report.inputLufs} LUFS, true peak ${formatDb(report.inputTruePeakDb)} dBTP`,
        `output       ${report.output} (${report.outputBitDepth}-bit)`,
        `output level ${report.finalLufs} LUFS (pre-normalize ${report.preNormalizeLufs})`,
        '',
      ].join('\n')
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`astra-mastering: ${message}\n`);
  process.stderr.write('\nRun `astra-mastering --help` for usage.\n');
  process.exit(1);
});
