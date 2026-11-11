import { afterEach, describe, expect, it } from 'vitest';
import { createDownloadPort, type SaveFileEnv } from './saveFile.ts';

interface Click {
  readonly href: string | null;
  readonly download: string;
  readonly inDocument: boolean;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function recordClicks(): Click[] {
  const clicks: Click[] = [];
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    clicks.push({
      href: target.getAttribute('href'),
      download: target.download,
      inDocument: document.body.contains(target),
    });
    // jsdom이 이동을 흉내 내지 않게 막는다.
    event.preventDefault();
  };
  document.addEventListener('click', onClick);
  cleanups.push(() => document.removeEventListener('click', onClick));
  return clicks;
}

describe('createDownloadPort (브라우저 내려받기)', () => {
  it('blob 주소로 숨긴 a[download]를 눌러 저장하고, 링크는 바로 떼고 주소는 잠시 뒤 거둔다', () => {
    const clicks = recordClicks();
    const created: Blob[] = [];
    const revoked: string[] = [];
    const timers: { readonly callback: () => void; readonly ms: number }[] = [];
    const env: SaveFileEnv = {
      document,
      createObjectURL: blob => {
        created.push(blob);
        return `blob:test/${created.length}`;
      },
      revokeObjectURL: url => void revoked.push(url),
      setTimeout: (callback, ms) => void timers.push({ callback, ms }),
    };
    const blob = new Blob(['가'], { type: 'text/plain;charset=utf-8' });

    createDownloadPort(env).save({ name: '가을_20261111.txt', blob });

    expect(created).toHaveLength(1);
    expect(created[0]).toBe(blob);
    expect(clicks).toEqual([{ href: 'blob:test/1', download: '가을_20261111.txt', inDocument: true }]);
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revoked).toEqual([]);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBeGreaterThan(0);

    timers[0]?.callback();
    expect(revoked).toEqual(['blob:test/1']);
  });
});
