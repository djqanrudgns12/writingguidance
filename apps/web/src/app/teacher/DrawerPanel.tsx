import { DOC_KEYS, DOC_META_KEYS, GENRE_CATALOG, isGenreId } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import type { DocSummary } from '@geulbang/core/protocol';
import { useRef, useState } from 'react';
import { buildStudentExport } from '../../application/exportStudent.ts';
import {
  getSnapshot,
  listDeviceItems,
  listSnapshots,
  reopenDoc,
  replaceYText,
  restoreSnapshot,
  revokeDevice,
  type SnapshotText,
  type TeacherSession,
} from '../../application/teacher.ts';
import type { ToastTone } from '../../ui/components/Toast.tsx';
import {
  DevicesSheet,
  RewindSheet,
  StudentDrawerView,
  type DeviceItem,
  type RewindItem,
  type StudentTileModel,
} from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { copyText } from './clipboard.ts';
import { errorCodeOf, errorMessage } from './errors.ts';
import type { TeacherRoomAction } from './hooks/teacherRoomState.ts';
import { useStudentDrawer } from './hooks/useStudentDrawer.ts';

export interface DrawerPanelProps {
  readonly teacher: TeacherSession | null;
  readonly room: { readonly roomId: string; readonly expiresAt: number };
  readonly summary: DocSummary;
  readonly tile: StudentTileModel | null;
  readonly nowMs: number;
  /** 연결이 끊겼으면 시간 되감기를 막는다(서버 기록이 필요하다). */
  readonly offline: boolean;
  readonly onClose: () => void;
  readonly onToast: (message: string, tone?: ToastTone) => void;
  readonly dispatch: (action: TeacherRoomAction) => void;
}

interface RewindState {
  readonly open: boolean;
  readonly loading: boolean;
  readonly items: readonly RewindItem[];
  readonly index: number;
  readonly preview: SnapshotText | null;
  readonly restoring: boolean;
}

const REWIND_CLOSED: RewindState = {
  open: false,
  loading: false,
  items: [],
  index: 0,
  preview: null,
  restoring: false,
};

interface DevicesState {
  readonly open: boolean;
  readonly loading: boolean;
  readonly items: readonly DeviceItem[];
  readonly revokingId: string | null;
}

const DEVICES_CLOSED: DevicesState = { open: false, loading: false, items: [], revokingId: null };

/**
 * T4 학생 글 서랍 결합(PRD F-18): 편집기(교사 모드)·되돌리기·시간 되감기·다시 쓰게 하기·복사·기기 끊기·메모 보기.
 * 서랍마다 `key={docId}`로 새로 그려, 다른 글로 바꾸면 편집기와 제공자를 떼고 새로 붙인다.
 */
