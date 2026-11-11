import {
  GENRE_CATALOG,
  getGenreDisplayLabel,
  getStructureButtonLabel,
  type AiButton,
  type GenreId,
  type PurposeId,
  type SongMoodId,
  type SongTempoId,
  type StructureButtonId,
  type SubtypeId,
} from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useEffect, useRef, type CSSProperties, type Ref } from 'react';
import {
  Banner,
  Button,
  Chip,
  Dropdown,
  HoldPill,
  IconButton,
  Menu,
  NotebookField,
  NoticeDrop,
  SaveState,
  Stamp,
  TimerPill,
  Toast,
  type MenuItemEntry,
  type NotebookFontSize,
} from '../../../components/index.ts';
import { AiChipBar } from './AiChipBar.tsx';
import { FontSizeSheet } from './FontSizeSheet.tsx';
import { HelpCard } from './HelpCard.tsx';
import { useWriteCompact, useWriteLayout } from './layout.ts';
import { ResultPanel } from './ResultPanel.tsx';
import { RewindSheet } from './RewindSheet.tsx';
import { SubmitSheet } from './SubmitSheet.tsx';
import type {
  AiChipView,
  HelpQuestionView,
  ResultPanelView,
  RewindView,
  SongChipsView,
  WriteLayout,
  WriteSaveState,
  WriteSubmission,
  WriteTimerView,
  WriteToast,
} from './types.ts';
import styles from './WriteView.module.css';

const EMPTY_REWIND: RewindView = { status: 'loading', snapshots: [], selectedIndex: 0 };

export interface WriteViewProps {
  // ── 배치 ──
  /** 없으면 900px 미디어 쿼리로 정한다(PRD 7.3). */
  readonly layout?: WriteLayout | undefined;
  /** 견본·시험용: 시트를 포털 대신 제자리에 그린다(운영 화면은 쓰지 않음). */
  readonly sheetsInline?: boolean | undefined;
  /** 상대 시각 기준(받은 시각, 되감기 시각). 결합 때 서버 시각 보정값. */
  readonly now: number;

  // ── 편집기 입력칸 자리(비제어, PLAN §6.3) ──
  /** 본문 `textarea`. 화면은 값·선택·초점·`readOnly`를 만지지 않는다. `useRef` 같은 안정된 ref를 준다. */
  readonly bodyRef: Ref<HTMLTextAreaElement>;
  /** 제목 한 줄 `input`(선택). */
  readonly titleRef: Ref<HTMLInputElement>;
  /** 본문 뒤 거울 층 `div`(형광·원격 커서, PLAN §6.4). */
  readonly mirrorRef: Ref<HTMLDivElement>;
  /** 도움 질문 메모 칸(`binding.bindMemo`). 질문을 넘기면 칸이 바뀌어 다시 부른다. */
  readonly memoRef?: ((questionId: string, el: HTMLTextAreaElement | null) => void) | undefined;

  // ── 글 ──
  readonly genre: GenreId;
  readonly subtype: SubtypeId | null;
  readonly purpose?: PurposeId | null | undefined;
  readonly purposeCustom?: string | null | undefined;
  /** 상단 글 종류 칩: 하위 종류만 바꾸는 메뉴(PRD F-06). 없으면 칩은 글자만. */
  readonly onSubtypeChange?: ((subtype: SubtypeId) => void) | undefined;
  /** `FONT_SIZES` 중 하나(PRD F-13). */
  readonly fontSize: number;

  // ── 상태 ──
  readonly saveState: WriteSaveState;
  readonly submission: WriteSubmission;
  /** 수업방 닫힘: "지금은 읽기만 할 수 있어요"(F-02). 입력칸 잠금은 `binding.setReadOnly`가 한다. */
  readonly roomClosed?: boolean | undefined;
  readonly offline?: boolean | undefined;
  /** 인터넷은 되는데 선생님 화면과 연결이 끊김(PRD 9.5). `offline`과 같은 띠 자리에 다른 문구. */
  readonly serverDown?: boolean | undefined;
  /** 저장할 수 없음·글이 너무 김처럼 학생이 선생님께 말해야 하는 문제 한 줄(`ko.errors` 문구, 결합하는 쪽이 고름). */
  readonly alertMessage?: string | null | undefined;
  /** 잠긴 뒤 서버가 받지 않은 변경이 기기에 남음(F-11). */
  readonly unsent?: boolean | undefined;
  /** 한글 입력 중 원격 변경 보류 3초 넘음(PRD 9.3 6번). */
  readonly holding?: boolean | undefined;
  readonly timer?: WriteTimerView | null | undefined;
  /** 교사가 보낸 알림(F-19, 6초 동안 보였다 사라짐 — 시간은 결합하는 쪽). */
  readonly notice?: string | null | undefined;
  readonly toast?: WriteToast | null | undefined;
  /** 제출 순간 도장(F-11, 1초 안에 사라짐 — 시간은 결합하는 쪽). */
  readonly stampVisible?: boolean | undefined;

