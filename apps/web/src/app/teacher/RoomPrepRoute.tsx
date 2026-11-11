import { MS_PER_SECOND } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { purgeRoomOnDevice } from '../../application/purgeLocal.ts';
import { connectionCheck, type CheckResult } from '../../application/teacher.ts';
import type { TeacherRoomMemory } from '../../ports/deviceMemory.ts';
import { ClosedView } from '../../ui/screens/common/Closed.tsx';
import { ErrorStateView } from '../../ui/screens/common/ErrorState.tsx';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import {
  QrFullscreenView,
  RoomPrepView,
  type ConnectionCheckModel,
  type PinReveal,
} from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { copyText } from './clipboard.ts';
import { errorCodeOf, errorMessage } from './errors.ts';
import { useRoomInfo } from './hooks/useRoomInfo.ts';
import { useTeacherRoom } from './hooks/useTeacherRoom.ts';
import { useToast } from './hooks/useToast.ts';
import { entryUrlOf, teacherLinkOf, teacherPaths } from './paths.ts';
import { TeacherRoomGate } from './TeacherRoomGate.tsx';
import { ToastLayer } from './ToastLayer.tsx';

const CHECK_IDLE: ConnectionCheckModel = { realtime: 'pending', ai: 'pending', storage: 'pending' };
const CHECK_RUNNING: ConnectionCheckModel = { realtime: 'running', ai: 'running', storage: 'running' };

/** 연결 점검 한 단계 결과를 화면 모양에 넣는다. 서버 응답 단계는 따로 보이지 않는다(실시간이 그 위에서 돈다). */
function applyCheckStep(model: ConnectionCheckModel, step: CheckResult, host: string): ConnectionCheckModel {
  const state = step.ok ? 'ok' : 'fail';
  switch (step.step) {
    case 'server':
      return model;
    case 'realtime':
      return {
        ...model,
        realtime: state,
        rttMs: step.latencyMs ?? null,
        ...(step.ok ? {} : { realtimeHost: host }),
      };
    case 'ai':
      return { ...model, ai: state };
    case 'storage':
      return { ...model, storage: state };
  }
}

/** T2 수업 준비(PRD F-16). `/t/room/:roomId/prep` */
export function RoomPrepRoute() {
  return <TeacherRoomGate>{entry => <RoomPrep key={entry.roomId} entry={entry} />}</TeacherRoomGate>;
}

function RoomPrep({ entry }: { entry: TeacherRoomMemory }) {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const { config } = deps;
  const toast = useToast(config.NOTICE_SHOW_SEC * MS_PER_SECOND);
  const { state: info, reload } = useRoomInfo(entry);
  // 연결 점검의 실시간 왕복은 이 수업방 채널로 잰다(PRD F-16). 화면에 있는 동안 연결을 열어 둔다.
  const room = useTeacherRoom(entry);
  const [pin, setPin] = useState<PinReveal>({ state: 'hidden' });
  const [check, setCheck] = useState<ConnectionCheckModel>(CHECK_IDLE);
  const [qrOpen, setQrOpen] = useState(false);
  const roomGone =
    info.status === 'error' &&
    (info.code === 'E_AUTH' || info.code === 'E_ROOM_EXPIRED' || info.code === 'E_ROOM_NOT_FOUND');
  useEffect(() => {
    // 다시 열 수 없는 방: 대시보드와 같은 정리(기억·기기 사본, 검토 B04).
    if (roomGone) void purgeRoomOnDevice(deps, entry.roomId).catch(() => undefined);
  }, [roomGone, deps, entry.roomId]);

  if (info.status === 'loading') return <LoadingView />;
  if (info.status === 'error') {
    if (roomGone) return <ClosedView kind="expired" onHome={() => navigate(teacherPaths.home)} />;
    return <ErrorStateView code={info.code} onRetry={reload} />;
  }
  const { room: roomInfo, entryCode, shortUrl, expiresAt } = info.info;
  const entryUrl = entryUrlOf(config, entryCode);
  const realtimeHost = new URL(config.PUBLIC_ORIGIN).host;

  const togglePin = async () => {
    if (pin.state === 'shown') {
      setPin({ state: 'hidden' });
      return;
    }
    setPin({ state: 'loading' });
    try {
      const result = await deps.api.teacherPinView(entry.roomId, entry.teacherToken);
      setPin({ state: 'shown', value: result.pin });
    } catch (error) {
      setPin({ state: 'hidden' });
      toast.show(errorMessage(errorCodeOf(error)), 'danger');
    }
  };

  const runCheck = async () => {
    const teacher = room.teacher;
    if (!teacher) {
      toast.show(errorMessage('E_OFFLINE'), 'danger');
      return;
    }
    setCheck(CHECK_RUNNING);
    try {
      await connectionCheck(
        deps,
        teacher,
        entry,
        step => setCheck(model => applyCheckStep(model, step, realtimeHost)),
        () => deps.newId(),
      );
    } catch (error) {
      setCheck(CHECK_IDLE);
      toast.show(errorMessage(errorCodeOf(error)), 'danger');
    }
  };

  const copyTeacherLink = async () => {
    const ok = await copyText(teacherLinkOf(config, entry.teacherToken));
    toast.show(ok ? ko.common.copiedToast : errorMessage('E_INTERNAL'), ok ? 'default' : 'danger');
  };

  const openTeacherLinkQr = () => {
    // 별도 창(PRD F-16). 토큰은 `#` 뒤로만 넘겨 서버 기록·주소 미리보기에 남지 않게 한다.
    // `noopener`라 새 창은 이 창을 모르고, 돌려받는 값도 없다(늘 null).
    globalThis.open(teacherPaths.linkQr(entry.roomId, entry.teacherToken), '_blank', 'noopener');
  };

  return (
    <>
      <RoomPrepView
        className={roomInfo.className}
        roomTitle={roomInfo.title}
        entryCode={entryCode}
        entryUrl={entryUrl}
        shortUrl={shortUrl}
        expiresAt={expiresAt}
        pin={pin}
        onTogglePin={() => void togglePin()}
        check={check}
        onRunCheck={() => void runCheck()}
        onOpenQrLarge={() => setQrOpen(true)}
        onCopyTeacherLink={() => void copyTeacherLink()}
        onOpenTeacherLinkQr={openTeacherLinkQr}
        onGoDashboard={() => navigate(teacherPaths.room(entry.roomId))}
        onBack={() => navigate(teacherPaths.home)}
      />
      {qrOpen ? (
        <QrFullscreenView
          roomTitle={roomInfo.title}
          className={roomInfo.className}
          entryCode={entryCode}
          entryUrl={entryUrl}
          shortUrl={shortUrl}
          onClose={() => setQrOpen(false)}
        />
      ) : null}
      <ToastLayer control={toast} />
    </>
  );
}
