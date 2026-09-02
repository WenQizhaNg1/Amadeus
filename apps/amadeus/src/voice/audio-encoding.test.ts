import { describe, expect, test } from 'bun:test';

import {
  encodeFloat32LE,
  InvalidAudioFrameError,
  validateAudioFrame,
} from './audio-encoding.ts';

describe('audio encoding', () => {
  test('encodes Float32 samples as little-endian bytes', () => {
    const bytes = encodeFloat32LE(new Float32Array([1, -0.5]));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getFloat32(0, true)).toBe(1);
    expect(view.getFloat32(4, true)).toBe(-0.5);
  });

  test('rejects invalid interleaved frames', () => {
    expect(() =>
      validateAudioFrame({
        data: new Float32Array([0, 0, 0]),
        sampleRate: 24_000,
        channels: 2,
      }),
    ).toThrow(InvalidAudioFrameError);
  });
});
