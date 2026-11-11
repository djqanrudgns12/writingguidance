import { ko } from '@geulbang/core/copy';
import { Menu, type MenuItemEntry } from '../../components/Menu.tsx';
import { TimerPill } from '../../components/TimerPill.tsx';
import type { TimerModel } from './timerDraft.ts';

export interface DashboardTimerProps {
  readonly timer: TimerModel;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onCancel: () => void;
}

/**
 * 대시보드 위 작은 시계 알약(PRD F-19). 누르면 `멈춤`(또는 `계속`)·`취소` 메뉴가 열린다.
 * 타이머가 없으면 아무것도 그리지 않는다. 남은 1분·끝남 색은 알약 부품이 정한다.
 */
export function DashboardTimer({ timer, onPause, onResume, onCancel }: DashboardTimerProps) {
  if (timer.status === 'IDLE' || timer.remainingSec === null) return null;
  const paused = timer.status === 'PAUSED';
  const ended = !paused && timer.remainingSec <= 0;

  const items: MenuItemEntry[] = [];
  if (paused) {
    items.push({ id: 'resume', label: ko.teacher.timerResumeAction, icon: 'timer', onSelect: onResume });
  } else if (!ended) {
    items.push({ id: 'pause', label: ko.teacher.timerPauseAction, icon: 'pause', onSelect: onPause });
  }
  items.push({
    id: 'cancel',
    label: ko.teacher.timerCancelAction,
    icon: 'close',
    tone: 'danger',
    onSelect: onCancel,
  });

  return (
    <Menu
      items={items}
      align="end"
      trigger={
        <TimerPill
          // 단추 모드: Menu가 누름 처리를 덧붙인다(빈 처리기 없이 단추로 그린다).
          asButton
          remainingSeconds={timer.remainingSec}
          state={paused ? 'paused' : undefined}
        />
      }
    />
  );
}
