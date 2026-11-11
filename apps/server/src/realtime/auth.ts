import { timingSafeEqual } from 'node:crypto';
import { AppError } from '@geulbang/core/errors';
import {
  decodeCredential,
  isDevDocId,
  parseDocumentName,
  type Credential,
  type DocumentRef,
} from '@geulbang/core/protocol';
import type { onAuthenticatePayload } from '@hocuspocus/server';
import { hashToken } from '../security/tokens.ts';
import { ensureDevDocument } from '../store/devSeed.ts';
import type { Db } from '../store/db.ts';
import type { Repos } from '../store/repos/index.ts';
import { roomStatusAt, type StoredRoom } from '../store/repos/rooms.ts';
import { decideAccess } from './access.ts';
import type { Actor, ConnectedDoc, RealtimeContext, RoomActor } from './context.ts';
import type { RoomGate } from './roomGate.ts';

export interface AuthDeps {
  readonly db: Db;
  readonly repos: Repos;
  readonly now: () => number;
  /** 지우는 중인 방은 새 인증을 받지 않는다(PLAN §7.7-1). */
  readonly gate: RoomGate;
  /** 지금 처리방침 판(설정 `POLICY_VERSION`). 학생의 동의 판이 다르면 자기 글도 읽기로만 연다(P5-5b 검토 B03). */
  readonly policyVersion: string;
  /** 개발 전용 비밀값. `DEV_DOCS_ENABLED`가 아니면 `undefined`라 `dev` 자격은 늘 거부된다. */
  readonly devSecret: string | undefined;
}

export type AuthResult = { actor: Actor; doc?: ConnectedDoc };

/**
 * 문서마다 인증(PLAN §4.3·§4.7). 토큰 확인 → 권한 표(`access.ts`) → 연결의 읽기 전용 여부 → context에 실행 주체.
 * 실패는 `AppError`로 던지고, 훅 감싸기가 코드를 `reason`에 실어 기기로 보낸다.
 *
 * - `student`: 기기 토큰 → SHA-256 → `devices` 행. 없거나 끊긴 기기(`revoked_at`)면 `E_AUTH`.
 *   토큰은 그 기기 ID에 묶여 있어 다른 기기 ID로 오면 `E_AUTH`. 동의 판이 지금 정책 판과 다르면 자기 글도 읽기 전용.
 * - `teacher`: 선생님 링크(LINK)·PIN 세션 토큰 → SHA-256 → `teacher_sessions`. LINK는 여러 기기가 함께 쓰고,
 *   PIN 세션은 그 기기에만 묶인다.
 * - 자격 문제는 모두 `E_AUTH`(기기는 그 수업방 기억을 지우고 처음 화면으로, PLAN §2.4). 수업방이 만료됐으면
 *   `E_ROOM_EXPIRED`(PRD F-02 "문을 닫았어요"가 따로 있다), 권한 밖이면 `E_FORBIDDEN`.
 * - `dev`: 개발 전용 비밀값 + `doc:dev-*`만(PLAN §11.5). 그대로 둔다.
 */
export function createAuthenticator(deps: AuthDeps) {
  const { repos } = deps;

  return async (payload: onAuthenticatePayload<RealtimeContext>): Promise<AuthResult> => {
    const ref = parseDocumentName(payload.documentName);
    if (!ref) throw new AppError('E_FORBIDDEN', 'bad document name');
    const credential = decodeCredential(payload.token);
    if (!credential) throw new AppError('E_AUTH', 'bad credential');

    if (credential.kind === 'dev') {
      if (!deps.devSecret || !sameSecret(credential.token, deps.devSecret)) throw new AppError('E_AUTH');
      if (ref.kind !== 'doc' || !isDevDocId(ref.id)) throw new AppError('E_FORBIDDEN');
      ensureDevDocument(deps.db, ref.id, deps.now());
      payload.connectionConfig.readOnly = false;
      return { actor: { kind: 'dev', role: credential.role, deviceId: credential.deviceId } };
    }

    const now = deps.now();
    const { actor, room, consentVersion } =
      credential.kind === 'student' ? verifyStudent(repos, credential) : verifyTeacher(repos, credential);
    deps.gate.assertOpen(room.id);
    const consentCurrent = consentVersion === null || consentVersion === deps.policyVersion;
    return authorize(repos, payload, ref, actor, { room, consentCurrent }, now);
  };
}

function authorize(
  repos: Repos,
  payload: onAuthenticatePayload<RealtimeContext>,
  ref: DocumentRef,
  actor: RoomActor,
  facts: { readonly room: StoredRoom; readonly consentCurrent: boolean },
  now: number,
): AuthResult {
  const info = ref.kind === 'doc' ? repos.documents.findInfo(ref.id) : undefined;
  const decision = decideAccess(ref, actor, {
    roomStatus: roomStatusAt(facts.room, now),
    consentCurrent: facts.consentCurrent,
    doc: info,
  });
  if (decision.kind === 'deny') throw new AppError(decision.code);
  payload.connectionConfig.readOnly = decision.kind === 'read';

  if (actor.kind === 'student') {
    repos.devices.touch(actor.deviceRowId, now);
    repos.participants.touch(actor.participantId, now);
  } else {
    repos.teacherSessions.touch(actor.sessionId, now);
  }
  if (!info || info.roomId === null) return { actor };
  return { actor, doc: { id: info.id, roomId: info.roomId, participantId: info.participantId } };
}

type RoomCredential = Extract<Credential, { kind: 'student' | 'teacher' }>;

function tokenHashOf(credential: RoomCredential): string {
  try {
    return hashToken(credential.token);
  } catch {
    throw new AppError('E_AUTH', 'bad token');
  }
}

/** `consentVersion`: 학생은 참가자의 동의 판, 교사는 null(동의 대상이 아님) */
type Verified = { actor: RoomActor; room: StoredRoom; consentVersion: string | null };

function verifyStudent(repos: Repos, credential: RoomCredential): Verified {
  const device = repos.devices.findByTokenHash(tokenHashOf(credential));
  if (!device || device.revokedAt !== null) throw new AppError('E_AUTH', 'unknown or revoked device');
  if (device.deviceId !== credential.deviceId) throw new AppError('E_AUTH', 'token bound to another device');
  const participant = repos.participants.findById(device.participantId);
  // 개인 모드(room_id NULL)는 v1.1. 지금은 수업방 참가자만 받는다.
  if (!participant || participant.roomId === null) throw new AppError('E_AUTH', 'no room participant');
  const room = repos.rooms.findById(participant.roomId);
  if (!room) throw new AppError('E_AUTH', 'room is gone');
  return {
    actor: {
      kind: 'student',
      role: 'student',
      roomId: room.id,
      participantId: participant.id,
      deviceRowId: device.id,
      deviceId: credential.deviceId,
    },
    room,
    consentVersion: participant.consentVersion,
  };
}

function verifyTeacher(repos: Repos, credential: RoomCredential): Verified {
  const session = repos.teacherSessions.findByTokenHash(tokenHashOf(credential));
  if (!session || session.revokedAt !== null) throw new AppError('E_AUTH', 'unknown or revoked session');
  if (session.kind === 'PIN' && session.deviceId !== credential.deviceId) {
    throw new AppError('E_AUTH', 'pin session bound to another device');
  }
  const room = repos.rooms.findById(session.roomId);
  if (!room) throw new AppError('E_AUTH', 'room is gone');
  return {
    actor: {
      kind: 'teacher',
      role: 'teacher',
      roomId: room.id,
      sessionId: session.id,
      deviceId: credential.deviceId,
    },
    room,
    consentVersion: null,
  };
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
