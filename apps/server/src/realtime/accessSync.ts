import { docDocumentName } from '@geulbang/core/protocol';
import type { Connection, Hocuspocus } from '@hocuspocus/server';
import type { Repos } from '../store/repos/index.ts';
import { roomStatusAt } from '../store/repos/rooms.ts';
import { decideAccess } from './access.ts';
import { isRoomActor, type RealtimeContext } from './context.ts';
import { sendDocEvent } from './docChannel.ts';
import type { RoomEvents } from './roomEvents.ts';
import type { RoomState } from './roomState.ts';

/**
 * 방·글 상태가 바뀐 뒤 열린 연결의 권한을 다시 계산한다(PLAN §4.3 "잠금이 바뀌면", §4.7 대응 3).
 * 같은 권한 표(`decideAccess`)를 인증 때와 똑같이 쓴다. 다음 메시지부터 적용되고, 잠긴 동안의 편집은 기기 사본에 남는다.
 * 잠금이 풀리면 기기가 글 채널 `doc.status {locked:false}`를 받고 `forceSync()`로 다시 보낸다.
 * 권한이 아예 없어졌으면(거부) 그 글 연결만 닫는다(기기는 다시 인증을 시도하고 거부 이유를 받는다).
 */
export interface AccessSync {
  /** 글 상태가 바뀜(제출·다시 쓰게 하기): 그 글의 모든 연결 + 수업방 채널 `doc.status`(교사·그 학생) */
  documentChanged(docId: string): void;
  /** 방 상태가 바뀜(닫기·다시 열기): 그 방의 열린 글 연결 중 잠금이 바뀐 것에만 글 채널 `doc.status` */
  roomChanged(roomId: string): void;
  /** 참가자의 동의 판이 바뀜(`consent.update`): 그 학생 글의 열린 연결 중 잠금이 바뀐 것에만 `doc.status` */
  participantChanged(roomId: string, participantId: string): void;
}

/** 서버가 그 글 연결을 닫을 때의 닫기 코드(응용 정의 영역 4000~4999). 이유에는 오류 코드를 싣는다. */
const CLOSE_ACCESS_CHANGED = 4403;

export function createAccessSync(deps: {
  readonly repos: Repos;
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
  readonly events: RoomEvents;
  readonly roomState: RoomState;
  readonly now: () => number;
  /** 지금 처리방침 판(설정 `POLICY_VERSION`, 인증과 같은 값) */
  readonly policyVersion: string;
}): AccessSync {
  const { repos } = deps;
  const consentCurrent = (participantId: string): boolean =>
    repos.participants.findById(participantId)?.consentVersion === deps.policyVersion;

  const syncDocument = (docId: string, announce: boolean): void => {
    const info = repos.documents.findInfo(docId);
    if (!info || info.roomId === null) return;
    const room = repos.rooms.findById(info.roomId);
    if (!room) return;
    const now = deps.now();
    const roomStatus = roomStatusAt(room, now);
    const document = deps.hocuspocus().documents.get(docDocumentName(docId));
    for (const connection of (document?.getConnections() ?? []) as Array<Connection<RealtimeContext>>) {
      const actor = connection.context.actor;
      if (!isRoomActor(actor)) continue;
      const decision = decideAccess({ kind: 'doc', id: docId }, actor, {
        roomStatus,
        consentCurrent: actor.kind === 'teacher' || consentCurrent(actor.participantId),
        doc: info,
      });
      if (decision.kind === 'deny') {
        connection.close({ code: CLOSE_ACCESS_CHANGED, reason: decision.code });
        continue;
      }
      const locked = decision.kind === 'read';
      const changed = connection.readOnly !== locked;
      connection.readOnly = locked;
      if (announce || changed) {
        sendDocEvent(connection, 'doc.status', { docId, status: info.status, at: now, locked }, now);
      }
    }
    if (announce) {
      const data = { docId, status: info.status, at: now, generation: info.generation };
      deps.events.toTeachers(info.roomId, 'doc.status', data);
      deps.events.toParticipant(info.roomId, info.participantId, 'doc.status', data);
      deps.roomState.setDocumentStatus(docId, info.status);
    }
  };

  return {
    documentChanged: docId => syncDocument(docId, true),
    roomChanged(roomId) {
      const loaded = deps.hocuspocus().documents;
      for (const info of repos.documents.listByRoom(roomId)) {
        if (loaded.has(docDocumentName(info.id))) syncDocument(info.id, false);
      }
    },
    participantChanged(roomId, participantId) {
      const loaded = deps.hocuspocus().documents;
      for (const info of repos.documents.listByRoom(roomId)) {
        if (info.participantId === participantId && loaded.has(docDocumentName(info.id))) {
          syncDocument(info.id, false);
        }
      }
    },
  };
}
