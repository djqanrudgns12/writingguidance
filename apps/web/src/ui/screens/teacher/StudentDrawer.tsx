import type { DocStatus } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { useEffect, useId, useRef, type Ref } from 'react';
import { Button } from '../../components/Button.tsx';
import { HoldPill } from '../../components/HoldPill.tsx';
import { Menu } from '../../components/Menu.tsx';
import { NotebookField } from '../../components/NotebookField.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { StatusBadge, type StudentStatusKind } from '../../components/StatusBadge.tsx';
import { Icon } from '../../icons/Icon.tsx';
import { useMediaQuery, WIDE_LAYOUT_QUERY } from '../common/useMediaQuery.ts';
import styles from './StudentDrawer.module.css';

/** 서랍 아래 접힌 "도움 질문 메모 보기"의 한 줄(읽기 전용, PRD F-18). */
export interface DrawerMemo {
  readonly questionId: string;
  readonly question: string;
  readonly note: string;
}

export interface StudentDrawerViewProps {
  readonly nickname: string;
  readonly status: StudentStatusKind;
  readonly genreLabel: string;
  readonly docStatus: DocStatus;
  /**
   * 편집기 입력칸 자리(PLAN §6.3). 화면은 값·선택·초점·readOnly를 건드리지 않는 **비제어** 칸만 그리고,
   * 결합 쪽이 이 ref로 `EditorPort.mount`에 넘긴다. 거울 층 `div`도 같다.
   */
  readonly titleRef: Ref<HTMLInputElement>;
  readonly bodyRef: Ref<HTMLTextAreaElement>;
  readonly mirrorRef: Ref<HTMLDivElement>;
  /** 그 글 제공자를 붙이는 중이면 칸 위에 종이 자리표시를 겹친다(칸은 그대로 둬 ref가 바뀌지 않게). */
  readonly loading?: boolean | undefined;
  readonly canUndo?: boolean | undefined;
  readonly canRedo?: boolean | undefined;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onOpenRewind: () => void;
  readonly onReopenDoc: () => void;
  readonly reopening?: boolean | undefined;
  readonly onCopyDoc: () => void;
  /** 노래 가사면 Suno 복사 두 단추를 더한다(PRD F-12·F-18). */
  readonly supportsSuno?: boolean | undefined;
  readonly onCopySunoLyrics?: (() => void) | undefined;
  readonly onCopySunoStyle?: (() => void) | undefined;
  readonly onOpenDevices: () => void;
  readonly onClose: () => void;
  readonly memos: readonly DrawerMemo[];
  /** 교사가 한글을 치는 동안 학생 변경이 보류될 때(PRD F-18). 문구는 결합 쪽이 준다. */
  readonly holdLabel?: string | undefined;
  readonly holding?: boolean | undefined;
}

/**
 * T4 학생 글 서랍(PRD F-18). 900px 이상은 대시보드 옆 480px 칸, 그보다 좁으면 전체 화면(자리는 대시보드가 정한다).
 * 주요 단추는 제출된 글일 때만 `다시 쓰게 하기` 하나.
 */
