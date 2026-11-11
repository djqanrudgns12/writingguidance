import { defaultConfig } from '@geulbang/core/config';
import type { ErrorCode } from '@geulbang/core/errors';
import type { CommandName, Hello, MyDoc, RoomEventData, RoomEventName } from '@geulbang/core/protocol';
import * as Y from 'yjs';
import { createDeviceMemory } from '../../adapters/local/deviceMemory.ts';
import type { AppDeps } from '../../application/deps.ts';
import type { RoomInfo } from '../../application/joinRoom.ts';
import type { ApiPort } from '../../ports/api.ts';
import type { StudentRoomMemory } from '../../ports/deviceMemory.ts';
import type { AiResultRecord, KvStorePort, LocalStorePort } from '../../ports/localStore.ts';
import { value, type Value } from '../../ports/observable.ts';
import type {
  CommandError,
  ConnectionState,
  RealtimePort,
  RealtimeSession,
  RoomChannel,
  RoomChannelState,
  SaveState,
  SyncedDoc,
} from '../../ports/realtime.ts';

/**
 * 학생 결합 시험용 가짜(시험 파일만 쓴다): 메모리 기기 저장소, 이름으로 갈아 끼우는 REST, 이벤트를 흘릴 수 있는
 * 수업방 채널, 통신용 Y.Doc 하나짜리 글. 기기 기억은 진짜 어댑터(`createDeviceMemory`)를 메모리 `kv` 위에 쓴다.
 */
export const ROOM_ID = '7b0e4c1e-2f6a-4b8e-9a51-0c6a3e9d1f20';
export const PARTICIPANT_ID = '1d6f2a90-5c3b-4e7f-8a12-6b9c0d4e2f31';
export const DOC_ID = '3a9c7e15-8b2d-4f60-9e43-2d1b5c7a8f09';
export const CODE = '482913';
export const POLICY = defaultConfig.POLICY_VERSION;
export const FUTURE = Date.now() + 10 * 24 * 60 * 60 * 1000;

export function memoryKv(): KvStorePort & { readonly map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async key => structuredClone(map.get(key)),
    set: async (key, v) => void map.set(key, structuredClone(v)),
    delete: async key => void map.delete(key),
  };
}

export function memoryStore(kv = memoryKv()): LocalStorePort {
  const ai = new Map<string, AiResultRecord>();
  return {
    kv,
    outbox: { put: async () => {}, list: async () => [], remove: async () => {} },
    aiResults: {
      get: async (docId, button) => (ai.get(`${docId}:${button}`) as never) ?? null,
      put: async record => void ai.set(`${record.docId}:${record.button}`, record),
      list: async docId => [...ai.values()].filter(r => r.docId === docId),
      removeDoc: async () => {},
    },
    loadDoc: async () => null,
    appendUpdate: async () => {},
    compact: async () => {},
    setDocMeta: async () => {},
    purgeExpired: async () => 0,
    purgeRoom: async () => 0,
    volatile: false,
  };
}

export function roomInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    roomId: ROOM_ID,
    className: 'class-a',
    title: 'room-a',
    schoolName: null,
    status: 'ACTIVE',
    expiresAt: FUTURE,
    policyVersion: POLICY,
    genres: ['news'],
    ...overrides,
  };
}

export function myDoc(overrides: Partial<MyDoc> = {}): MyDoc {
  return {
    docId: DOC_ID,
    genre: 'news',
    subtype: 'newspaper',
    purpose: null,
    purposeCustom: null,
    status: 'DRAFT',
    generation: 0,
    chars: 0,
    updatedAt: Date.now(),
    submittedAt: null,
    ...overrides,
  };
}

export function hello(overrides: Partial<Hello> = {}): Hello {
  return {
    role: 'student',
    room: {
      id: ROOM_ID,
      className: 'class-a',
      title: 'room-a',
      schoolName: null,
      status: 'ACTIVE',
      expiresAt: FUTURE,
      settings: {
        genres: ['news', 'poem'],
        aiButtons: ['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'],
        sound: false,
      },
    },
    me: { participantId: PARTICIPANT_ID, nickname: 'nick', consentVersion: POLICY },
    docs: [myDoc()],
    summaries: null,
    participants: null,
    timer: { status: 'IDLE', endsAt: null, remainingMs: null, durationSec: null, alerts: [], endText: '' },
    recentNotices: [],
    pendingResumes: null,
    config: { POLICY_VERSION: POLICY },
    ...overrides,
  };
}

export function rememberedEntry(overrides: Partial<StudentRoomMemory> = {}): StudentRoomMemory {
  return {
    roomId: ROOM_ID,
    entryCode: CODE,
    className: 'class-a',
    title: 'room-a',
    nickname: 'nick',
    participantId: PARTICIPANT_ID,
    deviceToken: 'token-remembered',
    lastDocId: DOC_ID,
    lastUsedAt: Date.now() - 60_000,
    expiresAt: FUTURE,
    ...overrides,
  };
}

// ── 실시간 ──────────────────────────────────────────────────────

export interface FakeChannel extends RoomChannel {
  readonly state: Value<RoomChannelState>;
  readonly hello: Value<Hello | null>;
  readonly failure: Value<ErrorCodeOrNull>;
  readonly sent: { name: CommandName; args: unknown }[];
  readonly enqueued: { commandId: string; docId: string; args: unknown }[];
  /** 명령 이름 → 응답(없으면 null로 성공) */
  readonly handlers: Map<CommandName, (args: unknown) => unknown>;
  emit<N extends RoomEventName>(name: N, data: RoomEventData<N>): void;
  result(r: { commandId: string; ok: boolean; error?: CommandError }): void;
}

