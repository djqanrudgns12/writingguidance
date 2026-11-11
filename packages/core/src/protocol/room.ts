import { z } from 'zod';
import type { Config } from '../config.ts';
import { isErrorCode, type ErrorCode } from '../errors.ts';
import {
  AI_BUTTONS,
  DOC_STATUSES,
  NOTICE_KINDS,
  PRESENCE_STATES,
  RESUME_STATUSES,
  ROOM_STATUSES,
  SNAPSHOT_AUTHORS,
  SNAPSHOT_REASONS,
  TIMER_STATUSES,
} from '../domain/status.ts';

/**
 * 수업방 채널(`room:*` 무상태 메시지, PLAN §4.4). 명령(cmd) → 응답(ack), 서버 → 기기 이벤트(evt).
 * 모양 검사만 여기서 한다. 길이·개수 한도는 `config`에서 오므로 명령 인자 스키마는 설정을 받아 만든다.
 * 권한(누가 보낼 수 있나)은 서버 `realtime/access.ts`가 이 표의 `COMMAND_ROLES`로 확인한다.
 */
export const PROTOCOL_VERSION = 1;

const uuid = z.uuid();
const genreId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const subtypeId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
/** base64url 상태 벡터(Yjs `encodeStateVector`) */
const stateVector = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/)
  .max(4096);

