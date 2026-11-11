import { koDev } from '@geulbang/core/copy/dev';
import { resolveGenreVariant, type GenreId, type StructureButtonId, type SubtypeId } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ClosedView } from '../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../ui/screens/common/ErrorState.tsx';
import { LoadingView } from '../ui/screens/common/Loading.tsx';
import { PrivacyView } from '../ui/screens/common/Privacy.tsx';
import { EntryCodeSheet, type EntryCodeStatus } from '../ui/screens/student/EntryCodeSheet.tsx';
import { GenreView, type GenreViewProps } from '../ui/screens/student/GenreView.tsx';
import { HomeView, type HomeRoomEntry } from '../ui/screens/student/HomeView.tsx';
import { NicknameView } from '../ui/screens/student/NicknameView.tsx';
import { ResumeWaitView } from '../ui/screens/student/ResumeWaitView.tsx';
import { RoomCardView } from '../ui/screens/student/RoomCardView.tsx';
import {
  spellKindFromLabel,
  type AiChipView,
  type AiChipViewState,
  type DirectionIdeaView,
  type HelpQuestionView,
  type ResultPanelView,
  type RewindView,
  type SpellItemView,
} from '../ui/screens/student/write/types.ts';
import { WriteView, type WriteViewProps } from '../ui/screens/student/write/WriteView.tsx';

/**
 * 개발 전용: 학생 화면 배치 견본(`/dev/screens/student`). 화면마다 상태별로 늘어놓는다(시각 검수·캡처용).
 * - `?group=entry|write|panels|common`: 묶음만 보기(전체 캡처가 너무 길어지지 않게)
 * - `?only=<견본 id>`: 그 견본 하나를 틀 없이 실제 화면처럼(시트는 진짜 시트로) 보기
 * 견본 틀은 `transform`이 있어 화면 안의 `position: fixed`(하단 바·제자리 시트)가 틀 안에 붙는다.
 */

