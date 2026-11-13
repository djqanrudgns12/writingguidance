import { AI_BUTTONS, GENRE_IDS, MS_PER_DAY } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import type { CommandName, Hello, RoomEventData, RoomEventName } from '@geulbang/core/protocol';
import * as Y from 'yjs';
import type { AppDeps } from '../../application/deps.ts';
import type { ApiPort } from '../../ports/api.ts';
import type { DeviceMemory, TeacherRoomMemory } from '../../ports/deviceMemory.ts';
import type { DownloadFile } from '../../ports/download.ts';
import type { KvStorePort, LocalStorePort } from '../../ports/localStore.ts';
import { value, type Value } from '../../ports/observable.ts';
import type {
  ConnectionState,
  RealtimeSession,
  RoomChannel,
  RoomChannelState,
  SaveState,
  SyncedDoc,
} from '../../ports/realtime.ts';

/**
 * 교사 결합 시험용 가짜(`app/teacher/*.test.tsx`만 가져온다). 운영 코드는 이 파일을 쓰지 않는다.
 * 실시간은 채널·세션을 손으로 움직이고(`emit`), 명령은 `handlers`로 답을 정한다.
 */

export const NOW = Date.UTC(2026, 10, 11, 1, 40, 0);
export const ROOM_ID = '11111111-1111-4111-8111-111111111111';

export function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export interface SentCommand {
  readonly name: CommandName;
  readonly args: unknown;
  readonly commandId: string | undefined;
}

export interface FakeChannel extends RoomChannel {
  readonly stateValue: Value<RoomChannelState>;
  readonly helloValue: Value<Hello | null>;
  readonly sent: SentCommand[];
  /** 명령 이름별 답. 던지면 그 명령이 실패한다. 없으면 null로 답한다. */
  readonly handlers: Partial<Record<CommandName, (args: unknown) => unknown>>;
  emit<N extends RoomEventName>(name: N, data: RoomEventData<N>, serverNow?: number): void;
  closed: boolean;
}

export function createFakeChannel(roomId: string): FakeChannel {
  const listeners = new Map<string, Set<(data: unknown, serverNow: number) => void>>();
  const stateValue = value<RoomChannelState>('connecting');
  const helloValue = value<Hello | null>(null);
  const failure = value(null);
  const channel: FakeChannel = {
    roomId,
    state: stateValue,
    hello: helloValue,
    failure,
    stateValue,
    helloValue,
    sent: [],
    handlers: {},
    closed: false,
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      const l = listener as (data: unknown, serverNow: number) => void;
      set.add(l);
      listeners.set(name, set);
      return () => set.delete(l);
    },
    emit(name, data, serverNow = NOW) {
      if (name === 'hello') {
        stateValue.set('ready');
        helloValue.set(data as Hello);
        return;
      }
      for (const l of [...(listeners.get(name) ?? [])]) l(data, serverNow);
    },
    async send<T>(name: CommandName, args: unknown, options?: { commandId?: string }): Promise<T> {
      channel.sent.push({ name, args, commandId: options?.commandId });
      const handler = channel.handlers[name];
      return (handler ? await handler(args) : null) as T;
    },
    queue: {
      enqueue: async () => 'queued',
      pending: async () => [],
      flush: async () => undefined,
      onResult: () => () => undefined,
    },
    close() {
      channel.closed = true;
    },
  };
  return channel;
}

export interface FakeDoc extends SyncedDoc {
  closed: boolean;
}

export function createFakeDoc(docId: string): FakeDoc {
  const doc: FakeDoc = {
    docId,
    netDoc: new Y.Doc(),
    awareness: null,
    saveState: value<SaveState>('saved'),
    locked: value(false),
    unsentWhileLocked: value(false),
    failure: value(null),
    rejected: value(null),
    storageFailed: value(false),
    flushLocal: async () => undefined,
    waitSynced: async () => undefined,
    close() {
      doc.closed = true;
    },
    closed: false,
  };
  return doc;
}

export interface FakeSession extends RealtimeSession {
  readonly channel: FakeChannel;
  readonly docs: FakeDoc[];
  readonly stateValue: Value<ConnectionState>;
  closed: boolean;
}

export interface FakeRealtime {
  readonly sessions: FakeSession[];
  connect: AppDeps['realtime']['connect'];
}

export function createFakeRealtime(): FakeRealtime {
  const sessions: FakeSession[] = [];
  return {
    sessions,
    connect() {
      const stateValue = value<ConnectionState>('online');
      let channel: FakeChannel | null = null;
      const session: FakeSession = {
        state: stateValue,
        stateValue,
        get channel() {
          channel ??= createFakeChannel(ROOM_ID);
          return channel;
        },
        docs: [],
        closed: false,
        serverNow: () => NOW,
        async openDoc(docId) {
          const doc = createFakeDoc(docId);
          session.docs.push(doc);
          return doc;
        },
        joinRoom(roomId) {
          channel ??= createFakeChannel(roomId);
          return channel;
        },
        close() {
          session.closed = true;
        },
      };
      sessions.push(session);
      return session;
    },
  };
}

