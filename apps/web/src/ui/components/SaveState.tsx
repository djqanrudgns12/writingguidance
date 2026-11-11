import { ko } from '@geulbang/core/copy';
import { type HTMLAttributes } from 'react';
import { Icon, type IconName } from '../icons/Icon.tsx';
import styles from './SaveState.module.css';

export type SaveStatus = 'saved' | 'sending' | 'local' | 'locked';

export interface SaveStateProps extends HTMLAttributes<HTMLSpanElement> {
  readonly state: SaveStatus;
  readonly label?: string | undefined;
  /**
   * 보조기기에 이 상태를 알릴지. 기본은 학생이 알아야 하는 전환(`local` 여기에만 저장, `locked` 제출 완료)만.
   * 글을 쓰는 내내 몇 초마다 오가는 `saved`↔`sending`은 알리지 않는다(P5-1 [상-2]). 제출 대기처럼
   * `sending` 모양에 다른 이름을 붙일 때는 결합 쪽이 `true`로 켠다.
   */
  readonly announce?: boolean | undefined;
}

const ICON_BY_STATE: Record<SaveStatus, IconName> = {
  saved: 'saved',
  sending: 'sending',
  local: 'localOnly',
  locked: 'locked',
};

/**
 * 쓰기 화면 저장 상태 표시 부품(PRD F-06, F-09, F-11, PLAN §6.5, §9.2).
 * 색만으로 구분하지 않고 상태색 + 아이콘 + 글자(`저장됨` / `보내는 중` / `여기에만 저장` / `제출 완료`)를 함께 그린다.
 */
export function SaveState({ state, label, announce, className, ...rest }: SaveStateProps) {
  const defaultLabel =
    state === 'saved'
      ? ko.common.saveSaved
      : state === 'sending'
        ? ko.common.saveSending
        : state === 'local'
          ? ko.common.saveLocal
          : ko.common.saveLocked;

  const resolvedLabel = label ?? defaultLabel;
  const shouldAnnounce = announce ?? (state === 'local' || state === 'locked');
  const classes = [styles.badge, styles[state], className ?? ''].filter(Boolean).join(' ');

  return (
    <span data-save-state={state} className={classes} {...rest}>
      <Icon name={ICON_BY_STATE[state]} size={16} className={styles.icon ?? ''} />
      <span className={styles.label}>{resolvedLabel}</span>
      {/* 알림 자리는 늘 그려 두고 글만 바꾼다(새로 붙은 라이브 영역은 첫 글을 놓치는 보조기기가 있다). */}
      <span role="status" className="visually-hidden">
        {shouldAnnounce ? resolvedLabel : ''}
      </span>
    </span>
  );
}
