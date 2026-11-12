import { ko } from '@geulbang/core/copy';
import { type CSSProperties, type Ref } from 'react';
import { Button, Gulbeot, MemoCard, Panel, type SheetProps } from '../../../components/index.ts';
import { Icon } from '../../../icons/Icon.tsx';
import { cx } from '../../common/cx.ts';
import { formatAgo } from '../../common/format.ts';
import { SheetSurface } from '../../common/SheetSurface.tsx';
import { AI_BUTTON_LABEL } from './AiChipBar.tsx';
import styles from './ResultPanel.module.css';
import type {
  DirectionIdeaView,
  FeedbackView,
  ResultNoticeView,
  ResultPanelView,
  SpellItemView,
  SpellKindView,
  SpellSeverityView,
} from './types.ts';

/** 기다림 자리표시 카드 3장의 줄 수(결과 카드 모양: 머리 짧은 줄 + 본문 줄, 줄 길이는 CSS). */
const PLACEHOLDER_CARDS: readonly number[] = [3, 3, 2];

const SPELL_KIND_LABEL: Record<SpellKindView, string> = {
  spelling: ko.student.aiSpellKindSpelling,
  spacing: ko.student.aiSpellKindSpacing,
  punctuation: ko.student.aiSpellKindPunctuation,
};

/** 등급 글자(색맹이어도 구분되게 늘 글자로도 둔다, 읽기 이름에도 들어간다). */
const SPELL_SEVERITY_LABEL: Record<SpellSeverityView, string> = {
  fix: ko.student.aiSpellSeverityFix,
  suggest: ko.student.aiSpellSeveritySuggest,
  keep: ko.student.aiSpellSeverityKeep,
};

const SPELL_SEVERITY_CLASS: Record<SpellSeverityView, string | undefined> = {
  fix: undefined,
  suggest: styles.spellItemSuggest,
  keep: styles.spellItemKeep,
};

const NOTICE_TEXT: Record<ResultNoticeView, string> = {
  personalInfo: ko.student.aiNoticePersonalInfo,
  kindWords: ko.student.aiNoticeKindWords,
};

export interface ResultPanelProps {
  readonly view: ResultPanelView;
  /** `side`: 900px 이상 옆 패널, `sheet`: 바텀시트(60%, 끌어 닫기), `inline`: 견본용 제자리 시트. */
  readonly placement: 'side' | 'sheet' | 'inline';
  readonly now: number;
  /** 글자 크기 설정(PRD F-13: 쓰기 칸과 패널에 함께). */
  readonly fontSize: number;
  /** 다듬은 글과 나란히 볼 내 글. 옆 패널에서는 쓰기 칸이 바로 옆이라 비워 둔다. */
  readonly mineText?: string | undefined;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  /** 맞춤법 항목 누름 → 결합하는 쪽이 `binding.select`·`highlight`(반영 문 조건을 지킴). */
  readonly onSpellItem: (itemId: string) => void;
  readonly onCopyPolish: () => void;
  /** 옆 패널 뿌리(`aside`). 칩으로 열었을 때 쓰기 화면이 이 자리로 초점을 옮긴다(P5-1 [중-3]). */
  readonly panelRef?: Ref<HTMLElement> | undefined;
  /** 바텀시트가 열릴 때 초점(부품 `Sheet`의 `initialFocus`). */
  readonly sheetInitialFocus?: SheetProps['initialFocus'];
  /** `다시 받기`를 막는다(닫힌 수업방: 읽기만, 서버도 `E_ROOM_CLOSED`로 거절). 받은 결과는 그대로 읽을 수 있다. */
  readonly refreshDisabled?: boolean | undefined;
}

/**
 * AI 결과 패널 4종(PRD F-08, 6.3, 6.5, F-26). 머리에 작은 글벗과 버튼 이름, 아래에 `다시 받기`와 받은 시각.
 * 결과는 보여 주기만 한다: '모두 고치기'·'적용' 같은 자동 반영 버튼은 없다.
 */
