import { ko } from '@geulbang/core/copy';
import { Button } from '../../components/Button.tsx';
import { Icon, type IconName } from '../../icons/Icon.tsx';
import styles from './ConnectionCheck.module.css';
import { formatRatio, formatSeconds, joinDot } from './format.ts';

/** 항목 하나의 단계. pending은 아직 누르지 않음, running은 확인 중. */
export type CheckItemState = 'pending' | 'running' | 'ok' | 'fail';

/** PRD F-16 연결 점검 결과 모양(세 항목 동시, 10초 안). */
export interface ConnectionCheckModel {
  readonly realtime: CheckItemState;
  readonly ai: CheckItemState;
  readonly storage: CheckItemState;
  /** 실시간 왕복 평균(ms). 아직 없으면 null. */
  readonly rttMs?: number | null | undefined;
  /** 오늘 AI 사용(전체 하루 한도 기준, PRD F-16 "오늘 AI 사용 120/3000"). */
  readonly aiUsedToday?: number | null | undefined;
  readonly aiDailyLimit?: number | null | undefined;
  /** 실시간 연결 실패 때 허용을 부탁할 주소(예: write.ssamuniverse.com). */
  readonly realtimeHost?: string | undefined;
}

export interface ConnectionCheckViewProps {
  readonly check: ConnectionCheckModel;
  readonly onRun: () => void;
}

interface ItemDef {
  readonly key: 'realtime' | 'ai' | 'storage';
  readonly label: string;
  readonly fail: string;
}

const ITEMS: readonly ItemDef[] = [
  { key: 'realtime', label: ko.teacher.checkRealtimeLabel, fail: ko.teacher.checkRealtimeFail },
  { key: 'ai', label: ko.teacher.checkAiLabel, fail: ko.teacher.checkAiFail },
  { key: 'storage', label: ko.teacher.checkStorageLabel, fail: ko.teacher.checkStorageFail },
];

const ICON_BY_STATE: Record<CheckItemState, IconName> = {
  pending: 'clock',
  running: 'sending',
  ok: 'check',
  fail: 'warning',
};

/**
 * 아이콘이 말하는 상태를 보조기기에도 이름으로 준다(P5-1 [중-7]). 실패는 바로 옆 안내 문구가 읽히므로 아이콘은 숨긴다.
 * 대기(`pending`)는 `확인 전`(`ko.teacher.checkItemPending`).
 */
const STATE_LABEL: Record<CheckItemState, string | undefined> = {
  pending: ko.teacher.checkItemPending,
  running: ko.teacher.checkItemRunning,
  ok: ko.teacher.checkItemOk,
  fail: undefined,
};

/**
 * 연결 점검(PRD F-16 `[고정]`). 세 항목을 줄마다 아이콘 + 이름으로 보이고, 실패한 항목만 쉬운 말 안내를 덧붙인다.
 * 셋 다 좋으면 `모두 좋아요` 한 줄, 아래 작은 글씨로 왕복 시간과 오늘 AI 사용.
 */
export function ConnectionCheckView({ check, onRun }: ConnectionCheckViewProps) {
  const states = ITEMS.map(item => check[item.key]);
  const running = states.includes('running');
  const started = states.some(s => s !== 'pending');
  const allGood = states.every(s => s === 'ok');
  const footnote = joinDot(
    check.rttMs !== null && check.rttMs !== undefined
      ? `${ko.teacher.checkRttPrefix}${formatSeconds(check.rttMs)}`
      : '',
    check.aiUsedToday !== null &&
      check.aiUsedToday !== undefined &&
      check.aiDailyLimit !== null &&
      check.aiDailyLimit !== undefined
      ? `${ko.teacher.checkAiUsagePrefix}${formatRatio(check.aiUsedToday, check.aiDailyLimit)}`
      : '',
  );

  return (
    <section className={styles.check} aria-live="polite" aria-busy={running || undefined}>
      <div className={styles.head}>
        <Button variant="secondary" icon="sending" loading={running} onClick={onRun}>
          {ko.teacher.connectionCheckAction}
        </Button>
        {allGood ? (
          <span className={styles.allGood} data-testid="check-all-good">
            <Icon name="check" size={20} />
            {ko.teacher.checkAllGood}
          </span>
        ) : null}
      </div>

      {started ? (
        <ul className={styles.items}>
          {ITEMS.map(item => {
            const state = check[item.key];
            const stateLabel = STATE_LABEL[state];
            return (
              <li key={item.key} className={[styles.item, styles[state]].join(' ')} data-state={state}>
                <span className={styles.itemIcon}>
                  <Icon
                    name={ICON_BY_STATE[state]}
                    size={20}
                    {...(stateLabel ? { label: stateLabel } : {})}
                  />
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemLabel}>{item.label}</span>
                  {state === 'fail' ? (
                    <span className={styles.itemFail}>
                      {item.fail}
                      {item.key === 'realtime' && check.realtimeHost ? (
                        <code className={styles.host}>{check.realtimeHost}</code>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
    </section>
  );
}