  // ── 이전으로·다음으로(F-10 1번) ──
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;

  // ── 도움 질문·구조 버튼(F-07) ──
  readonly helpOpen: boolean;
  readonly onHelpOpenChange: (open: boolean) => void;
  readonly helpQuestions: readonly HelpQuestionView[];
  readonly helpIndex: number;
  readonly onHelpIndexChange: (index: number) => void;
  readonly song?: SongChipsView | undefined;
  readonly onMoodChange?: ((mood: SongMoodId) => void) | undefined;
  readonly onMoodCustomChange?: ((text: string) => void) | undefined;
  readonly onTempoChange?: ((tempo: SongTempoId) => void) | undefined;
  readonly structureButtons: readonly StructureButtonId[];
  readonly onStructure: (id: StructureButtonId) => void;

  // ── 글벗(F-08) ──
  readonly aiChips: readonly AiChipView[];
  readonly onAiChip: (button: AiButton) => void;
  readonly panel?: ResultPanelView | null | undefined;
  readonly onPanelClose: () => void;
  readonly onPanelRefresh: () => void;
  readonly onSpellItem: (itemId: string) => void;
  readonly onCopyPolish: () => void;
  /** 바텀시트에서 다듬은 글과 나란히 볼 지금 글. */
  readonly polishMineText?: string | undefined;

  // ── 상단·메뉴(F-06, F-12) ──
  readonly onBack: () => void;
  readonly onCopyDoc: () => void;
  readonly onSaveTxt: () => void;
  /** 노래 가사만. */
  readonly onCopySunoLyrics?: (() => void) | undefined;
  readonly onCopySunoStyle?: (() => void) | undefined;
  /** `··· > 새 글`(v1.1, SHOULD). */
  readonly onNewDoc?: (() => void) | undefined;

  // ── 시트 ──
  readonly fontSizeOpen: boolean;
  readonly onFontSizeOpenChange: (open: boolean) => void;
  readonly onFontSizeChange: (size: number) => void;
  readonly rewindOpen: boolean;
  readonly onRewindOpenChange: (open: boolean) => void;
  readonly rewind?: RewindView | undefined;
  readonly onRewindSelect: (index: number) => void;
  readonly onRewindRestore: () => void;
  readonly submitOpen: boolean;
  readonly onSubmitOpenChange: (open: boolean) => void;
  readonly onSubmitConfirm: () => void;
  readonly submitting?: boolean | undefined;

  // ── 띠·토스트 동작 ──
  readonly onCopyUnsent?: (() => void) | undefined;
  readonly onRestoreDeleted?: (() => void) | undefined;
  readonly onDismissToast?: (() => void) | undefined;
  readonly onDismissNotice?: (() => void) | undefined;
  /** 오류 토스트의 `다시 하기`(PRD 7.2). 토스트에 `retry: true`일 때만 보인다. */
  readonly onRetryToast?: (() => void) | undefined;
}

/** 버튼이 쓰기 칸 초점을 빼앗지 않게 한다(조합·커서 유지). 키보드로는 그대로 누를 수 있다. */
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function aiChipOf(root: HTMLElement, button: AiButton): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`[data-ai-button="${button}"]`);
}

/** 지금 초점이 그 AI 칩에 있는가(키보드로 눌렀거나 칩이 초점을 받는 기기). */
function chipHasFocus(root: HTMLElement | null, button: AiButton): boolean {
  const active = document.activeElement;
  return root !== null && active !== null && active === aiChipOf(root, button);
}

