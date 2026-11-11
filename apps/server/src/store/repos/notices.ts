import type { NoticeKind } from '@geulbang/core';
import type { Notice } from '@geulbang/core/protocol';
import type { Db } from '../db.ts';

/**
 * 알림(PLAN §5.2 `notices`, PRD F-19). 교사가 바로 보낸 것(MANUAL)과 타이머 알림(TIMER).
 * 다시 연결한 기기는 최근 `NOTICE_REPLAY_SEC` 안의 알림만 `hello.recentNotices`로 다시 본다.
 */
export interface NoticeRepo {
  insert(roomId: string, notice: Notice): void;
  /** `since` 이후(포함) 보낸 알림, 시각 순. */
  listSince(roomId: string, since: number): Notice[];
}

interface Row {
  id: string;
  kind: NoticeKind;
  text: string;
  sound: number;
  sent_at: number;
}

export function createNoticeRepo(db: Db): NoticeRepo {
  const listStmt = db.prepare<[string, number], Row>(
    'SELECT id, kind, text, sound, sent_at FROM notices WHERE room_id = ? AND sent_at >= ? ORDER BY sent_at, id',
  );
  const insertStmt = db.prepare(
    'INSERT INTO notices (id, room_id, kind, text, sound, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  return {
    insert(roomId, n) {
      insertStmt.run(n.noticeId, roomId, n.kind, n.text, n.sound ? 1 : 0, n.sentAt);
    },
    listSince: (roomId, since) =>
      listStmt.all(roomId, since).map(r => ({
        noticeId: r.id,
        text: r.text,
        sentAt: r.sent_at,
        sound: r.sound === 1,
        kind: r.kind,
      })),
  };
}
