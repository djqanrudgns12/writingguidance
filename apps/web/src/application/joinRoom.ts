import type { ApiOutput } from '@geulbang/core/api';
import type { Hello } from '@geulbang/core/protocol';
import type { StudentRoomMemory } from '../ports/deviceMemory.ts';
import type { CommandQueue, RoomChannel } from '../ports/realtime.ts';
import type { AppDeps } from './deps.ts';

/**
 * 학생 첫 입장(PLAN §2.3 ②, PRD F-02~F-04): 코드 조회 → (화면: 카드·동의·별명) → 기기 토큰 만들고 해시로 입장 → 기억.
 * 같은 기기에 살아 있는 기억이 있으면 입장하지 않고 그 기억을 돌려준다(③ 같은 기기 다시 들어오기).
 */
export type RoomInfo = ApiOutput<'roomByCodeResult'>;

export async function lookupRoom(deps: Pick<AppDeps, 'api' | 'memory'>, code: string): Promise<RoomInfo> {
  return deps.api.roomByCode(code.trim(), await deps.memory.deviceId());
}

export interface JoinAttempt {
  readonly commandId: string;
  readonly deviceToken: string;
}

export function newJoinAttempt(deps: Pick<AppDeps, 'newId' | 'newToken'>): JoinAttempt {
  return { commandId: deps.newId(), deviceToken: deps.newToken() };
}

export async function rememberedEntry(deps: AppDeps, roomId: string): Promise<StudentRoomMemory | null> {
  return deps.memory.student(roomId, deps.now());
}

export async function joinRoom(
  deps: AppDeps,
  room: RoomInfo,
  entryCode: string,
  nickname: string,
  attempt: JoinAttempt,
): Promise<StudentRoomMemory> {
  const deviceId = await deps.memory.deviceId();
  const result = await deps.api.join(room.roomId, {
    nickname,
    consentVersion: room.policyVersion,
    deviceId,
    deviceTokenHash: await deps.sha256Hex(attempt.deviceToken),
    commandId: attempt.commandId,
  });
  const entry: StudentRoomMemory = {
    roomId: room.roomId,
    entryCode,
    className: room.className,
    title: room.title,
    nickname: result.nickname,
    participantId: result.participantId,
    deviceToken: attempt.deviceToken,
    lastDocId: null,
    lastUsedAt: deps.now(),
    expiresAt: room.expiresAt,
  };
  await deps.memory.rememberStudent(entry, deps.config.RECENT_ROOMS_MAX);
  // 기기 저장소를 오래 지키게 부탁한다(PLAN §2.3 ②-4). 거절돼도 계속 쓴다.
  try {
    await globalThis.navigator?.storage?.persist?.();
  } catch {
    // 무시
  }
  return entry;
}

/**
 * 이 연결에서 다시 동의한 판. hello는 연결할 때 한 번 오므로 `consent.update` 뒤에도 옛 판을 들고 있다.
 * 같은 연결을 쓰는 화면(S1 다시 들어오기 → S4·S5)이 다시 묻지 않게 연결별로 기억한다.
 * 새로 연결하면 서버의 새 hello가 바뀐 판을 알려 주므로 기기 저장소에 남기지 않는다.
 */
const agreedOn = new WeakMap<object, string>();

/**
 * 처리방침 판이 바뀐 뒤 다시 들어올 때 새 판에 동의한다(PRD F-20 재동의).
 * `commandId`는 부르는 쪽이 다시 하기 사이에 같은 값을 넘겨 서버가 한 번만 처리하게 한다.
 */
export async function updateConsent(
  channel: Pick<RoomChannel, 'send'> & { readonly queue?: Pick<CommandQueue, 'flush'> },
  consentVersion: string,
  commandId: string,
): Promise<void> {
  await channel.send('consent.update', { consentVersion }, { commandId });
  agreedOn.set(channel, consentVersion);
  // 동의 전에 서버가 거절해 대기열이 붙잡아 둔 제출을 이제 보낸다(P6-consent-block). 실패는 대기열이 다시 한다.
  void channel.queue?.flush().catch(() => {});
}

/**
 * 서버가 새 글·제출을 동의 판 때문에 거절했는가(P6-consent-block). 수업방 채널의 거절에는 `fields`가 없어
 * `E_INPUT` + hello의 동의 판이 지난 것으로 본다. 맞으면 이 연결의 "다시 동의함" 기억을 지워
 * `consentNeeded`가 다시 동의 화면을 보이게 한다(서버가 아직 옛 판으로 알고 있으므로).
 */
export function consentRefused(channel: object, hello: Hello | null, code: string): boolean {
  if (code !== 'E_INPUT' || !hello?.me) return false;
  const policy = policyVersionOf(hello);
  if (!policy || hello.me.consentVersion === policy) return false;
  agreedOn.delete(channel);
  return true;
}

/** hello가 알려 준 지금 처리방침 판. 없으면 null(옛 서버: 묻지 않는다). */
export function policyVersionOf(hello: Hello): string | null {
  const v = hello.config['POLICY_VERSION'];
  return typeof v === 'string' ? v : null;
}

/**
 * 다시 동의해야 하는 판(PRD F-03: 정책 판이 바뀌면 다시 받는다). 필요 없으면 null.
 * 모든 학생 경로(S1 다시 들어오기, S4·S5 직접 열기·새로고침)가 이 판단 하나를 쓴다.
 */
export function consentNeeded(channel: object, hello: Hello): string | null {
  const policy = policyVersionOf(hello);
  if (!policy || !hello.me) return null;
  if (hello.me.consentVersion === policy || agreedOn.get(channel) === policy) return null;
  return policy;
}
