import { ko } from '@geulbang/core/copy';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Menu, type MenuItemEntry } from '../../components/Menu.tsx';
import { Popover } from '../../components/Popover.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { Icon, type IconName } from '../../icons/Icon.tsx';
import { useMediaQuery, WIDE_LAYOUT_QUERY } from '../common/useMediaQuery.ts';
import styles from './Dashboard.module.css';
import { DashboardTimer } from './DashboardTimer.tsx';
import { formatRatio, joinDot } from './format.ts';
import { FilterChips, StudentTilesGrid } from './StudentTiles.tsx';
import type { DashboardFilter, StudentTileModel } from './tiles.ts';
import type { TimerModel } from './timerDraft.ts';

export interface DashboardViewProps {
  readonly roomTitle: string;
  readonly className: string;
  readonly roomStatus: 'ACTIVE' | 'CLOSED';
  /** 처음 `hello`를 받기 전이면 타일 자리에 종이 자리표시를 둔다. */
  readonly loading?: boolean | undefined;
  readonly nowMs: number;
  /** 별명 순으로 정렬한 타일(`sortTilesByNickname`). 한 번이라도 들어온 참가자 모두. */
  readonly tiles: readonly StudentTileModel[];
  /** 지금 접속 중인 참가자 수(`접속 n/m`의 n). 분모는 타일 수. */
  readonly connectedCount: number;
  readonly submittedCount: number;
  readonly filter: DashboardFilter;
  readonly onFilterChange: (filter: DashboardFilter) => void;
  readonly selectedParticipantId?: string | null | undefined;
  readonly onSelectTile: (participantId: string) => void;
  readonly timer: TimerModel;
  readonly onTimerPause: () => void;
  readonly onTimerResume: () => void;
  readonly onTimerCancel: () => void;
  /** 알림 팝오버(`NoticePanelView`)를 여닫는다. 내용은 결합 쪽이 `noticePanel`로 넣는다. */
  readonly noticeOpen: boolean;
  readonly onNoticeOpenChange: (open: boolean) => void;
  readonly noticePanel: ReactNode;
  readonly onOpenQr: () => void;
  readonly onOpenExport: () => void;
  readonly onOpenPrep: () => void;
  readonly onOpenSettings: () => void;
  readonly onCloseRoom: () => void;
  readonly onReopenRoom: () => void;
  readonly onDeleteRoom: () => void;
  /** 머리 아래 띠들(오프라인·닫힘·이어 쓰기 요청·삭제 예정) 자리. 순서대로 쌓는다. */
  readonly bands?: ReactNode | undefined;
  /** T4 서랍(`StudentDrawerView`). 있으면 900px 이상은 옆 칸, 그보다 좁으면 전체 화면. */
  readonly drawer?: ReactNode | undefined;
  /** 좁은 화면 전체 화면 서랍(모달 대화상자)의 읽기 이름. 보통 그 학생 별명. */
  readonly drawerLabel?: string | undefined;
  /** 하단 종이 토스트 자리. */
  readonly toast?: ReactNode | undefined;
}

function Count({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <span className={styles.count}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      <strong className={styles.countValue}>{value}</strong>
    </span>
  );
}

/**
 * T3 실시간 대시보드(PRD F-17). 정돈된 출석부 90% + 종이 10%: 그림은 빈 화면 한 장만, 채운 주요 단추 없음.
 * 머리(수업 이름·접속·제출·단추) → 띠 → 필터 칩·타이머 → 타일 격자. 서랍이 열리면 오른쪽 480px.
 */
