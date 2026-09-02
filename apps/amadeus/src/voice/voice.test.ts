import { describe, expect, test } from 'bun:test';

import type {
  AmadeusToStageMessage,
  StageLink,
} from '../link.ts';
import type { AudioFrame } from './audio.ts';
import type { Synthesizer } from './synthesizer.ts';
import {
  AudioFormatChangedError,
  CoreVoice,
  EmptyAudioStreamError,
  StageDisconnectedError,
  VoiceBusyError,
} from './voice.ts';

class FakeStage implements StageLink {
  readonly messages: AmadeusToStageMessage[] = [];
  readonly audio: Uint8Array[] = [];
  failOn?: AmadeusToStageMessage['type'];

  send(message: AmadeusToStageMessage): void {
    if (message.type === this.failOn) {
      throw new Error(`Stage rejected ${message.type}`);
    }
    this.messages.push(message);
  }

  sendAudio(frame: Uint8Array): void {
    this.audio.push(frame);
  }
}

function audioFrame(
  data: number[] = [0.25, -0.25],
  sampleRate = 24_000,
  channels = 1,
): AudioFrame {
  return {
    data: new Float32Array(data),
    sampleRate,
    channels,
  };
}

function synthesizerFrom(frames: AudioFrame[]): Synthesizer {
  return {
    async *synthesize() {
      yield* frames;
    },
  };
}

function idSequence(): () => string {
  let id = 0;
  return () => String((id += 1));
}

async function waitForMessage<T extends AmadeusToStageMessage['type']>(
  stage: FakeStage,
  type: T,
): Promise<Extract<AmadeusToStageMessage, { type: T }>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const message = stage.messages.find(
      (candidate): candidate is Extract<
        AmadeusToStageMessage,
        { type: T }
      > => candidate.type === type,
    );
    if (message) {
      return message;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out waiting for ${type}`);
}

describe('CoreVoice', () => {
  test('finishes only after Stage confirms real playout', async () => {
    const stage = new FakeStage();
    const voice = new CoreVoice({
      stage,
      synthesizer: synthesizerFrom([audioFrame()]),
      createId: idSequence(),
    });

    const utterance = voice.say('Hello.');
    const stop = await waitForMessage(stage, 'speaker.stop');
    expect(stop.reason).toBe('completed');

    voice.playbackFinished(stop.streamId);

    expect(await utterance.done).toEqual({ status: 'finished' });
    expect(stage.audio).toHaveLength(1);
    expect(stage.messages.at(-1)).toEqual({
      type: 'utterance.end',
      utteranceId: utterance.id,
      status: 'finished',
    });
  });

  test('interrupts synthesis and ignores a repeated interrupt', async () => {
    const stage = new FakeStage();
    const synthesizer: Synthesizer = {
      async *synthesize(_text, _style, signal) {
        yield audioFrame();
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      },
    };
    const voice = new CoreVoice({
      stage,
      synthesizer,
      createId: idSequence(),
    });

    const utterance = voice.say('A long sentence.');
    const start = await waitForMessage(stage, 'speaker.start');

    voice.interrupt();
    voice.interrupt();

    expect(await utterance.done).toEqual({ status: 'interrupted' });
    const interruptedStops = stage.messages.filter(
      (message) =>
        message.type === 'speaker.stop' &&
        message.streamId === start.format.streamId &&
        message.reason === 'interrupted',
    );
    expect(interruptedStops).toHaveLength(1);
  });

  test('late playback acknowledgement cannot finish an interrupted utterance', async () => {
    const stage = new FakeStage();
    const voice = new CoreVoice({
      stage,
      synthesizer: synthesizerFrom([audioFrame()]),
      createId: idSequence(),
    });

    const first = voice.say('First.');
    const firstStop = await waitForMessage(stage, 'speaker.stop');
    voice.interrupt();
    expect(await first.done).toEqual({ status: 'interrupted' });

    voice.playbackFinished(firstStop.streamId);

    const second = voice.say('Second.');
    let secondStop: Extract<
      AmadeusToStageMessage,
      { type: 'speaker.stop' }
    > | undefined;
    for (let attempt = 0; attempt < 100 && !secondStop; attempt += 1) {
      secondStop = stage.messages.find(
        (message): message is Extract<
          AmadeusToStageMessage,
          { type: 'speaker.stop' }
        > =>
          message.type === 'speaker.stop' &&
          message.streamId !== firstStop.streamId,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!secondStop) {
      throw new Error('Timed out waiting for the second speaker.stop');
    }
    voice.playbackFinished(secondStop.streamId);
    expect(await second.done).toEqual({ status: 'finished' });
  });

  test('rejects concurrent speech', () => {
    const voice = new CoreVoice({
      stage: new FakeStage(),
      synthesizer: synthesizerFrom([audioFrame()]),
      createId: idSequence(),
    });

    voice.say('First.');

    expect(() => voice.say('Second.')).toThrow(VoiceBusyError);
  });

  test('rejects an empty synthesized stream', async () => {
    const voice = new CoreVoice({
      stage: new FakeStage(),
      synthesizer: synthesizerFrom([]),
      createId: idSequence(),
    });

    await expect(voice.say('Hello.').done).rejects.toBeInstanceOf(
      EmptyAudioStreamError,
    );
  });

  test('rejects format changes inside one utterance', async () => {
    const voice = new CoreVoice({
      stage: new FakeStage(),
      synthesizer: synthesizerFrom([
        audioFrame(),
        audioFrame([0.1, 0.2], 48_000),
      ]),
      createId: idSequence(),
    });

    await expect(voice.say('Hello.').done).rejects.toBeInstanceOf(
      AudioFormatChangedError,
    );
  });

  test('fails when Stage disconnects before playback confirmation', async () => {
    const stage = new FakeStage();
    const voice = new CoreVoice({
      stage,
      synthesizer: synthesizerFrom([audioFrame()]),
      createId: idSequence(),
    });

    const utterance = voice.say('Hello.');
    await waitForMessage(stage, 'speaker.stop');
    voice.stageDisconnected('socket closed');

    await expect(utterance.done).rejects.toBeInstanceOf(
      StageDisconnectedError,
    );
  });

  test('fails when Stage cannot start playback', async () => {
    const stage = new FakeStage();
    stage.failOn = 'speaker.start';
    const voice = new CoreVoice({
      stage,
      synthesizer: synthesizerFrom([audioFrame()]),
      createId: idSequence(),
    });

    await expect(voice.say('Hello.').done).rejects.toThrow(
      'Stage rejected speaker.start',
    );
  });
});
