import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { lookupRoom } from '../../application/joinRoom.ts';
import type { EntryCodeStatus } from '../../ui/screens/student/EntryCodeSheet.tsx';
import { EntryCodeSheet } from '../../ui/screens/student/EntryCodeSheet.tsx';
import { HomeView } from '../../ui/screens/student/HomeView.tsx';
import { useAppDeps } from '../providers.tsx';
import { errorCodeOf, errorLineOf } from './errorCode.ts';
import { useHomeRooms } from './hooks/useHomeRooms.ts';

const ADD_TO_HOME_KEY = 'student.addToHomeSeen';

/** 홈 화면에 추가한 앱으로 열었는가(그러면 안내가 필요 없다) */
function isStandalone(): boolean {
  try {
    const nav = globalThis.navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

/**
 * `/` S0 홈(PRD F-01·F-09·F-23). 기기 기억만으로 그린다(실시간 연결은 열지 않는다).
 * - 이어 쓰기 카드·최근 수업방: 누르면 마지막 글로 바로(없으면 그 수업방 S1 → 다시 들어오기).
 * - 코드 시트: 6자리면 바로 조회 → 그 결과를 들고 S1로(같은 코드를 다시 조회하지 않게).
 * - 홈 화면 추가 안내: 수업방에 한 번이라도 들어간 기기에 한 번만(기기 `kv`에 본 기록).
 * - 받아 둔 앱 새 판은 홈에서만 적용한다(ADR-025).
 */
export function StudentHome() {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const rooms = useHomeRooms(deps);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<EntryCodeStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [showAddToHome, setShowAddToHome] = useState(false);
  const checking = useRef<string | null>(null);
  const hasRooms = rooms.resume !== null;

  // 앱 새 판: 홈에서만, 코드를 누르는 중이 아닐 때 적용(쓰기 화면에서는 적용하지 않는다).
  useEffect(() => {
    if (sheetOpen) return;
    deps.pwa.applyIfReady();
    return deps.pwa.updateReady.subscribe(ready => {
      if (ready) deps.pwa.applyIfReady();
    });
  }, [deps, sheetOpen]);

  useEffect(() => {
    if (!hasRooms || isStandalone()) return;
    let alive = true;
    void deps.localStore.kv.get(ADD_TO_HOME_KEY).then(
      seen => {
        if (!alive || seen === true) return;
        setShowAddToHome(true);
        // 한 번만 보인다(PRD F-09): 보인 순간 기록한다.
        void deps.localStore.kv.set(ADD_TO_HOME_KEY, true).catch(() => {});
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [deps, hasRooms]);

  const openRoom = useCallback(
    (roomId: string) => {
      const card = rooms.cards.get(roomId);
      if (!card) return;
      navigate(card.lastDocId ? `/${card.entryCode}/write/${card.lastDocId}` : `/${card.entryCode}`);
    },
    [navigate, rooms.cards],
  );

  const check = useCallback(
    (digits: string) => {
      if (checking.current === digits) return;
      checking.current = digits;
      setStatus('checking');
      setErrorMessage(undefined);
      lookupRoom(deps, digits).then(
        room => {
          if (checking.current !== digits) return;
          checking.current = null;
          setStatus('idle');
          setSheetOpen(false);
          navigate(`/${digits}`, { state: { room } });
        },
        (error: unknown) => {
          if (checking.current !== digits) return;
          checking.current = null;
          setStatus('error');
          setErrorMessage(errorLineOf(errorCodeOf(error)) ?? undefined);
        },
      );
    },
    [deps, navigate],
  );

  const paste = useCallback(() => {
    void globalThis.navigator?.clipboard
      ?.readText()
      .then(text => {
        const digits = text.replace(/\D+/g, '').slice(0, deps.config.ENTRY_CODE_LENGTH);
        setCode(digits);
        if (digits.length === deps.config.ENTRY_CODE_LENGTH) check(digits);
      })
      .catch(() => {
        // 붙여넣기를 막은 기기: 키패드로 누르면 된다.
      });
  }, [check, deps.config.ENTRY_CODE_LENGTH]);

  return (
    <>
      <HomeView
        now={deps.now()}
        resume={rooms.resume}
        recentRooms={rooms.recent}
        showAddToHome={showAddToHome}
        onDismissAddToHome={() => setShowAddToHome(false)}
        onStartWrite={() => setSheetOpen(true)}
        onResume={openRoom}
        onOpenRecent={openRoom}
        onTeacher={() => navigate('/t')}
        onPrivacy={() => navigate('/privacy')}
      />
      <EntryCodeSheet
        open={sheetOpen}
        onOpenChange={open => {
          setSheetOpen(open);
          if (!open) checking.current = null;
        }}
        code={code}
        onCodeChange={next => {
          setCode(next);
          if (status === 'error') {
            setStatus('idle');
            setErrorMessage(undefined);
          }
        }}
        onComplete={check}
        status={status}
        errorMessage={errorMessage}
        onPasteRequest={typeof globalThis.navigator?.clipboard?.readText === 'function' ? paste : undefined}
      />
    </>
  );
}
