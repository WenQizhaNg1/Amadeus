import type { AudioFrame } from './audio.ts';

export class InvalidAudioFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAudioFrameError';
  }
}

export function validateAudioFrame(frame: AudioFrame): void {
  if (!Number.isInteger(frame.sampleRate) || frame.sampleRate <= 0) {
    throw new InvalidAudioFrameError('Audio sampleRate must be a positive integer.');
  }

  if (!Number.isInteger(frame.channels) || frame.channels <= 0) {
    throw new InvalidAudioFrameError('Audio channels must be a positive integer.');
  }

  if (frame.data.length % frame.channels !== 0) {
    throw new InvalidAudioFrameError(
      'Interleaved audio sample count must be divisible by channels.',
    );
  }
}

/** Encode samples explicitly so the wire format never depends on host endianness. */
export function encodeFloat32LE(samples: Float32Array): Uint8Array {
  const output = new Uint8Array(samples.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(output.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      samples[index]!,
      true,
    );
  }

  return output;
}
