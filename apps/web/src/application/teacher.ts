import { snapshotItemSchema, type RoomSettings, type TimerState } from '@geulbang/core/protocol';
import { outerChangedRange } from '@geulbang/core/text';
import type * as Y from 'yjs';
import { z } from 'zod';
import type { TeacherRoomMemory } from '../ports/deviceMemory.ts';
import type { RealtimeSession, RoomChannel } from '../ports/realtime.ts';
import type { AppDeps } from './deps.ts';
import { purgeWhenRoomGone } from './purgeLocal.ts';

/**
 * 교사 유스케이스(PLAN §2.3 ①⑧⑨, PRD F-15~F-22). 수업방 안의 바뀜은 모두 수업방 채널 명령이다(§4.4).
 * 토큰은 기기가 만들고(선생님 링크·PIN 세션) 서버에는 해시만 간다(§7.4).
 */

/** 선생님 링크 `/t/{토큰}`로 들어옴(PRD F-20): 기억에 있으면 그것, 없으면 서버에 토큰으로 방을 물어 기억한다. */
export async function enterWithLink(deps: AppDeps, token: string): Promise<TeacherRoomMemory> {
  const known = (await deps.memory.teachers(deps.now())).find(t => t.teacherToken === token);
  if (known) return known;
  const { roomId } = await deps.api.teacherSession(token);
  const info = await deps.api.teacherRoom(roomId, token);
  const entry: TeacherRoomMemory = {
    roomId,
    displayName: info.room.title,
    teacherToken: token,
    tokenKind: 'LINK',
    lastUsedAt: deps.now(),
    expiresAt: info.expiresAt,
  };
  await deps.memory.rememberTeacher(entry);
  return entry;
}

/** PIN으로 들어오기(PRD F-20): 기기가 세션 토큰을 만들고 해시를 보낸다. */
export async function enterWithPin(deps: AppDeps, pin: string, commandId: string, sessionToken: string) {
  const deviceId = await deps.memory.deviceId();
  const { roomId } = await deps.api.teacherPin({
    pin,
    deviceId,
    sessionTokenHash: await deps.sha256Hex(sessionToken),
    commandId,
  });
  const info = await deps.api.teacherRoom(roomId, sessionToken);
  const entry: TeacherRoomMemory = {
    roomId,
    displayName: info.room.title,
    teacherToken: sessionToken,
    tokenKind: 'PIN',
    lastUsedAt: deps.now(),
    expiresAt: info.expiresAt,
  };
  await deps.memory.rememberTeacher(entry);
  return { entry, info };
}

export interface TeacherSession {
  readonly session: RealtimeSession;
  readonly channel: RoomChannel;
  close(): void;
}

export function connectTeacher(deps: AppDeps, entry: TeacherRoomMemory, deviceId: string): TeacherSession {
  const session = deps.realtime.connect(() => ({
    v: 1,
    kind: 'teacher',
    token: entry.teacherToken,
    deviceId,
  }));
  const channel = session.joinRoom(entry.roomId);
  // 다른 교사 기기에서 지운 방도 이 기기 사본·기억을 지운다(검토 B04).
  const offGone = purgeWhenRoomGone(deps, channel);
  return {
    session,
    channel,
    close() {
      offGone();
      channel.close();
      session.close();
    },
  };
}

const send = <T>(
  t: TeacherSession,
  name: Parameters<RoomChannel['send']>[0],
  args: unknown,
  commandId: string,
) => t.channel.send<T>(name, args, { commandId });

export const sendNotice = (t: TeacherSession, text: string, commandId: string) =>
  send<{ noticeId: string }>(t, 'notice.send', { text }, commandId);

export const startTimer = (
  t: TeacherSession,
  args: { durationSec: number; alerts: number[]; endText: string },
  commandId: string,
) => send<{ timer: TimerState }>(t, 'timer.start', args, commandId);
export const pauseTimer = (t: TeacherSession, commandId: string) => send(t, 'timer.pause', {}, commandId);
export const resumeTimer = (t: TeacherSession, commandId: string) => send(t, 'timer.resume', {}, commandId);
export const cancelTimer = (t: TeacherSession, commandId: string) => send(t, 'timer.cancel', {}, commandId);