const S = koDev.studentScreens;
const noop = () => {};
/** 2026-11-11 12:00(한국 시각) 고정: 캡처가 날마다 달라지지 않게 */
const NOW = Date.UTC(2026, 10, 11, 3, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Group = 'entry' | 'write' | 'panels' | 'common';
type FrameKind = 'screen' | 'write' | 'sheet';

interface SampleContext {
  /** 견본 틀 안이면 시트를 제자리에 그린다. `?only=`면 진짜 시트. */
  readonly inline: boolean;
}

interface Sample {
  readonly id: string;
  readonly group: Group;
  readonly label: string;
  readonly frame: FrameKind;
  readonly render: (ctx: SampleContext) => ReactNode;
}

// ── 견본 자료 ──────────────────────────────────────────────

const recentRooms: HomeRoomEntry[] = S.recentRooms.map((room, index) => ({
  roomId: `room-${index + 2}`,
  className: room.className,
  roomTitle: room.title,
  nickname: room.nickname,
  lastUsedAt: NOW - (index + 1) * DAY,
}));

const resumeRoom: HomeRoomEntry = {
  roomId: 'room-1',
  className: S.className,
  roomTitle: S.roomTitle,
  nickname: S.nickname,
  lastUsedAt: NOW - 25 * MIN,
};

function questionsFor(genre: GenreId, subtype: SubtypeId | null = null): HelpQuestionView[] {
  return resolveGenreVariant({ genre, subtype }).questions.map(q => ({ id: q.id, prompt: q.prompt }));
}

const BUTTONS = ['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'] as const;

function chips(state: AiChipViewState): AiChipView[] {
  return BUTTONS.map(button => ({ button, state }));
}

const spellItems: SpellItemView[] = S.spellItems.map((item, index) => ({
  id: `spell-${index}`,
  original: item.original,
  suggestion: item.suggestion,
  reason: item.reason,
  kind: spellKindFromLabel(item.kind),
  locatable: index !== S.spellItems.length - 1,
}));

const directionIdeas: DirectionIdeaView[] = S.directionIdeas.map(idea => ({
  text: idea.text,
  label: 'label' in idea ? idea.label : undefined,
}));

const bodyLines = S.docBody.split('\n');

const rewindReady: RewindView = {
  status: 'ready',
  selectedIndex: 1,
  snapshots: [
    { id: 'snap-1', at: NOW - 42 * MIN, reason: 'AUTO', title: '', body: bodyLines.slice(0, 2).join('\n') },
    {
      id: 'snap-2',
      at: NOW - 18 * MIN,
      reason: 'AI',
      title: S.docTitle,
      body: bodyLines.slice(0, 4).join('\n'),
    },
    {
      id: 'snap-3',
      at: NOW - 6 * MIN,
      reason: 'TEACHER',
      title: S.docTitle,
      body: bodyLines.slice(0, 6).join('\n'),
    },
    { id: 'snap-4', at: NOW - 40_000, reason: 'SUBMIT', title: S.docTitle, body: S.docBody },
  ],
};

const panels = {
  spell: {
    button: 'SPELL',
    status: 'ready',
    receivedAt: NOW - 3 * MIN,
    content: { kind: 'SPELL', items: spellItems, activeItemId: 'spell-1' },
  },
  spellEmpty: {
    button: 'SPELL',
    status: 'ready',
    receivedAt: NOW - 10_000,
    content: { kind: 'SPELL', items: [] },
  },
  feedback: {
    button: 'FEEDBACK',
    status: 'ready',
    receivedAt: NOW - 8 * MIN,
    stale: true,
    content: {
      kind: 'FEEDBACK',
      result: {
        praise: S.feedbackPraise,
        improve: S.feedbackImprove,
        factCheck: S.feedbackFactCheck,
        eraNote: S.feedbackEraNote,
        softenNote: S.feedbackSoftenNote,
      },
    },
  },
  direction: {
    button: 'DIRECTION',
    status: 'ready',
    receivedAt: NOW - 30_000,
    tailOnly: true,
    content: { kind: 'DIRECTION', ideas: directionIdeas },
  },
  polishStream: {
    button: 'POLISH',
    status: 'ready',
    content: {
      kind: 'POLISH',
      text: S.polishText.slice(0, Math.floor(S.polishText.length * 0.45)),
      done: false,
    },
  },
  polishDone: {
    button: 'POLISH',
    status: 'ready',
    receivedAt: NOW - 20_000,
    refreshCooldownSeconds: 6,
    content: { kind: 'POLISH', text: S.polishText, done: true, lengthWarning: true, truncated: true },
  },
  loading: { button: 'FEEDBACK', status: 'loading' },
  error: { button: 'DIRECTION', status: 'error', errorCode: 'E_AI_TIMEOUT' },
  refused: { button: 'FEEDBACK', status: 'error', errorCode: 'E_AI_REFUSED' },
  limit: { button: 'SPELL', status: 'limit' },
} satisfies Record<string, ResultPanelView>;

// ── 쓰기 화면 견본 ────────────────────────────────────────

type WriteSampleProps = Partial<
  Omit<WriteViewProps, 'bodyRef' | 'titleRef' | 'mirrorRef' | 'memoRef' | 'sheetsInline'>
> & {
  readonly ctx: SampleContext;
  readonly sampleTitle?: string;
  readonly sampleBody?: string;
  readonly sampleMemo?: string;
};

/** 결합 전이라 바인딩 대신 견본 글을 처음 한 번만 입력칸에 넣는다(개발 화면만, 화면 부품은 값을 만지지 않는다). */
function useSampleField<T extends HTMLInputElement | HTMLTextAreaElement>(text: string | undefined) {
  return useCallback(
    (el: T | null) => {
      if (!el || el.dataset['sampled'] === 'true') return;
      el.dataset['sampled'] = 'true';
      if (text) el.value = text;
    },
    [text],
  );
}

function WriteSample({ ctx, sampleTitle, sampleBody, sampleMemo, ...overrides }: WriteSampleProps) {
  const bodyRef = useSampleField<HTMLTextAreaElement>(sampleBody);
  const titleRef = useSampleField<HTMLInputElement>(sampleTitle);
  const mirrorRef = useCallback((_el: HTMLDivElement | null) => {}, []);
  const memoRef = useCallback(
    (_id: string, el: HTMLTextAreaElement | null) => {
      if (el && sampleMemo && el.dataset['sampled'] !== 'true') {
        el.dataset['sampled'] = 'true';
        el.value = sampleMemo;
      }
    },
    [sampleMemo],
  );

  const genre = overrides.genre ?? 'news';
  const subtype = overrides.subtype === undefined ? 'newspaper' : overrides.subtype;

  const props: WriteViewProps = {
    now: NOW,
    genre,
    subtype,
    fontSize: 18,
    saveState: 'saved',
    submission: 'none',
    canUndo: true,
    canRedo: false,
    onUndo: noop,
    onRedo: noop,
    helpOpen: false,
    onHelpOpenChange: noop,
    helpQuestions: questionsFor(genre, subtype),
    helpIndex: 0,
    onHelpIndexChange: noop,
    structureButtons: resolveGenreVariant({ genre, subtype }).structureButtons,
    onStructure: noop,
    aiChips: chips('idle'),
    onAiChip: noop,
    panel: null,
    onPanelClose: noop,
    onPanelRefresh: noop,
    onSpellItem: noop,
    onCopyPolish: noop,
    polishMineText: sampleBody,
    onBack: noop,
    onCopyDoc: noop,
    onSaveTxt: noop,
    onSubtypeChange: noop,
    onCopySunoLyrics: noop,
    onCopySunoStyle: noop,
    fontSizeOpen: false,
    onFontSizeOpenChange: noop,
    onFontSizeChange: noop,
    rewindOpen: false,
    onRewindOpenChange: noop,
    rewind: rewindReady,
    onRewindSelect: noop,
    onRewindRestore: noop,
    submitOpen: false,
    onSubmitOpenChange: noop,
    onSubmitConfirm: noop,
    onCopyUnsent: noop,
    onRestoreDeleted: noop,
    onDismissToast: noop,
    onDismissNotice: noop,
    ...overrides,
    bodyRef,
    titleRef,
    mirrorRef,
    memoRef,
    sheetsInline: ctx.inline,
  };

  return <WriteView {...props} />;
}

/** 눌러 볼 수 있는 쓰기 화면: 칩·메뉴·제출이 견본 자료로 움직인다. */
function LiveWriteSample({ ctx }: { readonly ctx: SampleContext }) {
  const [panelButton, setPanelButton] = useState<(typeof BUTTONS)[number] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpIndex, setHelpIndex] = useState(0);
  const [fontSize, setFontSize] = useState(18);
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [rewindOpen, setRewindOpen] = useState(false);
  const [rewindIndex, setRewindIndex] = useState(rewindReady.snapshots.length - 1);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [stamp, setStamp] = useState(false);
  const [subtype, setSubtype] = useState<SubtypeId>('newspaper');
  const [activeSpell, setActiveSpell] = useState<string | null>(null);

  const panel: ResultPanelView | null =
    panelButton === 'SPELL'
      ? { ...panels.spell, content: { kind: 'SPELL', items: spellItems, activeItemId: activeSpell } }
      : panelButton === 'FEEDBACK'
        ? panels.feedback
        : panelButton === 'DIRECTION'
          ? panels.direction
          : panelButton === 'POLISH'
            ? panels.polishDone
            : null;

  return (
    <WriteSample
      ctx={ctx}
      sampleTitle={S.docTitle}
      sampleBody={S.docBody}
      sampleMemo={S.memoNote}
      subtype={subtype}
      onSubtypeChange={setSubtype}
      fontSize={fontSize}
      aiChips={BUTTONS.map(button => ({
        button,
        state: panelButton === button ? 'fresh' : 'idle',
      }))}
      onAiChip={button => setPanelButton(prev => (prev === button ? null : button))}
      panel={panel}
      onPanelClose={() => setPanelButton(null)}
      onSpellItem={setActiveSpell}
      helpOpen={helpOpen}
      onHelpOpenChange={setHelpOpen}
      helpIndex={helpIndex}
      onHelpIndexChange={setHelpIndex}
      fontSizeOpen={fontSizeOpen}
      onFontSizeOpenChange={setFontSizeOpen}
      onFontSizeChange={setFontSize}
      rewindOpen={rewindOpen}
      onRewindOpenChange={setRewindOpen}
      rewind={{ ...rewindReady, selectedIndex: rewindIndex }}
      onRewindSelect={setRewindIndex}
      onRewindRestore={() => setRewindOpen(false)}
      submitOpen={submitOpen}
      onSubmitOpenChange={setSubmitOpen}
      onSubmitConfirm={() => {
        setSubmitOpen(false);
        setSubmitted(true);
        setStamp(true);
        window.setTimeout(() => setStamp(false), 1000);
      }}
      submission={submitted ? 'submitted' : 'none'}
      saveState={submitted ? 'saved' : 'sending'}
      stampVisible={stamp}
    />
  );
}

