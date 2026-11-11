import {
  countChars,
  DOC_KEYS,
  isParticipantOffline,
  resolvePresence,
  type DocStatus,
  type LastInputBy,
  type PresenceState,
} from '@geulbang/core';
import type { Config } from '@geulbang/core/config';
import {
  docDocumentName,
  encodeRoomEvent,
  type DocSummary,
  type ParticipantSummary,
} from '@geulbang/core/protocol';
import type { Connection, Hocuspocus, onChangePayload } from '@hocuspocus/server';
import type { Logger } from '../log.ts';
import type { DocumentInfo } from '../store/repos/documents.ts';
import type { Repos } from '../store/repos/index.ts';
import type { StoredParticipant } from '../store/repos/participants.ts';
import type { ConnectedDoc, RealtimeContext } from './context.ts';
import { knownSubtype } from './docMeta.ts';

/**
 * 수업방마다 메모리 요약(PLAN §4.6). 참가자별 `room:*` 연결 수·마지막으로 끊긴 시각, 글별 글자 수·마지막 입력 시각·
 * 입력자·상태, 교사 연결 목록, 바뀐 글 목록.
 * - 글이 바뀌면(`onChange`) 그 글을 "바뀜"으로 표시만 한다. 글자 수는 묶어 보낼 때 한 번 센다(입력마다 세지 않음).
 * - 교사 연결이 있는 방만 `SUMMARY_INTERVAL_MS`마다 요약을 다시 만들어, 지난번 보낸 것과 다른 글만 `summary.batch`로,
 *   접속·별명·상태가 바뀐 참가자는 `participant.update`로 교사 연결에만 보낸다(학생은 다른 학생의 요약을 받지 않는다,
 *   §4.3). 접속 판정은 시간이 흘러도 바뀌므로 바뀜 표시와 상관없이 매번 다시 계산한다.
 * - 접속 판정은 `domain/presence.ts`(제출 > 오프라인 > 멈춤 > 쓰는 중).
 * - 처음 필요할 때 DB에서 방을 읽어 온다. 서버가 다시 켜지면 비어 있다가 다시 채워진다.
 */
export interface LastInput {
  readonly at: number;
  readonly by: LastInputBy;
}

export interface RoomState {
  /** `room:*` 연결이 붙음(학생은 참가자 연결 수, 교사는 요약 받는 쪽) */
  attachRoomConnection(connection: Connection<RealtimeContext>): void;
  detachRoomConnection(connection: Connection<RealtimeContext>): void;
  /** `doc:*` 연결이 인증됨: 그 글의 방을 메모리에 올려 둔다(입력 기록을 받을 수 있게). */
  trackDocument(doc: ConnectedDoc): void;
  /** 새 참가자(입장). 교사 화면에 글이 없어도 보이게 한다. */
  addParticipant(participant: StoredParticipant): void;
  /** 새 글(`doc.create`) */
  addDocument(info: DocumentInfo): void;
  /** 글 상태가 바뀜(제출·다시 쓰게 하기) */
  setDocumentStatus(docId: string, status: DocStatus): void;
  /** Hocuspocus `onChange`: 연결에서 온 변경이면 입력으로 기록한다. */
  onChange(payload: onChangePayload<RealtimeContext>): void;
  lastInput(docId: string): LastInput | undefined;
  /** 교사 `hello.summaries` */
  summaries(roomId: string): DocSummary[];
  /** 교사 `hello.participants` */
  participants(roomId: string): ParticipantSummary[];
  /** 지금 연결이 있는 참가자인가 */
  isOnline(roomId: string, participantId: string): boolean;
  /** 한 번 묶어 보내기(시험에서 바로 부를 때도 쓴다) */
  flush(): void;
  /** 수업방을 지울 때(deleteRoom, PLAN §7.7-6) */
  forgetRoom(roomId: string): void;
  close(): void;
}

interface ParticipantMem {
  readonly id: string;
  nickname: string;
  readonly joinedAt: number;
  readonly connections: Set<Connection<RealtimeContext>>;
  /** 마지막 연결이 끊긴 시각. 서버가 켜진 뒤 한 번도 붙지 않았으면 null(= 오프라인) */
  lastDisconnectAt: number | null;
  /** 교사에게 마지막으로 보낸 `participant.update`(JSON) */
  sent: string | null;
}

interface DocMem {
  readonly id: string;
  readonly participantId: string;
  readonly genre: string;
  subtype: string | null;
  status: DocStatus;
  chars: number;
  lastInputAt: number | null;
  lastInputBy: LastInputBy | null;
  readonly createdAt: number;
  /** 교사에게 마지막으로 보낸 요약(JSON). 같으면 다시 보내지 않는다. */
  sent: string | null;
}

interface RoomMem {
  readonly id: string;
  readonly participants: Map<string, ParticipantMem>;
  readonly docs: Map<string, DocMem>;
  readonly teachers: Set<Connection<RealtimeContext>>;
  readonly dirty: Set<string>;
}

