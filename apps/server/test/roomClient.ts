import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  decodeDocEvent,
  decodeRoomMessage,
  encodeCommand,
  encodeCredential,
  type Ack,
  type CommandName,
  type DocEvent,
  type RoomEvent,
} from '@geulbang/core/protocol';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import type { TestServer } from './helpers.ts';

/**
 * v0 통합 시험용 Node 클라이언트(PLAN §10.4). 기기처럼 토큰을 스스로 만들고 해시만 보낸다(PLAN §7.4),
 * 소켓 하나에 `room:*`·`doc:*` 제공자를 붙인다(PLAN §4.1).
 */

export async function waitFor(check: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`시간 안에 되지 않음: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

/** 시험용 기기 머리: Bearer 토큰 */
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export interface ApiResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly json: {
    data?: Record<string, unknown>;
    commandId?: string;
    requestId?: string;
    error?: { code: string; retryable: boolean; fields?: Record<string, string> };
  };
}

export async function api(
  t: TestServer,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse> {
  const res = await fetch(`${t.server.url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, headers: res.headers, json: (await res.json()) as ApiResponse['json'] };
}

let pinCounter = 700_000;
export const nextPin = () => String(++pinCounter);

export interface CreatedRoom {
  readonly res: ApiResponse;
  readonly roomId: string;
  readonly entryCode: string;
  readonly linkToken: string;
  readonly body: Record<string, unknown>;
}

export async function createRoom(
  t: TestServer,
  startCode: string | undefined,
  overrides: Record<string, unknown> = {},
): Promise<CreatedRoom> {
  const link = newToken();
  const body = {
    className: '5학년 3반',
    title: '시험 수업',
    showSchool: false,
    genres: ['story', 'poem'],
    aiButtons: ['SPELL', 'FEEDBACK'],
    pin: nextPin(),
    linkTokenHash: link.hash,
    deviceId: randomUUID(),
    commandId: randomUUID(),
    ...overrides,
  };
  const res = await api(t, 'POST', '/api/rooms', body, startCode ? { 'x-start-code': startCode } : {});
  return {
    res,
    roomId: String(res.json.data?.['roomId'] ?? ''),
    entryCode: String(res.json.data?.['entryCode'] ?? ''),
    linkToken: link.token,
    body,
  };
}

export interface JoinedStudent {
  readonly res: ApiResponse;
  readonly participantId: string;
  readonly token: string;
  readonly deviceId: string;
  readonly body: Record<string, unknown>;
}

export async function joinRoom(
  t: TestServer,
  roomId: string,
  nickname: string,
  overrides: Record<string, unknown> = {},
): Promise<JoinedStudent> {
  const device = newToken();
  const deviceId = randomUUID();
  const body = {
    nickname,
    consentVersion: t.config.product.POLICY_VERSION,
    deviceId,
    deviceTokenHash: device.hash,
    commandId: randomUUID(),
    ...overrides,
  };
  const res = await api(t, 'POST', `/api/rooms/${roomId}/join`, body);
  return {
    res,
    participantId: String(res.json.data?.['participantId'] ?? ''),
    token: device.token,
    deviceId,
    body,
  };
}

export interface DocClient {
  readonly provider: HocuspocusProvider;
  readonly doc: Y.Doc;
  readonly events: DocEvent[];
  readonly failures: string[];
  close(): void;
}

export interface RoomClient {
  readonly socket: HocuspocusProviderWebsocket;
  readonly provider: HocuspocusProvider;
  readonly events: RoomEvent[];
  readonly failures: string[];
  /** 모양 검사(규약 스키마)를 통과하지 못한 메시지. 서버가 규약을 어기면 여기에 쌓인다. */
  readonly rejected: string[];
  command(name: CommandName | string, args: unknown, id?: string): Promise<Ack>;
  openDoc(docId: string): DocClient;
  event<N extends RoomEvent['name']>(name: N): Extract<RoomEvent, { name: N }> | undefined;
  close(): void;
}

export interface Credential {
  readonly kind: 'student' | 'teacher';
  readonly token: string;
  readonly deviceId: string;
}

export function connectRoom(t: TestServer, roomId: string, credential: Credential): RoomClient {
  const socket = new HocuspocusProviderWebsocket({ url: `${t.server.url.replace('http', 'ws')}/ws` });
  const token = encodeCredential({ v: 1, ...credential });
  const events: RoomEvent[] = [];
  const failures: string[] = [];
  const rejected: string[] = [];
  const acks = new Map<string, Ack>();
  const docs: DocClient[] = [];
  let closed = false;

  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `room:${roomId}`,
    document: new Y.Doc(),
    token,
  });
  provider.on('stateless', ({ payload }: { payload: string }) => {
    const message = decodeRoomMessage(payload);
    if (!message) rejected.push(payload);
    else if (message.kind === 'ack') acks.set(message.ack.id, message.ack);
    else events.push(message.evt);
  });
  provider.on('authenticationFailed', ({ reason }: { reason: string }) => failures.push(reason));
  provider.attach();

  return {
    socket,
    provider,
    events,
    failures,
    rejected,
    async command(name, args, id = randomUUID()) {
      provider.sendStateless(encodeCommand(id, name as CommandName, args));
      await waitFor(() => acks.has(id), `ack ${name}`);
      const ack = acks.get(id);
      if (!ack) throw new Error('ack 없음');
      acks.delete(id);
      return ack;
    },
    openDoc(docId) {
      const doc = new Y.Doc();
      const docEvents: DocEvent[] = [];
      const docFailures: string[] = [];
      const p = new HocuspocusProvider({
        websocketProvider: socket,
        name: `doc:${docId}`,
        document: doc,
        token,
      });
      p.on('stateless', ({ payload }: { payload: string }) => {
        const event = decodeDocEvent(payload);
        if (event) docEvents.push(event);
      });
      p.on('authenticationFailed', ({ reason }: { reason: string }) => docFailures.push(reason));
      p.attach();
      const client: DocClient = {
        provider: p,
        doc,
        events: docEvents,
        failures: docFailures,
        close: () => p.destroy(),
      };
      docs.push(client);
      return client;
    },
    event(name) {
      return events.findLast(e => e.name === name) as Extract<RoomEvent, { name: typeof name }> | undefined;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const d of docs) d.provider.destroy();
      provider.destroy();
      socket.destroy();
    },
  };
}
