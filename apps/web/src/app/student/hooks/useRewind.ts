import { DOC_KEYS } from '@geulbang/core';
import type { ErrorCode } from '@geulbang/core/errors';
import { snapshotItemSchema, type SnapshotItem } from '@geulbang/core/protocol';
import { outerChangedRange } from '@geulbang/core/text';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { z } from 'zod';
import type { EditorBinding } from '../../../ports/editor.ts';
import type { ConnectionState, RoomChannel } from '../../../ports/realtime.ts';
import type { RewindView } from '../../../ui/screens/student/write/types.ts';
import { errorCodeOf } from '../errorCode.ts';

/**
 * 시간 되감기(PRD F-10 2번): 목록(`snapshot.list`) → 고른 때의 글(`snapshot.get`, 받은 것은 기억) →
 * `이때 글로 돌리기`(`snapshot.restore`: 서버가 지금 글을 RESTORE로 남기고 그때 글을 돌려줌) →
 * 지금 글과의 **차이만** `applyAppEdit`로 넣는다(내 입력이라 `↶`로 되돌릴 수 있다).
 * 연결이 없으면 "인터넷이 돌아오면 볼 수 있어요".
 */
const listSchema = z.array(snapshotItemSchema);
const textSchema = z.object({ title: z.string(), body: z.string() });
type SnapText = z.output<typeof textSchema>;

export interface RewindHandle {
  readonly open: boolean;
  setOpen(open: boolean): void;
  readonly view: RewindView;
  select(index: number): void;
  restore(): Promise<void>;
}

/** 지금 글을 목표 글로 바꾸되 바뀐 가운데 한 범위만 지우고 넣는다. */
function replaceMinimal(text: Y.Text, next: string): void {
  const prev = text.toString();
  const range = outerChangedRange(prev, next);
  if (!range) return;
  if (range.endOld > range.start) text.delete(range.start, range.endOld - range.start);
  const insert = next.slice(range.start, range.endNew);
  if (insert) text.insert(range.start, insert);
}

const OFFLINE: ReadonlySet<ConnectionState> = new Set(['offline', 'server-down', 'closed']);

export function useRewind(args: {
  readonly channel: RoomChannel | null;
  readonly docId: string;
  readonly binding: EditorBinding | null;
  readonly connection: ConnectionState;
  readonly onError: (code: ErrorCode) => void;
}): RewindHandle {
  const { channel, docId, binding, connection, onError } = args;
  const [open, setOpenState] = useState(false);
  const [items, setItems] = useState<readonly SnapshotItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [texts, setTexts] = useState<ReadonlyMap<string, SnapText>>(new Map());
  const [restoring, setRestoring] = useState(false);
  const [failed, setFailed] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const offline = OFFLINE.has(connection);

  const requested = useRef(new Set<string>());
  const fetchText = useCallback(
    (item: SnapshotItem | undefined) => {
      if (!channel || !item || requested.current.has(item.id)) return;
      requested.current.add(item.id);
      channel.send('snapshot.get', { docId, snapshotId: item.id }).then(
        raw => {
          const parsed = textSchema.safeParse(raw);
          if (parsed.success) setTexts(m => new Map(m).set(item.id, parsed.data));
          else requested.current.delete(item.id);
        },
        () => requested.current.delete(item.id),
      );
    },
    [channel, docId],
  );

  useEffect(() => {
    if (!open || offline || !channel) return;
    let alive = true;
    setItems(null);
    setFailed(false);
    channel.send('snapshot.list', { docId }).then(
      raw => {
        if (!alive) return;
        const parsed = listSchema.safeParse(raw);
        const list = parsed.success ? parsed.data : [];
        setItems(list);
        const last = Math.max(0, list.length - 1);
        setIndex(last);
        fetchText(list[last]);
      },
      (error: unknown) => {
        if (!alive) return;
        setFailed(true);
        onErrorRef.current(errorCodeOf(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [open, offline, channel, docId, fetchText]);

  const select = useCallback(
    (next: number) => {
      setIndex(next);
      fetchText(items?.[next]);
    },
    [fetchText, items],
  );

  const restore = useCallback(async () => {
    const item = items?.[index];
    if (!channel || !binding || !item || restoring) return;
    setRestoring(true);
    try {
      const raw = await channel.send('snapshot.restore', { docId, snapshotId: item.id });
      const target = textSchema.parse(raw);
      await binding.applyAppEdit(doc => {
        replaceMinimal(doc.getText(DOC_KEYS.title), target.title);
        replaceMinimal(doc.getText(DOC_KEYS.body), target.body);
      });
      setOpenState(false);
    } catch (error) {
      onErrorRef.current(errorCodeOf(error));
    } finally {
      setRestoring(false);
    }
  }, [binding, channel, docId, index, items, restoring]);

  const view: RewindView = offline
    ? { status: 'offline', snapshots: [], selectedIndex: 0 }
    : items === null || failed
      ? { status: failed ? 'empty' : 'loading', snapshots: [], selectedIndex: 0 }
      : items.length === 0
        ? { status: 'empty', snapshots: [], selectedIndex: 0 }
        : {
            status: 'ready',
            selectedIndex: index,
            restoring,
            snapshots: items.map(item => ({
              id: item.id,
              at: item.at,
              reason: item.reason,
              title: texts.get(item.id)?.title ?? '',
              body: texts.get(item.id)?.body ?? '',
            })),
          };

  return { open, setOpen: setOpenState, view, select, restore };
}