/**
 * 결과 패널 열기·닫기 초점(P5-1 [중-3]). 쓰기 칸(본문·제목·메모)의 초점은 건드리지 않는다(PLAN §6.3):
 * - 열 때: 그 칩에 초점이 있었을 때만 옆 패널로 옮긴다(바텀시트는 `initialFocus`가 같은 조건으로 옮긴다).
 * - 닫을 때: 초점이 사라졌으면(패널 안에 있다가 패널이 빠짐) 연 칩으로, 칩이 꺼져 있으면 칩 묶음으로 돌려준다.
 */
function useResultPanelFocus(
  rootRef: { readonly current: HTMLElement | null },
  sideRef: { readonly current: HTMLElement | null },
  panelButton: AiButton | null,
  wide: boolean,
) {
  const prevRef = useRef<AiButton | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = panelButton;
    if (prev === panelButton) return;
    const root = rootRef.current;
    if (!root) return;
    if (panelButton !== null) {
      if (wide && chipHasFocus(root, panelButton)) sideRef.current?.focus();
      return;
    }
    if (prev === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const chip = aiChipOf(root, prev);
    if (chip && !chip.disabled) chip.focus();
    else root.querySelector<HTMLElement>('[data-ai-chip-group]')?.focus();
  }, [rootRef, sideRef, panelButton, wide]);
}

/**
 * S5 쓰기 화면(PRD F-06~F-13, 7.1 주요 버튼 `제출`). 보이는 부분만: 값과 동작은 props·콜백으로 받는다.
 *
 * 입력칸 규칙(PLAN §6.3, PRD 9.3): 본문·제목·메모 칸은 비제어이고 ref로만 넘긴다. 배치(`layout`)·패널·띠가
 * 바뀌어도 입력칸 DOM 노드는 같은 자리에 남는다(다시 붙이기·옮기기 없음). `readOnly`도 화면이 주지 않는다.
 */