export function ResultPanel({
  view,
  placement,
  now,
  fontSize,
  mineText,
  onClose,
  onRefresh,
  onSpellItem,
  onCopyPolish,
  panelRef,
  sheetInitialFocus,
  refreshDisabled = false,
}: ResultPanelProps) {
  const label = AI_BUTTON_LABEL[view.button].full;
  // 화면당 그림 한 장(PRD 8.10, 디자인 판정 6번): 기다림·한도는 표정 글벗 하나를 머리 자리에 두고 본문에는 글만.
  const moodMedia =
    view.status === 'loading' ? (
      <Gulbeot mood="reading" size={48} />
    ) : view.status === 'limit' ? (
      <Gulbeot mood="resting" size={48} />
    ) : null;
  const fontStyle = { '--panel-fs': `${fontSize}px` } as CSSProperties;
  const body = <ResultPanelBody view={view} mineText={mineText} onSpellItem={onSpellItem} />;
  // 바닥이 비는 상태(기다림·한도·받는 중)는 바닥 자리째 빼서 빈 띠가 남지 않게 한다.
  const footer = hasFooter(view) ? (
    <ResultPanelFooter
      view={view}
      now={now}
      onRefresh={onRefresh}
      onCopyPolish={onCopyPolish}
      refreshDisabled={refreshDisabled}
    />
  ) : undefined;

  if (placement === 'side') {
    return (
      <Panel
        ref={panelRef}
        as="aside"
        aria-label={label}
        // 코드로만 초점을 받는다(Tab 순서에는 넣지 않는다).
        tabIndex={-1}
        className={styles.side}
        headerMedia={moodMedia ?? <Gulbeot size={32} />}
        title={label}
        onClose={onClose}
        footer={footer}
        style={fontStyle}
        data-result={view.button}
        data-status={view.status}
      >
        {body}
      </Panel>
    );
  }

  return (
    <SheetSurface
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={label}
      showGulbeot
      headerMedia={moodMedia ?? undefined}
      // 한도 안내는 두 줄뿐이라 시트를 내용 높이로 줄인다(P5-4 시각 검토 3번). 나머지는 60% 고정(PRD F-06).
      height={view.status === 'limit' ? 'fit' : 'result'}
      modal={false}
      initialFocus={sheetInitialFocus}
      inline={placement === 'inline'}
      footer={footer}
      bodyStyle={fontStyle}
    >
      <div data-result={view.button} data-status={view.status} className={styles.sheetBody}>
        {body}
      </div>
    </SheetSurface>
  );
}

interface ResultPanelBodyProps {
  readonly view: ResultPanelView;
  readonly mineText?: string | undefined;
  readonly onSpellItem: (itemId: string) => void;
}