export const COMMAND_NAMES = [
  'doc.create',
  'doc.submit',
  'doc.reopen',
  'snapshot.list',
  'snapshot.get',
  'snapshot.restore',
  'notice.send',
  'timer.start',
  'timer.pause',
  'timer.resume',
  'timer.cancel',
  'resume.decide',
  'device.list',
  'device.revoke',
  'room.update',
  'room.close',
  'room.reopen',
  'room.delete',
  'consent.update',
  'ping',
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

export type Role = 'student' | 'teacher';

/** 명령마다 보낼 수 있는 역할(PLAN §4.3·§4.4 "누가"). */
export const COMMAND_ROLES: Readonly<Record<CommandName, readonly Role[]>> = {
  'doc.create': ['student'],
  'doc.submit': ['student'],
  'doc.reopen': ['teacher'],
  'snapshot.list': ['student', 'teacher'],
  'snapshot.get': ['student', 'teacher'],
  'snapshot.restore': ['student', 'teacher'],
  'notice.send': ['teacher'],
  'timer.start': ['teacher'],
  'timer.pause': ['teacher'],
  'timer.resume': ['teacher'],
  'timer.cancel': ['teacher'],
  'resume.decide': ['teacher'],
  'device.list': ['teacher'],
  'device.revoke': ['teacher'],
  'room.update': ['teacher'],
  'room.close': ['teacher'],
  'room.reopen': ['teacher'],
  'room.delete': ['teacher'],
  'consent.update': ['student'],
  ping: ['teacher'],
};

const empty = z.object({}).strict();

/** 명령 이름 → 인자 스키마. 설정 한도를 넣어 만든다. */
export function createCommandArgSchemas(config: Readonly<Config>) {
  const timerAlertsMin = z.array(z.number().int().min(1).max(config.TIMER_MAX_MIN)).max(4);
  return {
    'doc.create': z
      .object({
        genre: genreId,
        subtype: subtypeId.optional(),
        purpose: subtypeId.optional(),
        purposeCustom: z.string().trim().min(1).max(config.DOC_TITLE_MAX_CHARS).optional(),
      })
      .strict(),
    'doc.submit': z
      .object({
        docId: uuid,
        stateVector,
        generation: z.number().int().min(0),
        // 상태 벡터 + 삭제 집합(`Y.encodeSnapshot`, base64url). 있으면 서버는 이것으로 덮음을 본다(coverage.ts).
        snapshot: z
          .string()
          .regex(/^[A-Za-z0-9_-]*$/)
          .max(config.WS_MAX_PAYLOAD_BYTES)
          .optional(),
      })
      .strict(),
    'doc.reopen': z.object({ docId: uuid }).strict(),
    'snapshot.list': z.object({ docId: uuid }).strict(),
    'snapshot.get': z.object({ docId: uuid, snapshotId: uuid }).strict(),
    'snapshot.restore': z.object({ docId: uuid, snapshotId: uuid }).strict(),
    'notice.send': z.object({ text: z.string().trim().min(1).max(config.NOTICE_MAX_CHARS) }).strict(),
    'timer.start': z
      .object({
        durationSec: z
          .number()
          .int()
          .min(60)
          .max(config.TIMER_MAX_MIN * 60),
        alerts: timerAlertsMin,
        endText: z.string().trim().max(config.NOTICE_MAX_CHARS),
      })
      .strict(),
    'timer.pause': empty,
    'timer.resume': empty,
    'timer.cancel': empty,
    'resume.decide': z.union([
      z.object({ requestId: uuid, approve: z.boolean() }).strict(),
      z.object({ all: z.literal(true), approve: z.literal(true) }).strict(),
    ]),
    'device.list': z.object({ participantId: uuid }).strict(),
    'device.revoke': z.object({ deviceRowId: uuid }).strict(),
    'room.update': z
      .object({
        genres: z.array(genreId).min(1).max(32).optional(),
        aiButtons: z.array(z.enum(AI_BUTTONS)).max(AI_BUTTONS.length).optional(),
        sound: z.boolean().optional(),
      })
      .strict(),
    'room.close': empty,
    'room.reopen': empty,
    'room.delete': empty,
    'consent.update': z.object({ consentVersion: z.string().min(1).max(32) }).strict(),
    ping: z.object({ sentAt: z.number().finite() }).strict(),
  } satisfies Record<CommandName, z.ZodType>;
}

export type CommandArgSchemas = ReturnType<typeof createCommandArgSchemas>;
export type CommandArgs<N extends CommandName> = z.output<CommandArgSchemas[N]>;

// ── 봉투 ─────────────────────────────────────────────────────────
export const cmdEnvelopeSchema = z
  .object({
    t: z.literal('cmd'),
    v: z.number().int(),
    id: uuid,
    name: z.enum(COMMAND_NAMES),
    args: z.unknown(),
  })
  .strict();
export type CmdEnvelope = z.output<typeof cmdEnvelopeSchema>;

const errorCodeSchema = z.string().refine(isErrorCode) as unknown as z.ZodType<ErrorCode>;

export const ackSchema = z.discriminatedUnion('ok', [
  z
    .object({ t: z.literal('ack'), v: z.number().int(), id: uuid, ok: z.literal(true), data: z.unknown() })
    .strict(),
  z
    .object({
      t: z.literal('ack'),
      v: z.number().int(),
      id: uuid,
      ok: z.literal(false),
      error: z.object({ code: errorCodeSchema, retryable: z.boolean() }).strict(),
    })
    .strict(),
]);
export type Ack = z.output<typeof ackSchema>;

// ── 이벤트 ───────────────────────────────────────────────────────
export const timerStateSchema = z
  .object({
    status: z.enum(TIMER_STATUSES),
    endsAt: z.number().nullable(),
    remainingMs: z.number().nullable(),
    durationSec: z.number().int().nullable(),
    alerts: z.array(z.number().int()),
    endText: z.string(),
  })
  .strict();
export type TimerState = z.output<typeof timerStateSchema>;

export const roomSettingsSchema = z
  .object({
    genres: z.array(genreId),
    aiButtons: z.array(z.enum(AI_BUTTONS)),
    sound: z.boolean(),
  })
  .strict();
export type RoomSettings = z.output<typeof roomSettingsSchema>;

export const docSummarySchema = z
  .object({
    docId: uuid,
    participantId: uuid,
    nickname: z.string(),
    genre: genreId,
    subtype: subtypeId.nullable(),
    chars: z.number().int().min(0),
    lastInputAt: z.number().nullable(),
    lastInputBy: z.enum(['STUDENT', 'TEACHER']).nullable(),
    status: z.enum(DOC_STATUSES),
    presence: z.enum(PRESENCE_STATES),
  })
  .strict();
export type DocSummary = z.output<typeof docSummarySchema>;

export const myDocSchema = z
  .object({
    docId: uuid,
    genre: genreId,
    subtype: subtypeId.nullable(),
    purpose: subtypeId.nullable(),
    purposeCustom: z.string().nullable(),
    status: z.enum(DOC_STATUSES),
    generation: z.number().int().min(0),
    chars: z.number().int().min(0),
    updatedAt: z.number(),
    submittedAt: z.number().nullable(),
  })
  .strict();
export type MyDoc = z.output<typeof myDocSchema>;

export const noticeSchema = z
  .object({
    noticeId: uuid,
    text: z.string(),
    sentAt: z.number(),
    sound: z.boolean(),
    kind: z.enum(NOTICE_KINDS),
  })
  .strict();
export type Notice = z.output<typeof noticeSchema>;

/** 교사용 참가자 목록(글이 아직 없는 참가자도 보이고 "접속 n/m"의 분모가 되게) */
export const participantSummarySchema = z
  .object({
    participantId: uuid,
    nickname: z.string(),
    presence: z.enum(PRESENCE_STATES),
    joinedAt: z.number(),
  })
  .strict();
export type ParticipantSummary = z.output<typeof participantSummarySchema>;

export const resumePendingSchema = z
  .object({ requestId: uuid, participantId: uuid, nickname: z.string(), requestedAt: z.number() })
  .strict();
export type ResumePending = z.output<typeof resumePendingSchema>;

/** 기기에 내려 주는 설정 일부(hello.config). 화면 동작에 필요한 것만. */
export const clientConfigSchema = z.record(z.string(), z.unknown());

export const helloSchema = z
  .object({
    role: z.enum(['student', 'teacher']),
    room: z
      .object({
        id: uuid,
        className: z.string(),
        title: z.string(),
        schoolName: z.string().nullable(),
        status: z.enum(ROOM_STATUSES),
        expiresAt: z.number(),
        settings: roomSettingsSchema,
      })
      .strict(),
    me: z
      .object({ participantId: uuid, nickname: z.string(), consentVersion: z.string().nullable() })
      .strict()
      .nullable(),
    docs: z.array(myDocSchema),
    summaries: z.array(docSummarySchema).nullable(),
    /** 교사에게만. 학생은 null(다른 학생 정보를 받는 길이 없다, §4.3) */
    participants: z.array(participantSummarySchema).nullable(),
    timer: timerStateSchema,
    recentNotices: z.array(noticeSchema),
    pendingResumes: z.array(resumePendingSchema).nullable(),
    config: clientConfigSchema,
  })
  .strict();
export type Hello = z.output<typeof helloSchema>;

export const snapshotItemSchema = z
  .object({
    id: uuid,
    at: z.number(),
    reason: z.enum(SNAPSHOT_REASONS),
    author: z.enum(SNAPSHOT_AUTHORS),
    chars: z.number().int().min(0),
  })
  .strict();
export type SnapshotItem = z.output<typeof snapshotItemSchema>;

export const eventDataSchemas = {
  hello: helloSchema,
  'summary.batch': z.array(docSummarySchema),
  'participant.update': z
    .object({ participantId: uuid, nickname: z.string(), presence: z.enum(PRESENCE_STATES) })
    .strict(),
  'doc.status': z
    .object({ docId: uuid, status: z.enum(DOC_STATUSES), at: z.number(), generation: z.number().int() })
    .strict(),
  'teacher.editing': z.object({ docId: uuid }).strict(),
  notice: noticeSchema,
  timer: timerStateSchema,
  'resume.pending': z.array(resumePendingSchema),
  'resume.decided': z.object({ requestId: uuid, status: z.enum(RESUME_STATUSES) }).strict(),
  'room.settings': z.object({ settings: roomSettingsSchema }).strict(),
  'room.status': z.object({ status: z.enum(ROOM_STATUSES) }).strict(),
  tick: z.object({ serverNow: z.number() }).strict(),
} as const;
export type RoomEventName = keyof typeof eventDataSchemas;
export const ROOM_EVENT_NAMES = Object.keys(eventDataSchemas) as RoomEventName[];
export type RoomEventData<N extends RoomEventName> = z.output<(typeof eventDataSchemas)[N]>;

export const evtEnvelopeSchema = z
  .object({
    t: z.literal('evt'),
    v: z.number().int(),
    name: z.enum(ROOM_EVENT_NAMES as [RoomEventName, ...RoomEventName[]]),
    data: z.unknown(),
    serverNow: z.number(),
  })
  .strict();

export type RoomEvent = {
  [N in RoomEventName]: { name: N; data: RoomEventData<N>; serverNow: number };
}[RoomEventName];

// ── 만들기·풀기 ──────────────────────────────────────────────────
export function encodeCommand(id: string, name: CommandName, args: unknown): string {
  return JSON.stringify({ t: 'cmd', v: PROTOCOL_VERSION, id, name, args });
}

export function encodeAckOk(id: string, data?: unknown): string {
  return JSON.stringify({ t: 'ack', v: PROTOCOL_VERSION, id, ok: true, data: data ?? null });
}

export function encodeAckError(id: string, code: ErrorCode, retryable: boolean): string {
  return JSON.stringify({ t: 'ack', v: PROTOCOL_VERSION, id, ok: false, error: { code, retryable } });
}

export function encodeRoomEvent<N extends RoomEventName>(
  name: N,
  data: RoomEventData<N>,
  serverNow: number,
): string {
  return JSON.stringify({ t: 'evt', v: PROTOCOL_VERSION, name, data, serverNow });
}

/** 서버가 받는 판: N과 N-1(PLAN §4.4). */
export function isSupportedVersion(v: number): boolean {
  return v === PROTOCOL_VERSION || v === PROTOCOL_VERSION - 1;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** 서버 쪽: 무상태 메시지 → 명령 봉투. 모양이 틀리면 null. 인자는 아직 검사하지 않은 채로 둔다. */
export function decodeCommand(raw: string): CmdEnvelope | null {
  const r = cmdEnvelopeSchema.safeParse(parseJson(raw));
  return r.success ? r.data : null;
}

/** 기기 쪽: 무상태 메시지 → 응답 또는 이벤트. 이벤트 데이터까지 검사한다. 모르는 것은 null(조용히 버림). */
export function decodeRoomMessage(
  raw: string,
): { kind: 'ack'; ack: Ack } | { kind: 'evt'; evt: RoomEvent } | null {
  const value = parseJson(raw);
  const ack = ackSchema.safeParse(value);
  if (ack.success) return { kind: 'ack', ack: ack.data };
  const env = evtEnvelopeSchema.safeParse(value);
  if (!env.success) return null;
  const data = eventDataSchemas[env.data.name].safeParse(env.data.data);
  if (!data.success) return null;
  return {
    kind: 'evt',
    evt: { name: env.data.name, data: data.data, serverNow: env.data.serverNow } as RoomEvent,
  };
}
