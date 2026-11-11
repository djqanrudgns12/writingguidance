import { Hocuspocus } from '@hocuspocus/server';
import { createDeleteRoom, type DeleteRoom } from '../application/deleteRoom.ts';
import { createResumeWaiters, type ResumeWaiters } from '../application/resumeWaiters.ts';
import type { ServerConfig } from '../config.ts';
import { createTimerScheduler, type TimerScheduler } from '../jobs/timers.ts';
import type { Logger } from '../log.ts';
import type { Db } from '../store/db.ts';
import type { Repos } from '../store/repos/index.ts';
import { createAccessSync, type AccessSync } from './accessSync.ts';
import { createAuthenticator } from './auth.ts';
import type { RealtimeContext } from './context.ts';
import { decisionHook, notifyHook } from './hookGuards.ts';
import { createPersistence, type Persistence } from './persistence.ts';
import { createPrecheck } from './precheck.ts';
import { createRoomChannel, type RoomChannel } from './roomChannel.ts';
import { createRoomEvents, type RoomEvents } from './roomEvents.ts';
import { createRoomGate, type RoomGate } from './roomGate.ts';
import { createRoomState, type RoomState } from './roomState.ts';
import { createSnapshots, type Snapshots } from './snapshots.ts';
import { createTeacherEdits } from './teacherEdits.ts';

export type { RealtimeContext } from './context.ts';

