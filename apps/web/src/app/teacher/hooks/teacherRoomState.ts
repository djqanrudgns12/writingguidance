import {
  computeRemainingSec,
  MS_PER_SECOND,
  resolvePresenceBadgeVariant,
  type Config,
  type DocStatus,
  type RoomStatus,
} from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import type {
  DocSummary,
  Hello,
  ParticipantSummary,
  ResumePending,
  RoomEventData,
  RoomSettings,
  TimerState,
} from '@geulbang/core/protocol';
import {
  docKindLabel,
  sortTilesByNickname,
  type StudentTileModel,
  type TimerModel,
} from '../../../ui/screens/teacher/index.ts';

/**
 * 교사 수업방 상태(PLAN §4.4 이벤트를 합친 것). 순수 함수라 훅 밖에서 시험한다.
 * `hello`가 오면(다시 연결할 때마다) 통째로 바꾸고, 그 뒤 이벤트는 바뀐 것만 합친다.
 */
export type TeacherRoomInfoState = Hello['room'];

export interface TeacherRoomState {
  readonly room: TeacherRoomInfoState | null;
  /** 한 번이라도 들어온 참가자(글이 없어도). 키 = participantId */
  readonly participants: ReadonlyMap<string, ParticipantSummary>;
  /** 키 = docId */
  readonly summaries: ReadonlyMap<string, DocSummary>;
  /** 이번 연결에서 본 제출 시각(`doc.status`의 `at`). 요약에는 제출 시각이 없다. */
  readonly submittedAt: ReadonlyMap<string, number>;
  readonly timer: TimerState | null;
  readonly pendingResumes: readonly ResumePending[];
}

export const initialTeacherRoomState: TeacherRoomState = {
  room: null,
  participants: new Map(),
  summaries: new Map(),
  submittedAt: new Map(),
  timer: null,
  pendingResumes: [],
};

export type TeacherRoomAction =
  | { readonly type: 'hello'; readonly hello: Hello }
  | { readonly type: 'summary.batch'; readonly data: readonly DocSummary[] }
  | {
      readonly type: 'participant.update';
      readonly data: RoomEventData<'participant.update'>;
      readonly serverNow: number;
    }
  | { readonly type: 'doc.status'; readonly data: RoomEventData<'doc.status'> }
  | { readonly type: 'timer'; readonly data: TimerState }
  | { readonly type: 'resume.pending'; readonly data: readonly ResumePending[] }
  | { readonly type: 'resume.decided'; readonly requestId: string }
  | { readonly type: 'room.settings'; readonly settings: RoomSettings }
  | { readonly type: 'room.status'; readonly status: RoomStatus };

function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

export function reduceTeacherRoom(state: TeacherRoomState, action: TeacherRoomAction): TeacherRoomState {
  switch (action.type) {
    case 'hello': {
      const { hello } = action;
      const participants = new Map((hello.participants ?? []).map(p => [p.participantId, p] as const));
      const summaries = new Map((hello.summaries ?? []).map(s => [s.docId, s] as const));
      // 다시 연결해도 이미 본 제출 시각은 남긴다(아직 제출 상태인 글만).
      const submittedAt = new Map(
        [...state.submittedAt].filter(([docId]) => summaries.get(docId)?.status === 'SUBMITTED'),
      );
      return {
        room: hello.room,
        participants,
        summaries,
        submittedAt,
        timer: hello.timer,
        pendingResumes: hello.pendingResumes ?? [],
      };
    }
    case 'summary.batch': {
      if (action.data.length === 0) return state;
      const summaries = new Map(state.summaries);
      let participants: Map<string, ParticipantSummary> | null = null;
      for (const s of action.data) {
        summaries.set(s.docId, s);
        // 참가자 목록에 아직 없으면(입장 직후) 요약으로 채운다. 입장 시각은 모르므로 첫 입력 시각으로 둔다.
        if (!state.participants.has(s.participantId) && !participants?.has(s.participantId)) {
          participants ??= new Map(state.participants);
          participants.set(s.participantId, {
            participantId: s.participantId,
            nickname: s.nickname,
            presence: s.presence,
            joinedAt: s.lastInputAt ?? 0,
          });
        }
      }
      return { ...state, summaries, ...(participants ? { participants } : {}) };
    }
    case 'participant.update': {
      const { data } = action;
      const prev = state.participants.get(data.participantId);
      return {
        ...state,
        participants: withEntry(state.participants, data.participantId, {
          participantId: data.participantId,
          nickname: data.nickname,
          presence: data.presence,
          joinedAt: prev?.joinedAt ?? action.serverNow,
        }),
      };
    }
    case 'doc.status': {
      const { data } = action;
      const prev = state.summaries.get(data.docId);
      const summaries = prev
        ? withEntry(state.summaries, data.docId, { ...prev, status: data.status })
        : null;
      const submittedAt = new Map(state.submittedAt);
      if (data.status === 'SUBMITTED') submittedAt.set(data.docId, data.at);
      else submittedAt.delete(data.docId);
      return { ...state, ...(summaries ? { summaries } : {}), submittedAt };
    }
    case 'timer':
      return { ...state, timer: action.data };
    case 'resume.pending':
      return { ...state, pendingResumes: action.data };
    case 'resume.decided':
      return {
        ...state,
        pendingResumes: state.pendingResumes.filter(r => r.requestId !== action.requestId),
      };
    case 'room.settings':
      return state.room ? { ...state, room: { ...state.room, settings: action.settings } } : state;
    case 'room.status':
      return state.room ? { ...state, room: { ...state.room, status: action.status } } : state;
  }
}

