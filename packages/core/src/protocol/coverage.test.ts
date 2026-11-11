import { describe, expect, it } from 'vitest';
import { snapshotCovers, type CoverageSnapshot } from './coverage.ts';

const snap = (
  sv: Array<[number, number]>,
  ds: Array<[number, Array<[number, number]>]> = [],
): CoverageSnapshot => ({
  sv: new Map(sv),
  ds: {
    clients: new Map(ds.map(([client, ranges]) => [client, ranges.map(([clock, len]) => ({ clock, len }))])),
  },
});

describe('snapshotCovers(상태 벡터 + 삭제 집합)', () => {
  it('상태 벡터가 모자라면 덮지 않는다', () => {
    expect(snapshotCovers(snap([[1, 4]]), snap([[1, 5]]))).toBe(false);
    expect(snapshotCovers(snap([]), snap([[9, 1]]))).toBe(false);
    expect(snapshotCovers(snap([[1, 5]]), snap([[1, 5]]))).toBe(true);
    expect(snapshotCovers(snap([]), snap([]))).toBe(true);
  });

  it('상태 벡터가 같아도 기기에만 있는 지우기가 있으면 덮지 않는다', () => {
    const local = snap([[1, 3]], [[1, [[1, 1]]]]);
    expect(snapshotCovers(snap([[1, 3]]), local)).toBe(false);
    expect(snapshotCovers(snap([[1, 3]], [[1, [[1, 1]]]]), local)).toBe(true);
  });

  it('받은 쪽 구간이 쪼개져 있거나 더 넓어도 품으면 덮는다', () => {
    const local = snap([[1, 10]], [[1, [[2, 4]]]]);
    expect(snapshotCovers(snap([[1, 10]], [[1, [[0, 10]]]]), local)).toBe(true);
    expect(
      snapshotCovers(
        snap(
          [[1, 10]],
          [
            [
              1,
              [
                [4, 2],
                [2, 2],
              ],
            ],
          ],
        ),
        local,
      ),
    ).toBe(true);
    expect(snapshotCovers(snap([[1, 10]], [[1, [[2, 3]]]]), local)).toBe(false);
    expect(snapshotCovers(snap([[1, 10]], [[2, [[2, 4]]]]), local)).toBe(false);
  });

  it('길이 0인 구간은 무시한다', () => {
    expect(snapshotCovers(snap([[1, 3]]), snap([[1, 3]], [[1, [[1, 0]]]]))).toBe(true);
  });
});
