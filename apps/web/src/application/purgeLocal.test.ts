import { defaultConfig } from '@geulbang/core/config';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDeviceMemory } from '../adapters/local/deviceMemory.ts';
import { createMemoryStore } from '../adapters/local/localDocStore.ts';
import type { StudentRoomMemory, TeacherRoomMemory } from '../ports/deviceMemory.ts';
import { value } from '../ports/observable.ts';
import type { RealtimePort, RoomChannel } from '../ports/realtime.ts';
import type { AppDeps } from './deps.ts';
import { purgeLocal, purgeWhenRoomGone, startLocalPurge } from './purgeLocal.ts';
import { pendingResume } from './resumeOnDevice.ts';
import { connectTeacher } from './teacher.ts';

const ROOM_OLD = '00000000-0000-4000-8000-000000000001';
const ROOM_NEW = '00000000-0000-4000-8000-000000000002';
const DOC_OLD = '20000000-0000-4000-8000-000000000001';
const DOC_LEGACY = '20000000-0000-4000-8000-000000000002';
const DOC_NEW = '20000000-0000-4000-8000-000000000003';

const entry = (roomId: string, patch: Partial<StudentRoomMemory>): StudentRoomMemory => ({
  roomId,
  entryCode: '482913',
  className: '5반',
  title: '가을 글쓰기',
  nickname: '하늘고래',
  participantId: '10000000-0000-4000-8000-000000000001',
  deviceToken: 'token',
  lastDocId: null,
  lastUsedAt: 1,
  expiresAt: 10_000,
  ...patch,
});

const someUpdate = () => {
  const doc = new Y.Doc();
  doc.getText('body').insert(0, '가상의 글');
  return Y.encodeStateAsUpdate(doc);
};

async function setup() {
  const localStore = createMemoryStore();
  const memory = createDeviceMemory({ kv: localStore.kv, storage: null });
  await memory.rememberStudent(entry(ROOM_OLD, { expiresAt: 1000, lastDocId: DOC_LEGACY }), 5);
  await memory.rememberStudent(entry(ROOM_NEW, { expiresAt: 9000, lastDocId: DOC_NEW }), 5);
  for (const id of [DOC_OLD, DOC_LEGACY, DOC_NEW]) await localStore.appendUpdate(id, someUpdate());
  await localStore.setDocMeta(DOC_OLD, { roomId: ROOM_OLD, expiresAt: 1000 });
  await localStore.setDocMeta(DOC_NEW, { roomId: ROOM_NEW, expiresAt: 9000 });
  return { localStore, memory };
}

describe('기기 사본 정리(검토 6번)', () => {
  it('만료된 방의 기억과 그 방 사본(방 ID가 없는 옛 사본 포함)을 지우고, 살아 있는 방은 둔다', async () => {
    const deps = await setup();
    await purgeLocal(deps, 2000);
    expect(await deps.localStore.loadDoc(DOC_OLD)).toBeNull();
    expect(await deps.localStore.loadDoc(DOC_LEGACY)).toBeNull();
    expect(await deps.localStore.loadDoc(DOC_NEW)).not.toBeNull();
    expect((await deps.memory.students(0)).map(e => e.roomId)).toEqual([ROOM_NEW]);
  });

  it('시작할 때 한 번, 화면이 다시 보일 때마다 정리한다', async () => {
    const deps = await setup();
    let now = 500;
    const target = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const stop = startLocalPurge(deps, () => now, target);
    await new Promise(r => setTimeout(r, 0));
    expect(await deps.localStore.loadDoc(DOC_OLD)).not.toBeNull();
    now = 2000;
    target.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 0));
    expect(await deps.localStore.loadDoc(DOC_OLD)).toBeNull();
    stop();
  });

  it('수업방이 지워졌다는 알림을 받으면 그 방 사본을 지운다', async () => {
    const deps = await setup();
    const listeners: Array<(d: { status: string }) => void> = [];
    const channel = {
      roomId: ROOM_NEW,
      on: ((_name: string, listener: (d: { status: string }) => void) => {
        listeners.push(listener);
        return () => {};
      }) as unknown as RoomChannel['on'],
      state: value('ready'),
    };
    purgeWhenRoomGone(deps, channel);
    for (const l of listeners) l({ status: 'CLOSED' });
    await new Promise(r => setTimeout(r, 0));
    expect(await deps.localStore.loadDoc(DOC_NEW)).not.toBeNull();
    for (const l of listeners) l({ status: 'DELETED' });
    await new Promise(r => setTimeout(r, 0));
    expect(await deps.localStore.loadDoc(DOC_NEW)).toBeNull();
  });

  it('수업방이 지워졌다는 알림이면 사본과 함께 그 방 학생 기억도 지운다(검토 B04)', async () => {
    const deps = await setup();
    const listeners: Array<(d: { status: string }) => void> = [];
    const channel = {
      roomId: ROOM_NEW,
      on: ((_name: string, listener: (d: { status: string }) => void) => {
        listeners.push(listener);
        return () => {};
      }) as unknown as RoomChannel['on'],
    };
    purgeWhenRoomGone(deps, channel);
    for (const l of listeners) l({ status: 'DELETED' });
    await new Promise(r => setTimeout(r, 0));
    expect(await deps.memory.students(0)).toEqual([expect.objectContaining({ roomId: ROOM_OLD })]);
  });
});