export interface DashboardTiles {
  readonly tiles: readonly StudentTileModel[];
  readonly connectedCount: number;
  readonly submittedCount: number;
}

type PresenceConfig = Pick<Config, 'ACTIVE_WINDOW_SEC' | 'IDLE_AFTER_SEC'>;

/** 참가자 한 명의 대표 글: 가장 최근에 입력한 글(새 글을 시작했으면 그 글). */
function latestDocByParticipant(summaries: ReadonlyMap<string, DocSummary>): Map<string, DocSummary> {
  const byParticipant = new Map<string, DocSummary>();
  for (const s of summaries.values()) {
    const cur = byParticipant.get(s.participantId);
    if (!cur || (s.lastInputAt ?? -1) > (cur.lastInputAt ?? -1)) byParticipant.set(s.participantId, s);
  }
  return byParticipant;
}

/**
 * 타일(PRD F-17): 참가자마다 한 장, 별명 가나다순. 오프라인·제출은 서버 값, 쓰는 중·멈춤은 지금 시각으로 다시 계산한다
 * (`domain/presence`, PLAN §4.6).
 */
export function buildDashboardTiles(
  state: TeacherRoomState,
  nowMs: number,
  config: PresenceConfig,
): DashboardTiles {
  const docs = latestDocByParticipant(state.summaries);
  let connectedCount = 0;
  const tiles = [...state.participants.values()].map((p): StudentTileModel => {
    const doc = docs.get(p.participantId) ?? null;
    const offline = p.presence === 'OFFLINE';
    if (!offline) connectedCount += 1;
    const docStatus: DocStatus = doc?.status ?? 'DRAFT';
    const status = resolvePresenceBadgeVariant(
      { docStatus, offline, lastInputAt: doc?.lastInputAt ?? null, idleSinceAt: p.joinedAt },
      nowMs,
      config,
    );
    return {
      participantId: p.participantId,
      docId: doc?.docId ?? null,
      nickname: p.nickname,
      status,
      genreLabel: doc ? docKindLabel(doc.genre, doc.subtype) : ko.teacher.tileNoDocYet,
      chars: doc?.chars ?? 0,
      lastInputAt: doc?.lastInputAt ?? null,
      submittedAt: doc && doc.status === 'SUBMITTED' ? (state.submittedAt.get(doc.docId) ?? null) : null,
    };
  });
  return {
    tiles: sortTilesByNickname(tiles),
    connectedCount,
    submittedCount: tiles.filter(t => t.status === 'submitted').length,
  };
}

/** 내려받기 시트의 글 수(타일이 아니라 글 기준: 한 학생이 글을 여럿 쓸 수 있다). */
export function exportCounts(state: TeacherRoomState): { submitted: number; total: number } {
  let submitted = 0;
  for (const s of state.summaries.values()) if (s.status === 'SUBMITTED') submitted += 1;
  return { submitted, total: state.summaries.size };
}

/** 서버 타이머 → 알약 모양. 멈춤은 멈춘 순간의 남은 초, 도는 중은 서버 시각 기준 남은 초. */
export function toTimerModel(timer: TimerState | null, nowMs: number): TimerModel {
  if (!timer || timer.status === 'IDLE') return { status: 'IDLE', remainingSec: null };
  if (timer.status === 'PAUSED') {
    return { status: 'PAUSED', remainingSec: Math.ceil(Math.max(0, timer.remainingMs ?? 0) / MS_PER_SECOND) };
  }
  return { status: 'RUNNING', remainingSec: computeRemainingSec(timer, nowMs) };
}
