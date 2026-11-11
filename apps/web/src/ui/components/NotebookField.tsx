import { ko } from '@geulbang/core/copy';
import {
  forwardRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './NotebookField.module.css';
import './notebook-lines.css';

/** 글자 크기 4단계(PRD F-06, 12.3 `FONT_SIZES`: 16 · 18 · 21 · 24). */
export type NotebookFontSize = 16 | 18 | 21 | 24;

export interface NotebookFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'defaultValue' | 'readOnly' | 'children'
> {
  /** 거울 층(맞춤법 형광·원격 커서 표시, PLAN §6.4)을 그릴 뒤쪽 `div`의 ref. */
  readonly mirrorRef?: Ref<HTMLDivElement> | undefined;
  /** 비제어 `textarea`를 가리키는 보조 ref(`ref`와 함께 또는 대신 전달 가능). */
  readonly textareaRef?: Ref<HTMLTextAreaElement> | undefined;
  /** 글자 크기(16·18·21·24px, 기본 18px). 줄 간격(`--write-lh = fontSize * 1.8`)과 공책 줄 간격을 함께 맞춘다. */
  readonly fontSize?: NotebookFontSize | undefined;
  /** 왼쪽 살구색 여백선 표시 여부(기본 `true`). */
  readonly showMarginLine?: boolean | undefined;
  /** 바깥 감싸개(`stage`)에 덧붙일 클래스. */
  readonly stageClassName?: string | undefined;
  /** 거울 층 `div`에 붙일 `data-testid`(예: 교사 서랍 `drawer-mirror-host`). */
  readonly mirrorTestId?: string | undefined;
  /** 쓰기 칸 위에 겹쳐 그릴 요소(제출 도장 `Stamp`, 로딩 `Skeleton` 등). */
  readonly children?: ReactNode | undefined;
}

function assignRef<T>(target: Ref<T> | undefined, node: T | null): void {
  if (!target) return;
  if (typeof target === 'function') {
    target(node);
  } else {
    target.current = node;
  }
}

/**
 * 공책 줄 쓰기 칸 부품(PRD 8.3, 9.3, PLAN §6.3, §6.4, §9.2).
 * - 학생 S5 쓰기 화면과 교사 T4 학생 글 서랍이 함께 쓴다.
 * - 편집기 바인딩(`adapters/editor`)이 직접 값을 다루므로 React는 값·선택·초점·`readOnly`를 절대 건드리지 않는다.
 * - 입력칸 뒤에 거울 층(`mirrorRef`) `div`를 겹쳐 맞춤법 형광과 원격 커서를 표시한다.
 */
export const NotebookField = forwardRef<HTMLTextAreaElement, NotebookFieldProps>(function NotebookField(
  {
    mirrorRef,
    textareaRef,
    fontSize = 18,
    showMarginLine = true,
    stageClassName,
    mirrorTestId = 'notebook-mirror-host',
    placeholder = ko.student.bodyPlaceholder,
    'aria-label': ariaLabel = ko.student.bodyAriaLabel,
    className,
    style,
    children,
    ...rest
  },
  forwardedRef,
) {
  // 런타임에 잘못 넘어온 제어 속성이 있어도 입력칸에 전달하지 않는다(PLAN §6.3).
  const safeRest = { ...(rest as Record<string, unknown>) };
  delete safeRest['value'];
  delete safeRest['defaultValue'];
  delete safeRest['readOnly'];

  const mergedTextareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      assignRef(forwardedRef, node);
      assignRef(textareaRef, node);
    },
    [forwardedRef, textareaRef],
  );

  const stageClasses = [styles.stage, showMarginLine ? styles.withMarginLine : '', stageClassName ?? '']
    .filter(Boolean)
    .join(' ');

  const textareaClasses = [
    styles.textarea,
    'gb-notebook-lines',
    !showMarginLine ? styles.withoutMarginPadding : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const stageStyle: CSSProperties = {
    '--fs-write': `${fontSize}px`,
    '--write-fs': `${fontSize}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={stageClasses}
      style={stageStyle}
      data-notebook-field=""
      data-font-size={fontSize}
      data-margin-line={showMarginLine ? 'true' : 'false'}
    >
      <div
        ref={mirrorRef}
        className={styles.mirror}
        data-mirror=""
        aria-hidden="true"
        data-testid={mirrorTestId}
      />
      <textarea
        ref={textareaRef ? mergedTextareaRef : forwardedRef}
        className={textareaClasses}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-editor-field="body"
        {...(safeRest as Omit<
          TextareaHTMLAttributes<HTMLTextAreaElement>,
          'value' | 'defaultValue' | 'readOnly' | 'children'
        >)}
      />
      {children}
    </div>
  );
});