export function DashboardView({
  roomTitle,
  className,
  roomStatus,
  loading = false,
  nowMs,
  tiles,
  connectedCount,
  submittedCount,
  filter,
  onFilterChange,
  selectedParticipantId = null,
  onSelectTile,
  timer,
  onTimerPause,
  onTimerResume,
  onTimerCancel,
  noticeOpen,
  onNoticeOpenChange,
  noticePanel,
  onOpenQr,
  onOpenExport,
  onOpenPrep,
  onOpenSettings,
  onCloseRoom,
  onReopenRoom,
  onDeleteRoom,
  bands,
  drawer,
  drawerLabel,
  toast,
}: DashboardViewProps) {
  const total = tiles.length;
  const hasDrawer = Boolean(drawer);
  // 900px 미만에서 서랍은 화면을 덮는 모달: 뒤 보드는 inert로 막아 Tab이 가려진 타일로 새지 않게 한다(P5-1 [상-1]).
  const wideLayout = useMediaQuery(WIDE_LAYOUT_QUERY);
  const modalDrawer = hasDrawer && !wideLayout;
  const mainRef = useRef<HTMLElement | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const hadDrawerRef = useRef(false);

  useEffect(() => {
    if (selectedParticipantId) lastSelectedRef.current = selectedParticipantId;
  }, [selectedParticipantId]);

  useEffect(() => {
    const had = hadDrawerRef.current;
    hadDrawerRef.current = hasDrawer;
    if (!had || hasDrawer) return;
    // 서랍이 닫히며 초점이 사라졌을 때만(닫기 단추·Escape) 연 타일로 돌려준다. 교사가 이미 옮긴 초점은 두고 간다.
    const active = document.activeElement;
    const id = lastSelectedRef.current;
    if (!id || (active !== null && active !== document.body)) return;
    const tileButtons = mainRef.current?.querySelectorAll<HTMLElement>('[data-participant-id]') ?? [];
    for (const el of tileButtons) {
      if (el.dataset['participantId'] === id) {
        el.focus();
        break;
      }
    }
  }, [hasDrawer]);

  const menuItems: MenuItemEntry[] = [
    { id: 'prep', label: ko.teacher.prepHeading, icon: 'qr', onSelect: onOpenPrep },
    { id: 'settings', label: ko.teacher.roomSettingsTitle, icon: 'settings', onSelect: onOpenSettings },
    roomStatus === 'CLOSED'
      ? { id: 'reopen', label: ko.teacher.reopenRoomAction, icon: 'book', onSelect: onReopenRoom }
      : { id: 'close', label: ko.teacher.closeRoomAction, icon: 'locked', onSelect: onCloseRoom },
    {
      id: 'delete',
      label: ko.teacher.deleteRoomNowAction,
      icon: 'warning',
      tone: 'danger',
      separatorBefore: true,
      onSelect: onDeleteRoom,
    },
  ];

  return (
    <div className={[styles.page, drawer ? styles.withDrawer : ''].filter(Boolean).join(' ')}>
      <main ref={mainRef} className={styles.main} inert={modalDrawer || undefined}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{joinDot(roomTitle, className)}</h1>
          </div>
          <div className={styles.counts}>
            <Count
              icon="students"
              label={ko.teacher.connectedCountPrefix}
              value={formatRatio(connectedCount, total)}
            />
            <Count
              icon="check"
              label={ko.teacher.submittedCountPrefix}
              value={formatRatio(submittedCount, total)}
            />
          </div>
          <div className={styles.actions}>
            <Popover
              open={noticeOpen}
              onOpenChange={onNoticeOpenChange}
              title={ko.teacher.noticeButton}
              showCloseButton
              className={styles.noticePopup}
              trigger={
                <Button variant="secondary" icon="notice">
                  {ko.teacher.noticeButton}
                </Button>
              }
            >
              {noticePanel}
            </Popover>
            <Button variant="secondary" icon="qr" onClick={onOpenQr}>
              {ko.teacher.qrButton}
            </Button>
            <Button variant="secondary" icon="download" onClick={onOpenExport}>
              {ko.teacher.downloadButton}
            </Button>
          </div>
          <div className={styles.menu}>
            <Menu items={menuItems} />
          </div>
        </header>

        {bands ? <div className={styles.bands}>{bands}</div> : null}

        {loading ? (
          <div className={styles.skeletons} aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} variant="tile" lines={2} showLabelImmediately={i === 0} />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            className={styles.empty}
            artName="empty-desks"
            artWidth={220}
            title={ko.teacher.emptyRoomTitle}
            actionLabel={ko.teacher.emptyRoomAction}
            onAction={onOpenQr}
          />
        ) : (
          <>
            <div className={styles.toolbar}>
              <FilterChips
                className={styles.toolbarChips}
                tiles={tiles}
                filter={filter}
                onFilterChange={onFilterChange}
              />
              <span className={styles.toolbarTimer}>
                <DashboardTimer
                  timer={timer}
                  onPause={onTimerPause}
                  onResume={onTimerResume}
                  onCancel={onTimerCancel}
                />
              </span>
            </div>
            <StudentTilesGrid
              tiles={tiles}
              filter={filter}
              nowMs={nowMs}
              selectedParticipantId={selectedParticipantId}
              onSelect={onSelectTile}
            />
          </>
        )}
      </main>
      {drawer ? (
        <div
          className={styles.drawerSlot}
          role={modalDrawer ? 'dialog' : undefined}
          aria-modal={modalDrawer || undefined}
          aria-label={modalDrawer ? drawerLabel : undefined}
        >
          {drawer}
        </div>
      ) : null}
      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </div>
  );
}
