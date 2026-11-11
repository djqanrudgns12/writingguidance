import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeSaveState, persistedCovers, stateVectorCovers, type SaveInputs } from './saveState.ts';

const base: SaveInputs = {
  online: true,
  unsynced: 0,
  persistedCoversLocal: true,
  persistFailed: false,
  locked: false,
};

describe('computeSaveState', () => {
  it.each<[string, Partial<SaveInputs>, string]>([
    ['다 저장됨', {}, 'saved'],
    ['연결 안 됨', { online: false }, 'local'],
    ['연결 안 됨이어도 잠금이 먼저', { online: false, locked: true }, 'locked'],
    ['보낼 것이 남음', { unsynced: 2 }, 'sending'],
    ['서버가 받았지만 DB에 쓰기 전', { persistedCoversLocal: false }, 'sending'],
    ['서버 저장 실패, 다시 시도 중', { persistFailed: true }, 'sending'],
    ['잠김', { locked: true, unsynced: 3 }, 'locked'],
  ])('%s', (_name, patch, expected) => {
    expect(computeSaveState({ ...base, ...patch })).toBe(expected);
  });
});

describe('stateVectorCovers', () => {
  it('모든 클라이언트 시계가 같거나 크면 덮는다', () => {
    expect(
      stateVectorCovers(
        new Map([
          [1, 5],
          [2, 3],
        ]),
        new Map([
          [1, 5],
          [2, 2],
        ]),
      ),
    ).toBe(true);
    expect(stateVectorCovers(new Map([[1, 4]]), new Map([[1, 5]]))).toBe(false);
    expect(stateVectorCovers(new Map(), new Map([[9, 1]]))).toBe(false);
    expect(stateVectorCovers(new Map(), new Map())).toBe(true);
  });
});

describe('persistedCovers(검토 5번: 지우기까지)', () => {
  it('저장 뒤 글자만 지우면 상태 벡터는 그대로지만, 앞 저장 스냅숏은 덮지 않는다', () => {
    const doc = new Y.Doc();
    doc.getText('body').insert(0, '가나다');
    const saved = Y.decodeSnapshot(Y.encodeSnapshot(Y.snapshot(doc)));
    const savedVector = Y.decodeStateVector(Y.encodeStateVector(doc));
    expect(persistedCovers({ kind: 'snapshot', snapshot: saved }, Y.snapshot(doc))).toBe(true);

    doc.getText('body').delete(1, 1);
    expect(Y.decodeStateVector(Y.encodeStateVector(doc))).toEqual(savedVector);
    // 예전 판정(상태 벡터만)은 덮는다고 잘못 본다. 판 N-1 서버 대비로 남은 길이다.
    expect(persistedCovers({ kind: 'vector', vector: savedVector }, Y.snapshot(doc))).toBe(true);
    expect(persistedCovers({ kind: 'snapshot', snapshot: saved }, Y.snapshot(doc))).toBe(false);

    const after = Y.decodeSnapshot(Y.encodeSnapshot(Y.snapshot(doc)));
    expect(persistedCovers({ kind: 'snapshot', snapshot: after }, Y.snapshot(doc))).toBe(true);
  });

  it('남의 지우기도 서버가 이미 가진 것이면 덮는다', () => {
    const server = new Y.Doc();
    server.getText('body').insert(0, '오늘은 비');
    const device = new Y.Doc();
    Y.applyUpdate(device, Y.encodeStateAsUpdate(server));
    server.getText('body').delete(0, 3);
    Y.applyUpdate(device, Y.encodeStateAsUpdate(server, Y.encodeStateVector(device)));
    const mark = { kind: 'snapshot', snapshot: Y.snapshot(server) } as const;
    expect(persistedCovers(mark, Y.snapshot(device))).toBe(true);
  });

  it('저장 표시가 아직 없으면 빈 글일 때만 덮는다', () => {
    expect(persistedCovers(null, Y.snapshot(new Y.Doc()))).toBe(true);
    const doc = new Y.Doc();
    doc.getText('body').insert(0, '가');
    expect(persistedCovers(null, Y.snapshot(doc))).toBe(false);
  });
});