type ErrorCodeOrNull = ErrorCode | null;

export function fakeChannel(roomId: string): FakeChannel {
  const listeners = new Map<string, Set<(data: unknown, serverNow: number) => void>>();
  const resultListeners = new Set<(r: { commandId: string; ok: boolean; error?: CommandError }) => void>();
  const sent: FakeChannel['sent'] = [];
  const enqueued: FakeChannel['enqueued'] = [];
  const handlers = new Map<CommandName, (args: unknown) => unknown>();
  let n = 0;
  return {
    roomId,
    state: value<RoomChannelState>('connecting'),
    hello: value<Hello | null>(null),
    failure: value<ErrorCodeOrNull>(null),
    sent,
    enqueued,
    handlers,
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener as (data: unknown, serverNow: number) => void);
      listeners.set(name, set);
      return () => set.delete(listener as (data: unknown, serverNow: number) => void);
    },
    async send<T>(name: CommandName, args: unknown): Promise<T> {
      sent.push({ name, args });
      const h = handlers.get(name);
      return (h ? await h(args) : null) as T;
    },
    queue: {
      async enqueue(entry) {
        const commandId = `cmd-${++n}`;
        enqueued.push({ commandId, docId: entry.docId, args: entry.args });
        return commandId;
      },
      pending: async () => [],
      onResult(listener) {
        resultListeners.add(listener);
        return () => resultListeners.delete(listener);
      },
    },
    close() {},
    emit(name, data) {
      for (const l of listeners.get(name) ?? []) l(data, Date.now());
    },
    result(r) {
      for (const l of resultListeners) l(r);
    },
  };
}

export interface FakeDoc extends SyncedDoc {
  readonly saveState: Value<SaveState>;
  readonly locked: Value<boolean>;
}

export function fakeDoc(docId: string, netDoc: Y.Doc): FakeDoc {
  return {
    docId,
    netDoc,
    awareness: null,
    saveState: value<SaveState>('saved'),
    locked: value(false),
    unsentWhileLocked: value(false),
    failure: value(null),
    rejected: value(null),
    storageFailed: value(false),
    flushLocal: async () => {},
    waitSynced: async () => {},
    close: () => {},
  };
}

export interface FakeRealtime extends RealtimePort {
  readonly channels: FakeChannel[];
  readonly docs: Map<string, Y.Doc>;
  readonly opened: Map<string, FakeDoc>;
  /** 새 채널이 생기면 부른다(hello를 바로 넣는 등) */
  onChannel?: (channel: FakeChannel) => void;
}

export function fakeRealtime(): FakeRealtime {
  const rt: FakeRealtime = {
    channels: [],
    docs: new Map(),
    opened: new Map(),
    connect(): RealtimeSession {
      const state = value<ConnectionState>('online');
      return {
        state,
        serverNow: () => Date.now(),
        async openDoc(docId) {
          let net = rt.docs.get(docId);
          if (!net) {
            net = new Y.Doc();
            rt.docs.set(docId, net);
          }
          const d = fakeDoc(docId, net);
          rt.opened.set(docId, d);
          return d;
        },
        joinRoom(roomId) {
          const ch = fakeChannel(roomId);
          rt.channels.push(ch);
          rt.onChannel?.(ch);
          return ch;
        },
        close() {
          state.set('closed');
        },
      };
    },
  };
  return rt;
}

// ── REST ───────────────────────────────────────────────────────

export type FakeApi = ApiPort & { readonly calls: { name: string; args: unknown[] }[] };

export function fakeApi(impl: Partial<ApiPort> = {}): FakeApi {
  const calls: { name: string; args: unknown[] }[] = [];
  const missing = (name: string) => () => Promise.reject({ code: 'E_INTERNAL', retryable: false, name });
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'calls') return calls;
      const fn = (impl as Record<string, unknown>)[prop] as ((...a: unknown[]) => unknown) | undefined;
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return fn ? fn(...args) : missing(prop)();
      };
    },
  };
  return new Proxy({}, handler) as FakeApi;
}

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** 시험용 해시(겹치지 않으면 된다) */
async function fakeSha(input: string): Promise<string> {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `${h.toString(16).padStart(8, '0')}${input.length.toString(16).padStart(8, '0')}`.padEnd(64, '0');
}

export function fakeDeps(
  over: { api?: FakeApi; realtime?: FakeRealtime; kv?: ReturnType<typeof memoryKv> } = {},
) {
  const kv = over.kv ?? memoryKv();
  const localStore = memoryStore(kv);
  const saved: { name: string }[] = [];
  let token = 0;
  const deps: AppDeps = {
    config: defaultConfig,
    api: over.api ?? fakeApi(),
    realtime: over.realtime ?? fakeRealtime(),
    localStore,
    memory: createDeviceMemory({ kv, storage: memoryStorage() }),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    newToken: () => `token-${++token}`,
    sha256Hex: fakeSha,
    pwa: { updateReady: value(false), applyIfReady: () => {} },
    download: { save: file => void saved.push({ name: file.name }) },
  };
  return { deps, kv, saved };
}
