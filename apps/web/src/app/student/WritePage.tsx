import '../../adapters/editor/mirror.css';
import {
  computeRemainingSec,
  DOC_KEYS,
  GENRE_CATALOG,
  insertStructureBlock,
  MS_PER_SECOND,
  resolveGenreVariant,
  SONG_MOODS,
  SONG_TEMPOS,
  type GenreSelection,
  type SongMoodId,
  type SongTempoId,
  type StructureButtonId,
  type SubtypeId,
} from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import type { ErrorCode } from '@geulbang/core/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { bindKeyboardOffset } from '../../adapters/viewport/keyboardOffset.ts';
import { buildStudentExport, saveStudentTextFile } from '../../application/exportStudent.ts';
import { purgeRoomOnDevice, settleInvalidStudentToken } from '../../application/purgeLocal.ts';
import type { StudentRoomMemory } from '../../ports/deviceMemory.ts';
import type { HistoryState } from '../../ports/editor.ts';
import type { SyncedDoc } from '../../ports/realtime.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import type { WriteSaveState, WriteToast } from '../../ui/screens/student/write/types.ts';
import { WriteView } from '../../ui/screens/student/write/WriteView.tsx';
import { useAppDeps } from '../providers.tsx';
import { docKindOf, readDocKind, writeDocKind, type DocKind } from './docInfo.ts';
import { errorLineOf } from './errorCode.ts';
import { useAiPanel } from './hooks/useAiPanel.ts';
import { useConsentGate } from './hooks/useConsentGate.ts';
import { readMemos, readMeta, useDocContent, type DocMetaView } from './hooks/useDocContent.ts';
import { useEditorBinding } from './hooks/useEditorBinding.ts';
import { useFontSize } from './hooks/useFontSize.ts';
import { useNoticeSound } from './hooks/useNoticeSound.ts';
import { useNow } from './hooks/useNow.ts';
import { useObservable } from './hooks/useObservable.ts';
import { useRewind } from './hooks/useRewind.ts';
import { useRoomLive } from './hooks/useRoomLive.ts';
import { useStudentDoc } from './hooks/useStudentDoc.ts';
import { useStudentSession, type StudentConnection } from './hooks/useStudentSession.ts';
import { useSubmit } from './hooks/useSubmit.ts';
import { ReconsentCard } from './ReconsentCard.tsx';
import { useRoomFlow } from './RoomFlow.tsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 글 종류를 끝내 모를 때(기기에 기록이 없고 hello에도 없음): 도움 질문·구조 버튼이 없는 가장 넓은 종류 */
const FALLBACK_KIND: DocKind = { genre: 'other', subtype: null, purpose: null };

/**
 * `/:code/write/:docId` S5 쓰기 화면(PRD F-06~F-13, PLAN §6.7). 이 파일과 훅은 따로 나눈 묶음으로 불러온다.
 * 순서: 흐름 묶음의 연결 → 글 열기(기기 사본 먼저) → 글 종류(기기 기록 또는 hello) → 편집기 바인딩.
 */
export function WritePage() {
  const { docId = '' } = useParams();
  const flow = useRoomFlow();
  const navigate = useNavigate();
  if (!UUID.test(docId)) return <ClosedView kind="missingPage" onHome={() => navigate('/')} />;
  if (flow.entry.status === 'loading') return <LoadingView lines={8} />;
  const entry = flow.entry.entry;
  if (!entry) return <Navigate replace to=".." />;
  return <WriteScreen key={docId} entry={entry} docId={docId} />;
}

