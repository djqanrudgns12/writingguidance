import { z } from 'zod';
import type { RoomInfo } from './joinRoom.ts';
import type { StudentRoomMemory } from '../ports/deviceMemory.ts';
import type { KvStorePort } from '../ports/localStore.ts';
import type { AppDeps } from './deps.ts';

/**
 * 다른 기기로 이어 쓰기(PLAN §2.3 ④, PRD F-14). 새 기기가 토큰을 만들고 해시로 요청 → 긴 조회로 교사 결정을 기다린다.
 * 서버는 토큰을 건네지 않으므로 응답이 사라져도 다음 조회나 실시간 연결로 바로 이어진다.
 * 대기 중인 요청은 기기 기억(`kv`)에 두어, 새로고침해도 같은 요청을 계속 기다린다(S6).
 * - 요청을 보내기 **전에** 토큰·명령 ID·대상을 적는다. 응답을 잃고 새로고침해도 같은 명령을 다시 보내
 *   서버가 만든 요청과 기기 토큰이 어긋나지 않는다(검토 B05).
 * - 허용된 토큰은 학생 기억에 넣은 **뒤에** 대기를 지운다. 그 사이 실패해도 대기로 다시 이어 간다(검토 B06).
 * - 대기에도 수업방 만료 시각을 두어 만료 정리(`purgeLocal`)가 함께 지운다(검토 B04).
 */
const pendingSchema = z.object({
  roomId: z.string().min(1),
  /** 서버가 요청을 받았다고 답한 ID. 보내기 전·응답을 잃었으면 null(같은 명령 ID로 다시 보낸다). */
  requestId: z.string().min(1).nullable(),
  commandId: z.string().min(1),
  deviceToken: z.string().min(1),
  nickname: z.string().min(1),
  entryCode: z.string().min(1),
  expiresAt: z.number(),
});

export type PendingResume = z.output<typeof pendingSchema>;
export type SentResume = PendingResume & { readonly requestId: string };

const KEY = 'resume.pending';

/** 기기에 둔 이어 쓰기 대기. 없거나 모양이 다르면(만료 정보가 없는 옛 모양 포함) null. */
export async function pendingResume(deps: Pick<AppDeps, 'localStore'>): Promise<PendingResume | null> {
  const parsed = pendingSchema.safeParse(await deps.localStore.kv.get(KEY));
  return parsed.success ? parsed.data : null;
}

/** 만료됐거나 읽을 수 없는 대기를 지운다(앱 시작·화면 복귀 정리). */
export async function purgeExpiredResume(kv: KvStorePort, now: number): Promise<void> {
  const raw = await kv.get(KEY);
  if (raw === undefined) return;
  const parsed = pendingSchema.safeParse(raw);
  if (!parsed.success || parsed.data.expiresAt <= now) await kv.delete(KEY);
}

/** 그 수업방이 끝났을 때(삭제·만료 확인) 그 방의 대기를 지운다. */
export async function dropResumeFor(kv: KvStorePort, match: (p: PendingResume) => boolean): Promise<void> {
  const parsed = pendingSchema.safeParse(await kv.get(KEY));
  if (parsed.success && match(parsed.data)) await kv.delete(KEY);
}

/** 아직 응답을 받지 못한 대기를 같은 명령 ID·토큰으로 보낸다(이미 받았으면 그대로). */
export async function sendResume(
  deps: Pick<AppDeps, 'api' | 'memory' | 'localStore' | 'sha256Hex'>,
  pending: PendingResume,
): Promise<SentResume> {
  if (pending.requestId !== null) return { ...pending, requestId: pending.requestId };
  const { requestId } = await deps.api.resumeRequest(pending.roomId, {
    nickname: pending.nickname,
    deviceId: await deps.memory.deviceId(),
    deviceTokenHash: await deps.sha256Hex(pending.deviceToken),
    commandId: pending.commandId,
  });
  const sent: SentResume = { ...pending, requestId };
  await deps.localStore.kv.set(KEY, sent);
  return sent;
}

export async function requestResume(
  deps: AppDeps,
  room: RoomInfo,
  entryCode: string,
  nickname: string,
  commandId: string,
  deviceToken: string,
): Promise<SentResume> {
  const existing = await pendingResume(deps);
  if (existing && existing.roomId === room.roomId && existing.nickname === nickname) {
    // 같은 요청: 이미 받았으면 그대로, 보내던 중이면 그때 적은 명령 ID·토큰으로 다시 보낸다.
    return sendResume(deps, existing);
  }
  const draft: PendingResume = {
    roomId: room.roomId,
    requestId: null,
    commandId,
    deviceToken,
    nickname,
    entryCode,
    expiresAt: room.expiresAt,
  };
  await deps.localStore.kv.set(KEY, draft);
  return sendResume(deps, draft);
}

/** 대기를 영영 이어 갈 수 없는 거절: 수업방이 없거나 끝남, 이 토큰으로는 모르는 요청. */
const ENDED_CODES: ReadonlySet<unknown> = new Set(['E_ROOM_NOT_FOUND', 'E_ROOM_EXPIRED', 'E_AUTH']);

/**
 * 결정이 날 때까지 기다린다. 허용이면 기기 기억에 넣고 돌려준다(→ 바로 쓰기). 거절·취소면 null.
 * `signal`로 그만 기다리기(화면을 떠남). 허용 뒤 떠났으면 기억에 넣지 않고 대기를 남긴다(다음에 다시 이어 간다).
 */
export async function waitForDecision(
  deps: AppDeps,
  room: RoomInfo,
  pending: PendingResume,
  participantId: () => Promise<string>,
  signal: AbortSignal,
): Promise<StudentRoomMemory | null> {
  let sent: SentResume | null = null;
  while (!signal.aborted) {
    let status: string;
    try {
      sent ??= await sendResume(deps, pending);
      ({ status } = await deps.api.resumeStatus(
        sent.roomId,
        sent.requestId,
        sent.deviceToken,
        deps.config.RESUME_LONGPOLL_SEC,
        signal,
      ));
    } catch (error) {
      if (signal.aborted) return null;
      const e = error as { code?: unknown; retryable?: boolean };
      if (ENDED_CODES.has(e.code)) await deps.localStore.kv.delete(KEY).catch(() => {});
      if (e.retryable === false) throw error;
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    if (status === 'PENDING') continue;
    if (status !== 'APPROVED') {
      await deps.localStore.kv.delete(KEY);
      return null;
    }
    const id = await participantId();
    if (signal.aborted) return null;
    const entry: StudentRoomMemory = {
      roomId: room.roomId,
      entryCode: sent.entryCode,
      className: room.className,
      title: room.title,
      nickname: sent.nickname,
      participantId: id,
      deviceToken: sent.deviceToken,
      lastDocId: null,
      lastUsedAt: deps.now(),
      expiresAt: room.expiresAt,
    };
    await deps.memory.rememberStudent(entry, deps.config.RECENT_ROOMS_MAX);
    // 기억에 들어간 뒤에야 대기를 지운다(그 전에 실패하면 같은 대기로 다시 조회한다).
    await deps.localStore.kv.delete(KEY);
    return entry;
  }
  return null;
}

export async function cancelResume(deps: AppDeps, pending: PendingResume): Promise<void> {
  try {
    // 응답을 잃은 요청도 같은 명령 ID로 다시 보내 ID를 알아낸 뒤 취소한다.
    const sent = await sendResume(deps, pending);
    await deps.api.resumeCancel(sent.roomId, sent.requestId, sent.deviceToken);
  } finally {
    await deps.localStore.kv.delete(KEY);
  }
}
