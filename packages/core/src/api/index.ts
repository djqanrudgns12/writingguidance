import { z } from 'zod';
import type { Config } from '../config.ts';
import { AI_BUTTONS, DOC_STATUSES, RESUME_STATUSES, ROOM_STATUSES } from '../domain/status.ts';
import { TOKEN_PATTERN } from '../protocol/auth.ts';

/**
 * REST 요청·응답 모양(PLAN §7.2). 봉투는 `{data, requestId}` / `{error:{code,message,retryable,fields}, requestId}`.
 * 길이 한도는 `config`(PRD 12.3)에서 오므로 설정을 받아 스키마를 만든다. 알 수 없는 필드는 거부(`strict`).
 */
const uuid = z.uuid();
const genreId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
/** 기기가 만든 토큰의 SHA-256 hex(서버는 토큰 원문을 받지 않는다, §7.4) */
const tokenHash = z.string().regex(/^[0-9a-f]{64}$/);
/** 기기 식별자: 기기가 만든 UUID */
const deviceId = uuid;

export function createApiSchemas(config: Readonly<Config>) {
  const digits = (min: number, max: number) => z.string().regex(/^\d+$/).min(min).max(max);
  const pin = digits(config.PIN_MIN_LENGTH, config.PIN_MAX_LENGTH);
  const entryCode = digits(config.ENTRY_CODE_LENGTH, config.ENTRY_CODE_LENGTH);
  const nickname = z
    .string()
    .trim()
    .min(1)
    .max(config.NICKNAME_MAX_LENGTH * 2); // 정규화 전 여유. 정규화 뒤 길이는 domain이 본다.

  return {
    entryCode,
    createRoomBody: z
      .object({
        className: z.string().trim().min(1).max(config.CLASS_NAME_MAX_CHARS),
        title: z.string().trim().min(1).max(config.ROOM_TITLE_MAX_CHARS),
        schoolName: z.string().trim().min(1).max(config.SCHOOL_NAME_MAX_CHARS).optional(),
        showSchool: z.boolean(),
        genres: z.array(genreId).min(1).max(32),
        aiButtons: z.array(z.enum(AI_BUTTONS)).max(AI_BUTTONS.length),
        pin,
        linkTokenHash: tokenHash,
        deviceId,
        commandId: uuid,
      })
      .strict(),
    createRoomResult: z.object({ roomId: uuid, entryCode, expiresAt: z.number() }).strict(),

    roomByCodeResult: z
      .object({
        roomId: uuid,
        className: z.string(),
        title: z.string(),
        schoolName: z.string().nullable(),
        status: z.enum(ROOM_STATUSES),
        expiresAt: z.number(),
        policyVersion: z.string(),
        genres: z.array(genreId),
      })
      .strict(),

    joinBody: z
      .object({
        nickname,
        consentVersion: z.string().min(1).max(32),
        deviceId,
        deviceTokenHash: tokenHash,
        commandId: uuid,
      })
      .strict(),
    joinResult: z.object({ participantId: uuid, nickname: z.string() }).strict(),

    resumeRequestBody: z.object({ nickname, deviceId, deviceTokenHash: tokenHash, commandId: uuid }).strict(),
    resumeRequestResult: z.object({ requestId: uuid }).strict(),
    resumeStatusResult: z.object({ status: z.enum(RESUME_STATUSES) }).strict(),

    teacherPinBody: z.object({ pin, deviceId, sessionTokenHash: tokenHash, commandId: uuid }).strict(),
    teacherPinResult: z.object({ roomId: uuid }).strict(),
    /** `GET /api/teacher/session`(교사 Bearer): 선생님 링크 토큰이 어느 방 것인지 */
    teacherSessionResult: z.object({ roomId: uuid }).strict(),

    teacherRoomResult: z
      .object({
        room: z
          .object({
            id: uuid,
            className: z.string(),
            title: z.string(),
            schoolName: z.string().nullable(),
            showSchool: z.boolean(),
            status: z.enum(ROOM_STATUSES),
            genres: z.array(genreId),
            aiButtons: z.array(z.enum(AI_BUTTONS)),
            sound: z.boolean(),
            createdAt: z.number(),
          })
          .strict(),
        entryCode,
        shortUrl: z.string(),
        expiresAt: z.number(),
      })
      .strict(),
    teacherPinViewResult: z.object({ pin }).strict(),

    exportResult: z
      .object({
        room: z
          .object({ className: z.string(), title: z.string(), schoolName: z.string().nullable() })
          .strict(),
        docs: z.array(
          z
            .object({
              nickname: z.string(),
              genre: genreId,
              subtype: z.string().nullable(),
              purpose: z.string().nullable(),
              title: z.string(),
              body: z.string(),
              status: z.enum(DOC_STATUSES),
              submittedAt: z.number().nullable(),
              charCount: z.number().int(),
            })
            .strict(),
        ),
      })
      .strict(),

    checkAiResult: z.object({ ok: z.boolean(), latencyMs: z.number() }).strict(),

    /** `POST /api/rooms/:roomId/ai`(학생 Bearer). 본문은 기기가 보낸 글(학생이 본 글과 위치가 맞아야 해서, §7.2). */
    aiRequestBody: z
      .object({
        docId: uuid,
        button: z.enum(AI_BUTTONS),
        text: z.string().max(config.AI_SPELL_MAX_CHARS),
        range: z.enum(['ALL', 'TAIL']),
        meta: z
          .object({
            helpNotes: z
              .array(
                z
                  .object({ questionId: z.string().max(32), note: z.string().max(config.MEMO_MAX_CHARS) })
                  .strict(),
              )
              .max(16),
            // 노래 분위기 직접 입력은 화면·Yjs 검사(`docMeta.ts` moodCustom)와 같은 한도. 빠르기는 고른 이름이라 같은 값으로 넉넉하다.
            mood: z.string().max(config.DOC_TITLE_MAX_CHARS).optional(),
            tempo: z.string().max(config.DOC_TITLE_MAX_CHARS).optional(),
          })
          .strict(),
        commandId: uuid,
      })
      .strict(),
    /** 구조화 결과(맞춤법·한마디·방향). `result`의 모양은 버튼마다 다르고 서버가 검증한 뒤 보낸다. */
    aiStructuredResult: z
      .object({
        button: z.enum(AI_BUTTONS),
        result: z.unknown(),
        receivedAt: z.number(),
        textHash: z.string(),
      })
      .strict(),
  };
}

export type ApiSchemas = ReturnType<typeof createApiSchemas>;
export type ApiOutput<K extends keyof ApiSchemas> = z.output<ApiSchemas[K]>;

/** 공통 봉투(성공·실패) */
export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean(),
        fields: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    requestId: z.string(),
  })
  .strict();

/** 기기 토큰 원문 모양(인증 머리 `Bearer`) */
export const bearerTokenSchema = z.string().regex(TOKEN_PATTERN);

/** 다듬은 글 스트림 한 줄(PLAN §8.3 계약, `application/x-ndjson`) */
export const polishLineSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('text'), d: z.string() }).strict(),
  z.object({ t: z.literal('reset') }).strict(),
  z.object({ t: z.literal('done'), stop: z.enum(['end', 'limit']) }).strict(),
  z.object({ t: z.literal('error'), code: z.string() }).strict(),
  // 학생 글에 개인정보·쓰면 안 되는 표현이 있었다는 알림(docs/ai-harness.md P-01·S-09, U-26). 옛 기기는 모르는 줄을 버린다.
  z.object({ t: z.literal('notice'), notices: z.array(z.string()).max(4) }).strict(),
]);
export type PolishLine = z.output<typeof polishLineSchema>;