export interface RealtimeDeps {
  readonly config: ServerConfig;
  readonly log: Logger;
  readonly db: Db;
  readonly repos: Repos;
  readonly now: () => number;
  /** 개발 전용 `dev` 자격의 비밀값(`DEV_DOCS_ENABLED`일 때만). */
  readonly devSecret: string | undefined;
  /** 시험에서 저장 재시도 대기를 줄일 때 */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** HTTP 쪽(AI·이어 쓰기·내려받기·정리 작업)도 함께 쓰는 실시간 서비스 묶음 */
export interface RealtimeServices {
  readonly hocuspocus: () => Hocuspocus<RealtimeContext>;
  readonly roomState: RoomState;
  readonly snapshots: Snapshots;
  readonly events: RoomEvents;
  readonly access: AccessSync;
  readonly gate: RoomGate;
  readonly timers: TimerScheduler;
  readonly resumeWaiters: ResumeWaiters;
  readonly deleteRoom: DeleteRoom;
}

export interface Realtime {
  readonly hocuspocus: Hocuspocus<RealtimeContext>;
  readonly persistence: Persistence;
  readonly roomState: RoomState;
  readonly roomChannel: RoomChannel;
  readonly services: RealtimeServices;
  /** 주기 작업(요약 묶음·tick·타이머 예약)과 긴 조회를 멈춘다. 끝내기 ①에서 부른다. */
  close(): void;
}

/**
 * Hocuspocus 4 설정(PLAN §4.7). 자기 HTTP 서버를 만드는 `Server` 클래스는 쓰지 않고, 같은 포트의 `upgrade`를
 * `upgrade.ts`가 직접 넘긴다. 훅은 판단 훅(던짐)·알림 훅(삼킴)으로 감싼다(대응 1).
 */
export function createRealtime(deps: RealtimeDeps): Realtime {
  const { config, log, db, repos, now } = deps;
  const p = config.product;
  // 아래 모듈들이 문서 목록을 읽어야 하는데 Hocuspocus는 훅을 받아야 만들 수 있어 나중에 채운다.
  let instance: Hocuspocus<RealtimeContext> | undefined;
  const hocuspocus = () => {
    if (!instance) throw new Error('Hocuspocus가 아직 없음');
    return instance;
  };

  const gate = createRoomGate();
  const events = createRoomEvents({ hocuspocus, now });
  const snapshots = createSnapshots({ repos, config: p, now });
  const roomState = createRoomState({ config: p, repos, log, now, hocuspocus });
  const access = createAccessSync({
    repos,
    hocuspocus,
    events,
    roomState,
    now,
    policyVersion: p.POLICY_VERSION,
  });
  const timers = createTimerScheduler({ config: p, repos, events, log, now });
  const resumeWaiters = createResumeWaiters();
  const persistence = createPersistence({
    repo: repos.documents,
    log,
    now,
    lastInput: docId => roomState.lastInput(docId),
    afterSave: (docId, text, author) => snapshots.afterSave(docId, text, author),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  const deleteRoom = createDeleteRoom({
    repos,
    gate,
    events,
    hocuspocus,
    persistence,
    roomState,
    timers,
    resumeWaiters,
    log,
  });
  const authenticate = createAuthenticator({
    db,
    repos,
    now,
    gate,
    policyVersion: p.POLICY_VERSION,
    devSecret: deps.devSecret,
  });
  const precheck = createPrecheck({
    config: p,
    log,
    now,
    genreOf: docId => repos.documents.findInfo(docId)?.genre,
  });
  const teacherEdits = createTeacherEdits({ log, now, snapshots, hocuspocus });
  const roomChannel = createRoomChannel({
    config,
    repos,
    log,
    now,
    hocuspocus,
    roomState,
    snapshots,
    events,
    access,
    gate,
    timers,
    resumeWaiters,
    deleteRoom,
  });

  instance = new Hocuspocus<RealtimeContext>({
    name: 'geulbang',
    quiet: true,
    // 저장 묶음(PRD 9.1): 2초 묶음, 최대 10초
    debounce: p.SERVER_PERSIST_DEBOUNCE_MS,
    maxDebounce: p.SERVER_PERSIST_MAX_WAIT_MS,
    unloadImmediately: true,
    // 받은 메시지가 없으면 닫는 시간. 살아 있는 기기는 하트비트 pong마다 `touch()`되므로 이것은 마지막 안전장치다.
    timeout: p.HEARTBEAT_SEC * 6 * 1000,

    onAuthenticate: decisionHook('onAuthenticate', log, async payload => {
      const result = await authenticate(payload);
      // Hocuspocus는 인증 전에 쌓인 메시지(다시 연결한 기기의 오프라인 편집 등)를 `connected` 훅보다 먼저 적용한다.
      // 그 첫 변경도 입력으로 기록되게, 인증하자마자 글의 방을 메모리 요약에 올린다.
      if (result.doc) roomState.trackDocument(result.doc);
      return result;
    }),
    onLoadDocument: decisionHook('onLoadDocument', log, persistence.onLoadDocument),
    onStoreDocument: decisionHook('onStoreDocument', log, persistence.onStoreDocument),
    beforeUnloadDocument: decisionHook('beforeUnloadDocument', log, persistence.beforeUnloadDocument),
    // 적용 전 검사는 던지면 연결이 닫히므로 알림 훅처럼 감싼다(검사 자체가 고장 나면 기록하고 메시지는 통과).
    // 검사가 그 연결을 읽기 전용으로 바꿨으면 교사 첫 입력 준비는 건너뛴다.
    beforeHandleMessage: notifyHook('beforeHandleMessage', log, async payload => {
      await precheck(payload);
      teacherEdits.beforeHandleMessage(payload);
    }),
    connected: notifyHook('connected', log, payload => {
      persistence.connected(payload);
      roomChannel.connected(payload);
    }),
    afterUnloadDocument: notifyHook('afterUnloadDocument', log, persistence.afterUnloadDocument),
    onChange: notifyHook('onChange', log, payload => {
      roomState.onChange(payload);
      teacherEdits.onChange(payload);
    }),
    onStateless: notifyHook('onStateless', log, roomChannel.onStateless),
  });

  // 돌던 타이머의 알림 예약을 DB에서 다시 만든다(PLAN §7.1-3).
  timers.restore();

  return {
    hocuspocus: instance,
    persistence,
    roomState,
    roomChannel,
    services: { hocuspocus, roomState, snapshots, events, access, gate, timers, resumeWaiters, deleteRoom },
    close() {
      roomChannel.close();
      roomState.close();
      timers.close();
      resumeWaiters.close();
    },
  };
}