function ResultPanelBody({ view, mineText, onSpellItem }: ResultPanelBodyProps) {
  if (view.status === 'loading') {
    // PRD 7.2 불러오는 중: 종이 카드 모양의 옅은 자리표시(P5-4 시각 검토 3번). 안내 글은 한 줄만 읽힌다.
    return (
      <div className={styles.waiting}>
        <p className={styles.waitingText} role="status" aria-live="polite">
          {ko.student.aiReadingStatus}
        </p>
        <div className={styles.placeholders} aria-hidden="true" data-placeholder="">
          {PLACEHOLDER_CARDS.map((bars, index) => (
            <div key={index} className={styles.placeholderCard}>
              {Array.from({ length: bars }, (_, bar) => (
                <span key={bar} className={styles.placeholderBar} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (view.status === 'limit') {
    return (
      <div className={styles.limitCard} role="status">
        <p className={styles.limitText}>{ko.student.aiDailyLimitGuide}</p>
        <p className={styles.limitHint}>
          <Icon name="clock" size={16} />
          <span>{ko.student.aiDailyLimitNextHint}</span>
        </p>
      </div>
    );
  }

  if (view.status === 'error') {
    return (
      <p className={styles.errorLine} role="alert">
        <Icon name="warning" size={20} />
        <span>{ko.errors[view.errorCode ?? 'E_INTERNAL'] || ko.errors.E_INTERNAL}</span>
      </p>
    );
  }

  const content = view.content;
  if (!content) return null;

  return (
    <div className={styles.content}>
      {view.tailOnly ? (
        <p className={styles.notice}>
          <Icon name="notice" size={16} />
          <span>{ko.student.aiLongInputTailNotice}</span>
        </p>
      ) : null}
      {(view.notices ?? []).map(notice => (
        <p key={notice} className={styles.safetyNotice} data-notice={notice}>
          <Icon name="notice" size={16} />
          <span>{NOTICE_TEXT[notice]}</span>
        </p>
      ))}
      {content.kind === 'SPELL' ? (
        <SpellList items={content.items} activeItemId={content.activeItemId} onSpellItem={onSpellItem} />
      ) : null}
      {content.kind === 'FEEDBACK' ? <FeedbackCards result={content.result} /> : null}
      {content.kind === 'DIRECTION' ? <DirectionList ideas={content.ideas} /> : null}
      {content.kind === 'POLISH' ? (
        <PolishCompare
          text={content.text}
          done={content.done}
          lengthWarning={content.lengthWarning === true}
          truncated={content.truncated === true}
          mineText={mineText}
        />
      ) : null}
    </div>
  );
}

function SpellList({
  items,
  activeItemId,
  onSpellItem,
}: {
  readonly items: readonly SpellItemView[];
  readonly activeItemId?: string | null | undefined;
  readonly onSpellItem: (itemId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className={styles.emptyLine}>
        <Icon name="check" size={20} />
        <span>{ko.student.aiSpellEmpty}</span>
      </p>
    );
  }

  // 고쳐요가 맨 위(받은 순서 그대로), 권장해요는 그 아래, 그대로 둬도 돼요는 접어 둔다(docs/ai-harness.md 5절).
  const fix = items.filter(item => item.severity === 'fix');
  const suggest = items.filter(item => item.severity === 'suggest');
  const keep = items.filter(item => item.severity === 'keep');
  const row = (item: SpellItemView) => (
    <SpellRow key={item.id} item={item} active={activeItemId === item.id} onSpellItem={onSpellItem} />
  );

  return (
    <div className={styles.spellGroups} data-spell-groups="">
      {fix.length === 0 ? (
        <p className={styles.emptyLine} data-spell-no-fix="">
          <Icon name="check" size={20} />
          <span>{ko.student.aiSpellNoFixNeeded}</span>
        </p>
      ) : (
        <ul className={styles.spellList} data-severity-group="fix">
          {fix.map(row)}
        </ul>
      )}
      {suggest.length > 0 ? (
        <>
          <p className={styles.guideLine}>
            <Icon name="notice" size={16} />
            <span>{ko.student.aiSpellSuggestGuide}</span>
          </p>
          <ul className={styles.spellList} data-severity-group="suggest">
            {suggest.map(row)}
          </ul>
        </>
      ) : null}
      {keep.length > 0 ? (
        // 기본으로 접혀 있다. 고칠 곳 수에 넣지 않으려고 이 안의 개수만 따로 센다.
        <details className={styles.keepGroup} data-severity-group="keep">
          <summary className={styles.keepSummary}>
            <Icon name="show" size={16} />
            <span>
              {ko.student.aiSpellKeepSummaryPrefix}
              <span className="tabular">{keep.length}</span>
              {ko.student.aiSpellKeepSummarySuffix}
            </span>
          </summary>
          <div className={styles.keepBody}>
            <p className={styles.guideLine}>{ko.student.aiSpellKeepGuide}</p>
            <ul className={styles.spellList}>{keep.map(row)}</ul>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function SpellRow({
  item,
  active,
  onSpellItem,
}: {
  readonly item: SpellItemView;
  readonly active: boolean;
  readonly onSpellItem: (itemId: string) => void;
}) {
  // 바꿀 말이 비면(학생 글 속 비속어 자리, S-09) 원래 말을 되풀이하지 않고 이유만 보인다.
  const showChange = item.suggestion !== '';
  const inner = (
    <>
      <span className={styles.spellTop}>
        {item.severity === 'fix' ? (
          // 고쳐요는 지금 모양 그대로 두고, 읽기 이름에만 등급을 넣는다.
          <span className="visually-hidden">{SPELL_SEVERITY_LABEL.fix}</span>
        ) : (
          <span className={styles.severityBadge} data-severity={item.severity}>
            {SPELL_SEVERITY_LABEL[item.severity]}
          </span>
        )}
        <span className={styles.spellKind}>{SPELL_KIND_LABEL[item.kind]}</span>
        {showChange ? (
          <span className={styles.spellChange}>
            <span className={styles.original}>{item.original}</span>
            <span aria-hidden="true" className={styles.arrow}>
              {'→'}
            </span>
            <strong className={styles.suggestion}>{item.suggestion}</strong>
          </span>
        ) : null}
      </span>
      <span className={styles.reasonLine}>
        <span className={styles.reason}>{item.reason}</span>
        {item.ruleLabel ? <span className={styles.ruleLabel}>{item.ruleLabel}</span> : null}
      </span>
    </>
  );
  const severityClass = SPELL_SEVERITY_CLASS[item.severity];
  return (
    <li data-severity={item.severity}>
      {item.locatable ? (
        <button
          type="button"
          className={cx(styles.spellItem, severityClass, active && styles.spellItemActive)}
          aria-current={active ? 'true' : undefined}
          // 쓰기 칸의 선택·조합을 끊지 않도록 누를 때 초점을 가져오지 않는다.
          onMouseDown={event => event.preventDefault()}
          onClick={() => onSpellItem(item.id)}
        >
          {inner}
        </button>
      ) : (
        <div className={cx(styles.spellItem, severityClass, styles.spellItemLocked)} aria-disabled="true">
          {inner}
          <span className={styles.unlocated}>
            <Icon name="warning" size={16} />
            {ko.student.aiSpellUnlocatedHint}
          </span>
        </div>
      )}
    </li>
  );
}

function FeedbackCards({ result }: { readonly result: FeedbackView }) {
  return (
    <div className={styles.cards}>
      <MemoCard tone="praise" icon="check" heading={ko.student.aiFeedbackPraiseHeading}>
        <p className={styles.cardText}>{result.praise}</p>
      </MemoCard>
      {result.improve.length > 0 ? (
        <MemoCard tone="improve" icon="write" heading={ko.student.aiFeedbackImproveHeading}>
          <ul className={styles.cardList}>
            {result.improve.map((line, index) => (
              <li key={index} className={styles.cardText}>
                {line}
              </li>
            ))}
          </ul>
        </MemoCard>
      ) : null}
      {result.factCheck ? (
        <MemoCard tone="note" icon="book" heading={ko.student.aiFeedbackFactCheckHeading}>
          <p className={styles.cardText}>{result.factCheck}</p>
        </MemoCard>
      ) : null}
      {result.eraNote ? (
        <MemoCard tone="note" icon="clock">
          <p className={styles.cardText}>{result.eraNote}</p>
        </MemoCard>
      ) : null}
      {result.softenNote ? (
        <MemoCard tone="note" icon="notice">
          <p className={styles.cardText}>{result.softenNote}</p>
        </MemoCard>
      ) : null}
    </div>
  );
}

function DirectionList({ ideas }: { readonly ideas: readonly DirectionIdeaView[] }) {
  return (
    <ol className={styles.ideaList}>
      {ideas.map((idea, index) => (
        <li key={index}>
          <MemoCard badge={idea.label} className={styles.ideaCard}>
            <p className={styles.cardText}>
              <span className={cx(styles.ideaNumber, 'tabular')} aria-hidden="true">
                {index + 1}
              </span>
              {idea.text}
            </p>
          </MemoCard>
        </li>
      ))}
    </ol>
  );
}

function PolishCompare({
  text,
  done,
  lengthWarning,
  truncated,
  mineText,
}: {
  readonly text: string;
  readonly done: boolean;
  readonly lengthWarning: boolean;
  readonly truncated: boolean;
  readonly mineText?: string | undefined;
}) {
  const showMine = mineText !== undefined;
  return (
    <div className={styles.polish}>
      {done ? (
        <p className={styles.guideLine}>
          <Icon name="copy" size={16} />
          <span>{ko.student.aiPolishGuide}</span>
        </p>
      ) : null}
      {done && lengthWarning ? (
        <p className={cx(styles.notice, styles.warn)} role="status">
          <Icon name="warning" size={16} />
          <span>{ko.student.aiPolishDiffWarning}</span>
        </p>
      ) : null}
      {done && truncated ? (
        <p className={styles.notice}>
          <Icon name="notice" size={16} />
          <span>{ko.student.aiPolishTruncatedNotice}</span>
        </p>
      ) : null}
      <div className={cx(styles.compare, showMine && styles.compareTwo)}>
        <section className={styles.compareCol} aria-label={ko.student.aiPolishLabel}>
          {showMine ? <h4 className={styles.compareHeading}>{ko.student.aiPolishLabel}</h4> : null}
          <p className={styles.polishText} aria-busy={!done || undefined} data-streaming={!done || undefined}>
            {text}
            {!done ? <span className={styles.streamCaret} aria-hidden="true" /> : null}
          </p>
        </section>
        {showMine ? (
          <section
            className={cx(styles.compareCol, styles.mineCol)}
            aria-label={ko.student.aiPolishMineHeading}
          >
            <h4 className={styles.compareHeading}>{ko.student.aiPolishMineHeading}</h4>
            <p className={styles.polishText}>{mineText}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** 바닥(받은 시각·`다시 받기`)이 있는 상태: 기다림·한도·다듬은 글 받는 중에는 없다. */
function hasFooter(view: ResultPanelView): boolean {
  if (view.status === 'loading' || view.status === 'limit') return false;
  return !(view.content?.kind === 'POLISH' && !view.content.done);
}

function ResultPanelFooter({
  view,
  now,
  onRefresh,
  onCopyPolish,
  refreshDisabled,
}: {
  readonly view: ResultPanelView;
  readonly now: number;
  readonly onRefresh: () => void;
  readonly onCopyPolish: () => void;
  readonly refreshDisabled: boolean;
}) {
  const polish = view.content?.kind === 'POLISH' ? view.content : null;

  return (
    <div className={styles.footer}>
      {view.stale ? (
        <span className={styles.stale}>
          <Icon name="warning" size={16} />
          <span>{ko.student.aiStaleBadge}</span>
        </span>
      ) : view.receivedAt !== undefined ? (
        <span className={cx(styles.received, 'tabular')}>
          <Icon name="clock" size={16} />
          <span>{formatAgo(now, view.receivedAt)}</span>
        </span>
      ) : (
        <span />
      )}
      <span className={styles.footerActions}>
        {polish ? (
          <Button variant="secondary" icon="copy" onClick={onCopyPolish}>
            {ko.common.copy}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          icon="redo"
          delaySeconds={view.refreshCooldownSeconds}
          disabled={refreshDisabled}
          onClick={onRefresh}
        >
          {ko.student.aiRefreshAction}
        </Button>
      </span>
    </div>
  );
}
