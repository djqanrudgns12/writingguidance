import { encodeDocEvent, type DocEventData, type DocEventName } from '@geulbang/core/protocol';
import type { Connection, Document } from '@hocuspocus/server';

/** 글 채널 이벤트를 그 글의 모든 연결에 보낸다(PLAN §4.4). */
export function broadcastDocEvent<N extends DocEventName>(
  document: Document,
  name: N,
  data: DocEventData<N>,
  serverNow: number,
): void {
  document.broadcastStateless(encodeDocEvent(name, data, serverNow));
}

/** 글 채널 이벤트를 연결 하나에만 보낸다. */
export function sendDocEvent<N extends DocEventName>(
  connection: Connection,
  name: N,
  data: DocEventData<N>,
  serverNow: number,
): void {
  connection.sendStateless(encodeDocEvent(name, data, serverNow));
}
