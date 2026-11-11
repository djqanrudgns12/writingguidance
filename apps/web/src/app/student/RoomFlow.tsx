import { createApiSchemas } from '@geulbang/core/api';
import { defaultConfig } from '@geulbang/core/config';
import { errorCatalog, type ErrorCode } from '@geulbang/core/errors';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { lookupRoom, type RoomInfo } from '../../application/joinRoom.ts';
import { connectStudent, type StudentSession } from '../../application/openWriting.ts';
import type { StudentRoomMemory } from '../../ports/deviceMemory.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { useAppDeps } from '../providers.tsx';
import { errorCodeOf } from './errorCode.ts';

/**
 * 수업방 하나의 입장 흐름(`/:code/*`, PLAN §6.1)이 함께 쓰는 것: 수업방 공개 정보, 동의 여부, 기기 기억,
 * 실시간 연결. 연결은 React 밖 객체이고 이 묶음이 하나만 연다(S1 다시 들어오기·S4·S5가 같은 연결을 쓴다).
 * 흐름을 떠나면(홈 등) 연결을 닫는다. 코드가 바뀌면 `key`로 묶음을 새로 만든다.
 */
export type RoomLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly room: RoomInfo }
  | { readonly status: 'error'; readonly code: ErrorCode };

export type EntryLoad =
  { readonly status: 'loading' } | { readonly status: 'ready'; readonly entry: StudentRoomMemory | null };

export interface RoomFlowValue {
  readonly code: string;
  /** 기기 ID(연결을 열 때 필요). 기기 저장소에서 읽는 중이면 null */
  readonly deviceId: string | null;
  readonly room: RoomLoad;
  /** 수업방 정보가 없으면 조회한다(이미 있거나 조회 중이면 그대로). */
  loadRoom(force?: boolean): void;
  /**
   * 토큰이 무효(`E_AUTH`)로 판정된 뒤 부른다: 들고 있던 수업방 정보와 동의 체크를 버린다(PRD 16.6).
   * 앞서 조회해 둔 정보는 지워진 방일 수 있어 그대로 S1 카드로 보이면 안 된다.
   * `gone`(방 조회로 끝난 방임을 확인함)이면 S1이 닫힌 문을 보이고, 아니면 S1이 방을 새로 조회한다.
   */
  resetRoom(gone: boolean): void;
  readonly agreed: boolean;
  setAgreed(agreed: boolean): void;
  /** 이 코드의 기기 기억(살아 있는 토큰). 없으면 null */
  readonly entry: EntryLoad;
  setEntry(entry: StudentRoomMemory | null): void;
  /**
   * 그 기억으로 연결을 연다(같은 토큰이면 지금 연결을 그대로). 기기 ID를 읽는 중이면 null.
   * 지금 연결이 다시 될 수 있는 실패(`E_SERVER_DOWN` 등)로 멈춰 있으면 새로 연다(다시 하기가 다시 인증하게, 검토 B08).
   */
  session(entry: StudentRoomMemory): StudentSession | null;
  /** 연결을 닫는다(토큰이 무효일 때 등) */
  dropSession(): void;
}

const RoomFlowContext = createContext<RoomFlowValue | null>(null);

export function useRoomFlow(): RoomFlowValue {
  const flow = useContext(RoomFlowContext);
  if (!flow) throw new Error('RoomFlow outside');
  return flow;
}

const CODE_PATTERN = new RegExp(`^\\d{${defaultConfig.ENTRY_CODE_LENGTH}}$`);

/** `/:code` 묶음 뿌리. 숫자 6자리가 아니면 없는 주소. */
export function RoomFlowRoute() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  if (!CODE_PATTERN.test(code)) return <ClosedView kind="missingPage" onHome={() => navigate('/')} />;
  return <RoomFlowProvider key={code} code={code} />;
}

interface SessionHolder {
  readonly roomId: string;
  readonly token: string;
  readonly session: StudentSession;
}

/**
 * 그 연결의 수업방 채널이 다시 될 수 있는 이유로 멈췄는가. 영구 자격 오류(`E_AUTH`·`E_FORBIDDEN`)는 같은 토큰으로
 * 다시 열어도 같으므로 아니다(기억을 지우는 흐름이 맡는다).
 */