describe('이어 쓰기 대기와 교사 기기 정리(검토 B04)', () => {
  it('만료 시각이 지난 이어 쓰기 대기(`resume.pending`)는 시작 정리에서 지운다', async () => {
    const deps = await setup();
    const pending = {
      roomId: ROOM_OLD,
      requestId: '30000000-0000-4000-8000-000000000001',
      commandId: '30000000-0000-4000-8000-000000000002',
      deviceToken: 'resume-token',
      nickname: '하늘고래',
      entryCode: '482913',
      expiresAt: 1000,
    };
    await deps.localStore.kv.set('resume.pending', pending);
    await purgeLocal(deps, 500);
    expect(await deps.localStore.kv.get('resume.pending')).toEqual(pending);
    await purgeLocal(deps, 2000);
    expect(await deps.localStore.kv.get('resume.pending')).toBeUndefined();
  });

  it('만료 정보가 없는 옛 대기는 읽지 않고 시작 정리에서 지운다', async () => {
    const deps = await setup();
    await deps.localStore.kv.set('resume.pending', {
      roomId: ROOM_OLD,
      requestId: '30000000-0000-4000-8000-000000000001',
      deviceToken: 'resume-token',
      nickname: '하늘고래',
      entryCode: '482913',
    });
    expect(await pendingResume({ localStore: deps.localStore })).toBeNull();
    await purgeLocal(deps, 500);
    expect(await deps.localStore.kv.get('resume.pending')).toBeUndefined();
  });

  it('다른 교사 기기도 수업방 삭제 알림을 받으면 기억과 그 방 사본을 지운다', async () => {
    const deps = await setup();
    const teacher: TeacherRoomMemory = {
      roomId: ROOM_NEW,
      displayName: '가을 글쓰기',
      teacherToken: 'teacher-token',
      tokenKind: 'LINK',
      lastUsedAt: 1,
      expiresAt: 9000,
    };
    await deps.memory.rememberTeacher(teacher);
    const listeners = new Map<string, (d: unknown) => void>();
    const realtime: RealtimePort = {
      connect: () => ({
        state: value('online' as const),
        serverNow: () => 0,
        openDoc: () => Promise.reject(new Error('unused')),
        joinRoom: roomId => ({
          roomId,
          state: value('ready' as const),
          hello: value(null),
          failure: value(null),
          on: ((name: string, l: (d: unknown) => void) => {
            listeners.set(name, l);
            return () => listeners.delete(name);
          }) as unknown as RoomChannel['on'],
          send: () => Promise.reject(new Error('unused')),
          queue: { enqueue: async () => '', pending: async () => [], onResult: () => () => {} },
          close: () => {},
        }),
        close: () => {},
      }),
    };
    const appDeps = { ...deps, realtime, config: defaultConfig } as unknown as AppDeps;
    const t = connectTeacher(appDeps, teacher, 'device-1');
    listeners.get('room.status')?.({ status: 'DELETED' });
    await new Promise(r => setTimeout(r, 0));
    expect(await deps.localStore.loadDoc(DOC_NEW)).toBeNull();
    expect(await deps.memory.teachers(0)).toEqual([]);
    t.close();
  });
});