function createKv(): KvStorePort & { readonly map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async key => map.get(key),
    set: async (key, v) => {
      map.set(key, v);
    },
    delete: async key => {
      map.delete(key);
    },
  };
}

export interface FakeLocalStore extends LocalStorePort {
  readonly kv: ReturnType<typeof createKv>;
  readonly purgedRooms: string[];
}

function createLocalStore(): FakeLocalStore {
  const purgedRooms: string[] = [];
  return {
    kv: createKv(),
    purgedRooms,
    outbox: { put: async () => undefined, list: async () => [], remove: async () => undefined },
    aiResults: {
      get: async () => null,
      put: async () => undefined,
      list: async () => [],
      removeDoc: async () => undefined,
    },
    loadDoc: async () => null,
    appendUpdate: async () => undefined,
    compact: async () => undefined,
    setDocMeta: async () => undefined,
    purgeExpired: async () => 0,
    purgeRoom: async roomId => {
      purgedRooms.push(roomId);
      return 0;
    },
    volatile: false,
  };
}

export interface FakeMemory extends DeviceMemory {
  readonly teacherList: TeacherRoomMemory[];
}

function createMemory(): FakeMemory {
  const teacherList: TeacherRoomMemory[] = [];
  return {
    teacherList,
    deviceId: async () => 'device-1',
    students: async () => [],
    student: async () => null,
    rememberStudent: async () => undefined,
    touchStudent: async () => undefined,
    forgetStudent: async () => undefined,
    teachers: async () => [...teacherList],
    rememberTeacher: async entry => {
      const i = teacherList.findIndex(t => t.roomId === entry.roomId);
      if (i >= 0) teacherList.splice(i, 1, entry);
      else teacherList.push(entry);
    },
    forgetTeacher: async roomId => {
      const i = teacherList.findIndex(t => t.roomId === roomId);
      if (i >= 0) teacherList.splice(i, 1);
    },
    purgeExpired: async () => [],
    recentCardsSync: () => [],
  };
}

const notReady = () => Promise.reject({ code: 'E_INTERNAL', message: '', retryable: true });

export interface FakeDeps extends AppDeps {
  readonly realtime: FakeRealtime;
  readonly localStore: FakeLocalStore;
  readonly memory: FakeMemory;
  readonly api: ApiPort;
  readonly downloads: DownloadFile[];
}

/** 모든 REST는 기본으로 실패한다. 시험이 쓰는 것만 `api`로 덮는다. */
export function createFakeDeps(api: Partial<ApiPort> = {}): FakeDeps {
  let seq = 0;
  const downloads: DownloadFile[] = [];
  const base: ApiPort = {
    createRoom: notReady,
    roomByCode: notReady,
    join: notReady,
    aiStructured: notReady,
    aiPolish: () => ({
      [Symbol.asyncIterator]: () => ({ next: notReady }),
    }),
    resumeRequest: notReady,
    resumeStatus: notReady,
    resumeCancel: notReady,
    teacherPin: notReady,
    teacherSession: notReady,
    teacherRoom: notReady,
    teacherPinView: notReady,
    checkAi: notReady,
    exportRoom: notReady,
  };
  return {
    config: defaultConfig,
    api: { ...base, ...api },
    realtime: createFakeRealtime(),
    localStore: createLocalStore(),
    memory: createMemory(),
    now: () => NOW,
    newId: () => uuidOf(++seq),
    newToken: () => `token-${++seq}`,
    sha256Hex: async input => `hash:${input}`,
    pwa: { updateReady: value(false), applyIfReady: () => undefined },
    download: { save: file => void downloads.push(file) },
    downloads,
  };
}

export function teacherEntry(patch: Partial<TeacherRoomMemory> = {}): TeacherRoomMemory {
  return {
    roomId: ROOM_ID,
    displayName: 'room',
    teacherToken: 'teacher-token',
    tokenKind: 'LINK',
    lastUsedAt: NOW,
    expiresAt: NOW + defaultConfig.ROOM_TTL_DAYS * MS_PER_DAY,
    ...patch,
  };
}

export function helloOf(patch: Partial<Hello> = {}): Hello {
  return {
    role: 'teacher',
    room: {
      id: ROOM_ID,
      className: 'class-5-3',
      title: 'history',
      schoolName: null,
      status: 'ACTIVE',
      expiresAt: NOW + defaultConfig.ROOM_TTL_DAYS * MS_PER_DAY,
      settings: { genres: [...GENRE_IDS], aiButtons: [...AI_BUTTONS], sound: false },
    },
    me: null,
    docs: [],
    summaries: [],
    participants: [],
    timer: { status: 'IDLE', endsAt: null, remainingMs: null, durationSec: null, alerts: [], endText: '' },
    recentNotices: [],
    pendingResumes: [],
    config: {},
    ...patch,
  };
}