export interface RoomStateDeps {
  readonly config: Readonly<Config>;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
}

export function createRoomState(deps: RoomStateDeps): RoomState {
  const { config, repos, log } = deps;
  const rooms = new Map<string, RoomMem>();
  /** 글 ID → 방 ID (입력 기록을 방까지 빨리 찾으려고) */
  const docRoom = new Map<string, string>();

  const toDocMem = (info: DocumentInfo): DocMem => ({
    id: info.id,
    participantId: info.participantId,
    genre: info.genre,
    // 이미 저장된 틀린 값이 요약 묶음 전체를 받는 쪽에서 버려지게 하지 않는다(검토 2번).
    subtype: knownSubtype(info.genre, info.subtype),
    status: info.status,
    chars: info.charCount,
    lastInputAt: info.lastInputAt,
    lastInputBy: info.lastInputBy,
    createdAt: info.createdAt,
    sent: null,
  });

  const toParticipantMem = (p: StoredParticipant): ParticipantMem => ({
    id: p.id,
    nickname: p.nickname,
    joinedAt: p.createdAt,
    connections: new Set(),
    lastDisconnectAt: null,
    sent: null,
  });

  const loadRoom = (roomId: string): RoomMem => {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const room: RoomMem = {
      id: roomId,
      participants: new Map(),
      docs: new Map(),
      teachers: new Set(),
      dirty: new Set(),
    };
    for (const p of repos.participants.listInRoom(roomId)) room.participants.set(p.id, toParticipantMem(p));
    for (const info of repos.documents.listByRoom(roomId)) {
      room.docs.set(info.id, toDocMem(info));
      docRoom.set(info.id, roomId);
    }
    rooms.set(roomId, room);
    return room;
  };

  /** REST로 막 들어온 참가자는 방을 읽은 뒤에 생겼을 수 있다. */
  const participantOf = (room: RoomMem, participantId: string): ParticipantMem | undefined => {
    const known = room.participants.get(participantId);
    if (known) return known;
    const row = repos.participants.findById(participantId);
    if (!row || row.roomId !== room.id) return undefined;
    const mem = toParticipantMem(row);
    room.participants.set(row.id, mem);
    return mem;
  };

  /** 바뀐 글의 글자 수·하위 종류를 메모리에 열린 문서에서 다시 읽는다. */
  const refreshDirty = (room: RoomMem) => {
    const hp = deps.hocuspocus();
    for (const docId of room.dirty) {
      const doc = room.docs.get(docId);
      const live = hp.documents.get(docDocumentName(docId));
      if (!doc || !live) continue;
      doc.chars = countChars(live.getText(DOC_KEYS.body).toString());
      const subtype = live.getMap(DOC_KEYS.meta).get('subtype');
      if (typeof subtype === 'string') doc.subtype = knownSubtype(doc.genre, subtype);
    }
    room.dirty.clear();
  };

  const offline = (participant: ParticipantMem | undefined, now: number): boolean =>
    !participant ||
    isParticipantOffline(
      { activeConnections: participant.connections.size, disconnectedAt: participant.lastDisconnectAt },
      now,
      config,
    );

  const docPresence = (doc: DocMem, participant: ParticipantMem | undefined, now: number): PresenceState =>
    resolvePresence(
      {
        docStatus: doc.status,
        offline: offline(participant, now),
        lastInputAt: doc.lastInputAt,
        idleSinceAt: doc.createdAt,
      },
      now,
      config,
    );

  const summaryOf = (room: RoomMem, doc: DocMem, now: number): DocSummary => {
    const participant = room.participants.get(doc.participantId);
    return {
      docId: doc.id,
      participantId: doc.participantId,
      nickname: participant?.nickname ?? '',
      genre: doc.genre,
      subtype: doc.subtype,
      chars: doc.chars,
      lastInputAt: doc.lastInputAt,
      lastInputBy: doc.lastInputBy,
      status: doc.status,
      presence: docPresence(doc, participant, now),
    };
  };

  /** 참가자 상태 = 가장 최근에 만든 글의 상태. 글이 없으면 입장 시각부터 잰다(글 종류 고르는 중). */
  const participantSummaryOf = (room: RoomMem, p: ParticipantMem, now: number): ParticipantSummary => {
    let latest: DocMem | undefined;
    for (const doc of room.docs.values()) {
      if (doc.participantId === p.id && (!latest || doc.createdAt >= latest.createdAt)) latest = doc;
    }
    const presence = latest
      ? docPresence(latest, p, now)
      : resolvePresence(
          { docStatus: 'DRAFT', offline: offline(p, now), lastInputAt: null, idleSinceAt: p.joinedAt },
          now,
          config,
        );
    return { participantId: p.id, nickname: p.nickname, presence, joinedAt: p.joinedAt };
  };

  const flushRoom = (room: RoomMem, now: number) => {
    refreshDirty(room);
    const batch: DocSummary[] = [];
    for (const doc of room.docs.values()) {
      const summary = summaryOf(room, doc, now);
      const key = JSON.stringify(summary);
      if (key === doc.sent) continue;
      doc.sent = key;
      batch.push(summary);
    }
    const updates: string[] = [];
    for (const p of room.participants.values()) {
      const { joinedAt: _joinedAt, ...update } = participantSummaryOf(room, p, now);
      const key = JSON.stringify(update);
      if (key === p.sent) continue;
      p.sent = key;
      updates.push(encodeRoomEvent('participant.update', update, now));
    }
    const messages = batch.length > 0 ? [encodeRoomEvent('summary.batch', batch, now), ...updates] : updates;
    for (const teacher of room.teachers) for (const m of messages) teacher.sendStateless(m);
  };

  const flush = () => {
    const now = deps.now();
    for (const room of rooms.values()) {
      if (room.teachers.size === 0) continue;
      try {
        flushRoom(room, now);
      } catch (error) {
        log.error('summary_failed', { error });
      }
    }
  };

  const timer = setInterval(flush, config.SUMMARY_INTERVAL_MS);
  timer.unref();

  const docOf = (docId: string): DocMem | undefined => {
    const roomId = docRoom.get(docId);
    return roomId ? rooms.get(roomId)?.docs.get(docId) : undefined;
  };

  return {
    attachRoomConnection(connection) {
      const actor = connection.context.actor;
      if (actor?.kind === 'teacher') {
        loadRoom(actor.roomId).teachers.add(connection);
      } else if (actor?.kind === 'student') {
        const room = loadRoom(actor.roomId);
        participantOf(room, actor.participantId)?.connections.add(connection);
      }
    },

    detachRoomConnection(connection) {
      const actor = connection.context.actor;
      if (actor?.kind !== 'teacher' && actor?.kind !== 'student') return;
      const room = rooms.get(actor.roomId);
      if (!room) return;
      if (actor.kind === 'teacher') {
        room.teachers.delete(connection);
        return;
      }
      const participant = room.participants.get(actor.participantId);
      if (!participant) return;
      participant.connections.delete(connection);
      if (participant.connections.size === 0) participant.lastDisconnectAt = deps.now();
    },

    trackDocument(doc) {
      const room = loadRoom(doc.roomId);
      if (!room.docs.has(doc.id)) {
        const info = repos.documents.findInfo(doc.id);
        if (info) room.docs.set(info.id, toDocMem(info));
      }
      docRoom.set(doc.id, doc.roomId);
    },

    addParticipant(participant) {
      if (participant.roomId === null) return;
      // 방이 아직 메모리에 없으면 처음 읽을 때 함께 온다.
      const room = rooms.get(participant.roomId);
      if (room && !room.participants.has(participant.id)) {
        room.participants.set(participant.id, toParticipantMem(participant));
      }
    },

    addDocument(info) {
      if (info.roomId === null) return;
      const room = loadRoom(info.roomId);
      room.docs.set(info.id, toDocMem(info));
      docRoom.set(info.id, info.roomId);
      participantOf(room, info.participantId);
    },

    setDocumentStatus(docId, status) {
      const doc = docOf(docId);
      if (doc) doc.status = status;
    },

    onChange(payload) {
      // 서버가 스스로 고친 것(연결 없음)은 입력이 아니다.
      const actor = payload.connection?.context.actor;
      const docId = payload.connection?.context.doc?.id;
      if (!actor || !docId) return;
      const roomId = docRoom.get(docId);
      const room = roomId ? rooms.get(roomId) : undefined;
      const doc = room?.docs.get(docId);
      if (!room || !doc) return;
      doc.lastInputAt = deps.now();
      doc.lastInputBy = actor.role === 'teacher' ? 'TEACHER' : 'STUDENT';
      room.dirty.add(docId);
    },

    lastInput(docId) {
      const doc = docOf(docId);
      if (!doc || doc.lastInputAt === null || doc.lastInputBy === null) return undefined;
      return { at: doc.lastInputAt, by: doc.lastInputBy };
    },

    summaries(roomId) {
      const room = loadRoom(roomId);
      refreshDirty(room);
      const now = deps.now();
      return [...room.docs.values()].map(doc => summaryOf(room, doc, now));
    },

    participants(roomId) {
      const room = loadRoom(roomId);
      const now = deps.now();
      return [...room.participants.values()].map(p => participantSummaryOf(room, p, now));
    },

    isOnline(roomId, participantId) {
      return (rooms.get(roomId)?.participants.get(participantId)?.connections.size ?? 0) > 0;
    },

    flush,

    forgetRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room) return;
      for (const docId of room.docs.keys()) docRoom.delete(docId);
      rooms.delete(roomId);
    },

    close() {
      clearInterval(timer);
    },
  };
}
