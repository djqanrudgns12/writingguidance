import { z } from 'zod';

/**
 * 실시간 인증 값(PLAN §4.1). 주소가 아니라 제공자의 인증 메시지로 JSON 문자열을 보낸다.
 * 토큰은 기기가 만든 32바이트 base64url(43자, PLAN §7.4). 서버는 해시만 저장한다.
 * `dev`는 개발 전용 자격(PLAN §11.5): 서버가 시작할 때마다 만든 비밀값, `doc:dev-*`에만 붙는다.
 */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const token = z.string().regex(TOKEN_PATTERN);
const deviceId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const credentialSchema = z.discriminatedUnion('kind', [
  z.strictObject({ v: z.literal(1), kind: z.literal('student'), token, deviceId }),
  z.strictObject({ v: z.literal(1), kind: z.literal('teacher'), token, deviceId }),
  z.strictObject({
    v: z.literal(1),
    kind: z.literal('dev'),
    token,
    deviceId,
    role: z.enum(['student', 'teacher']),
  }),
]);

export type Credential = z.infer<typeof credentialSchema>;

export function encodeCredential(credential: Credential): string {
  return JSON.stringify(credential);
}

/** 모양이 틀리면 `null`. */
export function decodeCredential(raw: string): Credential | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = credentialSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