export const decideResume = (t: TeacherSession, requestId: string, approve: boolean, commandId: string) =>
  send<{ decided: number }>(t, 'resume.decide', { requestId, approve }, commandId);
export const approveAllResumes = (t: TeacherSession, commandId: string) =>
  send<{ decided: number }>(t, 'resume.decide', { all: true, approve: true }, commandId);

export const updateRoomSettings = (t: TeacherSession, patch: Partial<RoomSettings>, commandId: string) =>
  send<{ settings: RoomSettings }>(t, 'room.update', patch, commandId);
export const closeRoom = (t: TeacherSession, commandId: string) => send(t, 'room.close', {}, commandId);
export const reopenRoom = (t: TeacherSession, commandId: string) => send(t, 'room.reopen', {}, commandId);
export const deleteRoomNow = (t: TeacherSession, commandId: string) => send(t, 'room.delete', {}, commandId);
export const reopenDoc = (t: TeacherSession, docId: string, commandId: string) =>
  send<{ status: string; generation: number }>(t, 'doc.reopen', { docId }, commandId);
export const listDevices = (t: TeacherSession, participantId: string, commandId: string) =>
  send<unknown[]>(t, 'device.list', { participantId }, commandId);
export const revokeDevice = (t: TeacherSession, deviceRowId: string, commandId: string) =>
  send<{ revoked: number }>(t, 'device.revoke', { deviceRowId }, commandId);

/**
 * 연결 점검(PRD F-16): ① 서버 응답 ② 실시간 왕복 5번 ③ AI ④ 기기 저장소. 단계마다 결과를 알린다.
 * 세 항목을 함께 돌리고, 전체에 기한 하나(`COMMAND_ACK_TIMEOUT_MS`, PRD 16.4 "10초 안에 결과")를 둔다.
 * 기한이 되거나 부르는 쪽이 취소하면 남은 요청을 끊고 끝나지 않은 단계는 실패로 확정한다(검토 B11).
 */
export type CheckStep = 'server' | 'realtime' | 'ai' | 'storage';
export interface CheckResult {
  readonly step: CheckStep;
  readonly ok: boolean;
  readonly latencyMs?: number;
}

const CHECK_STEPS: readonly CheckStep[] = ['server', 'realtime', 'ai', 'storage'];
const REALTIME_ROUNDS = 5;

