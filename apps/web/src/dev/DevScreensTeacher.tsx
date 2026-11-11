import { koDev } from '@geulbang/core/copy/dev';
import {
  defaultConfig,
  GENRE_IDS,
  MS_PER_DAY,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  type GenreId,
} from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Toast } from '../ui/components/Toast.tsx';
import type { StudentStatusKind } from '../ui/components/StatusBadge.tsx';
import {
  ClosedBand,
  CreateRoomView,
  DashboardTimer,
  DashboardView,
  DeleteRoomPanelView,
  DeleteRoomSheet,
  DevicesPanelView,
  DevicesSheet,
  docKindLabel,
  ExpiryBand,
  ExportPanelView,
  ExportSheet,
  initialTimerDraft,
  NoticePanelView,
  OfflineBand,
  PinEntryView,
  QrFullscreenView,
  ResumeRequestsBand,
  RewindPanelView,
  RewindSheet,
  RoomPrepView,
  RoomSettingsPanelView,
  RoomSettingsSheet,
  sortTilesByNickname,
  StudentDrawerView,
  TeacherHomeView,
  TeacherLinkQrView,
  TeacherRegisterView,
  type ConnectionCheckModel,
  type CreateRoomCodeField,
  type CreateRoomErrors,
  type CreateRoomValues,
  type DashboardFilter,
  type DrawerMemo,
  type ResumeRequestItem,
  type RewindItem,
  type RoomSettingsValues,
  type StudentTileModel,
  type TeacherRegisterState,
  type TimerDraft,
  type TimerModel,
} from '../ui/screens/teacher/index.ts';

/**
 * 개발 전용: 교사 화면 배치 견본(`/dev/screens/teacher`). 화면마다 상태별로 늘어놓는다(시각 검수·캡처용).
 * `?s=<id>`를 붙이면 그 견본 하나만 실제 화면처럼 꽉 채워 그린다(폭별 캡처용).
 *
 * 견본 글자: 화면 파일에는 한국어를 직접 쓸 수 없어 `ko.dev`에서 가져온다. 아직 `ko.dev`에 없는
 * 견본 키(`teacherSample*`)는 있으면 그 값을, 없으면 로마자 대체값을 쓴다(키가 생기면 코드 수정 없이 바뀐다).
 */

const devCopy = koDev as unknown as Readonly<Record<string, unknown>>;

function devText(key: string, fallback: string): string {
  const v = devCopy[key];
  return typeof v === 'string' ? v : fallback;
}

function devList(key: string, fallback: readonly string[]): readonly string[] {
  const v = devCopy[key];
  return Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as string[]) : fallback;
}

/** 견본 기준 시각: 2026-11-11 10:40:12(한국 시각). */
const NOW = Date.UTC(2026, 10, 11, 1, 40, 12);
const EXPIRES_AT = NOW + defaultConfig.ROOM_TTL_DAYS * MS_PER_DAY;
const EXPIRES_SOON = NOW + 2 * MS_PER_DAY;
/** 지금 삭제 단추가 켜지기까지(PRD F-22 "3초 뒤"). 설정 표에 키가 없어 견본에서 넘긴다. */
const DELETE_DELAY_SEC = 3;

const ROOM_TITLE = devText('teacherSampleRoomTitle', koDev.galleryFieldReadOnlyValue);
const CLASS_NAME = devText('teacherSampleClassName', '5-3');
const ENTRY_CODE = '482913';
const SHORT_URL = `${new URL(defaultConfig.PUBLIC_ORIGIN).host}/${ENTRY_CODE}`;
const ENTRY_URL = `${defaultConfig.PUBLIC_ORIGIN}/${ENTRY_CODE}`;
const TEACHER_LINK = `${defaultConfig.PUBLIC_ORIGIN}/t/dev-sample-teacher-link-token-0000000000000000`;

const NICKNAMES = devList('teacherSampleNicknames', [
  'Haneul',
  'Byeolbit',
  'Somsatang',
  'Bada',
  'Choco',
  'Dalbit',
  'Gureum',
  'Narae',
  'Saebom',
  'Iseul',
  'Haessal',
  'Doldol',
  'Mintcho',
  'Podo',
  'Ttokki',
  'Garam',
  'Sora',
  'Bomnal',
  'Yeoreum',
  'Gaeul',
  'Gyeoul',
  'Namu',
  'Kkotbi',
  'Baram',
  'Nuri',
  'Hana',
  'Dure',
  'Seri',
  'Maru',
  'Jandi',
]);

