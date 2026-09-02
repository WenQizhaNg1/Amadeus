import type { AgentInputItem, SessionInputCallback } from '@openai/agents';

function isTurnStart(item: AgentInputItem): boolean {
  if (!item || typeof item !== 'object' || !('role' in item)) {
    return false;
  }
  return item.role === 'user' || item.role === 'system';
}

function splitTurns(items: AgentInputItem[]): AgentInputItem[][] {
  if (items.length === 0) {
    return [];
  }

  const starts = items.flatMap((item, index) =>
    isTurnStart(item) ? [index] : [],
  );
  if (starts.length === 0) {
    return [items];
  }

  const boundaries = starts[0] === 0 ? starts : [0, ...starts.slice(1)];
  return boundaries.map((start, index) =>
    items.slice(start, boundaries[index + 1] ?? items.length),
  );
}

function serializedSize(items: AgentInputItem[]): number {
  return items.reduce((total, item) => {
    const value = JSON.stringify(item);
    if (value === undefined) {
      throw new TypeError('Context item must be JSON serializable.');
    }
    return total + value.length;
  }, 0);
}

function validateSize(maxHistoryChars: number): void {
  if (!Number.isInteger(maxHistoryChars) || maxHistoryChars < 0) {
    throw new RangeError('Context size must be a non-negative integer.');
  }
}

/** Selects recent complete turns without changing persisted session history. */
export function selectRecentContext(
  historyItems: AgentInputItem[],
  newItems: AgentInputItem[],
  maxHistoryChars: number,
): AgentInputItem[] {
  validateSize(maxHistoryChars);

  const turns = splitTurns(historyItems);
  if (turns.length === 0) {
    return [...newItems];
  }

  const selected: AgentInputItem[][] = [];
  let size = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const turnSize = serializedSize(turn);
    if (selected.length > 0 && size + turnSize > maxHistoryChars) {
      break;
    }
    selected.unshift(turn);
    size += turnSize;
  }

  return [...selected.flat(), ...newItems];
}

export function contextWindow(maxHistoryChars: number): SessionInputCallback {
  validateSize(maxHistoryChars);
  return (historyItems, newItems) =>
    selectRecentContext(historyItems, newItems, maxHistoryChars);
}
