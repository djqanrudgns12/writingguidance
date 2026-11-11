import type { ApiOutput } from '@geulbang/core/api';
import { docDocumentName } from '@geulbang/core/protocol';
import { currentText, type DocTextDeps } from '../realtime/docText.ts';
import type { StoredRoom } from '../store/repos/rooms.ts';

/**
 * 모두 내려받기(PRD F-21, PLAN §2.3 ⑩). 모든 글의 본문을 모아 주면 교사 브라우저가 zip으로 묶는다.
 * 본문은 메모리에 열린 글이면 그것(가장 새 글), 아니면 저장 때 쓴 캐시다(PLAN §4.5). AI 도움 표시는 넣지 않는다.
 */
export type ExportResult = ApiOutput<'exportResult'>;

export function exportRoom(deps: DocTextDeps, room: StoredRoom, scope: 'submitted' | 'all'): ExportResult {
  const loaded = deps.hocuspocus().documents;
  const docs = deps.repos.documents.listForExport(room.id, scope === 'submitted').map(row => {
    const live = loaded.has(docDocumentName(row.id)) ? currentText(deps, row.id) : undefined;
    return {
      nickname: row.nickname,
      genre: row.genre,
      subtype: row.subtype,
      purpose: row.purpose,
      title: live?.titleText ?? row.titleText,
      body: live?.bodyText ?? row.plainText,
      status: row.status,
      submittedAt: row.submittedAt,
      charCount: live?.charCount ?? row.charCount,
    };
  });
  return {
    room: { className: room.className, title: room.title, schoolName: room.schoolName },
    docs,
  };
}
