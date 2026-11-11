import { countChars, DOC_KEYS } from '@geulbang/core';
import { encodeRoomEvent, roomDocumentName } from '@geulbang/core/protocol';
import type {
  beforeHandleMessagePayload,
  Connection,
  Document,
  Hocuspocus,
  onChangePayload,
} from '@hocuspocus/server';
import type { Logger } from '../log.ts';
import type { RealtimeContext } from './context.ts';
import { readSyncContent } from './precheck.ts';
import type { SnapshotText, Snapshots } from './snapshots.ts';

/**
 * 교사 서랍(PLAN §2.3 ⑧, PRD F-18). 교사가 서랍으로 그 방 글(`doc:*`)을 연 뒤 **처음 입력하는 순간**:
 * ① TEACHER 스냅샷(교사 입력 바로 전의 제목·본문, 학생이 되돌릴 수 있게) ② 그 학생의 `room:*` 연결에 `teacher.editing`.
 * 서랍을 열 때(= 문서 연결마다) 한 번. 학생 화면 안내를 기기마다 한 번만 보이는 것은 기기가 맡는다.
 *
 * "바로 전" 글은 `beforeHandleMessage`(적용 전 검사 뒤)에서 떠 두고, 실제로 글이 바뀐 `onChange`에서 쓴다.
 * 내용 없는 동기화 메시지는 `onChange`가 오지 않으므로 그 사이 떠 둔 값은 다음 메시지가 덮는다.
 * `last_input_by`는 `roomState`가 기록하고 저장할 때 DB에 쓴다.
 */
export interface TeacherEdits {
  beforeHandleMessage(payload: beforeHandleMessagePayload<RealtimeContext>): void;
  onChange(payload: onChangePayload<RealtimeContext>): void;
}

export function createTeacherEdits(deps: {
  readonly log: Logger;
  readonly now: () => number;
  readonly snapshots: Snapshots;
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
}): TeacherEdits {
  const before = new WeakMap<Connection, SnapshotText>();
  const done = new WeakSet<Connection>();

  const isTeacherDocConnection = (connection: Connection<RealtimeContext>) =>
    connection.context.actor?.kind === 'teacher' && connection.context.doc !== undefined;

  return {
    beforeHandleMessage({ connection, document, update }) {
      if (connection.readOnly || done.has(connection) || !isTeacherDocConnection(connection)) return;
      if (!readSyncContent(update)) return;
      before.set(connection, textOf(document));
    },

    onChange({ connection, document }) {
      if (!connection || done.has(connection) || !isTeacherDocConnection(connection)) return;
      const doc = connection.context.doc;
      if (!doc) return;
      done.add(connection);
      const text = before.get(connection) ?? textOf(document);
      before.delete(connection);
      deps.snapshots.record(doc.id, 'TEACHER', 'TEACHER', text);

      const room = deps.hocuspocus().documents.get(roomDocumentName(doc.roomId));
      if (!room) return;
      const now = deps.now();
      const message = encodeRoomEvent('teacher.editing', { docId: doc.id }, now);
      for (const c of room.getConnections() as Array<Connection<RealtimeContext>>) {
        const actor = c.context.actor;
        if (actor?.kind === 'student' && actor.participantId === doc.participantId) c.sendStateless(message);
      }
      deps.log.info('teacher_editing', { detail: 'first teacher input' });
    },
  };
}

function textOf(document: Document): SnapshotText {
  const bodyText = document.getText(DOC_KEYS.body).toString();
  return {
    titleText: document.getText(DOC_KEYS.title).toString(),
    bodyText,
    charCount: countChars(bodyText),
  };
}
