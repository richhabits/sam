import { describe, expect, it } from 'vitest';
import { encodeWidgetState, parseWidgetState } from './widgetState';

describe('widget snapshot', () => {
  it('round-trips paired yard state', () => {
    const raw = encodeWidgetState({
      paired: true,
      demo: false,
      line: 'Yard idle',
      detail: '3 tasks today',
    });
    expect(parseWidgetState(raw)).toEqual({
      paired: true,
      demo: false,
      line: 'Yard idle',
      detail: '3 tasks today',
    });
  });

  it('empty or garbage is an honest disconnected launcher, not a fake live SAM', () => {
    expect(parseWidgetState(null).paired).toBe(false);
    expect(parseWidgetState('not-json').line).toBe('Ask SAM');
  });
});
