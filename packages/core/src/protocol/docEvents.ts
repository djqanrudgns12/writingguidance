import { z } from 'zod';
import { errorCodes, type ErrorCode } from '../errors.ts';

/**
 * 글 채널 이벤트(PLAN §4.4 "글 채널 이벤트"). `doc:*` 제공자의 무상태 메시지로 서버 → 기기로만 간다.
 * 모양은 수업방 채널 이벤트와 같다: `{t:'evt', v:1, name, data, serverNow}`.
 *
 * - `doc.persisted {stateVector, snapshot?}`: 이 상태까지 DB에 저장됨. 기기는 자기 상태가 다 들어 있을 때만 `저장됨`.
 *   `snapshot`(base64url `Y.encodeSnapshot`)은 삭제 집합까지 담아 지우기만 한 변경도 판정한다(`coverage.ts`).
 *   없으면(판 N-1 서버) 기기는 `stateVector`로만 본다.
 * - `doc.persistFailed {}`: 저장 실패(서버가 다시 시도 중). 기기는 사본을 지우지 않고 `보내는 중`.
 * - `doc.status {docId, status, at}`: 잠금이 바뀜(제출·다시 쓰게 하기·닫기). 풀리면 기기가 `forceSync()`.
 * - `doc.error {code}`: 그 연결의 편집을 서버가 받지 않음(예: `E_DOC_TOO_LARGE`). 연결은 읽기 전용이 된다.
 */
export const docStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'REOPENED']);
export type DocStatus = z.infer<typeof docStatusSchema>;

const errorCode = z.enum(errorCodes as [ErrorCode, ...ErrorCode[]]);
const base64Url = z.string().regex(/^[A-Za-z0-9_-]*$/);

export const docEventSchema = z.discriminatedUnion('name', [
  z.strictObject({
    t: z.literal('evt'),
    v: z.literal(1),
    name: z.literal('doc.persisted'),
    data: z.strictObject({ stateVector: z.string(), snapshot: base64Url.optional() }),
    serverNow: z.number(),
  }),
  z.strictObject({
    t: z.literal('evt'),
    v: z.literal(1),
    name: z.literal('doc.persistFailed'),
    data: z.strictObject({}),
    serverNow: z.number(),
  }),
  z.strictObject({
    t: z.literal('evt'),
    v: z.literal(1),
    name: z.literal('doc.status'),
    data: z.strictObject({ docId: z.string(), status: docStatusSchema, at: z.number(), locked: z.boolean() }),
    serverNow: z.number(),
  }),
  z.strictObject({
    t: z.literal('evt'),
    v: z.literal(1),
    name: z.literal('doc.error'),
    data: z.strictObject({ code: errorCode }),
    serverNow: z.number(),
  }),
]);

export type DocEvent = z.infer<typeof docEventSchema>;
export type DocEventName = DocEvent['name'];
export type DocEventData<N extends DocEventName> = Extract<DocEvent, { name: N }>['data'];

export function encodeDocEvent<N extends DocEventName>(
  name: N,
  data: DocEventData<N>,
  serverNow: number,
): string {
  return JSON.stringify({ t: 'evt', v: 1, name, data, serverNow });
}

/** 모르는 이벤트·틀린 모양은 `null`(기기는 무시하고 기록만 한다). */
export function decodeDocEvent(raw: string): DocEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = docEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
