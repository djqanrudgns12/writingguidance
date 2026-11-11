import { countChars, DOC_KEYS } from '@geulbang/core';
import { AppError, errorCatalog, type ErrorCode } from '@geulbang/core/errors';
import {
  COMMAND_NAMES,
  COMMAND_ROLES,
  createCommandArgSchemas,
  decodeCommand,
  docDocumentName,
  encodeAckError,
  encodeAckOk,
  encodeRoomEvent,
  isSupportedVersion,
  isUuid,
  parseDocumentName,
  type CommandName,
  type Hello,
  type MyDoc,
} from '@geulbang/core/protocol';
import type { connectedPayload, Connection, onStatelessPayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { z } from 'zod';
import type { DeleteRoom } from '../application/deleteRoom.ts';
import type { ResumeWaiters } from '../application/resumeWaiters.ts';
import type { TimerScheduler } from '../jobs/timers.ts';
import { hashArgs } from '../store/repos/commands.ts';
import type { DocumentInfo } from '../store/repos/documents.ts';
import { roomStatusAt } from '../store/repos/rooms.ts';
import { clientConfigOf } from './clientConfig.ts';
import { classCommands } from './commands/classCommands.ts';
import { docCommands } from './commands/docCommands.ts';
import { resumeCommands } from './commands/resumeCommands.ts';
import { roomCommands } from './commands/roomCommands.ts';
import { snapshotCommands } from './commands/snapshotCommands.ts';
import type { CommandDeps, CommandSpec } from './commands/types.ts';
import { isRoomActor, type RealtimeContext, type RoomActor } from './context.ts';
import { knownSubtype } from './docMeta.ts';

/**
 * 수업방 채널(PLAN §4.4). `room:*` 문서는 내용이 없고, 무상태 메시지로 명령·응답·이벤트가 오간다.
 * - 연결이 붙으면 그 기기에만 `hello`.
 * - 명령: 봉투 → 판(N, N-1) → 역할(`COMMAND_ROLES`) → 인자(설정으로 만든 스키마) → 멱등 기록과 실행(한 트랜잭션)
 *   → (연결·메모리 고치기) → `ack`. 학생의 `room:*` 연결은 읽기 전용이지만 무상태 메시지는 오므로 권한은 여기서 본다.
 *   명령마다의 일은 `commands/*.ts`. 이 서버가 모르는 이름(더 새 기기)은 `E_VERSION`.
 * - `HEARTBEAT_SEC`마다 모든 방 연결에 `tick {serverNow}`(기기의 시각 보정용, §4.7 대응 5).
 */
export interface RoomChannel {
  connected(payload: connectedPayload<RealtimeContext>): void;
  onStateless(payload: onStatelessPayload): void;
  close(): void;
}

export interface RoomChannelDeps extends CommandDeps {
  readonly timers: TimerScheduler;
  readonly resumeWaiters: ResumeWaiters;
  readonly deleteRoom: DeleteRoom;
}

export function createRoomChannel(deps: RoomChannelDeps): RoomChannel {
  const { config, repos, log, roomState } = deps;
  const p = config.product;
  const argSchemas = createCommandArgSchemas(p);
  const specs = new Map<CommandName, CommandSpec>([
    ...docCommands(deps),
    ...snapshotCommands(deps),
    ...classCommands(deps),
    ...resumeCommands(deps),
    ...roomCommands(deps),
  ]);

  // ── 명령 ─────────────────────────────────────────────────────
  const reply = (connection: Connection, message: string) => connection.sendStateless(message);
  const replyError = (connection: Connection, id: string, code: ErrorCode) =>
    reply(connection, encodeAckError(id, code, errorCatalog[code].retryable));
  /** 트랜잭션은 이미 끝났다. 뒷일이 실패해도 명령은 된 것이라 기록만 남기고 `ack`는 그대로 보낸다. */
  const runAfter = (name: string, after: (() => void) | undefined) => {
    if (!after) return;
    try {
      after();
    } catch (error) {
      log.error('command_after_failed', { detail: name, error });
    }
  };

  const handleCommand = (connection: Connection, actor: RoomActor, raw: string) => {
    const env = decodeCommand(raw);
    if (!env) {
      const peeked = peekCommand(raw);
      if (peeked) replyError(connection, peeked.id, peeked.unknownName ? 'E_VERSION' : 'E_INPUT');
      else log.info('command_dropped', { code: 'E_INPUT' });
      return;
    }
    if (!isSupportedVersion(env.v)) return replyError(connection, env.id, 'E_VERSION');
    if (!COMMAND_ROLES[env.name].includes(actor.role)) return replyError(connection, env.id, 'E_FORBIDDEN');
    const spec = specs.get(env.name);
    if (!spec) return replyError(connection, env.id, 'E_VERSION');
    const parsed = (argSchemas[env.name] as z.ZodType).safeParse(env.args);
    if (!parsed.success) return replyError(connection, env.id, 'E_INPUT');

    const now = deps.now();
    try {
      if (spec.unrecorded) {
        const outcome = spec.handler(actor, parsed.data, now);
        reply(connection, encodeAckOk(env.id, outcome.result));
        runAfter(env.name, outcome.after);
        log.info('command', { detail: env.name });
        return;
      }
      let after: (() => void) | undefined;
      const outcome = repos.commands.runOnce(
        {
          id: env.id,
          roomId: actor.roomId,
          actorKind: actor.kind === 'student' ? 'STUDENT' : 'TEACHER',
          actorId: actor.kind === 'student' ? actor.deviceRowId : actor.sessionId,
          name: env.name,
          argsHash: hashArgs(parsed.data),
        },
        now,
        () => {
          const result = spec.handler(actor, parsed.data, now);
          after = result.after;
          return result.result;
        },
      );
      if (!outcome.replayed) runAfter(env.name, after);
      reply(connection, encodeAckOk(env.id, outcome.result));
      log.debug('command', { detail: outcome.replayed ? `${env.name} replayed` : env.name });
    } catch (error) {
      if (error instanceof AppError) {
        log.info('command_rejected', { detail: env.name, code: error.code });
        return replyError(connection, env.id, error.code);
      }
      log.error('command_failed', { detail: env.name, error });
      replyError(connection, env.id, 'E_INTERNAL');
    }
  };

  // ── hello ────────────────────────────────────────────────────
  /** 메모리에 열린 문서가 있으면 그것이 가장 새 글이다(PLAN §4.5). 없으면 저장된 상태를 잠깐 열어 읽는다. */
  const readDocMeta = (
    info: DocumentInfo,
  ): { chars: number; subtype: string | null; purposeCustom: string | null } => {
    const live = deps.hocuspocus().documents.get(docDocumentName(info.id));
    if (live) return metaOf(live, info);
    const stored = repos.documents.find(info.id);
    if (!stored)
      return { chars: info.charCount, subtype: knownSubtype(info.genre, info.subtype), purposeCustom: null };
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, stored.state);
      return metaOf(doc, info);
    } finally {
      doc.destroy();
    }
  };

  const myDocs = (participantId: string): MyDoc[] =>
    repos.documents.listByParticipant(participantId).map(info => {
      const meta = readDocMeta(info);
      return {
        docId: info.id,
        genre: info.genre,
        subtype: meta.subtype,
        purpose: info.purpose,
        purposeCustom: meta.purposeCustom,
        status: info.status,
        generation: info.generation,
        chars: meta.chars,
        updatedAt: info.updatedAt,
        submittedAt: info.submittedAt,
      };
    });

  const buildHello = (actor: RoomActor, now: number): Hello | null => {
    const room = repos.rooms.findById(actor.roomId);
    if (!room) return null;
    const student = actor.kind === 'student';
    const participant = student ? repos.participants.findById(actor.participantId) : undefined;
    return {
      role: actor.role,
      room: {
        id: room.id,
        className: room.className,
        title: room.title,
        // 학생에게는 교사가 '보이기'를 켰을 때만(PRD F-02). 교사는 자기가 쓴 값을 본다.
        schoolName: student && !room.showSchool ? null : room.schoolName,
        status: roomStatusAt(room, now),
        expiresAt: room.expiresAt,
        settings: {
          genres: room.settings.genres,
          aiButtons: room.settings.aiButtons,
          sound: room.settings.sound,
        },
      },
      me: participant
        ? {
            participantId: participant.id,
            nickname: participant.nickname,
            consentVersion: participant.consentVersion,
          }
        : null,
      docs: student ? myDocs(actor.participantId) : [],
      summaries: student ? null : roomState.summaries(room.id),
      participants: student ? null : roomState.participants(room.id),
      timer: repos.timers.get(room.id, now),
      recentNotices: repos.notices.listSince(room.id, now - p.NOTICE_REPLAY_SEC * 1000),
      // 교사가 접속해 있지 않을 때 온 이어 쓰기 요청은 들어오면 여기서 본다(PRD F-14).
      pendingResumes: student ? null : repos.resumeRequests.listPending(room.id),
      config: clientConfigOf(config),
    };
  };

  // ── tick ─────────────────────────────────────────────────────
  const ticker = setInterval(() => {
    const now = deps.now();
    const message = encodeRoomEvent('tick', { serverNow: now }, now);
    for (const [name, document] of deps.hocuspocus().documents) {
      if (parseDocumentName(name)?.kind === 'room') document.broadcastStateless(message);
    }
  }, p.HEARTBEAT_SEC * 1000);
  ticker.unref();

  return {
    connected({ connection, documentName }) {
      // 글 연결(`doc:*`)은 인증 훅에서 이미 요약에 올렸다(hocuspocus.ts). 여기서는 수업방 채널만.
      const { actor } = connection.context;
      if (parseDocumentName(documentName)?.kind !== 'room' || !isRoomActor(actor)) return;
      roomState.attachRoomConnection(connection);
      connection.onClose(() => {
        try {
          roomState.detachRoomConnection(connection);
        } catch (error) {
          log.error('room_detach_failed', { error });
        }
      });
      const now = deps.now();
      const hello = buildHello(actor, now);
      if (hello) connection.sendStateless(encodeRoomEvent('hello', hello, now));
    },

    onStateless({ connection, documentName, payload }) {
      if (parseDocumentName(documentName)?.kind !== 'room') return;
      // onStateless 묶음의 연결 타입은 context를 모른다. 이 서버의 연결은 모두 RealtimeContext다.
      const actor = (connection.context as RealtimeContext).actor;
      if (!isRoomActor(actor)) return;
      handleCommand(connection, actor, payload);
    },

    close() {
      clearInterval(ticker);
    },
  };
}