// ── 입장 흐름 견본 ────────────────────────────────────────

function CodeSample({
  ctx,
  code,
  status = 'idle',
}: {
  readonly ctx: SampleContext;
  readonly code: string;
  readonly status?: EntryCodeStatus;
}) {
  const [value, setValue] = useState(code);
  const [open, setOpen] = useState(true);
  return (
    <>
      <HomeView
        now={NOW}
        onStartWrite={() => setOpen(true)}
        onResume={noop}
        onOpenRecent={noop}
        onTeacher={noop}
        onPrivacy={noop}
      />
      <EntryCodeSheet
        open={open}
        onOpenChange={setOpen}
        code={value}
        onCodeChange={setValue}
        onComplete={noop}
        status={status}
        errorMessage={status === 'error' ? ko.errors.E_ROOM_NOT_FOUND : undefined}
        onSolo={noop}
        onPasteRequest={noop}
        inline={ctx.inline}
      />
    </>
  );
}

function RoomCardSample({
  initialAgreed,
  school,
}: {
  readonly initialAgreed: boolean;
  readonly school: boolean;
}) {
  const [agreed, setAgreed] = useState(initialAgreed);
  return (
    <RoomCardView
      className={S.className}
      roomTitle={S.roomTitle}
      schoolName={school ? S.schoolName : null}
      expiresAt={NOW + 30 * DAY}
      agreed={agreed}
      onAgreedChange={setAgreed}
      onStart={noop}
      onLearnMore={noop}
    />
  );
}

