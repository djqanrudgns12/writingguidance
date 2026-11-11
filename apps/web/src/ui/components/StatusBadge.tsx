import { ko } from '@geulbang/core/copy';
import { type HTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './StatusBadge.module.css';

export type StudentStatusKind = 'writing' | 'writing-flow' | 'idle' | 'submitted' | 'offline';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly status: StudentStatusKind;
  readonly label?: string | undefined;
}

const ICON_BY_STATUS: Record<StudentStatusKind, IconName> = {
  writing: 'write',
  'writing-flow': 'write',
  idle: 'clock',
  submitted: 'check',
  offline: 'offline',
};

/**
 * 교사 대시보드·서랍 학생 상태 배지 부품(PRD F-17, PLAN §9.2).
 * - `writing`: 최근 30초 안 입력(초록 바탕 + 채운 연필 아이콘 + `쓰는 중`)
 * - `writing-flow`: 30~180초 사이(테두리만 있는 연필 아이콘 + `쓰는 중`)
 * - `idle`: 180초 초과 입력 없음(버터 바탕 + 시계 아이콘 + `멈춤`)
 * - `submitted`: 제출 완료(하늘 바탕 + 체크 아이콘 + `제출`)
 * - `offline`: 연결 끊김(회색 톤 + 오프라인 아이콘 + `오프라인`)
 */
export function StatusBadge({ status, label, className, ...rest }: StatusBadgeProps) {
  const defaultLabel =
    status === 'writing' || status === 'writing-flow'
      ? ko.teacher.statusWriting
      : status === 'idle'
        ? ko.teacher.statusIdle
        : status === 'submitted'
          ? ko.teacher.statusSubmitted
          : ko.teacher.statusOffline;

  const resolvedLabel = label ?? defaultLabel;
  // 30~180초(`writing-flow`)는 눈에는 PRD F-17대로 `쓰는 중`이지만, 보조기기에는 `쓰는 흐름`으로 읽혀
  // 최근 30초 안 입력(`writing`)과 구분되게 한다(P5-1 [중-8]). 결합 쪽이 이름을 따로 주면 그대로 쓴다.
  const spokenLabel = label === undefined && status === 'writing-flow' ? ko.teacher.statusWritingFlow : null;
  const variantClass = status === 'writing-flow' ? styles.writingFlow : styles[status];
  const classes = [styles.badge, variantClass, className ?? ''].filter(Boolean).join(' ');

  return (
    <span data-status={status} className={classes} {...rest}>
      <Icon
        name={ICON_BY_STATUS[status]}
        size={16}
        className={(status === 'writing-flow' ? styles.outlineIcon : styles.icon) ?? ''}
      />
      {spokenLabel ? (
        <>
          <span className={styles.label} aria-hidden="true">
            {resolvedLabel}
          </span>
          <span className="visually-hidden">{spokenLabel}</span>
        </>
      ) : (
        <span className={styles.label}>{resolvedLabel}</span>
      )}
    </span>
  );
}
