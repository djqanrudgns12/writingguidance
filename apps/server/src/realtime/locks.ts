import type { DocStatus } from '@geulbang/core/protocol';
import type { Connection, Hocuspocus } from '@hocuspocus/server';
import type { RealtimeContext } from './context.ts';
import { broadcastDocEvent } from './docChannel.ts';

/**
 * 잠금 바꾸기(PLAN §4.3, §4.7 대응 3). 그 글의 해당 연결들의 `readOnly`를 바꾸고 `doc.status`를 보낸다.
 * 다음 메시지부터 적용된다. 잠긴 동안의 편집은 기기 사본에 남고, 풀리면 기기가 `forceSync()`로 다시 보낸다.
 * 재연결 때는 인증 훅이 DB 상태로 다시 정한다.
 *
 * `appliesTo`로 어떤 연결을 잠글지 고른다(제출은 학생 연결만, 교사는 계속 고칠 수 있음 — ADR-048).
 */
export function setDocumentLock(
  hocuspocus: Hocuspocus<RealtimeContext>,
  options: {
    readonly documentName: string;
    readonly docId: string;
    readonly locked: boolean;
    readonly status: DocStatus;
    readonly at: number;
    readonly appliesTo: (connection: Connection<RealtimeContext>) => boolean;
  },
): number {
  const document = hocuspocus.documents.get(options.documentName);
  if (!document) return 0;
  let changed = 0;
  for (const connection of document.getConnections()) {
    if (!options.appliesTo(connection as Connection<RealtimeContext>)) continue;
    if (connection.readOnly !== options.locked) changed++;
    connection.readOnly = options.locked;
  }
  broadcastDocEvent(
    document,
    'doc.status',
    { docId: options.docId, status: options.status, at: options.at, locked: options.locked },
    options.at,
  );
  return changed;
}
