# Contributing to astra-mastering

Thanks for taking the time to contribute. This package is the audio mastering
engine used by [AstraStudio](https://github.com/tradade/astra-studio), and it
is deliberately small and pure: every stage is a plain function over sample
data, with no DOM dependency.

## Getting set up

Requirements: **Node.js 20+** and **pnpm 10+** (`corepack enable` is enough).

```bash
pnpm install
pnpm test           # vitest
pnpm build          # tsc -b → dist/
pnpm lint           # eslint (0 errors expected)
```

## Before you open a pull request

```bash
pnpm test && pnpm build && pnpm lint
```

New DSP logic needs a unit test. `pnpm lint` currently reports a handful of
**warnings** (`no-explicit-any` in the older worker layers). New code should
not add to them.

## Ground rules for DSP changes

1. **Stay pure.** The `src/dsp/` layer must not touch the DOM, React, or any
   browser API. It runs in Node, in a Web Worker, and on the main thread, and
   must produce identical results in all three. Guard new code with
   `typeof AudioBuffer !== 'undefined'` checks if it needs the DOM constructor.
2. **Never mutate the input.** `runMasteringChain` works on a copy. Stage
   functions that write into channel data must do so on a copy too.
3. **Determinism is a contract.** No randomness, no `Date.now()`, no
   iteration-order-dependent logic. The same input and settings must always
   produce byte-identical output — this is what makes a preview match its
   export.
4. **Do not add a "preview" shortcut.** The chain always runs the full
   export-grade path. A cheaper preview path would break preview/export parity.
5. **Clamp every new setting.** Add it to `validateAndClampSettings` with a safe
   range, and give it a default in `DEFAULT_MASTERING_SETTINGS`.

## Reporting a bug

Please include the input's sample rate, channel count, duration, the settings
used, and the measured output (LUFS, true peak). A short snippet that
reproduces it is worth more than a description.

## Code of Conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