function WriteScreen({ entry, docId }: { readonly entry: StudentRoomMemory; readonly docId: string }) {
  const deps = useAppDeps();
  const flow = useRoomFlow();
  const navigate = useNavigate();
  const conn = useStudentSession(entry, flow.session);
  // 정책 판이 바뀌었으면 다시 동의 전에는 글 연결을 열지 않는다(기기 사본은 남고, 동의 뒤 연다, 검토 B03).
  const consent = useConsentGate(deps, conn.student, conn.hello);
  const { doc, error } = useStudentDoc(deps, consent.needed ? null : conn.student, entry, docId);
  const docFailure = useObservable(doc?.failure, null);
  const [stored, setStored] = useState<DocKind | null | undefined>(undefined);
  const { roomId } = entry;

  useEffect(() => {
    let alive = true;
    void readDocKind(deps.localStore.kv, docId).then(k => alive && setStored(k));
    return () => {
      alive = false;
    };
  }, [deps, docId]);

  const mine = conn.hello?.docs.find(d => d.docId === docId);
  const fromHello = mine ? docKindOf(mine) : null;
  useEffect(() => {
    if (fromHello) void writeDocKind(deps.localStore.kv, docId, fromHello);
  }, [deps, docId, fromHello?.genre, fromHello?.subtype, fromHello?.purpose]);

  // 이어 쓸 글로 기억한다(홈 카드·다시 들어오기가 이 글로 온다).
  useEffect(() => {
    void deps.memory.touchStudent(roomId, { lastDocId: docId, lastUsedAt: deps.now() }).catch(() => {});
  }, [deps, roomId, docId]);

  // 토큰이 무효(`E_AUTH`): 서버는 지워진 방의 토큰도 같은 `E_AUTH`로 답하므로 방 조회로 확인한다(PRD 16.6, 검토 B04).
  // - 끝난 방(404·만료) → 그 방 기기 사본까지 지우고 S1 자리에 닫힌 문.
  // - 그 밖(방이 살아 있음·확인 못 함) → 이 토큰만 잊고 S1을 새로 조회해 보인다.
  // 어느 쪽이든 흐름 묶음이 들고 있던 수업방 정보·동의 체크는 버린다(지워진 방의 카드가 다시 보이지 않게).
  const authFailed = conn.failure === 'E_AUTH' || docFailure === 'E_AUTH';
  const { dropSession, setEntry, resetRoom } = flow;
  useEffect(() => {
    if (!authFailed) return;
    void settleInvalidStudentToken(deps, entry)
      .catch(() => 'revoked' as const)
      .then(result => {
        dropSession();
        resetRoom(result === 'gone');
        setEntry(null);
        navigate('..', { replace: true });
      });
  }, [authFailed, deps, entry, dropSession, resetRoom, setEntry, navigate]);

  const offline = conn.connection === 'offline' || conn.connection === 'server-down';
  const kind: DocKind | null =
    fromHello ?? stored ?? (stored === null && (conn.hello || offline) ? FALLBACK_KIND : null);

  if (authFailed) return <LoadingView lines={8} />;
  if (consent.needed && conn.hello) return <ReconsentCard hello={conn.hello} gate={consent} />;
  const failure = error ?? docFailure;
  if (failure) return <ErrorStateView code={failure} onRetry={() => navigate('..', { replace: true })} />;
  if (!doc || !kind) return <LoadingView lines={8} />;
  return <WriteEditor entry={entry} docId={docId} doc={doc} kind={kind} conn={conn} />;
}

function songForAi(meta: DocMetaView): { readonly mood: string; readonly tempo: string } | undefined {
  if (!meta.mood || !meta.tempo) return undefined;
  const mood = meta.mood === 'custom' ? meta.moodCustom.trim() : ko.student[SONG_MOODS[meta.mood].labelKey];
  return mood ? { mood, tempo: ko.student[SONG_TEMPOS[meta.tempo].labelKey] } : undefined;
}

interface WriteEditorProps {
  readonly entry: StudentRoomMemory;
  readonly docId: string;
  readonly doc: SyncedDoc;
  readonly kind: DocKind;
  readonly conn: StudentConnection;
}