export async function connectionCheck(
  deps: AppDeps,
  t: TeacherSession,
  entry: TeacherRoomMemory,
  onStep: (r: CheckResult) => void,
  commandIds: () => string,
  signal?: AbortSignal,
): Promise<readonly CheckResult[]> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, deps.config.COMMAND_ACK_TIMEOUT_MS);
  if (signal?.aborted) stop();
  else signal?.addEventListener('abort', stop);
  // 기한·취소가 오면 기다리던 단계가 모두 거절로 끝나게 한다(명령 응답처럼 끊을 수 없는 것도).
  const ended = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new Error('check deadline'));
    if (controller.signal.aborted) fail();
    else controller.signal.addEventListener('abort', fail);
  });
  ended.catch(() => {});
  const within = <T>(work: Promise<T>): Promise<T> => Promise.race([work, ended]);

  const results = new Map<CheckStep, CheckResult>();
  const push = (r: CheckResult) => {
    // 기한 뒤에 늦게 온 결과는 버린다(이미 실패로 확정했다).
    if (results.has(r.step)) return;
    results.set(r.step, r);
    onStep(r);
  };

  const server = async () => {
    const started = Date.now();
    try {
      await within(deps.api.teacherRoom(entry.roomId, entry.teacherToken, controller.signal));
      push({ step: 'server', ok: true, latencyMs: Date.now() - started });
    } catch {
      push({ step: 'server', ok: false });
    }
  };
  const realtime = async () => {
    const rtts: number[] = [];
    for (let i = 0; i < REALTIME_ROUNDS && !controller.signal.aborted; i++) {
      const sentAt = Date.now();
      try {
        await within(send(t, 'ping', { sentAt }, commandIds()));
        rtts.push(Date.now() - sentAt);
      } catch {
        break;
      }
    }
    push({
      step: 'realtime',
      ok: rtts.length === REALTIME_ROUNDS,
      ...(rtts.length ? { latencyMs: Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) } : {}),
    });
  };
  const ai = async () => {
    try {
      const r = await within(deps.api.checkAi(entry.roomId, entry.teacherToken, controller.signal));
      push({ step: 'ai', ok: r.ok, latencyMs: r.latencyMs });
    } catch {
      push({ step: 'ai', ok: false });
    }
  };

  try {
    push({ step: 'storage', ok: !deps.localStore.volatile });
    await Promise.all([server(), realtime(), ai()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    // 끝난 뒤 남은 요청(늦은 응답 대기)을 끊는다.
    stop();
  }
  return CHECK_STEPS.flatMap(step => {
    const r = results.get(step);
    return r ? [r] : [];
  });
}

// ── 교사 서랍(PRD F-10·F-14·F-18, P4-13 결합) ─────────────────────
// 명령 결과는 바깥 값이라 zod로 모양을 본다(AGENTS.md §3). 서버가 필드를 더해도 읽을 수 있게 엄격하게 막지 않는다.

const snapshotListSchema = z.array(snapshotItemSchema);
const snapshotTextSchema = z.object({ title: z.string(), body: z.string() });

/** 그때의 글(`snapshot.get`·`snapshot.restore` 결과) */
export type SnapshotText = z.output<typeof snapshotTextSchema>;
export type SnapshotListItem = z.output<typeof snapshotItemSchema>;

/** 시간 되감기 목록. 슬라이더가 왼쪽 = 오래된 것이 되게 시각 순으로 돌려준다. */
export async function listSnapshots(
  t: TeacherSession,
  docId: string,
  commandId: string,
): Promise<SnapshotListItem[]> {
  const items = snapshotListSchema.parse(await send<unknown>(t, 'snapshot.list', { docId }, commandId));
  return [...items].sort((a, b) => a.at - b.at);
}

export async function getSnapshot(
  t: TeacherSession,
  docId: string,
  snapshotId: string,
  commandId: string,
): Promise<SnapshotText> {
  return snapshotTextSchema.parse(await send<unknown>(t, 'snapshot.get', { docId, snapshotId }, commandId));
}

/** 서버가 지금 글을 RESTORE로 남기고 대상 글을 돌려준다. 글에 넣는 것은 기기가 한다(`replaceYText`, 되돌리기 가능). */
export async function restoreSnapshot(
  t: TeacherSession,
  docId: string,
  snapshotId: string,
  commandId: string,
): Promise<SnapshotText> {
  return snapshotTextSchema.parse(
    await send<unknown>(t, 'snapshot.restore', { docId, snapshotId }, commandId),
  );
}

/**
 * `Y.Text`를 새 글로 바꾸되 앞뒤 같은 부분은 두고 가운데만 바꾼다(커서·원격 변경과 덜 부딪히게).
 * 편집기 `applyAppEdit` 안에서 부른다(출처 LOCAL이라 교사 `↶`로 되돌릴 수 있다).
 */
export function replaceYText(text: Y.Text, next: string): void {
  const prev = text.toString();
  const range = outerChangedRange(prev, next);
  if (!range) return;
  if (range.endOld > range.start) text.delete(range.start, range.endOld - range.start);
  const insert = next.slice(range.start, range.endNew);
  if (insert) text.insert(range.start, insert);
}

const deviceItemSchema = z.object({
  deviceRowId: z.string().min(1),
  approvedAt: z.number(),
  lastSeenAt: z.number().nullable(),
  connected: z.boolean().optional(),
});
export type TeacherDeviceItem = z.output<typeof deviceItemSchema>;

/** `device.list` 결과를 모양 검사해서 돌려준다(`listDevices`는 검사 전 값). */
export async function listDeviceItems(
  t: TeacherSession,
  participantId: string,
  commandId: string,
): Promise<TeacherDeviceItem[]> {
  return z.array(deviceItemSchema).parse(await listDevices(t, participantId, commandId));
}
