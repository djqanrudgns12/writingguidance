import type { IncomingHttpHeaders, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ServerConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import { clientIpFrom } from '../security/clientIp.ts';
import type { RealtimeContext } from './hocuspocus.ts';

export interface RealtimeGateway {
  /** 새 웹소켓 업그레이드를 받지 않는다(끝내기 ①). */
  stopAccepting(): void;
  connectionCount(): number;
  /** 남은 소켓을 "다시 연결하세요"(1012)로 닫는다. 기기는 자동으로 다시 붙는다(끝내기 ⑤). */
  close(): Promise<void>;
}

/** 서버 재시작 중이라는 닫기 코드(RFC 6455 등록 코드). 기기 제공자는 이 코드에도 다시 연결한다. */
const CLOSE_SERVICE_RESTART = 1012;
/** Hocuspocus 메시지 종류(4.8.0): Ping=9, Pong=10. 한 바이트짜리 메시지다. */
const APP_PING = Uint8Array.of(9);
const APP_PONG = 10;

/**
 * 같은 HTTP 서버의 `upgrade`를 받아 `/ws`만 Hocuspocus로 넘긴다(PLAN §4.7 "한 포트에 붙이기").
 * - 업그레이드 소켓·웹소켓·`WebSocketServer`의 `error`를 모두 받는다(대응 10). 없으면 잘못된 프레임 하나로 프로세스가 죽는다.
 * - `HEARTBEAT_SEC`마다 두 가지 ping을 보낸다(대응 5).
 *   ① 웹소켓 ping 프레임: 그사이 pong이 없던 소켓은 끊는다(서버가 끊긴 기기를 약 두 간격 안에 안다).
 *   ② 응용 Ping(한 바이트 9): 브라우저 코드는 ①을 볼 수 없어서, 제공자의 `messageReconnectTimeout`
 *      (`CLIENT_STALE_SEC`)이 조용한 연결을 끊지 않게 하는 신호다. 제공자는 Pong(한 바이트 10)으로 답한다.
 *      Hocuspocus 4.8은 이 Pong을 문서 메시지로 읽다 실패해 연결을 닫으므로, 여기서 가로채고 넘기지 않는다.
 */
export function attachRealtime(
  server: Server,
  hocuspocus: Hocuspocus<RealtimeContext>,
  deps: { readonly config: ServerConfig; readonly log: Logger },
): RealtimeGateway {
  const { config, log } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.product.WS_MAX_PAYLOAD_BYTES });
  wss.on('error', error => log.error('wss_error', { error }));

  const sockets = new Set<WebSocket>();
  const alive = new WeakMap<WebSocket, boolean>();
  let accepting = true;

  const onUpgrade = (req: import('node:http').IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    if (!accepting || pathnameOf(req.url) !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws);
      alive.set(ws, true);
      const headers = toFetchHeaders(req.headers);
      const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/ws'}`, {
        headers,
      });
      const connection = hocuspocus.handleConnection(ws, request, { ip: clientIpFrom(headers) });

      ws.on('message', data => {
        const bytes = toBytes(data);
        if (bytes.length === 1 && bytes[0] === APP_PONG) {
          alive.set(ws, true);
          connection.touch();
          return;
        }
        connection.handleMessage(bytes);
      });
      ws.on('close', (code, reason) => {
        sockets.delete(ws);
        connection.handleClose({ code, reason: reason.toString() });
      });
      ws.on('pong', () => {
        alive.set(ws, true);
        connection.touch();
      });
      ws.on('error', error => {
        // 잘못된 프레임·크기 초과면 ws가 알맞은 닫기 코드(1002·1009 등)로 스스로 닫는다.
        // 듣기만 하면 프로세스가 죽지 않고, 닫히지 않고 남으면 1초 뒤 끊는다.
        log.warn('ws_error', { error });
        setTimeout(() => ws.terminate(), 1000).unref();
      });
    });
  };
  server.on('upgrade', onUpgrade);

  const pinger = setInterval(() => {
    for (const ws of sockets) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      try {
        ws.ping();
        ws.send(APP_PING);
      } catch {
        ws.terminate();
      }
    }
  }, config.product.HEARTBEAT_SEC * 1000);
  pinger.unref();

  return {
    stopAccepting() {
      accepting = false;
    },
    connectionCount: () => sockets.size,
    async close() {
      accepting = false;
      clearInterval(pinger);
      server.off('upgrade', onUpgrade);
      const closed = [...sockets].map(
        ws =>
          new Promise<void>(resolve => {
            ws.once('close', () => resolve());
            ws.close(CLOSE_SERVICE_RESTART, 'server restart');
            setTimeout(() => {
              ws.terminate();
              resolve();
            }, 2000).unref();
          }),
      );
      await Promise.all(closed);
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };
}

function pathnameOf(url: string | undefined): string | null {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}

function toFetchHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
