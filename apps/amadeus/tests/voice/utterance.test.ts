import { describe, expect, test } from 'bun:test';

import { ActiveUtterance } from '../../src/voice/utterance.ts';

describe('ActiveUtterance', () => {
  test('finishes exactly once', async () => {
    const utterance = new ActiveUtterance('utterance-1');

    expect(utterance.beginFinish()).toBe(true);
    expect(utterance.beginFinish()).toBe(false);
    expect(utterance.finish()).toBe(true);
    expect(utterance.finish()).toBe(false);
    expect(await utterance.done).toEqual({ status: 'finished' });
  });

  test('interrupt is idempotent and aborts work', async () => {
    let interruptions = 0;
    const utterance = new ActiveUtterance('utterance-1', {
      onInterrupt: () => {
        interruptions += 1;
      },
    });

    utterance.interrupt();
    utterance.interrupt();

    expect(utterance.signal.aborted).toBe(true);
    expect(interruptions).toBe(1);
    expect(utterance.finishInterruption()).toBe(true);
    expect(await utterance.done).toEqual({ status: 'interrupted' });
  });

  test('a reserved finish cannot be interrupted', async () => {
    const utterance = new ActiveUtterance('utterance-1');
    expect(utterance.beginFinish()).toBe(true);
    utterance.interrupt();

    expect(utterance.state).toBe('finishing');
    expect(utterance.signal.aborted).toBe(false);
    expect(utterance.beginFailure(new Error('too late'))).toBe(false);
    expect(utterance.finish()).toBe(true);
    expect(await utterance.done).toEqual({ status: 'finished' });
  });

  test('infrastructure failure rejects done', async () => {
    const utterance = new ActiveUtterance('utterance-1');
    const error = new Error('TTS unavailable');

    expect(utterance.beginFailure(error)).toBe(true);
    utterance.interrupt();
    expect(utterance.state).toBe('failing');
    expect(utterance.finishFailure(error)).toBe(true);

    await expect(utterance.done).rejects.toBe(error);
    expect(utterance.state).toBe('failed');
  });
});
