import { AppError } from '@geulbang/core/errors';
import type { CommandArgs, CommandName } from '@geulbang/core/protocol';
import type { Hocuspocus } from '@hocuspocus/server';
import { assertConsentCurrent } from '../../application/consent.ts';
import type { ServerConfig } from '../../config.ts';
import type { Logger } from '../../log.ts';
import type { DocumentInfo } from '../../store/repos/documents.ts';
import type { Repos } from '../../store/repos/index.ts';
import { roomStatusAt, type StoredRoom } from '../../store/repos/rooms.ts';
import type { AccessSync } from '../accessSync.ts';
import type { RealtimeContext, RoomActor } from '../context.ts';
import type { RoomEvents } from '../roomEvents.ts';
import type { RoomGate } from '../roomGate.ts';
import type { RoomState } from '../roomState.ts';
import type { Snapshots } from '../snapshots.ts';

/**
 * 수업방 채널 명령 하나를 처리하는 함수의 모양(PLAN §4.4). `roomChannel.ts`가 봉투·판·역할·인자를 확인한 뒤 부른다.
 * 명령은 한 SQLite 트랜잭션 안에서 실행되고(멱등 기록과 함께), `after`는 트랜잭션이 끝난 뒤 메모리 상태와
 * 연결(읽기 전용·이벤트)을 고친다. 다시 보낸 명령(같은 commandId)이면 `after`는 돌지 않는다.
 */
export interface Outcome {
  readonly result: unknown;
  readonly after?: () => void;
}

export type Handler<N extends CommandName> = (actor: RoomActor, args: CommandArgs<N>, now: number) => Outcome;
export type AnyHandler = (actor: RoomActor, args: unknown, now: number) => Outcome;

export interface CommandSpec {
  readonly handler: AnyHandler;
  /**
   * 멱등 기록을 남기지 않는다(기록할 수업방 행이 명령과 함께 사라지는 `room.delete`).
   * 이때는 `ack`를 먼저 보내고 `after`를 부른다(지우기가 그 연결을 닫기 때문).
   */
  readonly unrecorded?: boolean;
}

export function command<N extends CommandName>(
  name: N,
  handler: Handler<N>,
  options: { readonly unrecorded?: boolean } = {},
): [CommandName, CommandSpec] {
  // 인자는 부르기 전에 그 명령의 스키마로 확인했다.
  const any: AnyHandler = (actor, args, now) => handler(actor, args as CommandArgs<N>, now);
  return [name, { handler: any, ...(options.unrecorded ? { unrecorded: true } : {}) }];
}

/** 명령 모듈이 함께 쓰는 것들 */
export interface CommandDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly log: Logger;
  readonly now: () => number;
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
  readonly roomState: RoomState;
  readonly snapshots: Snapshots;
  readonly events: RoomEvents;
  readonly access: AccessSync;
  readonly gate: RoomGate;
}

/** 실행 주체의 수업방. 없거나 만료면 `E_ROOM_EXPIRED`, `active`면 닫힌 방도 `E_ROOM_CLOSED`. */
export function roomFor(
  deps: CommandDeps,
  actor: RoomActor,
  now: number,
  options: { readonly active?: boolean } = {},
): StoredRoom {
  deps.gate.assertOpen(actor.roomId);
  const room = deps.repos.rooms.findById(actor.roomId);
  if (!room) throw new AppError('E_ROOM_EXPIRED', 'room is gone');
  const status = roomStatusAt(room, now);
  if (status === 'EXPIRED') throw new AppError('E_ROOM_EXPIRED');
  if (options.active && status === 'CLOSED') throw new AppError('E_ROOM_CLOSED');
  return room;
}

/** 실행 주체가 다룰 수 있는 글: 학생은 자기 글, 교사는 그 방 글. 아니면(없는 글 포함) `E_FORBIDDEN`. */
export function docFor(deps: CommandDeps, actor: RoomActor, docId: string): DocumentInfo {
  const info = deps.repos.documents.findInfo(docId);
  if (!info || info.roomId !== actor.roomId) throw new AppError('E_FORBIDDEN');
  if (actor.kind === 'student' && info.participantId !== actor.participantId)
    throw new AppError('E_FORBIDDEN');
  return info;
}

export function requireStudent(actor: RoomActor): asserts actor is Extract<RoomActor, { kind: 'student' }> {
  if (actor.kind !== 'student') throw new AppError('E_FORBIDDEN');
}

/**
 * 학생의 동의 판이 지금 판인가(PRD F-03, P6-consent-block). 다르면 `E_INPUT {consentVersion:'outdated'}`.
 * 새 글·제출처럼 글을 서버에 남기는 명령 앞에 둔다. 재동의(`consent.update`)는 이 검사를 거치지 않는다.
 */
export function requireCurrentConsent(
  deps: Pick<CommandDeps, 'repos' | 'config'>,
  actor: Extract<RoomActor, { kind: 'student' }>,
): void {
  const participant = deps.repos.participants.findById(actor.participantId);
  assertConsentCurrent(participant?.consentVersion, deps.config.product.POLICY_VERSION);
}

export function requireTeacher(actor: RoomActor): asserts actor is Extract<RoomActor, { kind: 'teacher' }> {
  if (actor.kind !== 'teacher') throw new AppError('E_FORBIDDEN');
}

export { currentText } from '../docText.ts';

export function authorOf(actor: RoomActor): 'STUDENT' | 'TEACHER' {
  return actor.kind === 'teacher' ? 'TEACHER' : 'STUDENT';
}
