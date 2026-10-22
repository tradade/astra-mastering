/**
 * astra-mastering — public API.
 *
 * The DSP layer (`./dsp`) is pure: no DOM, no React, no Web Audio nodes. It
 * operates on the minimal `IAudioBuffer` shape, so the same code runs in a
 * Web Worker, in Node, or on the main thread.
 *
 * The rendering layer (`./rendering`) adds the Web Audio glue — AudioBuffer
 * conversion, resampling, WAV encoding — for browser callers. It is optional:
 * import `./dsp` if you only want the chain.
 */

export * from './dsp/index.js';
export * from './rendering/renderer.js';
export * from './rendering/export-report.js';
export * from './recommender.js';
export { encodeWAV, encodeWAVAsync, audioBufferToBlob } from './utils/encoder.js';
export type { EncodeWAVOptions, EncodeWAVAsyncOptions } from './utils/encoder.js';
export { decodeWAV } from './utils/wav-decoder.js';
export type { DecodedWav } from './utils/wav-decoder.js';