function NicknameSample({
  initial,
  taken = false,
  error,
}: {
  readonly initial: string;
  readonly taken?: boolean;
  readonly error?: string;
}) {
  const [nickname, setNickname] = useState(initial);
  const [isTaken, setTaken] = useState(taken);
  return (
    <NicknameView
      roomLabel={`${S.className} · ${S.roomTitle}`}
      nickname={nickname}
      onNicknameChange={next => {
        setNickname(next);
        setTaken(false);
      }}
      onNext={noop}
      taken={isTaken}
      onClaimMine={noop}
      errorMessage={error}
    />
  );
}

function GenreSample(
  initial: Partial<
    Pick<
      GenreViewProps,
      'enabledGenres' | 'selectedGenre' | 'selectedSubtype' | 'selectedPurpose' | 'purposeCustom'
    >
  >,
) {
  const [genre, setGenre] = useState(initial.selectedGenre ?? null);
  const [subtype, setSubtype] = useState(initial.selectedSubtype ?? null);
  const [purpose, setPurpose] = useState(initial.selectedPurpose ?? null);
  const [custom, setCustom] = useState(initial.purposeCustom ?? '');
  return (
    <GenreView
      enabledGenres={initial.enabledGenres ?? ['story', 'poem', 'lyrics', 'news', 'essay', 'other']}
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
      onStart={noop}
    />
  );
}

