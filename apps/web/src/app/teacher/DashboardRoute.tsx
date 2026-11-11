import { isGenreId, MS_PER_SECOND, RetentionPolicy } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import type { RoomSettings } from '@geulbang/core/protocol';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { buildExportBundle, downloadAll, type ExportSummaryLabels } from '../../application/exportAll.ts';
import { purgeRoomOnDevice } from '../../application/purgeLocal.ts';
import {
  approveAllResumes,
  cancelTimer,
  closeRoom,
  decideResume,
  deleteRoomNow,
  pauseTimer,
  reopenRoom,
  resumeTimer,
  sendNotice,
  startTimer,
  updateRoomSettings,
  type TeacherSession,
} from '../../application/teacher.ts';
import type { TeacherRoomMemory } from '../../ports/deviceMemory.ts';
import { Toast } from '../../ui/components/Toast.tsx';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import {
  ClosedBand,
  DashboardView,
  DeleteRoomSheet,
  ExpiryBand,
  ExportSheet,
  initialTimerDraft,
  NoticePanelView,
  OfflineBand,
  QrFullscreenView,
  ResumeRequestsBand,
  RoomSettingsSheet,
  timerDraftToCommand,
  type DashboardFilter,
  type ExportKind,
  type RoomSettingsValues,
  type TimerDraft,
} from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { DrawerPanel } from './DrawerPanel.tsx';
import { errorCodeOf, errorMessage } from './errors.ts';
import { buildDashboardTiles, exportCounts, toTimerModel } from './hooks/teacherRoomState.ts';
import { useNow } from './hooks/useNow.ts';
import { useRoomInfo } from './hooks/useRoomInfo.ts';
import { useTeacherRoom } from './hooks/useTeacherRoom.ts';
import { useToast } from './hooks/useToast.ts';
import { entryUrlOf, teacherPaths } from './paths.ts';
import { TeacherRoomGate } from './TeacherRoomGate.tsx';

/** 전체모음.md 문구(PRD F-21). 이름이 `ko.teacher` 키와 같다(`ExportSummaryLabels`). */
const EXPORT_LABELS: ExportSummaryLabels = {
  exportSummaryFileBase: ko.teacher.exportSummaryFileBase,
  exportSummaryTitleLabel: ko.teacher.exportSummaryTitleLabel,
  exportSummaryGenreLabel: ko.teacher.exportSummaryGenreLabel,
  exportSummaryStatusLabel: ko.teacher.exportSummaryStatusLabel,
  exportSummarySubmittedAtLabel: ko.teacher.exportSummarySubmittedAtLabel,
  exportSummaryUntitled: ko.teacher.exportSummaryUntitled,
  exportStatusSubmitted: ko.teacher.exportStatusSubmitted,
  exportStatusDraft: ko.teacher.exportStatusDraft,
  exportStatusReopened: ko.teacher.exportStatusReopened,
};

const DOC_PARAM = 'doc';

/** 설정 시트 값(읽기 전용 배열) → `room.update` 인자 */
function toSettingsPatch(patch: Partial<RoomSettingsValues>): Partial<RoomSettings> {
  return {
    ...(patch.genres ? { genres: [...patch.genres] } : {}),
    ...(patch.aiButtons ? { aiButtons: [...patch.aiButtons] } : {}),
    ...(patch.sound !== undefined ? { sound: patch.sound } : {}),
  };
}

type DashboardSheet = 'settings' | 'export' | 'delete' | null;

/** T3 대시보드(PRD F-17), `?doc=`이면 T4 서랍(F-18). `/t/room/:roomId` */
export function DashboardRoute() {
  const [attempt, setAttempt] = useState(0);
  return (
    <TeacherRoomGate>
      {entry => (
        <Dashboard key={`${entry.roomId}:${attempt}`} entry={entry} onRetry={() => setAttempt(n => n + 1)} />
      )}
    </TeacherRoomGate>
  );
}