/** 모양이 틀린 명령이라도 `id`가 보이면 답을 준다(기기가 10초 기다리지 않게). 모르는 이름이면 더 새 기기다. */
function peekCommand(raw: string): { id: string; unknownName: boolean } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { t, id, name } = value as { t?: unknown; id?: unknown; name?: unknown };
  if (t !== 'cmd' || typeof id !== 'string' || !isUuid(id)) return null;
  const unknownName = typeof name === 'string' && !(COMMAND_NAMES as readonly string[]).includes(name);
  return { id, unknownName };
}

function metaOf(
  doc: Y.Doc,
  info: DocumentInfo,
): { chars: number; subtype: string | null; purposeCustom: string | null } {
  const meta = doc.getMap(DOC_KEYS.meta);
  const subtype = meta.get('subtype');
  const purposeCustom = meta.get('purposeCustom');
  // 이미 저장된 틀린 하위 종류는 null로 보낸다(hello 전체가 받는 쪽 규약 검사에서 버려지지 않게, 검토 2번).
  return {
    chars: countChars(doc.getText(DOC_KEYS.body).toString()),
    subtype: knownSubtype(info.genre, typeof subtype === 'string' ? subtype : info.subtype),
    purposeCustom: typeof purposeCustom === 'string' ? purposeCustom : null,
  };
}