// ── 견본 목록 ────────────────────────────────────────────

const lyricsStructure: StructureButtonId[] = ['verse1', 'chorus', 'verse2', 'bridge'];

const SAMPLES: readonly Sample[] = [
  // S0 홈
  {
    id: 'home-empty',
    group: 'entry',
    label: 'S0 home / first visit',
    frame: 'screen',
    render: () => (
      <HomeView
        now={NOW}
        onStartWrite={noop}
        onResume={noop}
        onOpenRecent={noop}
        onTeacher={noop}
        onPrivacy={noop}
      />
    ),
  },
  {
    id: 'home-resume',
    group: 'entry',
    label: 'S0 home / resume card (primary) + recent rooms + add-to-home',
    frame: 'screen',
    render: () => (
      <HomeView
        now={NOW}
        resume={resumeRoom}
        recentRooms={recentRooms}
        showAddToHome
        onDismissAddToHome={noop}
        onStartWrite={noop}
        onResume={noop}
        onOpenRecent={noop}
        onTeacher={noop}
        onPrivacy={noop}
      />
    ),
  },
  // 코드 시트
  {
    id: 'code-empty',
    group: 'entry',
    label: 'code sheet / empty + solo + paste',
    frame: 'sheet',
    render: ctx => <CodeSample ctx={ctx} code="" />,
  },
  {
    id: 'code-typing',
    group: 'entry',
    label: 'code sheet / 4 digits',
    frame: 'sheet',
    render: ctx => <CodeSample ctx={ctx} code="4829" />,
  },
  {
    id: 'code-checking',
    group: 'entry',
    label: 'code sheet / checking',
    frame: 'sheet',
    render: ctx => <CodeSample ctx={ctx} code="482913" status="checking" />,
  },
  {
    id: 'code-error',
    group: 'entry',
    label: 'code sheet / not found',
    frame: 'sheet',
    render: ctx => <CodeSample ctx={ctx} code="482913" status="error" />,
  },
  // S1
  {
    id: 'room-card',
    group: 'entry',
    label: 'S1 room card + consent / school shown, unchecked',
    frame: 'screen',
    render: () => <RoomCardSample initialAgreed={false} school />,
  },
  {
    id: 'room-card-agreed',
    group: 'entry',
    label: 'S1 room card / school hidden, checked',
    frame: 'screen',
    render: () => <RoomCardSample initialAgreed school={false} />,
  },
  // S3
  {
    id: 'nickname-empty',
    group: 'entry',
    label: 'S3 nickname / empty',
    frame: 'screen',
    render: () => <NicknameSample initial="" />,
  },
  {
    id: 'nickname-taken',
    group: 'entry',
    label: 'S3 nickname / taken',
    frame: 'screen',
    render: () => <NicknameSample initial={S.nickname} taken />,
  },
  {
    id: 'nickname-invalid',
    group: 'entry',
    label: 'S3 nickname / invalid',
    frame: 'screen',
    render: () => <NicknameSample initial={S.nicknameInvalid} error={ko.errors.E_NICK_INVALID} />,
  },
  // S4
  {
    id: 'genre-none',
    group: 'entry',
    label: 'S4 genre / 6 tiles',
    frame: 'screen',
    render: () => <GenreSample />,
  },
  {
    id: 'genre-story',
    group: 'entry',
    label: 'S4 genre / story subtypes',
    frame: 'screen',
    render: () => <GenreSample selectedGenre="story" selectedSubtype="fairy-tale" />,
  },
  {
    id: 'genre-other-custom',
    group: 'entry',
    label: 'S4 genre / other purposes + custom',
    frame: 'screen',
    render: () => (
      <GenreSample selectedGenre="other" selectedPurpose="custom" purposeCustom={S.purposeCustom} />
    ),
  },
  {
    id: 'genre-only-other',
    group: 'entry',
    label: 'S4 genre / only other enabled',
    frame: 'screen',
    render: () => <GenreSample enabledGenres={['other']} />,
  },
  {
    id: 'genre-three',
    group: 'entry',
    label: 'S4 genre / 3 tiles enabled',
    frame: 'screen',
    render: () => <GenreSample enabledGenres={['poem', 'lyrics', 'news']} />,
  },
  // S6
  {
    id: 'resume-wait',
    group: 'entry',
    label: 'S6 resume wait',
    frame: 'screen',
    render: () => <ResumeWaitView status="waiting" onCancel={noop} onChooseOther={noop} />,
  },
  {
    id: 'resume-wait-long',
    group: 'entry',
    label: 'S6 resume wait / 30 min',
    frame: 'screen',
    render: () => <ResumeWaitView status="waiting" longWait onCancel={noop} onChooseOther={noop} />,
  },
  {
    id: 'resume-rejected',
    group: 'entry',
    label: 'S6 resume / rejected',
    frame: 'screen',
    render: () => <ResumeWaitView status="rejected" onCancel={noop} onChooseOther={noop} />,
  },

  // S5 쓰기
  {
    id: 'write-live',
    group: 'write',
    label: 'S5 write / interactive (chips, menu, submit)',
    frame: 'write',
    render: ctx => <LiveWriteSample ctx={ctx} />,
  },
  {
    id: 'write-empty',
    group: 'write',
    label: 'S5 write / empty, chips replaced by guide',
    frame: 'write',
    render: ctx => <WriteSample ctx={ctx} aiChips={chips('guide')} canUndo={false} />,
  },
  {
    id: 'write-news',
    group: 'write',
    label: 'S5 write / news, help card + memo, timer',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleTitle={S.docTitle}
        sampleBody={S.docBody}
        sampleMemo={S.memoNote}
        helpOpen
        timer={{ remainingSeconds: 492 }}
        saveState="sending"
        aiChips={[
          { button: 'SPELL', state: 'fresh' },
          { button: 'FEEDBACK', state: 'idle' },
          { button: 'DIRECTION', state: 'idle' },
          { button: 'POLISH', state: 'hidden' },
        ]}
      />
    ),
  },
  {
    id: 'write-lyrics',
    group: 'write',
    label: 'S5 write / lyrics, mood+tempo card, structure buttons',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        genre="lyrics"
        subtype={null}
        sampleTitle={S.lyricsTitle}
        sampleBody={S.lyricsBody}
        helpOpen
        song={{ mood: 'custom', moodCustom: S.moodCustom, tempo: 'medium' }}
        structureButtons={lyricsStructure}
      />
    ),
  },
  {
    id: 'write-long',
    group: 'write',
    label: 'S5 write / long story chapter, font 24, chip states mixed',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        genre="story"
        subtype="long"
        sampleTitle={koDev.longSampleTitle}
        sampleBody={koDev.longSampleBody}
        fontSize={24}
        canRedo
        aiChips={[
          { button: 'SPELL', state: 'stale' },
          { button: 'FEEDBACK', state: 'cooldown', cooldownSeconds: 7 },
          { button: 'DIRECTION', state: 'loading' },
          { button: 'POLISH', state: 'fresh' },
        ]}
      />
    ),
  },
  {
    id: 'write-offline',
    group: 'write',
    label: 'S5 write / offline',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleTitle={S.docTitle}
        sampleBody={S.docBody}
        offline
        saveState="local"
        aiChips={chips('offline')}
      />
    ),
  },
  {
    id: 'write-limit',
    group: 'write',
    label: 'S5 write / daily AI limit',
    frame: 'write',
    render: ctx => (
      <WriteSample ctx={ctx} sampleTitle={S.docTitle} sampleBody={S.docBody} aiChips={chips('limit')} />
    ),
  },
  {
    id: 'write-closed',
    group: 'write',
    label: 'S5 write / room closed (read only)',
    frame: 'write',
    render: ctx => (
      <WriteSample ctx={ctx} sampleTitle={S.docTitle} sampleBody={S.docBody} roomClosed canUndo={false} />
    ),
  },
  {
    id: 'write-submitted',
    group: 'write',
    label: 'S5 write / submitted + unsent changes',
    frame: 'write',
    render: ctx => (
      <WriteSample ctx={ctx} sampleTitle={S.docTitle} sampleBody={S.docBody} submission="submitted" unsent />
    ),
  },
  {
    id: 'write-pending',
    group: 'write',
    label: 'S5 write / submitted offline (pending)',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleTitle={S.docTitle}
        sampleBody={S.docBody}
        submission="pending"
        offline
        saveState="local"
        aiChips={chips('offline')}
      />
    ),
  },
  {
    id: 'write-overlays',
    group: 'write',
    label: 'S5 write / hold pill + teacher notice + restore toast + urgent timer',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleTitle={S.docTitle}
        sampleBody={S.docBody}
        holding
        notice={ko.teacher.noticePreset5Min}
        toast={{ kind: 'restore' }}
        timer={{ remainingSeconds: 45 }}
      />
    ),
  },
  {
    id: 'write-teacher-toast',
    group: 'write',
    label: 'S5 write / teacher editing toast, paused timer',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleTitle={S.docTitle}
        sampleBody={S.docBody}
        toast={{ kind: 'teacherEditing' }}
        timer={{ remainingSeconds: 300, paused: true }}
      />
    ),
  },
  {
    id: 'write-stamp',
    group: 'write',
    label: 'S5 write / submit stamp moment',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleTitle={S.docTitle}
        sampleBody={S.docBody}
        submission="submitted"
        stampVisible
      />
    ),
  },

  // 결과 패널·시트
  ...(
    [
      ['panel-spell', 'SPELL ready (active item, 1 unlocated)', panels.spell],
      ['panel-spell-empty', 'SPELL nothing to fix', panels.spellEmpty],
      ['panel-feedback', 'FEEDBACK all fields, text changed', panels.feedback],
      ['panel-direction', 'DIRECTION ideas + tail-only notice', panels.direction],
      ['panel-polish-stream', 'POLISH streaming', panels.polishStream],
      ['panel-polish-done', 'POLISH done + length warning + truncated + cooldown', panels.polishDone],
      ['panel-loading', 'loading (reading gulbeot)', panels.loading],
      ['panel-error', 'error: timeout', panels.error],
      ['panel-refused', 'error: refused', panels.refused],
      ['panel-limit', 'daily limit (resting gulbeot)', panels.limit],
    ] as const
  ).map(([id, label, view]): Sample => ({
    id,
    group: 'panels',
    label: `result panel / ${label}`,
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleTitle={S.docTitle}
        sampleBody={S.docBody}
        panel={view}
        aiChips={BUTTONS.map(button => ({
          button,
          state: view.button === button ? (view.status === 'loading' ? 'loading' : 'fresh') : 'idle',
        }))}
      />
    ),
  })),
  {
    id: 'sheet-rewind',
    group: 'panels',
    label: 'rewind sheet / ready',
    frame: 'write',
    render: ctx => <WriteSample ctx={ctx} sampleTitle={S.docTitle} sampleBody={S.docBody} rewindOpen />,
  },
  {
    id: 'sheet-rewind-offline',
    group: 'panels',
    label: 'rewind sheet / offline',
    frame: 'write',
    render: ctx => (
      <WriteSample
        ctx={ctx}
        sampleBody={S.docBody}
        offline
        saveState="local"
        rewindOpen
        rewind={{ status: 'offline', snapshots: [], selectedIndex: 0 }}
      />
    ),
  },
  {
    id: 'sheet-rewind-empty',
    group: 'panels',
    label: 'rewind sheet / empty',
    frame: 'write',
    render: ctx => (
      <WriteSample ctx={ctx} rewindOpen rewind={{ status: 'empty', snapshots: [], selectedIndex: 0 }} />
    ),
  },
  {
    id: 'sheet-submit',
    group: 'panels',
    label: 'submit confirm sheet',
    frame: 'write',
    render: ctx => <WriteSample ctx={ctx} sampleTitle={S.docTitle} sampleBody={S.docBody} submitOpen />,
  },
  {
    id: 'sheet-font',
    group: 'panels',
    label: 'font size sheet (21)',
    frame: 'write',
    render: ctx => (
      <WriteSample ctx={ctx} sampleTitle={S.docTitle} sampleBody={S.docBody} fontSize={21} fontSizeOpen />
    ),
  },

  // 공통 상태
  {
    id: 'loading',
    group: 'common',
    label: 'loading',
    frame: 'screen',
    render: () => <LoadingView showLabelImmediately />,
  },
  {
    id: 'error',
    group: 'common',
    label: 'error + retry',
    frame: 'screen',
    render: () => <ErrorStateView code="E_INTERNAL" onRetry={noop} />,
  },
  {
    id: 'closed-expired',
    group: 'common',
    label: 'expired / missing room',
    frame: 'screen',
    render: () => <ClosedView kind="expired" onHome={noop} />,
  },
  {
    id: 'closed-missing-page',
    group: 'common',
    label: 'missing page',
    frame: 'screen',
    render: () => <ClosedView kind="missingPage" onHome={noop} />,
  },
  {
    id: 'privacy',
    group: 'common',
    label: 'privacy (title + body slot)',
    frame: 'screen',
    render: () => (
      <PrivacyView onBack={noop}>
        <p>{S.privacyPlaceholder}</p>
      </PrivacyView>
    ),
  },
];

