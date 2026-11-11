import { ko } from '@geulbang/core/copy';
import { useId, useState } from 'react';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { NARROW_LAYOUT_QUERY, useMediaQuery } from '../common/useMediaQuery.ts';
import styles from './DashboardBands.module.css';
import { formatMonthDay } from './format.ts';

/** 이어 쓰기 요청 하나(`resume.pending`, PRD F-14). */
export interface ResumeRequestItem {
  readonly requestId: string;
  readonly nickname: string;
}

export interface ResumeRequestsBandProps {
  readonly requests: readonly ResumeRequestItem[];
  readonly onDecide: (requestId: string, approve: boolean) => void;
  readonly onApproveAll: () => void;
  /** 결정을 보내는 중인 요청(그 줄 단추만 막는다). */
  readonly pendingIds?: readonly string[] | undefined;
  /**
   * 요청 목록을 `이어 쓰기 요청 N건` 한 줄로 접고 `보기`로 펼친다. 없으면 900px 미만에서만 접는다(`NARROW_LAYOUT_QUERY`)
   * (360px에서 요청 줄이 학생 타일을 첫 화면 밖으로 밀었다, P5-4 시각 검토 2번).
   */
  readonly collapsible?: boolean | undefined;
}

/**
 * 이어 쓰기 요청 띠(PRD F-14·F-17). 요청이 있을 때만 보이고, 2개 이상이면 `모두 허용`이 생긴다.
 * 별명 뒤 조사(가/이)를 붙이지 않으려고 "이어 쓰기 요청: 별명 [허용][거절]" 모양으로 둔다.
 * 좁은 화면은 `이어 쓰기 요청 N건 [보기]` 한 줄로 접어 두고, 펼치면 줄마다 [허용][거절]과 `모두 허용`이 나온다.
 */
export function ResumeRequestsBand({
  requests,
  onDecide,
  onApproveAll,
  pendingIds = [],
  collapsible,
}: ResumeRequestsBandProps) {
  const narrow = useMediaQuery(NARROW_LAYOUT_QUERY);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (requests.length === 0) return null;
  const folds = collapsible ?? narrow;
  const approveAll =
    requests.length >= 2 ? (
      <Button variant="secondary" icon="check" onClick={onApproveAll}>
        {ko.teacher.resumeApproveAllAction}
      </Button>
    ) : undefined;

  if (folds) {
    const summary = `${ko.teacher.resumeSummaryLabel} ${requests.length}${ko.teacher.resumeSummaryCountSuffix}`;
    return (
      <Banner
        tone="notice"
        icon="students"
        inlineAction
        // 접혀 있으면 한 줄이라 가운데, 펼치면 목록이 길어져 단추를 첫 줄 높이에 둔다.
        className={expanded ? styles.resume : undefined}
        data-collapsed={expanded ? 'false' : 'true'}
        action={
          <Button
            variant="secondary"
            aria-expanded={expanded}
            aria-controls={expanded ? listId : undefined}
            onClick={() => setExpanded(open => !open)}
          >
            {expanded ? ko.teacher.resumeCollapseAction : ko.teacher.resumeExpandAction}
          </Button>
        }
      >
        <div className={styles.resumeFolded}>
          <span className={styles.resumeLabel}>{summary}</span>
          {expanded ? (
            <div id={listId} className={styles.resumeFoldedBody}>
              <ResumeRequestList requests={requests} onDecide={onDecide} pendingIds={pendingIds} />
              {approveAll ? <div className={styles.resumeFoldedAll}>{approveAll}</div> : null}
            </div>
          ) : null}
        </div>
      </Banner>
    );
  }

  return (
    <Banner tone="notice" icon="students" className={styles.resume} action={approveAll}>
      <div className={styles.resumeBody}>
        <span className={styles.resumeLabel}>{ko.teacher.resumeBannerLabel}</span>
        <ResumeRequestList requests={requests} onDecide={onDecide} pendingIds={pendingIds} />
      </div>
    </Banner>
  );
}

function ResumeRequestList({
  requests,
  onDecide,
  pendingIds,
}: Pick<ResumeRequestsBandProps, 'requests' | 'onDecide'> & { readonly pendingIds: readonly string[] }) {
  return (
    <ul className={styles.resumeList}>
      {requests.map(req => {
        const busy = pendingIds.includes(req.requestId);
        return (
          <li key={req.requestId} className={styles.resumeItem}>
            <span className={styles.nickname}>{req.nickname}</span>
            <span className={styles.resumeActions}>
              {/* 줄마다 같은 `허용`·`거절`이 되풀이되지 않게 읽기 이름에 별명을 앞에 붙인다(보이는 글자를 포함, P5-1 [중-9]). */}
              <Button
                variant="secondary"
                disabled={busy}
                aria-label={`${req.nickname} ${ko.teacher.resumeApproveAction}`}
                onClick={() => onDecide(req.requestId, true)}
              >
                {ko.teacher.resumeApproveAction}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={`${req.nickname} ${ko.teacher.resumeRejectAction}`}
                onClick={() => onDecide(req.requestId, false)}
              >
                {ko.teacher.resumeRejectAction}
              </Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export interface ExpiryBandProps {
  readonly expiresAt: number;
  readonly onDownload: () => void;
}

/**
 * 삭제 3일 전부터 보이는 띠(PRD F-17·F-24). 언제 보일지는 결합 쪽이 `RetentionPolicy`로 정한다.
 * 좁은 화면은 날짜 한 줄 + 같은 줄 `내려받기`로 줄인다(P5-4 시각 검토 2번). "미리 내려받아" 권유는 단추가 대신한다.
 */
export function ExpiryBand({ expiresAt, onDownload }: ExpiryBandProps) {
  const narrow = useMediaQuery(NARROW_LAYOUT_QUERY);
  const suffix = narrow ? ko.teacher.expiryWarningShortSuffix : ko.teacher.expiryWarningSuffix;
  return (
    <Banner
      tone="warning"
      icon="clock"
      inlineAction={narrow}
      message={`${formatMonthDay(expiresAt)}${suffix}`}
      action={
        <Button variant="secondary" icon="download" onClick={onDownload}>
          {ko.teacher.downloadButton}
        </Button>
      }
    />
  );
}

export interface ClosedBandProps {
  /** 닫힌 수업방 안내 문구(결합 쪽이 `ko`에서 고른다). */
  readonly message: string;
  readonly onReopen: () => void;
}

/** 수업방을 닫았을 때 띠(PRD F-22): 학생은 읽기만, `다시 열기`로 되돌린다. 단추는 글 옆 같은 줄(띠 높이 줄이기). */
export function ClosedBand({ message, onReopen }: ClosedBandProps) {
  return (
    <Banner
      kind="closed"
      inlineAction
      message={message}
      action={
        <Button variant="secondary" onClick={onReopen}>
          {ko.teacher.reopenRoomAction}
        </Button>
      }
    />
  );
}

export interface OfflineBandProps {
  readonly message: string;
}

/** 교사 기기 연결이 끊겼을 때 띠(PRD 7.2 오프라인). */
export function OfflineBand({ message }: OfflineBandProps) {
  return <Banner kind="offline" message={message} />;
}