function WriteEditor({ entry, docId, doc, kind, conn }: WriteEditorProps) {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const { config } = deps;
  const channel = conn.student?.channel ?? null;
  const session = conn.student?.session ?? null;

  // ── 편집기(비제어 입력칸, PLAN §6.3) ──
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const refs = useMemo(() => ({ body: bodyRef, title: titleRef, mirror: mirrorRef }), []);
  const diagnostics = conn.hello?.config['IME_DIAGNOSTICS_ENABLED'] === true;
  const { binding, memoRef } = useEditorBinding(deps, doc, refs, diagnostics);
  const content = useDocContent(binding?.viewDoc ?? null, config.IME_IDLE_MS);

  const saveState = useObservable(doc.saveState, 'local');
  const locked = useObservable(doc.locked, false);
  const unsent = useObservable(doc.unsentWhileLocked, false);
  const rejected = useObservable(doc.rejected, null);
  const storageFailed = useObservable(doc.storageFailed, false);
  const now = useNow(deps.now);
  const serverNow = useCallback(() => (session ? session.serverNow() : deps.now()), [session, deps]);
  const [fontSize, setFontSize] = useFontSize(deps);
  const playSound = useNoticeSound();
  const [holding, setHolding] = useState(false);

  // ── 토스트 한 줄(한 번에 하나) ──
  const [toast, setToast] = useState<WriteToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryRef = useRef<(() => void) | null>(null);
  const showToast = useCallback((next: WriteToast, hideAfterMs: number | null, retry?: () => void) => {
    clearTimeout(toastTimer.current);
    retryRef.current = retry ?? null;
    setToast(next);
    if (hideAfterMs !== null) toastTimer.current = setTimeout(() => setToast(null), hideAfterMs);
  }, []);
  const hideToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    retryRef.current = null;
    setToast(null);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const toastMs = config.NOTICE_SHOW_SEC * MS_PER_SECOND;
  const showError = useCallback(
    (code: ErrorCode, retry?: () => void) => {
      const message = errorLineOf(code);
      if (message) showToast({ kind: 'error', message, retry: retry !== undefined }, null, retry);
    },
    [showToast],
  );

  // ── 수업방 채널 ──
  const teacherSeen = useRef(false);
  const live = useRoomLive(channel, conn.hello, docId, config, serverNow, {
    onNotice: n => {
      if (n.sound) playSound();
    },
    onTeacherEditing: () => {
      // 선생님 함께 고침 안내는 그 글에서 처음 1번만(PRD F-06).
      if (teacherSeen.current) return;
      teacherSeen.current = true;
      const key = `student.teacherEditingSeen.${docId}`;
      void deps.localStore.kv.get(key).then(
        seen => {
          if (seen === true) return;
          void deps.localStore.kv.set(key, true).catch(() => {});
          showToast({ kind: 'teacherEditing' }, toastMs);
        },
        () => showToast({ kind: 'teacherEditing' }, toastMs),
      );
    },
  });
  const roomClosed = live.roomStatus === 'CLOSED';
  const gone = conn.channelState === 'gone' || live.roomStatus === 'DELETED' || live.roomStatus === 'EXPIRED';

  // ── 제출 ──
  const submit = useSubmit({
    channel,
    doc,
    binding,
    locked,
    roomClosed,
    docStatus: live.docStatus,
    onError: code => showError(code),
  });
  const readOnly = roomClosed || locked || submit.lockForSubmit || submit.submission !== 'none';

  useEffect(() => {
    binding?.setReadOnly(readOnly);
  }, [binding, readOnly]);
  useEffect(() => (binding ? binding.onHoldChange(setHolding) : undefined), [binding]);
  const [history, setHistory] = useState<HistoryState>({ canUndo: false, canRedo: false });
  useEffect(() => {
    if (!binding) return undefined;
    setHistory(binding.historyState());
    return binding.onHistoryChange(setHistory);
  }, [binding]);
  useEffect(
    () => (binding ? binding.onLargeDelete(() => showToast({ kind: 'restore' }, toastMs)) : undefined),
    [binding, showToast, toastMs],
  );
  useEffect(() => {
    binding?.syncLayout();
  }, [binding, fontSize]);
  useEffect(() => bindKeyboardOffset(), []);
  useEffect(() => {
    // 끝난 방: 기억과 기기 사본을 함께 지운다(학생·교사 공통 정리, 검토 B04).
    if (gone) void purgeRoomOnDevice(deps, entry.roomId).catch(() => {});
  }, [gone, deps, entry.roomId]);

  // ── 글 종류(하위 종류는 문서 `meta`가 이긴다) ──
  const def = GENRE_CATALOG[kind.genre];
  const metaSubtype = content.meta.subtype;
  const subtype = (
    metaSubtype && def.subtypes.some(s => s.id === metaSubtype) ? metaSubtype : kind.subtype
  ) as SubtypeId | null;
  const selection: GenreSelection = {
    genre: kind.genre,
    subtype,
    purpose: kind.purpose,
    purposeCustom: content.meta.purposeCustom,
  };
  const variant = resolveGenreVariant(selection, config);

  // 분위기 직접 입력은 보통 입력칸(제어)이라 화면이 값을 쥐고, 문서에는 따로 적는다.
  const [moodDraft, setMoodDraft] = useState(content.meta.moodCustom);
  const lastMoodWrite = useRef<string | null>(null);
  useEffect(() => {
    if (content.meta.moodCustom !== lastMoodWrite.current) setMoodDraft(content.meta.moodCustom);
  }, [content.meta.moodCustom]);

  const setMeta = useCallback(
    (key: 'subtype' | 'mood' | 'moodCustom' | 'tempo', value: string) => {
      void binding?.applyAppEdit(d => d.getMap(DOC_KEYS.meta).set(key, value));
    },
    [binding],
  );

  // ── 글벗 ──
  const readNow = useCallback(() => {
    const vd = binding?.viewDoc;
    return vd
      ? {
          body: vd.getText(DOC_KEYS.body).toString(),
          title: vd.getText(DOC_KEYS.title).toString(),
          meta: readMeta(vd),
          memos: readMemos(vd),
        }
      : content;
  }, [binding, content]);

  const ai = useAiPanel({
    deps,
    roomId: entry.roomId,
    docId,
    binding,
    genre: selection,
    enabledButtons: live.settings?.aiButtons ?? [],
    connection: conn.connection,
    now,
    body: content.body,
    input: () => {
      const cur = readNow();
      return {
        body: cur.body,
        helpNotes: variant.questions.map(q => ({ questionId: q.id, note: cur.memos.get(q.id) ?? '' })),
        song: variant.hasSongChips ? songForAi(cur.meta) : undefined,
        currentBody: () => readNow().body,
      };
    },
    onStreamError: code => showError(code),
  });

  // ── 시간 되감기 ──
  const rewind = useRewind({ channel, docId, binding, connection: conn.connection, onError: showError });

  // ── 내보내기·복사(PRD F-12) ──
  const exported = () => {
    const cur = readNow();
    return buildStudentExport(
      {
        genre: kind.genre,
        subtype,
        purpose: kind.purpose,
        purposeCustom: cur.meta.purposeCustom,
        title: cur.title,
        body: cur.body,
        mood: cur.meta.mood,
        moodCustom: cur.meta.moodCustom,
        tempo: cur.meta.tempo,
      },
      { now: deps.now(), timeZone: config.TIMEZONE },
    );
  };
  const copy = (text: string) => {
    const clipboard = globalThis.navigator?.clipboard;
    const failed = () => showToast({ kind: 'error', message: ko.student.copyFailedToast }, toastMs);
    if (!clipboard) {
      failed();
      return;
    }
    clipboard.writeText(text).then(() => showToast({ kind: 'copied' }, toastMs), failed);
  };

  // ── 구조 버튼(PRD F-07): 커서 줄에 머리말만 넣고 커서를 그 뒤로 ──
  const onStructure = (id: StructureButtonId) => {
    if (!binding) return;
    let cursor: number | null = null;
    void binding
      .applyAppEdit(d => {
        const text = d.getText(DOC_KEYS.body);
        // 커서 위치는 읽기만 한다(바꾸는 것은 바인딩의 `select`).
        const at = bodyRef.current?.selectionEnd ?? text.length;
        const ins = insertStructureBlock(text.toString(), at, id);
        text.insert(ins.insertAt, ins.insertText);
        cursor = ins.nextCursor;
      })
      .then(() =>
        cursor !== null ? binding.select({ field: 'body', start: cursor, end: cursor }) : undefined,
      );
  };

  // ── 시트·카드 상태 ──
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpIndex, setHelpIndex] = useState(0);
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);

  if (gone) return <ClosedView kind="expired" onHome={() => navigate('/')} />;

  const timer =
    live.timer && live.timer.status !== 'IDLE'
      ? {
          remainingSeconds: computeRemainingSec(live.timer, serverNow()),
          paused: live.timer.status === 'PAUSED',
        }
      : null;
  const viewSave: WriteSaveState = saveState === 'locked' ? 'saved' : saveState;
  const alertMessage =
    storageFailed || deps.localStore.volatile
      ? ko.errors.E_STORAGE_BLOCKED
      : rejected
        ? errorLineOf(rejected)
        : null;

  return (
    <WriteView
      now={now}
      bodyRef={bodyRef}
      titleRef={titleRef}
      mirrorRef={mirrorRef}
      memoRef={memoRef}
      genre={kind.genre}
      subtype={subtype}
      purpose={variant.purpose}
      purposeCustom={content.meta.purposeCustom}
      onSubtypeChange={next => {
        setMeta('subtype', next);
        void writeDocKind(deps.localStore.kv, docId, { ...kind, subtype: next });
      }}
      fontSize={fontSize}
      saveState={viewSave}
      submission={submit.submission}
      roomClosed={roomClosed}
      offline={conn.connection === 'offline'}
      serverDown={conn.connection === 'server-down'}
      alertMessage={alertMessage}
      unsent={unsent}
      holding={holding}
      timer={timer}
      notice={live.notice?.text ?? null}
      toast={toast}
      stampVisible={submit.stampVisible}
      canUndo={history.canUndo && !readOnly}
      canRedo={history.canRedo && !readOnly}
      onUndo={() => binding?.undo()}
      onRedo={() => binding?.redo()}
      helpOpen={helpOpen}
      onHelpOpenChange={setHelpOpen}
      helpQuestions={variant.questions.map(q => ({ id: q.id, prompt: q.prompt }))}
      helpIndex={helpIndex}
      onHelpIndexChange={setHelpIndex}
      song={
        variant.hasSongChips
          ? { mood: content.meta.mood, moodCustom: moodDraft, tempo: content.meta.tempo }
          : undefined
      }
      onMoodChange={(mood: SongMoodId) => setMeta('mood', mood)}
      onMoodCustomChange={text => {
        const clean = text.replace(/[\r\n]+/g, ' ').slice(0, config.DOC_TITLE_MAX_CHARS);
        setMoodDraft(clean);
        lastMoodWrite.current = clean;
        setMeta('moodCustom', clean);
      }}
      onTempoChange={(tempo: SongTempoId) => setMeta('tempo', tempo)}
      structureButtons={variant.structureButtons}
      onStructure={onStructure}
      aiChips={ai.chips}
      // 닫힌 수업방은 읽기만: 새 요청을 보내지 않는다(화면은 칩·`다시 받기`를 막고, 서버도 `E_ROOM_CLOSED`로 거절).
      onAiChip={button => {
        if (!roomClosed) ai.onChip(button);
      }}
      panel={ai.panel}
      onPanelClose={ai.onClose}
      onPanelRefresh={() => {
        if (!roomClosed) ai.onRefresh();
      }}
      onSpellItem={ai.onSpellItem}
      onCopyPolish={() => copy(ai.polishText ?? '')}
      polishMineText={content.body}
      onBack={() => navigate('/')}
      onCopyDoc={() => copy(exported().text)}
      onSaveTxt={() => saveStudentTextFile(deps.download, exported())}
      onCopySunoLyrics={() => copy(exported().suno?.lyrics ?? '')}
      onCopySunoStyle={() => copy(exported().suno?.style ?? '')}
      onNewDoc={() => navigate('../genre')}
      fontSizeOpen={fontSizeOpen}
      onFontSizeOpenChange={setFontSizeOpen}
      onFontSizeChange={setFontSize}
      rewindOpen={rewind.open}
      onRewindOpenChange={rewind.setOpen}
      rewind={rewind.view}
      onRewindSelect={rewind.select}
      onRewindRestore={() => void rewind.restore()}
      submitOpen={submitOpen}
      onSubmitOpenChange={setSubmitOpen}
      onSubmitConfirm={() => {
        void submit.submit().finally(() => setSubmitOpen(false));
      }}
      submitting={submit.submitting}
      onCopyUnsent={() => copy(exported().text)}
      onRestoreDeleted={() => {
        binding?.undo();
        hideToast();
      }}
      onDismissToast={hideToast}
      onDismissNotice={live.dismissNotice}
      onRetryToast={() => {
        const retry = retryRef.current;
        hideToast();
        retry?.();
      }}
    />
  );
}