export function StudentDrawerView({
  nickname,
  status,
  genreLabel,
  docStatus,
  titleRef,
  bodyRef,
  mirrorRef,
  loading = false,
  canUndo = true,
  canRedo = true,
  onUndo,
  onRedo,
  onOpenRewind,
  onReopenDoc,
  reopening = false,
  onCopyDoc,
  supportsSuno = false,
  onCopySunoLyrics,
  onCopySunoStyle,
  onOpenDevices,
  onClose,
  memos,
  holdLabel,
  holding = false,
}: StudentDrawerViewProps) {
  const headingId = useId();
  const submitted = docStatus === 'SUBMITTED';
  const compact = !useMediaQuery(WIDE_LAYOUT_QUERY);
  const rootRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // 열리면 닫기 단추로 초점을 옮긴다(P5-1 [상-1]): 서랍이 타일 격자 뒤에 있어 Tab으로는 학생 수만큼 지나가야 닿는다.
    // 제목·본문 칸에는 코드로 초점을 주지 않는다(PLAN §6.3). 서랍은 글마다 새로 그려지므로 열릴 때 한 번이다.
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    // 900px 미만은 전체 화면 대화상자라 Escape로 닫는다. 한글 조합을 끝내는 Escape는 무시한다.
    // 메뉴·시트는 body 아래 포털이라 그 안의 Escape는 여기까지 오지 않는다(DOM 이벤트로 듣는다).
    const el = rootRef.current;
    if (!compact || !el) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [compact]);

  return (
    <aside ref={rootRef} className={styles.drawer} aria-labelledby={headingId} data-doc-status={docStatus}>
      <header className={styles.header}>
        <div className={styles.who}>
          <h2 id={headingId} className={styles.nickname}>
            {nickname}
          </h2>
          <div className={styles.meta}>
            <StatusBadge status={status} />
            {genreLabel ? <span className={styles.genre}>{genreLabel}</span> : null}
          </div>
        </div>
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          aria-label={ko.common.close}
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
      </header>

      {submitted ? (
        <div className={styles.reopen}>
          <span className={styles.reopenText}>
            <Icon name="locked" size={20} />
            {ko.common.saveLocked}
          </span>
          <Button variant="primary" icon="write" loading={reopening} onClick={onReopenDoc}>
            {ko.teacher.reopenDocAction}
          </Button>
        </div>
      ) : null}

      <div className={styles.toolbar} role="toolbar" aria-label={nickname}>
        <div className={styles.toolGroup}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={ko.common.undo}
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Icon name="undo" size={20} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={ko.common.redo}
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Icon name="redo" size={20} />
          </button>
        </div>
        <div className={styles.toolGroup}>
          <Button variant="secondary" icon="clock" onClick={onOpenRewind}>
            {ko.common.rewindTitle}
          </Button>
          <Button variant="ghost" icon="copy" onClick={onCopyDoc}>
            {ko.common.copyDoc}
          </Button>
          <Menu
            items={[
              ...(supportsSuno && onCopySunoLyrics
                ? [
                    {
                      id: 'suno-lyrics',
                      label: ko.common.copySunoLyrics,
                      icon: 'copy' as const,
                      onSelect: onCopySunoLyrics,
                    },
                  ]
                : []),
              ...(supportsSuno && onCopySunoStyle
                ? [
                    {
                      id: 'suno-style',
                      label: ko.common.copySunoStyle,
                      icon: 'copy' as const,
                      onSelect: onCopySunoStyle,
                    },
                  ]
                : []),
              {
                id: 'devices',
                label: ko.teacher.disconnectDeviceAction,
                icon: 'offline',
                tone: 'danger',
                separatorBefore: supportsSuno,
                onSelect: onOpenDevices,
              },
            ]}
          />
        </div>
      </div>

      <div className={styles.editor} aria-busy={loading || undefined}>
        {holding && holdLabel ? <HoldPill label={holdLabel} className={styles.hold} /> : null}
        {/* 비제어 입력칸: value·defaultValue·readOnly를 주지 않는다(반영 문이 닫힌 동안 화면이 만지지 않게). */}
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
          data-testid="drawer-title-input"
        />
        {/* 학생 쓰기 칸과 같은 공책 줄 칸(비제어 textarea + 뒤 거울 층). 값은 편집기 바인딩만 만진다.
            높이는 부품이 글에 맞춰 정한다(늘려 채우면 공책 줄이 중간에서 끊겨 보인다). */}
        <NotebookField
          textareaRef={bodyRef}
          mirrorRef={mirrorRef}
          mirrorTestId="drawer-mirror-host"
          data-testid="drawer-body-input"
        />
        {loading ? (
          <div className={styles.loading}>
            <Skeleton variant="card" lines={5} />
          </div>
        ) : null}
      </div>

      <details className={styles.memos}>
        <summary className={styles.memoSummary}>
          <Icon name="book" size={20} />
          <span>{ko.teacher.viewHelpMemos}</span>
          <span className={styles.memoCount}>{memos.length}</span>
        </summary>
        {memos.length === 0 ? (
          <p className={styles.memoEmpty}>{ko.teacher.helpMemosEmpty}</p>
        ) : (
          <dl className={styles.memoList}>
            {memos.map(m => (
              <div key={m.questionId} className={styles.memo}>
                <dt className={styles.memoQuestion}>{m.question}</dt>
                <dd className={styles.memoNote}>{m.note}</dd>
              </div>
            ))}
          </dl>
        )}
      </details>
    </aside>
  );
}