function stoppedRecoverably(student: StudentSession): boolean {
  if (student.channel.state.get() !== 'failed') return false;
  const code = student.channel.failure.get();
  return code !== null && errorCatalog[code].retryable;
}

function RoomFlowProvider({ code }: { readonly code: string }) {
  const deps = useAppDeps();
  const location = useLocation();
  const roomSchema = useMemo(() => createApiSchemas(deps.config).roomByCodeResult, [deps.config]);

  // 홈의 코드 시트가 이미 조회했으면 그 결과를 넘겨받는다(같은 코드를 두 번 조회하지 않게).
  const [room, setRoom] = useState<RoomLoad>(() => {
    const passed = roomSchema.safeParse((location.state as { room?: unknown } | null)?.room);
    return passed.success ? { status: 'ready', room: passed.data } : { status: 'loading' };
  });
  const roomRequested = useRef(room.status === 'ready');
  /** 조회 차례. 버린(`resetRoom`) 뒤에 도착한 앞선 조회 결과는 쓰지 않는다. */
  const roomGen = useRef(0);
  const [agreed, setAgreed] = useState(false);
  const [entry, setEntryState] = useState<EntryLoad>({ status: 'loading' });
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const holder = useRef<SessionHolder | null>(null);

  useEffect(() => {
    let alive = true;
    void deps.memory.deviceId().then(
      id => alive && setDeviceId(id),
      () => alive && setDeviceId(deps.newId()),
    );
    void deps.memory.students(deps.now()).then(
      list =>
        alive && setEntryState({ status: 'ready', entry: list.find(e => e.entryCode === code) ?? null }),
      () => alive && setEntryState({ status: 'ready', entry: null }),
    );
    return () => {
      alive = false;
    };
  }, [deps, code]);

  // 흐름을 떠나면 연결을 닫는다(StrictMode가 다시 붙이면 다음 `session()`이 새로 연다).
  useEffect(
    () => () => {
      holder.current?.session.close();
      holder.current = null;
    },
    [],
  );

  const loadRoom = useCallback(
    (force = false) => {
      if (roomRequested.current && !force) return;
      roomRequested.current = true;
      const gen = ++roomGen.current;
      setRoom({ status: 'loading' });
      lookupRoom(deps, code).then(
        r => {
          if (gen === roomGen.current) setRoom({ status: 'ready', room: r });
        },
        (error: unknown) => {
          if (gen === roomGen.current) setRoom({ status: 'error', code: errorCodeOf(error) });
        },
      );
    },
    [deps, code],
  );

  const resetRoom = useCallback((gone: boolean) => {
    setAgreed(false);
    // 늦게 오는 앞선 조회 결과가 버린 정보를 되살리지 않게 한다.
    roomGen.current++;
    // 끝난 방이면 다시 조회하지 않는다(같은 코드는 404·만료로만 답한다). 아니면 다음 `loadRoom()`이 새로 조회한다.
    roomRequested.current = gone;
    setRoom(gone ? { status: 'error', code: 'E_ROOM_EXPIRED' } : { status: 'loading' });
  }, []);

  const session = useCallback(
    (e: StudentRoomMemory): StudentSession | null => {
      const h = holder.current;
      if (h && h.roomId === e.roomId && h.token === e.deviceToken && !stoppedRecoverably(h.session)) {
        return h.session;
      }
      if (!deviceId) return null;
      h?.session.close();
      const next = connectStudent(deps, e, deviceId);
      holder.current = { roomId: e.roomId, token: e.deviceToken, session: next };
      return next;
    },
    [deps, deviceId],
  );

  const dropSession = useCallback(() => {
    holder.current?.session.close();
    holder.current = null;
  }, []);

  const setEntry = useCallback(
    (e: StudentRoomMemory | null) => setEntryState({ status: 'ready', entry: e }),
    [],
  );

  const value = useMemo<RoomFlowValue>(
    () => ({
      code,
      deviceId,
      room,
      loadRoom,
      resetRoom,
      agreed,
      setAgreed,
      entry,
      setEntry,
      session,
      dropSession,
    }),
    [code, deviceId, room, loadRoom, resetRoom, agreed, entry, setEntry, session, dropSession],
  );

  return (
    <RoomFlowContext.Provider value={value}>
      <Outlet />
    </RoomFlowContext.Provider>
  );
}
