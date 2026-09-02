import { describe, expect, test } from 'bun:test';

import { ActiveUtterance } from './utterance.ts';

describe('ActiveUtterance', () => {
  test('finishes exactly once', async () => {
    const utterance = new ActiveUtterance('utterance-1');

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

  test('non-interruptible utterances ignore interruption', () => {
    const utterance = new ActiveUtterance('utterance-1', {
      interruptible: false,
    });

    utterance.interrupt();

    expect(utterance.state).toBe('pending');
    expect(utterance.signal.aborted).toBe(false);
  });

  test('infrastructure failure rejects done', async () => {
    const utterance = new ActiveUtterance('utterance-1');
    const error = new Error('TTS unavailable');

    utterance.fail(error);

    await expect(utterance.done).rejects.toBe(error);
    expect(utterance.state).toBe('failed');
  });
});
