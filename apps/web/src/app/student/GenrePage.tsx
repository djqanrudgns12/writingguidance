import {
  GENRE_CATALOG,
  isGenreId,
  type GenreId,
  type GenreSelection,
  type PurposeId,
  type SubtypeId,
} from '@geulbang/core';
import type { ErrorCode } from '@geulbang/core/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { createDoc, type NewDocChoice } from '../../application/openWriting.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import { GenreView } from '../../ui/screens/student/GenreView.tsx';
import { useAppDeps } from '../providers.tsx';
import { writeDocKind } from './docInfo.ts';
import { errorCodeOf } from './errorCode.ts';
import { useConsentGate } from './hooks/useConsentGate.ts';
import { useStudentSession } from './hooks/useStudentSession.ts';
import { ReconsentCard } from './ReconsentCard.tsx';
import { useRoomFlow } from './RoomFlow.tsx';

/** `GenreSelection`(화면) → `doc.create` 인자. 빈 값은 보내지 않는다(서버가 기본 하위 종류·용도를 쓴다). */
function choiceOf(selection: GenreSelection): NewDocChoice {
  return {
    genre: selection.genre,
    ...(selection.subtype ? { subtype: selection.subtype } : {}),
    ...(selection.purpose ? { purpose: selection.purpose } : {}),
    ...(selection.purposeCustom ? { purposeCustom: selection.purposeCustom } : {}),
  };
}

/**
 * `/:code/genre` S4 글 종류 고르기(PRD F-05). 교사가 켠 종류는 hello에서 온다.
 * 켠 종류가 하나뿐이고 `기타 문구`가 아니면 이 화면을 건너뛰고 바로 글을 만든다.
 * 같은 선택으로 다시 누르면 같은 명령 ID로 보내 글이 두 개 생기지 않는다.
 */
export function GenrePage() {
  const deps = useAppDeps();
  const flow = useRoomFlow();
  const navigate = useNavigate();
  const entry = flow.entry.status === 'ready' ? flow.entry.entry : null;
  const { student, hello, channelState, failure, connection } = useStudentSession(entry, flow.session);
  const consent = useConsentGate(deps, student, hello);

  const [genre, setGenre] = useState<GenreId | null>(null);
  const [subtype, setSubtype] = useState<SubtypeId | null>(null);
  const [purpose, setPurpose] = useState<PurposeId | null>(null);
  const [custom, setCustom] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const last = useRef<{
    readonly key: string;
    readonly commandId: string;
    readonly selection: GenreSelection;
  } | null>(null);

  // 수업 중 교사가 글 종류를 바꾸면(`room.settings`) 고르는 중인 화면에서도 바로 반영한다(PRD F-22 MUST, e2e 결함 3).
  const [liveGenres, setLiveGenres] = useState<readonly string[] | null>(null);
  useEffect(() => {
    if (!student) return;
    setLiveGenres(null);
    return student.channel.on('room.settings', d => setLiveGenres(d.settings.genres));
  }, [student]);
  const enabled = useMemo<GenreId[]>(
    () => (liveGenres ?? hello?.room.settings.genres ?? []).filter((g): g is GenreId => isGenreId(g)),
    [hello, liveGenres],
  );
  // 고른 종류가 꺼지면 선택을 푼다(꺼진 종류로 글을 만들지 않게).
  useEffect(() => {
    if (genre && !enabled.includes(genre)) {
      setGenre(null);
      setSubtype(null);
      setPurpose(null);
    }
  }, [enabled, genre]);

  const start = useCallback(
    async (selection: GenreSelection) => {
      if (!student || !entry || starting) return;
      const key = JSON.stringify(choiceOf(selection));
      if (last.current?.key !== key) last.current = { key, commandId: deps.newId(), selection };
      setStarting(true);
      setError(null);
      try {
        const docId = await createDoc(deps, student, entry, choiceOf(selection), last.current.commandId);
        const def = GENRE_CATALOG[selection.genre];
        await writeDocKind(deps.localStore.kv, docId, {
          genre: selection.genre,
          subtype: def.subtypes.length > 0 ? (selection.subtype ?? def.defaultSubtype) : null,
          purpose: def.purposes.length > 0 ? (selection.purpose ?? def.defaultPurpose) : null,
        });
        navigate(`../write/${docId}`, { replace: true });
      } catch (e) {
        setError(errorCodeOf(e));
      } finally {
        setStarting(false);
      }
    },
    [deps, entry, navigate, starting, student],
  );

  // 켠 종류가 하나(기타 문구 아님)면 고를 것이 없다: 바로 만든다(PRD F-05).
  const only = enabled.length === 1 ? enabled[0] : undefined;
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!only || only === 'other' || autoStarted.current || !student || consent.needed) return;
    autoStarted.current = true;
    void start({ genre: only, subtype: GENRE_CATALOG[only].defaultSubtype });
  }, [only, start, student, consent.needed]);

  if (flow.entry.status === 'loading') return <LoadingView />;
  if (!entry) return <Navigate replace to=".." />;
  if (channelState === 'gone') return <ClosedView kind="expired" onHome={() => navigate('/')} />;
  if (channelState === 'failed') {
    if (failure === 'E_AUTH') return <Navigate replace to=".." />;
    return (
      <ErrorStateView code={failure ?? 'E_INTERNAL'} onRetry={() => navigate('..', { replace: true })} />
    );
  }
  if (error) {
    const retry = last.current?.selection;
    return <ErrorStateView code={error} onRetry={retry ? () => void start(retry) : () => setError(null)} />;
  }
  if (!hello) {
    // 새 글은 연결이 있어야 만든다(쓰기는 기기에 저장되지만 글 만들기는 선생님 쪽이 정한다).
    if (connection === 'offline' || connection === 'server-down') {
      return <ErrorStateView code={connection === 'offline' ? 'E_OFFLINE' : 'E_SERVER_DOWN'} />;
    }
    return <LoadingView />;
  }
  // 정책 판이 바뀌었으면 새 글을 만들기 전에 다시 동의(검토 B03).
  if (consent.needed) return <ReconsentCard hello={hello} gate={consent} />;
  if (only && only !== 'other') return <LoadingView />;

  return (
    <GenreView
      enabledGenres={enabled}
      selectedGenre={genre}
      selectedSubtype={subtype}
      selectedPurpose={purpose}
      purposeCustom={custom}
      onSelectGenre={next => {
        setGenre(next);
        setSubtype(null);
        setPurpose(null);
      }}
      onSelectSubtype={setSubtype}
      onSelectPurpose={setPurpose}
      onPurposeCustomChange={setCustom}
      onStart={selection => void start(selection)}
      starting={starting}
    />
  );
}