const GROUPS: readonly Group[] = ['entry', 'write', 'panels', 'common'];

const FRAME_HEIGHT: Record<FrameKind, number | null> = { screen: null, write: 720, sheet: 680 };

function Frame({ sample }: { readonly sample: Sample }) {
  const height = FRAME_HEIGHT[sample.frame];
  const frameStyle = {
    position: 'relative',
    transform: 'translateZ(0)',
    overflow: height ? 'auto' : 'visible',
    height: height ? `${height}px` : undefined,
    border: 'var(--stroke-thin) solid var(--line)',
    borderRadius: 'var(--r-sm)',
    background: 'var(--bg)',
    '--screen-min-h': height ? `${height}px` : 'auto',
    '--screen-h': height ? `${height}px` : undefined,
  } as CSSProperties;

  return (
    <section style={{ display: 'grid', gap: 'var(--sp-2)' }} data-sample={sample.id}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-body)' }}>{sample.label}</h2>
        <Link to={`?only=${sample.id}`} style={{ color: 'var(--sky-ink)', fontSize: 'var(--fs-small)' }}>
          {sample.id}
        </Link>
      </header>
      <div style={frameStyle}>{sample.render({ inline: true })}</div>
    </section>
  );
}

export function DevScreensStudent() {
  const [params] = useSearchParams();
  const only = params.get('only');
  const groupParam = params.get('group');
  const group = GROUPS.find(g => g === groupParam) ?? null;

  if (only) {
    const sample = SAMPLES.find(s => s.id === only);
    if (sample) return <>{sample.render({ inline: false })}</>;
  }

  const visible = group ? SAMPLES.filter(s => s.group === group) : SAMPLES;

  return (
    <main style={{ display: 'grid', gap: 'var(--sp-8)', padding: 'var(--sp-4)' }}>
      <nav style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', fontSize: 'var(--fs-small)' }}>
        <Link to="?">all ({SAMPLES.length})</Link>
        {GROUPS.map(g => (
          <Link key={g} to={`?group=${g}`}>
            {g} ({SAMPLES.filter(s => s.group === g).length})
          </Link>
        ))}
      </nav>
      {visible.map(sample => (
        <Frame key={sample.id} sample={sample} />
      ))}
    </main>
  );
}
