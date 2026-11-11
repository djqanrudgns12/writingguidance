import { describe, expect, it } from 'vitest';
import { locateAll, locateSpell, mapPosition } from './locate.ts';

const t = (original: string, before = '', after = '') => ({ original, context: { before, after } });

describe('맞춤법 위치 찾기(PLAN §8.6)', () => {
  it('앞뒤 글자가 맞는 곳을 고른다', () => {
    const text = '되요 그리고 정말 되요.';
    expect(locateSpell(text, text, t('되요', '정말 ', '.'))).toEqual({ start: 10, end: 12 });
  });

  it('요청 뒤 앞쪽에 글자가 더해지면 예상 위치를 옮겨 맞는 곳을 찾는다', () => {
    const before = '오늘은 되요. 내일도 되요.';
    const after = '아침에 ' + before;
    const r = locateSpell(before, after, t('되요', '내일도 ', '.'));
    expect(after.slice(r!.start, r!.end)).toBe('되요');
    expect(r!.start).toBe(after.indexOf('내일도 되요') + 4);
  });

  it('앞뒤가 바뀌었으면 original만 맞는 곳 중 가까운 것, 없으면 null', () => {
    expect(locateSpell('a 되요 b', 'x 되요 y', t('되요', 'a ', ' b'))).toEqual({ start: 2, end: 4 });
    expect(locateSpell('되요', '돼요', t('되요'))).toBeNull();
  });

  it('위치 옮기기: 바뀐 곳 앞은 그대로, 뒤는 길이 차이만큼', () => {
    expect(mapPosition('abcdef', 'abXXcdef', 1)).toBe(1);
    expect(mapPosition('abcdef', 'abXXcdef', 4)).toBe(6);
  });

  it('같은 실수가 여러 번이면 각각 다른 자리', () => {
    const text = '되요 되요 되요';
    const r = locateAll(text, text, [t('되요'), t('되요'), t('되요'), t('되요')]);
    expect(r.slice(0, 3).map(x => x?.start)).toEqual([0, 3, 6]);
    expect(r[3]).toBeNull();
  });
});