const STATUS_CYCLE: readonly StudentStatusKind[] = [
  'writing',
  'writing',
  'writing-flow',
  'idle',
  'submitted',
  'writing',
  'offline',
  'writing-flow',
  'submitted',
  'writing',
];

function sampleTiles(count: number): StudentTileModel[] {
  const tiles = Array.from({ length: count }, (_, i): StudentTileModel => {
    const status = STATUS_CYCLE[i % STATUS_CYCLE.length] ?? 'writing';
    const genre: GenreId = GENRE_IDS[i % GENRE_IDS.length] ?? 'story';
    const noDoc = i === count - 1 && count > 5;
    const secondsAgo =
      status === 'writing' ? 2 + ((i * 7) % 25) : status === 'writing-flow' ? 45 + i * 3 : 200 + i * 20;
    return {
      participantId: `p-${String(i).padStart(2, '0')}`,
      docId: noDoc ? null : `d-${i}`,
      nickname: NICKNAMES[i % NICKNAMES.length] ?? `S${i}`,
      status: noDoc ? 'idle' : status,
      genreLabel: noDoc ? '' : docKindLabel(genre, genre === 'other' ? 'poster' : null),
      chars: noDoc ? 0 : (i * 53 + 17) % 480,
      lastInputAt: noDoc ? null : NOW - secondsAgo * MS_PER_SECOND,
      submittedAt: status === 'submitted' ? NOW - (9 + i) * MS_PER_MINUTE : null,
    };
  });
  return sortTilesByNickname(tiles);
}

const TILES_30 = sampleTiles(30);
const TILES_8 = sampleTiles(8);

function tileAt(tiles: readonly StudentTileModel[], index: number): StudentTileModel {
  const tile = tiles[index] ?? tiles[0];
  if (!tile) throw new Error('sample tiles empty');
  return tile;
}

const REQUESTS_3: readonly ResumeRequestItem[] = [
  { requestId: 'r-1', nickname: NICKNAMES[0] ?? 'A' },
  { requestId: 'r-2', nickname: NICKNAMES[5] ?? 'B' },
  { requestId: 'r-3', nickname: NICKNAMES[11] ?? 'C' },
];

const TIMER_IDLE: TimerModel = { status: 'IDLE', remainingSec: null };
const TIMER_RUNNING: TimerModel = { status: 'RUNNING', remainingSec: 8 * 60 + 12 };
const TIMER_URGENT: TimerModel = { status: 'RUNNING', remainingSec: 42 };
const TIMER_PAUSED: TimerModel = { status: 'PAUSED', remainingSec: 5 * 60 + 3 };
const TIMER_ENDED: TimerModel = { status: 'RUNNING', remainingSec: 0 };

const SETTINGS: RoomSettingsValues = {
  genres: ['story', 'poem', 'lyrics', 'news'],
  aiButtons: ['SPELL', 'FEEDBACK', 'DIRECTION'],
  sound: false,
};

const MEMOS: readonly DrawerMemo[] = [
  { questionId: 'story_who', question: ko.student.questionStoryWho, note: koDev.galleryReadOnlyBody },
  { questionId: 'story_event', question: ko.student.questionStoryEvent, note: koDev.galleryPanelPraise },
];

const REWIND_ITEMS: readonly RewindItem[] = [
  { id: 's-1', at: NOW - 24 * MS_PER_MINUTE, reason: 'AUTO' },
  { id: 's-2', at: NOW - 12 * MS_PER_MINUTE, reason: 'AI' },
  { id: 's-3', at: NOW - 3 * MS_PER_MINUTE, reason: 'SUBMIT' },
  { id: 's-4', at: NOW - 40 * MS_PER_SECOND, reason: 'TEACHER' },
];

