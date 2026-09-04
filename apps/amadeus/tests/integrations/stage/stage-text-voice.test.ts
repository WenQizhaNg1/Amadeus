import { describe, expect, test } from 'bun:test';
import type { AmadeusToStageMessage } from '@amadeus/stage-protocol';

import type { StageLink } from '../../../src/integrations/stage/stage-link.ts';
import { StageTextVoice } from '../../../src/integrations/stage/stage-text-voice.ts';
import { VoiceBusyError } from '../../../src/voice/voice.ts';

class FakeStage implements StageLink {
  readonly messages: AmadeusToStageMessage[] = [];
  fail = false;
  pauseStart?: Promise<void>;

  async send(message: AmadeusToStageMessage): Promise<void> {
    if (this.fail) {
      throw new Error('Stage disconnected.');
    }
    this.messages.push(message);
    if (message.type === 'utterance.start') {
      await this.pauseStart;
    }
  }

  sendAudio(): void {}
}

describe('StageTextVoice', () => {
  test('writes text and presents a completed subtitle to Stage', async () => {
    const stage = new FakeStage();
    const lines: string[] = [];
    const voice = new StageTextVoice({
      stage,
      writeLine: (text) => lines.push(text),
      createId: () => '1',
    });

    const utterance = voice.say('Hello.');

    expect(await utterance.done).toEqual({ status: 'finished' });
    expect(lines).toEqual(['Hello.']);
    expect(stage.messages).toEqual([
      {
        type: 'utterance.start',
        utteranceId: 'utterance-1',
        text: 'Hello.',
      },
      {
        type: 'utterance.end',
        utteranceId: 'utterance-1',
        status: 'finished',
      },
    ]);
  });

  test('keeps console speech available while Stage is disconnected', async () => {
    const stage = new FakeStage();
    stage.fail = true;
    const lines: string[] = [];
    const voice = new StageTextVoice({
      stage,
      writeLine: (text) => lines.push(text),
    });

    expect(await voice.say('Hello.').done).toEqual({ status: 'finished' });
    expect(lines).toEqual(['Hello.']);
  });

  test('finishes an active subtitle as interrupted', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const stage = new FakeStage();
    stage.pauseStart = wait;
    const voice = new StageTextVoice({
      stage,
      createId: () => '1',
    });
    const utterance = voice.say('Hello.');

    voice.interrupt();
    expect(await utterance.done).toEqual({ status: 'interrupted' });
    if (!release) {
      throw new Error('Paused Stage send was not initialized.');
    }
    release();
    expect(stage.messages.at(-1)).toEqual({
      type: 'utterance.end',
      utteranceId: 'utterance-1',
      status: 'interrupted',
    });
  });

  test('rejects concurrent subtitles while an utterance is active', async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const stage = new FakeStage();
    stage.pauseStart = wait;
    const voice = new StageTextVoice({ stage });

    const first = voice.say('First.');
    expect(() => voice.say('Second.')).toThrow(VoiceBusyError);
    if (!release) {
      throw new Error('Paused Stage send was not initialized.');
    }
    release();
    expect(await first.done).toEqual({ status: 'finished' });
  });
});
