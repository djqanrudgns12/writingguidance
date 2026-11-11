import type { ApiOutput } from '@geulbang/core/api';
import { AppError } from '@geulbang/core/errors';
import type { ServerConfig } from '../config.ts';
import { checkCodeLookupRateLimit } from '../security/rateLimit.ts';
import type { Repos } from '../store/repos/index.ts';
import { roomStatusAt } from '../store/repos/rooms.ts';

/**
 * 입장 코드로 수업방 찾기(PLAN §2.3 ②-1, PRD F-02). 학생에게는 최소 정보만 준다:
 * 학급명·수업명, 학교명은 교사가 '보이기'를 켰을 때만. 교사 이름·다른 학생 정보는 없다.
 * 코드를 하나씩 넣어 보는 일을 막으려고 찾기 전에 조회 칸(기기·IP)을 센다.
 */
export type RoomByCodeResult = ApiOutput<'roomByCodeResult'>;

export interface LookupRoomDeps {
  readonly config: ServerConfig;
  readonly repos: Repos;
  readonly now: () => number;
}

export function lookupRoom(
  deps: LookupRoomDeps,
  input: { readonly entryCode: string; readonly deviceId: string | undefined; readonly ip: string },
): RoomByCodeResult {
  const { config, repos } = deps;
  const now = deps.now();
  checkCodeLookupRateLimit({
    db: repos.db,
    product: config.product,
    secrets: config.secrets,
    deviceId: input.deviceId,
    ip: input.ip,
    now,
  });
  const room = repos.rooms.findByEntryCode(input.entryCode);
  if (!room) throw new AppError('E_ROOM_NOT_FOUND');
  const status = roomStatusAt(room, now);
  if (status === 'EXPIRED') throw new AppError('E_ROOM_EXPIRED');
  return {
    roomId: room.id,
    className: room.className,
    title: room.title,
    schoolName: room.showSchool ? room.schoolName : null,
    status,
    expiresAt: room.expiresAt,
    policyVersion: config.product.POLICY_VERSION,
    genres: room.settings.genres,
  };
}