function Dashboard({ entry, onRetry }: { entry: TeacherRoomMemory; onRetry: () => void }) {
  const deps = useAppDeps();
  const { config } = deps;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const room = useTeacherRoom(entry);
  const now = useNow(room.serverNow);
  const toast = useToast(config.NOTICE_SHOW_SEC * MS_PER_SECOND);
  const { state: info } = useRoomInfo(entry);

  const [filter, setFilter] = useState<DashboardFilter>('all');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState('');
  const [noticeSending, setNoticeSending] = useState(false);
  const [timerDraft, setTimerDraft] = useState<TimerDraft>(() => initialTimerDraft(config.TIMER_PRESETS_MIN));
  const [sheet, setSheet] = useState<DashboardSheet>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resumeBusy, setResumeBusy] = useState<readonly string[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<Partial<RoomSettings> | null>(null);

  const { state, teacher, dispatch } = room;
  const roomInfo = state.room;
  const { tiles, connectedCount, submittedCount } = useMemo(
    () => buildDashboardTiles(state, now, config),
    [state, now, config],
  );
  const timer = toTimerModel(state.timer, now);
  const counts = exportCounts(state);

  const showToast = toast.show;
  const showError = (error: unknown) => showToast(errorMessage(errorCodeOf(error)), 'danger');

  /** 수업방 채널 명령 하나. 연결 전이면 오프라인 안내, 실패는 `ko.errors` 토스트. */
  const run = async <T,>(command: (t: TeacherSession, commandId: string) => Promise<T>) => {
    if (!teacher) {
      toast.show(errorMessage('E_OFFLINE'), 'danger');
      return { ok: false as const };
    }
    try {
      return { ok: true as const, value: await command(teacher, deps.newId()) };
    } catch (error) {
      showError(error);
      return { ok: false as const };
    }
  };

  // ── 끝난 방 ────────────────────────────────────────────────────
  // 지금 삭제는 응답 뒤 직접 홈으로 가므로, 그 사이 오는 끝남 알림은 닫힌 문 화면으로 바꾸지 않는다.
  const ended =
    !deleting &&
    (room.channelState === 'gone' ||
      roomInfo?.status === 'EXPIRED' ||
      roomInfo?.status === 'DELETED' ||
      (room.channelState === 'failed' &&
        (room.failure === 'E_ROOM_EXPIRED' || room.failure === 'E_ROOM_NOT_FOUND')));
  const authLost =
    room.channelState === 'failed' && (room.failure === 'E_AUTH' || room.failure === 'E_FORBIDDEN');
  useEffect(() => {
    // 다시 들어올 수 없는 방은 이 기기 기억과 사본(서랍에서 연 글·AI 결과)을 지운다(검토 B04).
    // 교사 토큰 무효(`E_AUTH`)는 방이 살아 있어도 이 기기가 그 방을 다시 열 수 없으므로 사본도 쓸모가 없다.
    if (ended || authLost) void purgeRoomOnDevice(deps, entry.roomId).catch(() => undefined);
  }, [ended, authLost, deps, entry.roomId]);

  if (ended) return <ClosedView kind="expired" onHome={() => navigate(teacherPaths.home)} />;
  if (authLost) return <ClosedView kind="missingRoom" onHome={() => navigate(teacherPaths.home)} />;
  if (room.channelState === 'failed') {
    return <ErrorStateView code={room.failure ?? 'E_INTERNAL'} onRetry={onRetry} />;
  }

  // ── 서랍(T4) ───────────────────────────────────────────────────
  const docId = params.get(DOC_PARAM);
  const drawerSummary = docId ? (state.summaries.get(docId) ?? null) : null;
  const drawerTile = drawerSummary
    ? (tiles.find(t => t.participantId === drawerSummary.participantId) ?? null)
    : null;
  const setDrawerDoc = (next: string | null) =>
    setParams(
      prev => {
        const p = new URLSearchParams(prev);
        if (next) p.set(DOC_PARAM, next);
        else p.delete(DOC_PARAM);
        return p;
      },
      { replace: true },
    );
  const selectTile = (participantId: string) => {
    const tile = tiles.find(t => t.participantId === participantId);
    if (!tile?.docId) return; // 아직 글 종류를 고르는 중: 열 글이 없다.
    setDrawerDoc(tile.docId === docId ? null : tile.docId);
  };

  // ── 이어 쓰기 요청(PRD F-14) ────────────────────────────────────
  const decide = async (requestId: string, approve: boolean) => {
    setResumeBusy(ids => [...ids, requestId]);
    const r = await run((t, id) => decideResume(t, requestId, approve, id));
    if (r.ok) dispatch({ type: 'resume.decided', requestId });
    setResumeBusy(ids => ids.filter(x => x !== requestId));
  };
  const approveAll = async () => {
    const ids = state.pendingResumes.map(r => r.requestId);
    setResumeBusy(ids);
    const r = await run((t, id) => approveAllResumes(t, id));
    if (r.ok) for (const requestId of ids) dispatch({ type: 'resume.decided', requestId });
    setResumeBusy([]);
  };

  // ── 설정·소리(PRD F-19·F-22): 바꾸는 즉시 보내고, 응답 전에도 화면은 바뀐 값을 보인다 ──
  const serverSettings = roomInfo?.settings ?? null;
  const settings: RoomSettings | null = serverSettings ? { ...serverSettings, ...settingsDraft } : null;
  const settingsValues: RoomSettingsValues = {
    genres: (settings?.genres ?? []).filter(isGenreId),
    aiButtons: settings?.aiButtons ?? [],
    sound: settings?.sound ?? false,
  };
  const changeSettings = async (patch: Partial<RoomSettings>) => {
    if (Object.keys(patch).length === 0) return;
    setSettingsDraft(d => ({ ...d, ...patch }));
    const r = await run((t, id) => updateRoomSettings(t, patch, id));
    if (r.ok) dispatch({ type: 'room.settings', settings: r.value.settings });
    setSettingsDraft(null);
  };

  // ── 알림·타이머(PRD F-19) ──────────────────────────────────────
  const send = async (text: string) => {
    setNoticeSending(true);
    const r = await run((t, id) => sendNotice(t, text, id));
    setNoticeSending(false);
    if (!r.ok) return;
    showToast(ko.teacher.noticeSentToast);
    if (text === noticeDraft.trim()) setNoticeDraft('');
  };
  const start = async () => {
    const args = timerDraftToCommand(timerDraft, config.TIMER_MAX_MIN);
    if (!args) return;
    const r = await run((t, id) => startTimer(t, args, id));
    if (r.ok) dispatch({ type: 'timer', data: r.value.timer });
  };
  const pause = () => void run((t, id) => pauseTimer(t, id));
  const resume = () => void run((t, id) => resumeTimer(t, id));
  const cancel = () => void run((t, id) => cancelTimer(t, id));

  // ── 닫기·다시 열기·지금 삭제(PRD F-22) ──────────────────────────
  const close = async () => {
    const r = await run((t, id) => closeRoom(t, id));
    if (r.ok) dispatch({ type: 'room.status', status: 'CLOSED' });
  };
  const reopen = async () => {
    const r = await run((t, id) => reopenRoom(t, id));
    if (r.ok) dispatch({ type: 'room.status', status: 'ACTIVE' });
  };
  const deleteNow = async () => {
    setDeleting(true);
    const r = await run((t, id) => deleteRoomNow(t, id));
    if (!r.ok) {
      setDeleting(false);
      return;
    }
    // 이 기기의 기억·글 사본도 지운다(PRD F-24 "즉시 사라진다"). 다른 기기와 같은 정리를 지난다.
    await purgeRoomOnDevice(deps, entry.roomId).catch(() => undefined);
    navigate(teacherPaths.home, { replace: true });
  };

  // ── 모두 내려받기(PRD F-21) ─────────────────────────────────────
  const exportDocs = async (kind: ExportKind) => {
    setExporting(kind);
    try {
      const result = await deps.api.exportRoom(entry.roomId, entry.teacherToken, kind);
      const options = { scope: kind, now: deps.now(), timeZone: config.TIMEZONE, labels: EXPORT_LABELS };
      if (buildExportBundle(result, options).docCount === 0) {
        toast.show(ko.teacher.exportEmpty);
        return;
      }
      await downloadAll(deps.download, result, options);
      setSheet(null);
    } catch (error) {
      showError(error);
    } finally {
      setExporting(null);
    }
  };

  // ── QR ─────────────────────────────────────────────────────────
  const openQr = () => {
    if (info.status === 'ready') setQrOpen(true);
    else toast.show(errorMessage(info.status === 'error' ? info.code : 'E_OFFLINE'), 'danger');
  };

  // ── 띠 ─────────────────────────────────────────────────────────
  const offline = room.connection === 'offline' || room.connection === 'server-down';
  const closed = roomInfo?.status === 'CLOSED';
  const expiring =
    roomInfo !== null && RetentionPolicy.isInExpiryWarningWindow(roomInfo.expiresAt, now, config);
  const resumeItems = state.pendingResumes.map(r => ({ requestId: r.requestId, nickname: r.nickname }));
  const hasBands = offline || closed || resumeItems.length > 0 || expiring;
  const bands = hasBands ? (
    <>
      {offline ? <OfflineBand message={ko.teacher.teacherOfflineBanner} /> : null}
      {closed ? <ClosedBand message={ko.teacher.roomClosedBanner} onReopen={() => void reopen()} /> : null}
      <ResumeRequestsBand
        requests={resumeItems}
        onDecide={(id, approve) => void decide(id, approve)}
        onApproveAll={() => void approveAll()}
        pendingIds={resumeBusy}
      />
      {roomInfo && expiring ? (
        <ExpiryBand expiresAt={roomInfo.expiresAt} onDownload={() => setSheet('export')} />
      ) : null}
    </>
  ) : undefined;

  const { toast: toastMessage, dismiss } = toast;

  return (
    <>
      <DashboardView
        roomTitle={roomInfo?.title ?? entry.displayName}
        className={roomInfo?.className ?? ''}
        roomStatus={closed ? 'CLOSED' : 'ACTIVE'}
        loading={roomInfo === null}
        nowMs={now}
        tiles={tiles}
        connectedCount={connectedCount}
        submittedCount={submittedCount}
        filter={filter}
        onFilterChange={setFilter}
        selectedParticipantId={drawerSummary?.participantId ?? null}
        onSelectTile={selectTile}
        timer={timer}
        onTimerPause={pause}
        onTimerResume={resume}
        onTimerCancel={cancel}
        noticeOpen={noticeOpen}
        onNoticeOpenChange={setNoticeOpen}
        noticePanel={
          <NoticePanelView
            draft={noticeDraft}
            onDraftChange={setNoticeDraft}
            onSend={text => void send(text)}
            sending={noticeSending}
            sound={settingsValues.sound}
            onSoundChange={sound => void changeSettings({ sound })}
            timer={timer}
            timerDraft={timerDraft}
            onTimerDraftChange={patch => setTimerDraft(d => ({ ...d, ...patch }))}
            onTimerStart={() => void start()}
            onTimerPause={pause}
            onTimerResume={resume}
            onTimerCancel={cancel}
            maxChars={config.NOTICE_MAX_CHARS}
            timerPresets={config.TIMER_PRESETS_MIN}
            timerMaxMinutes={config.TIMER_MAX_MIN}
          />
        }
        onOpenQr={openQr}
        onOpenExport={() => setSheet('export')}
        onOpenPrep={() => navigate(teacherPaths.prep(entry.roomId))}
        onOpenSettings={() => setSheet('settings')}
        onCloseRoom={() => void close()}
        onReopenRoom={() => void reopen()}
        onDeleteRoom={() => setSheet('delete')}
        bands={bands}
        drawerLabel={drawerTile?.nickname}
        drawer={
          drawerSummary && roomInfo ? (
            <DrawerPanel
              key={drawerSummary.docId}
              teacher={teacher}
              room={{ roomId: entry.roomId, expiresAt: roomInfo.expiresAt }}
              summary={drawerSummary}
              tile={drawerTile}
              nowMs={now}
              offline={offline}
              onClose={() => setDrawerDoc(null)}
              onToast={showToast}
              dispatch={dispatch}
            />
          ) : undefined
        }
        toast={
          toastMessage ? (
            <Toast
              key={toastMessage.id}
              message={toastMessage.message}
              tone={toastMessage.tone}
              onDismiss={dismiss}
            />
          ) : undefined
        }
      />
      <RoomSettingsSheet
        open={sheet === 'settings'}
        onOpenChange={open => setSheet(open ? 'settings' : null)}
        settings={settingsValues}
        disabled={settings === null}
        onChange={patch => void changeSettings(toSettingsPatch(patch))}
      />
      <ExportSheet
        open={sheet === 'export'}
        onOpenChange={open => setSheet(open ? 'export' : null)}
        submittedCount={counts.submitted}
        totalCount={counts.total}
        exporting={exporting}
        onExport={kind => void exportDocs(kind)}
      />
      <DeleteRoomSheet
        open={sheet === 'delete'}
        onOpenChange={open => setSheet(open ? 'delete' : null)}
        delaySec={config.DELETE_CONFIRM_DELAY_SEC}
        deleting={deleting}
        onConfirm={() => void deleteNow()}
      />
      {qrOpen && info.status === 'ready' ? (
        <QrFullscreenView
          roomTitle={info.info.room.title}
          className={info.info.room.className}
          entryCode={info.info.entryCode}
          entryUrl={entryUrlOf(config, info.info.entryCode)}
          shortUrl={info.info.shortUrl}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
    </>
  );
}