export function DrawerPanel({
  teacher,
  room,
  summary,
  tile,
  nowMs,
  offline,
  onClose,
  onToast,
  dispatch,
}: DrawerPanelProps) {
  const deps = useAppDeps();
  const drawer = useStudentDrawer(teacher, summary.docId, room);
  const [reopening, setReopening] = useState(false);
  const [rewind, setRewind] = useState<RewindState>(REWIND_CLOSED);
  const [devices, setDevices] = useState<DevicesState>(DEVICES_CLOSED);
  const previews = useRef(new Map<string, SnapshotText>());
  const { docId } = summary;
  const supportsSuno = isGenreId(summary.genre) && GENRE_CATALOG[summary.genre].supportsSunoExport;

  const fail = (error: unknown) => onToast(errorMessage(errorCodeOf(error)), 'danger');
  const needTeacher = (): TeacherSession | null => {
    if (!teacher) onToast(errorMessage('E_OFFLINE'), 'danger');
    return teacher;
  };

  // ── 복사(PRD F-12·F-18) ───────────────────────────────────────
  const exported = () => {
    const text = drawer.readText();
    if (!text) return null;
    const meta = text.meta;
    return buildStudentExport(
      {
        genre: summary.genre,
        subtype: summary.subtype,
        purpose: meta[DOC_META_KEYS.purpose] ?? null,
        purposeCustom: meta[DOC_META_KEYS.purposeCustom] ?? null,
        title: text.title,
        body: text.body,
        mood: meta[DOC_META_KEYS.mood] ?? null,
        moodCustom: meta[DOC_META_KEYS.moodCustom] ?? null,
        tempo: meta[DOC_META_KEYS.tempo] ?? null,
      },
      { now: deps.now(), timeZone: deps.config.TIMEZONE },
    );
  };
  const copy = async (pick: (e: NonNullable<ReturnType<typeof exported>>) => string | undefined) => {
    const e = exported();
    const text = e ? pick(e) : undefined;
    const ok = text !== undefined && (await copyText(text));
    onToast(ok ? ko.common.copiedToast : errorMessage('E_INTERNAL'), ok ? 'default' : 'danger');
  };

  // ── 다시 쓰게 하기(PRD F-18, `doc.reopen`) ──────────────────────
  const reopen = async () => {
    const t = needTeacher();
    if (!t) return;
    setReopening(true);
    try {
      const result = await reopenDoc(t, docId, deps.newId());
      if (result.status === 'DRAFT' || result.status === 'REOPENED' || result.status === 'SUBMITTED') {
        dispatch({
          type: 'doc.status',
          data: { docId, status: result.status, at: t.session.serverNow(), generation: result.generation },
        });
      }
    } catch (error) {
      fail(error);
    } finally {
      setReopening(false);
    }
  };

  // ── 시간 되감기(PRD F-10) ──────────────────────────────────────
  const loadPreview = async (t: TeacherSession, items: readonly RewindItem[], index: number) => {
    const item = items[index];
    if (!item) return;
    const cached = previews.current.get(item.id);
    if (cached) {
      setRewind(r => ({ ...r, preview: cached }));
      return;
    }
    setRewind(r => ({ ...r, preview: null }));
    try {
      const text = await getSnapshot(t, docId, item.id, deps.newId());
      previews.current.set(item.id, text);
      setRewind(r => (r.items[r.index]?.id === item.id ? { ...r, preview: text } : r));
    } catch (error) {
      fail(error);
    }
  };

  const openRewind = async () => {
    setRewind({ ...REWIND_CLOSED, open: true, loading: !offline });
    if (offline) return;
    const t = needTeacher();
    if (!t) return;
    try {
      const list = await listSnapshots(t, docId, deps.newId());
      const items = list.map(s => ({ id: s.id, at: s.at, reason: s.reason }));
      const index = Math.max(0, items.length - 1);
      setRewind(r => ({ ...r, loading: false, items, index }));
      await loadPreview(t, items, index);
    } catch (error) {
      setRewind(r => ({ ...r, loading: false }));
      fail(error);
    }
  };

  const changeRewindIndex = (index: number) => {
    setRewind(r => ({ ...r, index }));
    if (teacher) void loadPreview(teacher, rewind.items, index);
  };

  const restore = async () => {
    const t = needTeacher();
    const item = rewind.items[rewind.index];
    const binding = drawer.binding();
    if (!t || !item || !binding) return;
    setRewind(r => ({ ...r, restoring: true }));
    try {
      const target = await restoreSnapshot(t, docId, item.id, deps.newId());
      // 받은 글을 앱 변경으로 넣는다: 교사 `↶`로 되돌릴 수 있다(PLAN §4.4 `snapshot.restore`).
      // (편집기가 한 LOCAL 트랜잭션으로 감싼다.)
      await binding.applyAppEdit(doc => {
        replaceYText(doc.getText(DOC_KEYS.title), target.title);
        replaceYText(doc.getText(DOC_KEYS.body), target.body);
      });
      setRewind(REWIND_CLOSED);
    } catch (error) {
      setRewind(r => ({ ...r, restoring: false }));
      fail(error);
    }
  };

  // ── 기기 연결 끊기(PRD F-14·F-18) ───────────────────────────────
  const loadDevices = async (t: TeacherSession) => {
    const items = await listDeviceItems(t, summary.participantId, deps.newId());
    return items.map(d => ({
      deviceRowId: d.deviceRowId,
      approvedAt: d.approvedAt,
      lastSeenAt: d.lastSeenAt,
    }));
  };

  const openDevices = async () => {
    const t = needTeacher();
    if (!t) return;
    setDevices({ ...DEVICES_CLOSED, open: true, loading: true });
    try {
      const items = await loadDevices(t);
      setDevices(d => ({ ...d, loading: false, items }));
    } catch (error) {
      setDevices(d => ({ ...d, loading: false }));
      fail(error);
    }
  };

  const revoke = async (deviceRowId: string) => {
    const t = needTeacher();
    if (!t) return;
    setDevices(d => ({ ...d, revokingId: deviceRowId }));
    try {
      await revokeDevice(t, deviceRowId, deps.newId());
      const items = await loadDevices(t);
      setDevices(d => ({ ...d, revokingId: null, items }));
    } catch (error) {
      setDevices(d => ({ ...d, revokingId: null }));
      fail(error);
    }
  };

  const binding = drawer.binding;

  return (
    <>
      <StudentDrawerView
        nickname={tile?.nickname ?? summary.nickname}
        status={tile?.status ?? 'idle'}
        genreLabel={tile?.genreLabel ?? ''}
        docStatus={summary.status}
        titleRef={drawer.titleRef}
        bodyRef={drawer.bodyRef}
        mirrorRef={drawer.mirrorRef}
        loading={drawer.loading}
        onUndo={() => binding()?.undo()}
        onRedo={() => binding()?.redo()}
        onOpenRewind={() => void openRewind()}
        onReopenDoc={() => void reopen()}
        reopening={reopening}
        onCopyDoc={() => void copy(e => e.text)}
        supportsSuno={supportsSuno}
        onCopySunoLyrics={() => void copy(e => e.suno?.lyrics)}
        onCopySunoStyle={() => void copy(e => e.suno?.style)}
        onOpenDevices={() => void openDevices()}
        onClose={onClose}
        memos={drawer.memos}
        holdLabel={ko.teacher.teacherHoldNotice}
        holding={drawer.holding}
      />
      <RewindSheet
        open={rewind.open}
        onOpenChange={open => {
          if (!open) setRewind(REWIND_CLOSED);
        }}
        items={rewind.items}
        index={rewind.index}
        onIndexChange={changeRewindIndex}
        preview={rewind.preview}
        onRestore={() => void restore()}
        restoring={rewind.restoring}
        loading={rewind.loading}
        offline={offline}
        nowMs={nowMs}
      />
      <DevicesSheet
        open={devices.open}
        onOpenChange={open => {
          if (!open) setDevices(DEVICES_CLOSED);
        }}
        devices={devices.items}
        onRevoke={id => void revoke(id)}
        revokingId={devices.revokingId}
        loading={devices.loading}
        nowMs={nowMs}
      />
    </>
  );
}
