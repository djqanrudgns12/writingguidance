import { AppError } from '@geulbang/core/errors';
import type { RoomGate } from '../realtime/roomGate.ts';
import { requireBearerTokenHash } from '../security/tokens.ts';
import type { StoredDevice } from '../store/repos/devices.ts';
import type { Repos } from '../store/repos/index.ts';
import type { StoredParticipant } from '../store/repos/participants.ts';
import { roomStatusAt, type StoredRoom } from '../store/repos/rooms.ts';
import type { StoredTeacherSession } from '../store/repos/teacherSessions.ts';

/**
 * REST의 `Authorization: Bearer` 확인(PLAN §7.2·§7.3, 쿠키는 쓰지 않는다). 토큰 원문은 받자마자 SHA-256으로 바꿔 찾는다.
 * - 교사: 선생님 링크(LINK)·PIN 세션 토큰 → `teacher_sessions`. 그 방이 아니면 `E_FORBIDDEN`.
 * - 학생: 기기 토큰 → `devices`(끊긴 기기 거부) → 참가자 → 그 방이어야 한다.
 * 자격 문제는 `E_AUTH`, 만료(또는 지우는 중)는 `E_ROOM_EXPIRED`.
 */
export interface BearerDeps {
  readonly repos: Repos;
  readonly gate: RoomGate;
}

export function teacherFor(
  deps: BearerDeps,
  headers: Headers,
  roomId: string,
  now: number,
): { readonly session: StoredTeacherSession; readonly room: StoredRoom } {
  const session = deps.repos.teacherSessions.findByTokenHash(requireBearerTokenHash(headers));
  if (!session || session.revokedAt !== null) throw new AppError('E_AUTH', 'unknown or revoked session');
  if (session.roomId !== roomId) throw new AppError('E_FORBIDDEN');
  const room = openRoom(deps, roomId, now);
  deps.repos.teacherSessions.touch(session.id, now);
  return { session, room };
}

export function studentFor(
  deps: BearerDeps,
  headers: Headers,
  roomId: string,
  now: number,
): { readonly device: StoredDevice; readonly participant: StoredParticipant; readonly room: StoredRoom } {
  const device = deps.repos.devices.findByTokenHash(requireBearerTokenHash(headers));
  if (!device || device.revokedAt !== null) throw new AppError('E_AUTH', 'unknown or revoked device');
  const participant = deps.repos.participants.findById(device.participantId);
  if (!participant || participant.roomId === null) throw new AppError('E_AUTH', 'no room participant');
  if (participant.roomId !== roomId) throw new AppError('E_FORBIDDEN');
  const room = openRoom(deps, roomId, now);
  deps.repos.devices.touch(device.id, now);
  return { device, participant, room };
}

function openRoom(deps: BearerDeps, roomId: string, now: number): StoredRoom {
  deps.gate.assertOpen(roomId);
  const room = deps.repos.rooms.findById(roomId);
  if (!room) throw new AppError('E_AUTH', 'room is gone');
  if (roomStatusAt(room, now) === 'EXPIRED') throw new AppError('E_ROOM_EXPIRED');
  return room;
}
