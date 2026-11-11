/**
 * 실시간 문서 이름 규칙(PLAN §4.1): `room:{roomId}`(수업방 채널), `doc:{docId}`(글 하나).
 * ID는 UUID. 개발 전용 글만 `dev-` 이름을 쓴다(PLAN §11.5, 운영에서는 서버가 받지 않음).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEV_ID = /^dev-[a-z0-9-]{1,40}$/;

export type DocumentRef =
  { readonly kind: 'room'; readonly id: string } | { readonly kind: 'doc'; readonly id: string };

export const isUuid = (id: string): boolean => UUID.test(id);
export const isDevDocId = (id: string): boolean => DEV_ID.test(id);

export const roomDocumentName = (roomId: string): string => `room:${roomId}`;
export const docDocumentName = (docId: string): string => `doc:${docId}`;

/** 모양이 틀린 이름은 `null`(서버는 그 문서 인증을 거부한다). */
export function parseDocumentName(name: string): DocumentRef | null {
  const sep = name.indexOf(':');
  if (sep < 0) return null;
  const prefix = name.slice(0, sep);
  const id = name.slice(sep + 1);
  if (prefix === 'room' && isUuid(id)) return { kind: 'room', id };
  if (prefix === 'doc' && (isUuid(id) || isDevDocId(id))) return { kind: 'doc', id };
  return null;
}
