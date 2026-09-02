/** Normalized audio used inside the Voice boundary. */
export interface AudioFrame {
  data: Float32Array;
  sampleRate: number;
  channels: number;
}

/** Format negotiated at a Stage Link audio-stream boundary. */
export interface AudioFormat {
  streamId: string;
  sampleRate: number;
  channels: number;
  encoding: 'f32le' | 's16le';
}
