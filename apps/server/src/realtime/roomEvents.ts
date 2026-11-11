import {
  encodeRoomEvent,
  roomDocumentName,
  type RoomEventData,
  type RoomEventName,
} from '@geulbang/core/protocol';
import type { Connection, Hocuspocus } from '@hocuspocus/server';
import type { RealtimeContext, RoomActor } from './context.ts';

/**
 * 수업방 채널 이벤트 보내기(PLAN §4.4 "받는 쪽"). `room:{id}` 문서의 연결을 실행 주체로 골라 보낸다.
 * 학생이 다른 학생의 요약·글을 받는 길이 생기지 않게, 받는 쪽은 늘 여기서 고른다(§4.3).
 */
export interface RoomEvents {
  connections(roomId: string): Array<Connection<RealtimeContext>>;
  toRoom<N extends RoomEventName>(roomId: string, name: N, data: RoomEventData<N>): void;
  toTeachers<N extends RoomEventName>(roomId: string, name: N, data: RoomEventData<N>): void;
  toStudents<N extends RoomEventName>(roomId: string, name: N, data: RoomEventData<N>): void;
  toParticipant<N extends RoomEventName>(
    roomId: string,
    participantId: string,
    name: N,
    data: RoomEventData<N>,
  ): void;
}

export function createRoomEvents(deps: {
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
  readonly now: () => number;
}): RoomEvents {
  const connections = (roomId: string) =>
    (deps.hocuspocus().documents.get(roomDocumentName(roomId))?.getConnections() ?? []) as Array<
      Connection<RealtimeContext>
    >;

  const send = <N extends RoomEventName>(
    roomId: string,
    name: N,
    data: RoomEventData<N>,
    pick: (actor: RoomActor) => boolean,
  ) => {
    const now = deps.now();
    const message = encodeRoomEvent(name, data, now);
    for (const c of connections(roomId)) {
      const actor = c.context.actor;
      if (actor && actor.kind !== 'dev' && pick(actor)) c.sendStateless(message);
    }
  };

  return {
    connections,
    toRoom: (roomId, name, data) => send(roomId, name, data, () => true),
    toTeachers: (roomId, name, data) => send(roomId, name, data, a => a.kind === 'teacher'),
    toStudents: (roomId, name, data) => send(roomId, name, data, a => a.kind === 'student'),
    toParticipant: (roomId, participantId, name, data) =>
      send(roomId, name, data, a => a.kind === 'student' && a.participantId === participantId),
  };
}
