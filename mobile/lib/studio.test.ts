import { describe, expect, it } from 'vitest';
import { studioImageUrl } from './studio';

describe('studioImageUrl', () => {
  it('builds a real Pollinations URL from the prompt', () => {
    const url = studioImageUrl('a terracotta robot', { seed: 7, width: 768, height: 768 });
    expect(url).toBe(
      'https://image.pollinations.ai/prompt/a%20terracotta%20robot?width=768&height=768&nologo=true&seed=7',
    );
  });

  it('refuses an empty prompt', () => {
    expect(studioImageUrl('   ')).toBeNull();
  });

  it('caps an oversized edge instead of asking the phone for a huge image', () => {
    const url = studioImageUrl('x', { width: 4000, height: 10, seed: 1 });
    expect(url).toContain('width=1024');
    expect(url).toContain('height=256');
  });
});
