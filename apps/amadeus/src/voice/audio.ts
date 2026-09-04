/** Normalized audio used inside the Voice boundary. */
export interface AudioFrame {
  data: Float32Array;
  sampleRate: number;
  channels: number;
}