const CHECK_IDLE: ConnectionCheckModel = { realtime: 'pending', ai: 'pending', storage: 'pending' };
const CHECK_RUNNING: ConnectionCheckModel = { realtime: 'ok', ai: 'running', storage: 'ok', rttMs: 31 };
const CHECK_OK: ConnectionCheckModel = {
  realtime: 'ok',
  ai: 'ok',
  storage: 'ok',
  rttMs: 31,
  aiUsedToday: 120,
  aiDailyLimit: defaultConfig.AI_DAILY_GLOBAL,
};
const CHECK_FAIL: ConnectionCheckModel = {
  realtime: 'fail',
  ai: 'fail',
  storage: 'fail',
  realtimeHost: new URL(defaultConfig.PUBLIC_ORIGIN).host,
  aiUsedToday: 2980,
  aiDailyLimit: defaultConfig.AI_DAILY_GLOBAL,
};

const noop = () => undefined;

// ── 틀 ───────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-8)',
  padding: 'var(--sp-5) var(--sp-4) var(--sp-10)',
  maxWidth: 1320,
  margin: '0 auto',
};

const labelStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-small)',
  color: 'var(--ink-sub)',
  letterSpacing: '0.04em',
};

/** 견본 칸: `transform`이 있어 화면 고정(`position: fixed`) 요소도 이 칸 안에 갇힌다. */
const stageStyle = (height: number | 'auto'): CSSProperties => ({
  position: 'relative',
  transform: 'translateZ(0)',
  height,
  overflow: 'auto',
  border: 'var(--stroke) dashed var(--line)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--bg)',
});

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
  gap: 'var(--sp-4)',
  padding: 'var(--sp-4)',
  alignItems: 'start',
};

const paperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-5)',
  borderRadius: 'var(--r-card)',
  border: 'var(--stroke) solid var(--ink)',
  background: 'var(--surface)',
  boxShadow: 'var(--shadow-paper)',
};

function Paper({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div style={paperStyle}>
      <p style={labelStyle}>{caption}</p>
      {children}
    </div>
  );
}

interface Sample {
  readonly id: string;
  readonly caption: string;
  /** 칸 높이(전체 화면 견본은 고정 높이 안에서 굴린다). */
  readonly height: number | 'auto';
  readonly render: () => ReactNode;
}

// ── 상호작용 견본 ─────────────────────────────────────────────────

const EMPTY_VALUES: CreateRoomValues = {
  startCode: '',
  className: '',
  title: '',
  schoolName: '',
  showSchool: false,
  genres: GENRE_IDS,
  aiButtons: ['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'],
  pin: '',
  pinConfirm: '',
};

function LiveCreateRoom(props: {
  readonly needsStartCode: boolean;
  readonly initial?: Partial<CreateRoomValues>;
  readonly errors?: CreateRoomErrors;
  readonly submitting?: boolean;
  readonly startCodeLocked?: boolean;
  readonly active?: CreateRoomCodeField | null;
}) {
  const [values, setValues] = useState<CreateRoomValues>({ ...EMPTY_VALUES, ...props.initial });
  const [active, setActive] = useState<CreateRoomCodeField | null>(
    props.active === undefined ? (props.needsStartCode ? 'startCode' : 'pin') : props.active,
  );
  return (
    <CreateRoomView
      needsStartCode={props.needsStartCode}
      values={values}
      onChange={patch => setValues(v => ({ ...v, ...patch }))}
      activeCodeField={active}
      onActiveCodeFieldChange={setActive}
      errors={props.errors}
      submitting={props.submitting}
      startCodeLocked={props.startCodeLocked}
      onSubmit={noop}
      onBack={noop}
    />
  );
}

function LivePin(props: {
  readonly initial?: string;
  readonly error?: string;
  readonly lockedUntil?: number;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <PinEntryView
      value={value}
      onChange={setValue}
      onSubmit={noop}
      error={props.error}
      lockedUntil={props.lockedUntil}
      nowMs={NOW}
      onBack={noop}
    />
  );
}

