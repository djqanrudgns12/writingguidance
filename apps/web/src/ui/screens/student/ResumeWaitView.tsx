import { ko } from '@geulbang/core/copy';
import { EmptyState } from '../../components/index.ts';
import styles from './ResumeWaitView.module.css';

export type ResumeWaitStatus = 'waiting' | 'rejected';

export interface ResumeWaitViewProps {
  readonly status: ResumeWaitStatus;
  /** 기다린 지 `RESUME_WAIT_HINT_MIN`(30분)이 지나면 결합하는 쪽이 켠다(PRD F-14: 요청은 저절로 사라지지 않는다). */
  readonly longWait?: boolean | undefined;
  readonly onCancel: () => void;
  /** 거절된 뒤 별명 화면으로 돌아가기. */
  readonly onChooseOther: () => void;
}

/**
 * S6 이어 쓰기 기다림(PRD F-14, 7.1: 주요 버튼 없음, `취소`는 보조). 편지를 든 글벗 그림 1장.
 * 거절되면 "다른 별명으로 들어가요"와 별명 화면으로 돌아가는 버튼 하나만 둔다.
 */
export function ResumeWaitView({ status, longWait = false, onCancel, onChooseOther }: ResumeWaitViewProps) {
  if (status === 'rejected') {
    return (
      <main className={styles.page} data-screen="S6" data-status="rejected">
        <EmptyState
          artName="gulbeot-thinking"
          artWidth={160}
          artPriority
          // 상태 그림 틀은 하나로: 빈 화면·만료 그림과 같은 손그림 테두리(PRD 8.3, P5-4 시각 검토 5번)
          frameSize="md"
          title={ko.student.resumeRejectedTitle}
          actionLabel={ko.student.nicknameChangeAction}
          onAction={onChooseOther}
          actionVariant="primary"
        />
      </main>
    );
  }

  return (
    <main className={styles.page} data-screen="S6" data-status="waiting" aria-busy="true">
      <EmptyState
        artName="waiting-letter"
        artWidth={200}
        artPriority
        frameSize="md"
        title={ko.student.resumeWaitTitle}
        description={longWait ? ko.student.resumeWaitLongHint : undefined}
        actionLabel={ko.common.cancel}
        onAction={onCancel}
        actionVariant="secondary"
        liveText
      />
    </main>
  );
}