export function WriteView(props: WriteViewProps) {
  const {
    sheetsInline = false,
    now,
    bodyRef,
    titleRef,
    mirrorRef,
    memoRef,
    genre,
    subtype,
    purpose,
    purposeCustom,
    onSubtypeChange,
    fontSize,
    saveState,
    submission,
    roomClosed = false,
    offline = false,
    serverDown = false,
    alertMessage,
    unsent = false,
    holding = false,
    timer,
    notice,
    toast,
    stampVisible = false,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    helpOpen,
    onHelpOpenChange,
    helpQuestions,
    helpIndex,
    onHelpIndexChange,
    song,
    onMoodChange,
    onMoodCustomChange,
    onTempoChange,
    structureButtons,
    onStructure,
    aiChips,
    onAiChip,
    panel,
    onPanelClose,
    onPanelRefresh,
    onSpellItem,
    onCopyPolish,
    polishMineText,
    onBack,
    onCopyDoc,
    onSaveTxt,
    onCopySunoLyrics,
    onCopySunoStyle,
    onNewDoc,
    fontSizeOpen,
    onFontSizeOpenChange,
    onFontSizeChange,
    rewindOpen,
    onRewindOpenChange,
    rewind = EMPTY_REWIND,
    onRewindSelect,
    onRewindRestore,
    submitOpen,
    onSubmitOpenChange,
    onSubmitConfirm,
    submitting = false,
    onCopyUnsent,
    onRestoreDeleted,
    onDismissToast,
    onDismissNotice,
    onRetryToast,
  } = props;

  const layout = useWriteLayout(props.layout);
  const wide = layout === 'wide';
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sidePanelRef = useRef<HTMLElement | null>(null);
  const panelButton = panel?.button ?? null;
  useResultPanelFocus(rootRef, sidePanelRef, panelButton, wide);
  const def = GENRE_CATALOG[genre];
  const locked = roomClosed || submission !== 'none';
  const sidePanel = wide && panel ? panel : null;
  const sheetPanel = !wide && panel ? panel : null;
  // 옆 패널이 쓰기 칸을 좁히면 상단 바 두 줄 + 칩 짧은 이름(P5-4 시각 검토 1번, `layout.ts`).
  const compact = useWriteCompact(layout, sidePanel !== null);
  const hasHelp = helpQuestions.length > 0 || song !== undefined;

  const rootStyle = { '--fs-write': `${fontSize}px` } as CSSProperties;

  const genreLabel = getGenreDisplayLabel({ genre, subtype, purpose, purposeCustom });
  const genreControl =
    def.subtypes.length > 1 && onSubtypeChange ? (
      <Dropdown<SubtypeId>
        ariaLabel={ko.student.writeGenreMenuLabel}
        value={subtype ?? def.defaultSubtype ?? undefined}
        disabled={locked}
        onValueChange={onSubtypeChange}
        options={def.subtypes.map(sub => ({
          value: sub.id,
          label: `${ko.student[def.labelKey]} · ${ko.student[sub.labelKey]}`,
        }))}
      />
    ) : (
      <span className={styles.genreStatic}>{genreLabel}</span>
    );

  const saveIndicator =
    submission === 'submitted' ? (
      <SaveState state="locked" />
    ) : submission === 'pending' ? (
      // 제출 대기는 학생이 알아야 하는 전환이라 `보내는 중` 모양이어도 알린다(P5-1 [상-2]).
      <SaveState state="sending" label={ko.student.submitPendingStatus} announce />
    ) : (
      <SaveState state={saveState} />
    );

  const undoRedo = (
    <span className={styles.undoRedo}>
      <IconButton
        icon="undo"
        label={ko.common.undo}
        disabled={!canUndo || locked}
        onMouseDown={keepFocus}
        onClick={onUndo}
      />
      <IconButton
        icon="redo"
        label={ko.common.redo}
        disabled={!canRedo || locked}
        onMouseDown={keepFocus}
        onClick={onRedo}
      />
    </span>
  );

  const menuItems: MenuItemEntry[] = [
    {
      id: 'font-size',
      label: ko.common.fontSize,
      icon: 'fontSize',
      onSelect: () => onFontSizeOpenChange(true),
    },
    { id: 'rewind', label: ko.common.rewindTitle, icon: 'clock', onSelect: () => onRewindOpenChange(true) },
    { id: 'copy', label: ko.common.copyDoc, icon: 'copy', separatorBefore: true, onSelect: onCopyDoc },
    { id: 'txt', label: ko.common.saveTxt, icon: 'download', onSelect: onSaveTxt },
  ];
  if (def.supportsSunoExport && onCopySunoLyrics) {
    menuItems.push({
      id: 'suno-lyrics',
      label: ko.common.copySunoLyrics,
      icon: 'copy',
      onSelect: onCopySunoLyrics,
    });
  }
  if (def.supportsSunoExport && onCopySunoStyle) {
    menuItems.push({
      id: 'suno-style',
      label: ko.common.copySunoStyle,
      icon: 'copy',
      onSelect: onCopySunoStyle,
    });
  }
  if (onNewDoc) {
    menuItems.push({
      id: 'new-doc',
      label: ko.student.newDocAction,
      icon: 'write',
      separatorBefore: true,
      onSelect: onNewDoc,
    });
  }

  // 교사 알림·보류 알약은 상단 바 아래 전용 자리에 둔다(제목·타이머·도움 질문을 덮지 않게, 디자인 판정 2번).
  // 넓은 배치는 붙어 있는 상단 바 안 마지막 줄, 좁은 배치는 상단 바 바로 아래(내리면 화면 위에 붙음).
  const noticeSlot =
    notice || holding ? (
      <div className={styles.noticeSlot} data-notice-slot="">
        {notice ? <NoticeDrop message={notice} onDismiss={onDismissNotice} /> : null}
        <HoldPill visible={holding} />
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={styles.write}
      data-screen="S5"
      data-layout={layout}
      data-panel={sidePanel ? 'open' : 'closed'}
      data-compact={compact ? 'true' : 'false'}
      data-toast={toast ? 'open' : 'closed'}
      data-locked={locked ? 'true' : 'false'}
      style={rootStyle}
    >
      {/* 본문 영역(main 랜드마크, P5-1 [하-4]). 결과 옆 패널·하단 바는 밖에 둔다. */}
      <main className={styles.main}>
        {/* 화면 제목: 보이는 자리는 글 종류 칩·제목 칸이 맡아 보조기기 전용으로 둔다. */}
        <h1 className="visually-hidden">{genreLabel}</h1>
        {/*
          상단 바: 넓으면 한 줄(PRD F-06 그림), 좁으면 제목이 둘째 줄. 넓어도 옆 패널이 쓰기 칸을 좁히면(`data-compact`)
          제목이 둘째 줄 전체를 쓴다. 제목 칸은 모든 배치에서 같은 노드다(격자 자리만 바뀐다).
        */}
        <header className={styles.topBar}>
          <div className={styles.back}>
            <Button variant="ghost" icon="back" onClick={onBack}>
              {ko.common.back}
            </Button>
          </div>
          <div className={styles.genre}>{genreControl}</div>
          <input
            ref={titleRef}
            type="text"
            className={styles.title}
            placeholder={ko.student.titlePlaceholder}
            aria-label={ko.student.titlePlaceholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-editor-field="title"
          />
          {wide ? (
            <div className={styles.tools}>
              {saveIndicator}
              {undoRedo}
            </div>
          ) : null}
          <div className={styles.menu}>
            <Menu items={menuItems} trigger={<IconButton icon="more" label={ko.common.moreMenu} />} />
          </div>
          {timer ? (
            <div className={styles.timer}>
              <TimerPill
                remainingSeconds={timer.remainingSeconds}
                state={timer.paused ? 'paused' : undefined}
              />
            </div>
          ) : null}
          {wide ? noticeSlot : null}
        </header>
        {!wide ? noticeSlot : null}

        <div className={styles.banners}>
          {roomClosed ? <Banner kind="closed" /> : null}
          {unsent ? (
            <Banner
              kind="unsent"
              action={
                onCopyUnsent ? (
                  <Button variant="secondary" icon="copy" onClick={onCopyUnsent}>
                    {ko.common.copyDoc}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {offline ? <Banner kind="offline" /> : null}
          {serverDown && !offline ? <Banner kind="offline" message={ko.errors.E_SERVER_DOWN} /> : null}
          {alertMessage ? <Banner tone="danger" icon="warning" message={alertMessage} /> : null}
          {submission === 'submitted' && !roomClosed ? (
            <Banner tone="info" icon="locked" message={ko.errors.E_DOC_LOCKED} />
          ) : null}
        </div>

        <section className={styles.paper}>
          {hasHelp || structureButtons.length > 0 ? (
            <div className={styles.toolsRow}>
              {hasHelp ? (
                <Chip
                  icon="book"
                  // 펼침 단추: 열림은 aria-expanded로만 알린다(Chip이 aria-pressed를 붙이지 않는다, P5-1 [중-2]).
                  selected={helpOpen}
                  aria-expanded={helpOpen}
                  onMouseDown={keepFocus}
                  onClick={() => onHelpOpenChange(!helpOpen)}
                >
                  {ko.student.helpQuestionsButton}
                </Chip>
              ) : null}
              {structureButtons.length > 0 ? (
                <div className={styles.structure} role="group" aria-label={ko.student.structureGroupLabel}>
                  {structureButtons.map(id => (
                    <Chip
                      key={id}
                      disabled={locked}
                      onMouseDown={keepFocus}
                      onClick={() => onStructure(id)}
                      data-structure={id}
                    >
                      {getStructureButtonLabel(id)}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {helpOpen && hasHelp ? (
            <HelpCard
              questions={helpQuestions}
              index={helpIndex}
              onIndexChange={onHelpIndexChange}
              onClose={() => onHelpOpenChange(false)}
              memoRef={memoRef}
              song={song}
              onMoodChange={onMoodChange}
              onMoodCustomChange={onMoodCustomChange}
              onTempoChange={onTempoChange}
              readOnly={locked}
            />
          ) : null}

          {/* 공책 줄 쓰기 칸 부품(비제어). 값·선택·초점·readOnly는 편집기 바인딩만 다룬다. */}
          <NotebookField
            ref={bodyRef}
            mirrorRef={mirrorRef}
            // `fontSize`는 `FONT_SIZES`(16·18·21·24) 중 하나다(PRD F-13, 결합하는 쪽이 그 안에서만 고른다).
            fontSize={fontSize as NotebookFontSize}
            stageClassName={styles.stage}
          />
        </section>
      </main>

      {sidePanel ? (
        <div className={styles.side}>
          <ResultPanel
            panelRef={sidePanelRef}
            view={sidePanel}
            placement="side"
            now={now}
            fontSize={fontSize}
            onClose={onPanelClose}
            onRefresh={onPanelRefresh}
            onSpellItem={onSpellItem}
            onCopyPolish={onCopyPolish}
            refreshDisabled={roomClosed}
          />
        </div>
      ) : null}

      {/* 하단 바: position fixed + 키보드 위(`--kb-offset`, adapters/viewport/keyboardOffset.ts가 갱신) */}
      <footer className={styles.dock}>
        <div className={styles.dockInner}>
          <div className={styles.dockChips}>
            {/* 닫힌 수업방은 읽기만: 칩도 흐리게 막는다(서버도 `E_ROOM_CLOSED`로 거절, P5-4 시각 검토 7번). */}
            <AiChipBar
              chips={aiChips}
              layout={layout}
              compact={compact}
              disabled={roomClosed}
              activeButton={panel?.button}
              onChip={onAiChip}
            />
          </div>
          {!wide ? (
            <div className={styles.dockTools}>
              {saveIndicator}
              {undoRedo}
            </div>
          ) : null}
          <div className={styles.dockSubmit}>
            {submission === 'none' && !roomClosed ? (
              <Button icon="submit" onClick={() => onSubmitOpenChange(true)}>
                {ko.student.submitButton}
              </Button>
            ) : null}
          </div>
        </div>
      </footer>

      {/*
        제출 도장(PRD F-11·8.9): 글 위에 겹치지 않게 화면 가운데 종이 카드로 띄우고 옅은 막으로 글을 잠시 가린다.
        1초 안에 사라지는 시간은 결합하는 쪽(`useSubmit`)이 맡는다. 누르기는 막지 않는다(지나가는 순간 효과).
      */}
      {stampVisible ? (
        <div className={styles.stampOverlay} data-stamp-overlay="">
          <div className={styles.stampCard}>
            <Stamp />
          </div>
        </div>
      ) : null}

      <div className={styles.toastArea}>
        {toast ? (
          <WriteToastLine
            toast={toast}
            onRestoreDeleted={onRestoreDeleted}
            onDismissToast={onDismissToast}
            onRetryToast={onRetryToast}
          />
        ) : null}
      </div>

      {sheetPanel ? (
        <ResultPanel
          view={sheetPanel}
          placement={sheetsInline ? 'inline' : 'sheet'}
          now={now}
          fontSize={fontSize}
          mineText={sheetPanel.button === 'POLISH' ? polishMineText : undefined}
          sheetInitialFocus={() => chipHasFocus(rootRef.current, sheetPanel.button)}
          onClose={onPanelClose}
          onRefresh={onPanelRefresh}
          onSpellItem={onSpellItem}
          onCopyPolish={onCopyPolish}
          refreshDisabled={roomClosed}
        />
      ) : null}

      <RewindSheet
        open={rewindOpen}
        onOpenChange={onRewindOpenChange}
        view={rewind}
        now={now}
        fontSize={fontSize}
        onSelect={onRewindSelect}
        onRestore={onRewindRestore}
        inline={sheetsInline}
      />
      <SubmitSheet
        open={submitOpen}
        onOpenChange={onSubmitOpenChange}
        onConfirm={onSubmitConfirm}
        submitting={submitting}
        inline={sheetsInline}
      />
      <FontSizeSheet
        open={fontSizeOpen}
        onOpenChange={onFontSizeOpenChange}
        value={fontSize}
        onChange={onFontSizeChange}
        inline={sheetsInline}
      />
    </div>
  );
}

function WriteToastLine({
  toast,
  onRestoreDeleted,
  onDismissToast,
  onRetryToast,
}: { readonly toast: WriteToast } & Pick<
  WriteViewProps,
  'onRestoreDeleted' | 'onDismissToast' | 'onRetryToast'
>) {
  switch (toast.kind) {
    case 'restore':
      return (
        <Toast
          tone="warning"
          message={ko.student.largeDeleteToast}
          actionLabel={onRestoreDeleted ? ko.student.restoreAction : undefined}
          onAction={onRestoreDeleted}
          onDismiss={onDismissToast}
        />
      );
    case 'teacherEditing':
      return <Toast icon="write" message={ko.student.teacherEditingToast} onDismiss={onDismissToast} />;
    case 'copied':
      return <Toast icon="copy" message={ko.common.copiedToast} onDismiss={onDismissToast} />;
    case 'error':
      return (
        <Toast
          tone="danger"
          message={toast.message}
          actionLabel={toast.retry && onRetryToast ? ko.common.retry : undefined}
          onAction={toast.retry ? onRetryToast : undefined}
          onDismiss={onDismissToast}
        />
      );
  }
}