function LiveNotice(props: {
  readonly timer: TimerModel;
  readonly draft?: Partial<TimerDraft>;
  readonly text?: string;
}) {
  const [draft, setDraft] = useState(props.text ?? '');
  const [timerDraft, setTimerDraft] = useState<TimerDraft>({ ...initialTimerDraft(), ...props.draft });
  const [sound, setSound] = useState(false);
  return (
    <NoticePanelView
      draft={draft}
      onDraftChange={setDraft}
      onSend={noop}
      sound={sound}
      onSoundChange={setSound}
      timer={props.timer}
      timerDraft={timerDraft}
      onTimerDraftChange={patch => setTimerDraft(d => ({ ...d, ...patch }))}
      onTimerStart={noop}
      onTimerPause={noop}
      onTimerResume={noop}
      onTimerCancel={noop}
    />
  );
}

/** 서랍 견본: 실제로는 편집기 어댑터가 칸을 채운다. 견본에서는 ref로 글을 한 번만 넣어 흉내 낸다. */
function DrawerSample(props: {
  readonly tile: StudentTileModel;
  readonly submitted?: boolean;
  readonly lyrics?: boolean;
  readonly loading?: boolean;
  readonly onClose?: () => void;
  readonly onOpenRewind?: () => void;
  readonly onOpenDevices?: () => void;
  readonly onCopyDoc?: () => void;
}) {
  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (titleRef.current) titleRef.current.value = koDev.longSampleTitle;
    if (bodyRef.current) bodyRef.current.value = koDev.longSampleBody;
  }, []);
  return (
    <StudentDrawerView
      nickname={props.tile.nickname}
      status={props.submitted ? 'submitted' : props.tile.status}
      genreLabel={props.lyrics ? docKindLabel('lyrics') : props.tile.genreLabel}
      docStatus={props.submitted ? 'SUBMITTED' : 'DRAFT'}
      titleRef={titleRef}
      bodyRef={bodyRef}
      mirrorRef={mirrorRef}
      loading={props.loading}
      canRedo={false}
      onUndo={noop}
      onRedo={noop}
      onOpenRewind={props.onOpenRewind ?? noop}
      onReopenDoc={noop}
      onCopyDoc={props.onCopyDoc ?? noop}
      supportsSuno={props.lyrics}
      onCopySunoLyrics={noop}
      onCopySunoStyle={noop}
      onOpenDevices={props.onOpenDevices ?? noop}
      onClose={props.onClose ?? noop}
      memos={props.submitted ? MEMOS : []}
    />
  );
}

function LiveDashboard(props: {
  readonly tiles: readonly StudentTileModel[];
  readonly requests?: readonly ResumeRequestItem[];
  readonly timer?: TimerModel;
  readonly closed?: boolean;
  readonly offline?: boolean;
  readonly expiring?: boolean;
  readonly loading?: boolean;
  readonly openDrawerFor?: string;
}) {
  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [selected, setSelected] = useState<string | null>(props.openDrawerFor ?? null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [settings, setSettings] = useState<RoomSettingsValues>(SETTINGS);
  const [sheet, setSheet] = useState<'settings' | 'export' | 'delete' | 'rewind' | 'devices' | null>(null);
  const [qr, setQr] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const tile = props.tiles.find(t => t.participantId === selected) ?? null;
  const requests = props.requests ?? [];
  const timer = props.timer ?? TIMER_IDLE;
  const submittedCount = props.tiles.filter(t => t.status === 'submitted').length;
  const connectedCount = props.tiles.filter(t => t.status !== 'offline').length;

  const bands = (
    <>
      {props.offline ? <OfflineBand message={ko.errors.E_OFFLINE} /> : null}
      {props.closed ? <ClosedBand message={ko.errors.E_ROOM_CLOSED} onReopen={noop} /> : null}
      <ResumeRequestsBand requests={requests} onDecide={noop} onApproveAll={noop} />
      {props.expiring ? <ExpiryBand expiresAt={EXPIRES_SOON} onDownload={() => setSheet('export')} /> : null}
    </>
  );
  const hasBands = props.offline || props.closed || requests.length > 0 || props.expiring;

  return (
    <>
      <DashboardView
        roomTitle={ROOM_TITLE}
        className={CLASS_NAME}
        roomStatus={props.closed ? 'CLOSED' : 'ACTIVE'}
        loading={props.loading}
        nowMs={NOW}
        tiles={props.tiles}
        connectedCount={connectedCount}
        submittedCount={submittedCount}
        filter={filter}
        onFilterChange={setFilter}
        selectedParticipantId={selected}
        onSelectTile={id => setSelected(cur => (cur === id ? null : id))}
        timer={timer}
        onTimerPause={noop}
        onTimerResume={noop}
        onTimerCancel={noop}
        noticeOpen={noticeOpen}
        onNoticeOpenChange={setNoticeOpen}
        noticePanel={<LiveNotice timer={timer} />}
        onOpenQr={() => setQr(true)}
        onOpenExport={() => setSheet('export')}
        onOpenPrep={noop}
        onOpenSettings={() => setSheet('settings')}
        onCloseRoom={noop}
        onReopenRoom={noop}
        onDeleteRoom={() => setSheet('delete')}
        bands={hasBands ? bands : undefined}
        drawer={
          tile ? (
            <DrawerSample
              key={tile.participantId}
              tile={tile}
              submitted={tile.status === 'submitted'}
              lyrics={tile.genreLabel === docKindLabel('lyrics')}
              onClose={() => setSelected(null)}
              onOpenRewind={() => setSheet('rewind')}
              onOpenDevices={() => setSheet('devices')}
              onCopyDoc={() => setToast(ko.common.copiedToast)}
            />
          ) : undefined
        }
        toast={toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : undefined}
      />
      <RoomSettingsSheet
        open={sheet === 'settings'}
        onOpenChange={open => setSheet(open ? 'settings' : null)}
        settings={settings}
        onChange={patch => setSettings(s => ({ ...s, ...patch }))}
      />
      <ExportSheet
        open={sheet === 'export'}
        onOpenChange={open => setSheet(open ? 'export' : null)}
        submittedCount={submittedCount}
        totalCount={props.tiles.length}
        onExport={() => setSheet(null)}
      />
      <DeleteRoomSheet
        open={sheet === 'delete'}
        onOpenChange={open => setSheet(open ? 'delete' : null)}
        delaySec={DELETE_DELAY_SEC}
        onConfirm={() => setSheet(null)}
      />
      <RewindSheet
        open={sheet === 'rewind'}
        onOpenChange={open => setSheet(open ? 'rewind' : null)}
        items={REWIND_ITEMS}
        index={REWIND_ITEMS.length - 2}
        onIndexChange={noop}
        preview={{ title: koDev.longSampleTitle, body: koDev.longSampleBody }}
        onRestore={noop}
        nowMs={NOW}
      />
      <DevicesSheet
        open={sheet === 'devices'}
        onOpenChange={open => setSheet(open ? 'devices' : null)}
        devices={[
          { deviceRowId: 'dv-1', approvedAt: NOW - 50 * MS_PER_MINUTE, lastSeenAt: NOW - 5 * MS_PER_SECOND },
          { deviceRowId: 'dv-2', approvedAt: NOW - 8 * MS_PER_MINUTE, lastSeenAt: NOW - 2 * MS_PER_MINUTE },
        ]}
        onRevoke={noop}
        nowMs={NOW}
      />
      {qr ? (
        <QrFullscreenView
          roomTitle={ROOM_TITLE}
          className={CLASS_NAME}
          entryCode={ENTRY_CODE}
          entryUrl={ENTRY_URL}
          shortUrl={SHORT_URL}
          onClose={() => setQr(false)}
        />
      ) : null}
    </>
  );
}

function LivePrep(props: { readonly check: ConnectionCheckModel; readonly pinShown?: boolean }) {
  const [pinShown, setPinShown] = useState(props.pinShown ?? false);
  const [qr, setQr] = useState(false);
  return (
    <>
      <RoomPrepView
        className={CLASS_NAME}
        roomTitle={ROOM_TITLE}
        entryCode={ENTRY_CODE}
        entryUrl={ENTRY_URL}
        shortUrl={SHORT_URL}
        expiresAt={EXPIRES_AT}
        pin={pinShown ? { state: 'shown', value: '58203917' } : { state: 'hidden' }}
        onTogglePin={() => setPinShown(s => !s)}
        check={props.check}
        onRunCheck={noop}
        onOpenQrLarge={() => setQr(true)}
        onCopyTeacherLink={noop}
        onOpenTeacherLinkQr={noop}
        onGoDashboard={noop}
        onBack={noop}
      />
      {qr ? (
        <QrFullscreenView
          roomTitle={ROOM_TITLE}
          className={CLASS_NAME}
          entryCode={ENTRY_CODE}
          entryUrl={ENTRY_URL}
          shortUrl={SHORT_URL}
          onClose={() => setQr(false)}
        />
      ) : null}
    </>
  );
}

// ── 견본 목록 ─────────────────────────────────────────────────────

const RECENT = [
  { roomId: 'room-1', displayName: `${ROOM_TITLE} · ${CLASS_NAME}`, expiresAt: EXPIRES_AT },
  {
    roomId: 'room-2',
    displayName: `${ko.student.genrePoemLabel} · ${CLASS_NAME}`,
    expiresAt: NOW + 12 * MS_PER_DAY,
  },
  {
    roomId: 'room-3',
    displayName: `${ko.student.genreNewsLabel} · ${CLASS_NAME}`,
    expiresAt: NOW + 2 * MS_PER_DAY,
  },
];

const REGISTER_STATES: readonly TeacherRegisterState[] = ['saving', 'saved', 'invalid', 'blocked'];

const SAMPLES: readonly Sample[] = [
  {
    id: 't0',
    caption: 'T0 teacher home / recent=3',
    height: 720,
    render: () => (
      <TeacherHomeView
        recentRooms={RECENT}
        onCreateRoom={noop}
        onOpenRoom={noop}
        onEnterWithPin={noop}
        onBack={noop}
      />
    ),
  },
  {
    id: 't0-empty',
    caption: 'T0 teacher home / recent=0',
    height: 560,
    render: () => (
      <TeacherHomeView
        recentRooms={[]}
        onCreateRoom={noop}
        onOpenRoom={noop}
        onEnterWithPin={noop}
        onBack={noop}
      />
    ),
  },
  {
    id: 't0-loading',
    caption: 'T0 teacher home / loading',
    height: 560,
    render: () => (
      <TeacherHomeView recentRooms={[]} loading onCreateRoom={noop} onOpenRoom={noop} onEnterWithPin={noop} />
    ),
  },
  ...REGISTER_STATES.map((state): Sample => ({
    id: `register-${state}`,
    caption: `register link / ${state}`,
    height: 420,
    render: () => <TeacherRegisterView state={state} onCreateRoom={noop} onTeacherHome={noop} />,
  })),
  {
    id: 't1-first',
    caption: 'T1 create room / first time on this device (start code on top)',
    height: 900,
    render: () => <LiveCreateRoom needsStartCode />,
  },
  {
    id: 't1-errors',
    caption: 'T1 create room / errors (start code, pin taken, pin mismatch)',
    height: 900,
    render: () => (
      <LiveCreateRoom
        needsStartCode
        active={null}
        initial={{
          startCode: '12345678',
          className: CLASS_NAME,
          title: ROOM_TITLE,
          pin: '482913',
          pinConfirm: '482914',
        }}
        errors={{
          startCode: ko.errors.E_START_CODE_INVALID,
          pin: ko.errors.E_PIN_TAKEN,
          pinConfirm: ko.teacher.pinMismatchError,
          form: ko.errors.E_RATE_LIMITED,
        }}
      />
    ),
  },
  {
    id: 't1-ready',
    caption: 'T1 create room / code remembered, filled, submitting',
    height: 900,
    render: () => (
      <LiveCreateRoom
        needsStartCode={false}
        active={null}
        submitting
        initial={{
          className: CLASS_NAME,
          title: ROOM_TITLE,
          schoolName: devText('teacherSampleSchoolName', 'Haneul'),
          showSchool: true,
          genres: ['story', 'poem', 'news'],
          aiButtons: ['SPELL', 'FEEDBACK'],
          pin: '58203917',
          pinConfirm: '58203917',
        }}
      />
    ),
  },
  {
    id: 't1-locked',
    caption: 'T1 create room / start code locked',
    height: 640,
    render: () => (
      <LiveCreateRoom needsStartCode startCodeLocked active={null} initial={{ startCode: '1234' }} />
    ),
  },
  {
    id: 't2-idle',
    caption: 'T2 prep / check not run',
    height: 980,
    render: () => <LivePrep check={CHECK_IDLE} />,
  },
  {
    id: 't2-running',
    caption: 'T2 prep / check running',
    height: 980,
    render: () => <LivePrep check={CHECK_RUNNING} />,
  },
  {
    id: 't2-ok',
    caption: 'T2 prep / check all good, pin shown',
    height: 980,
    render: () => <LivePrep check={CHECK_OK} pinShown />,
  },
  {
    id: 't2-fail',
    caption: 'T2 prep / check failed (all three)',
    height: 1100,
    render: () => <LivePrep check={CHECK_FAIL} />,
  },
  {
    id: 'qr-full',
    caption: 'QR fullscreen (TV)',
    height: 640,
    render: () => (
      <QrFullscreenView
        roomTitle={ROOM_TITLE}
        className={CLASS_NAME}
        entryCode={ENTRY_CODE}
        entryUrl={ENTRY_URL}
        shortUrl={SHORT_URL}
        onClose={noop}
      />
    ),
  },
  {
    id: 'teacher-qr',
    caption: 'teacher link QR (separate window, student warning)',
    height: 720,
    render: () => <TeacherLinkQrView teacherLinkUrl={TEACHER_LINK} onClose={noop} />,
  },
  {
    id: 't3-empty',
    caption: 'T3 dashboard / students=0',
    height: 720,
    render: () => <LiveDashboard tiles={[]} />,
  },
  {
    id: 't3-loading',
    caption: 'T3 dashboard / loading',
    height: 560,
    render: () => <LiveDashboard tiles={[]} loading />,
  },
  {
    id: 't3-30',
    caption: 'T3 dashboard / students=30, requests=3, timer running, expiry band (tap a tile for T4)',
    height: 1100,
    render: () => <LiveDashboard tiles={TILES_30} requests={REQUESTS_3} timer={TIMER_RUNNING} expiring />,
  },
  {
    id: 't3-8',
    caption: 'T3 dashboard / students=8, requests=1, timer paused, room closed, teacher offline',
    height: 760,
    render: () => (
      <LiveDashboard tiles={TILES_8} requests={REQUESTS_3.slice(0, 1)} timer={TIMER_PAUSED} closed offline />
    ),
  },
  {
    id: 't3-drawer',
    caption: 'T3 + T4 drawer open (submitted doc). <900 full screen, >=900 side 480px',
    height: 1000,
    render: () => (
      <LiveDashboard
        tiles={TILES_30}
        timer={TIMER_URGENT}
        openDrawerFor={TILES_30.find(t => t.status === 'submitted')?.participantId ?? 'p-00'}
      />
    ),
  },
  {
    id: 't4',
    caption: 'T4 drawer alone / writing lyrics (Suno menu) and loading',
    height: 'auto',
    render: () => (
      <div style={rowStyle}>
        <div style={{ height: 900, display: 'flex', border: 'var(--stroke-thin) solid var(--line)' }}>
          <DrawerSample tile={tileAt(TILES_30, 0)} lyrics />
        </div>
        <div style={{ height: 900, display: 'flex', border: 'var(--stroke-thin) solid var(--line)' }}>
          <DrawerSample tile={tileAt(TILES_30, 1)} loading />
        </div>
      </div>
    ),
  },
  {
    id: 'timers',
    caption: 'timer pill states / running, urgent, paused, ended (tap for menu)',
    height: 'auto',
    render: () => (
      <div style={{ ...rowStyle, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {[TIMER_RUNNING, TIMER_URGENT, TIMER_PAUSED, TIMER_ENDED].map((t, i) => (
          <DashboardTimer key={i} timer={t} onPause={noop} onResume={noop} onCancel={noop} />
        ))}
      </div>
    ),
  },
  {
    id: 'notice',
    caption: 'notice popover content / timer idle, custom 1 min, running, paused, ended',
    height: 'auto',
    render: () => (
      <div style={rowStyle}>
        <Paper caption="idle / preset 5">
          <LiveNotice timer={TIMER_IDLE} draft={{ preset: 5 }} />
        </Paper>
        <Paper caption="idle / custom 1 min, typed text">
          <LiveNotice
            timer={TIMER_IDLE}
            draft={{ preset: 'custom', customMinutes: '1' }}
            text={ko.teacher.noticePresetLookTeacher}
          />
        </Paper>
        <Paper caption="running">
          <LiveNotice timer={TIMER_RUNNING} />
        </Paper>
        <Paper caption="paused">
          <LiveNotice timer={TIMER_PAUSED} />
        </Paper>
        <Paper caption="ended">
          <LiveNotice timer={TIMER_ENDED} />
        </Paper>
      </div>
    ),
  },
  {
    id: 'sheets',
    caption: 'sheet contents / settings, export, delete, rewind, devices',
    height: 'auto',
    render: () => (
      <div style={rowStyle}>
        <Paper caption={ko.teacher.roomSettingsTitle}>
          <RoomSettingsPanelView settings={SETTINGS} onChange={noop} />
        </Paper>
        <Paper caption={ko.teacher.exportSheetTitle}>
          <ExportPanelView submittedCount={5} totalCount={21} onExport={noop} />
          <ExportPanelView submittedCount={0} totalCount={21} exporting="all" onExport={noop} />
        </Paper>
        <Paper caption={ko.teacher.deleteRoomConfirmTitle}>
          <DeleteRoomPanelView delaySec={DELETE_DELAY_SEC} onConfirm={noop} onCancel={noop} />
        </Paper>
        <Paper caption={ko.common.rewindTitle}>
          <RewindPanelView
            items={REWIND_ITEMS}
            index={2}
            onIndexChange={noop}
            preview={{ title: koDev.longSampleTitle, body: koDev.galleryReadOnlyBody }}
            onRestore={noop}
            nowMs={NOW}
          />
          <RewindPanelView
            items={[]}
            index={0}
            onIndexChange={noop}
            preview={null}
            onRestore={noop}
            nowMs={NOW}
          />
          <RewindPanelView
            items={REWIND_ITEMS}
            index={0}
            onIndexChange={noop}
            preview={null}
            onRestore={noop}
            offline
            nowMs={NOW}
          />
        </Paper>
        <Paper caption={ko.teacher.deviceListHeading}>
          <DevicesPanelView
            devices={[
              {
                deviceRowId: 'dv-1',
                approvedAt: NOW - 50 * MS_PER_MINUTE,
                lastSeenAt: NOW - 5 * MS_PER_SECOND,
              },
              { deviceRowId: 'dv-2', approvedAt: NOW - 8 * MS_PER_MINUTE, lastSeenAt: null },
            ]}
            revokingId="dv-2"
            onRevoke={noop}
            nowMs={NOW}
          />
        </Paper>
      </div>
    ),
  },
  {
    id: 't5',
    caption: 'T5 pin entry / empty',
    height: 860,
    render: () => <LivePin />,
  },
  {
    id: 't5-error',
    caption: 'T5 pin entry / wrong pin',
    height: 860,
    render: () => <LivePin initial="482913" error={ko.errors.E_PIN_INVALID} />,
  },
  {
    id: 't5-locked',
    caption: 'T5 pin entry / locked (PIN_LOCK_MIN)',
    height: 860,
    render: () => <LivePin initial="" lockedUntil={NOW + 7 * MS_PER_MINUTE + 20 * MS_PER_SECOND} />,
  },
];

function soloId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('s');
}

export function DevScreensTeacher() {
  const solo = soloId();
  const only = solo ? SAMPLES.find(s => s.id === solo) : undefined;
  if (only) return <>{only.render()}</>;

  return (
    <main style={pageStyle}>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        {SAMPLES.map(s => (
          <a key={s.id} href={`?s=${s.id}`} style={{ ...labelStyle, color: 'var(--sky-ink)' }}>
            {s.id}
          </a>
        ))}
      </nav>
      {SAMPLES.map(s => (
        <section
          key={s.id}
          id={s.id}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}
        >
          <p style={labelStyle}>
            <a href={`?s=${s.id}`} style={{ color: 'inherit' }}>
              {s.id}
            </a>{' '}
            {s.caption}
          </p>
          <div style={stageStyle(s.height)}>{s.render()}</div>
        </section>
      ))}
    </main>
  );
}
