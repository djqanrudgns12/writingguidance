import { type CSSProperties, type ReactNode } from 'react';
import {
  Gulbeot,
  Panel,
  Sheet,
  type SheetHeight,
  type SheetMode,
  type SheetProps,
} from '../../components/index.ts';
import type { IconName } from '../../icons/Icon.tsx';
import { cx } from './cx.ts';
import styles from './SheetSurface.module.css';

export interface SheetSurfaceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly mode?: Exclude<SheetMode, 'side'> | undefined;
  /** `result`: 좁은 화면 AI 결과 시트(화면 높이 60%, 본문만 안에서 넘김, PRD F-06) */
  readonly height?: SheetHeight | undefined;
  /** `false`: 배경막 없는 시트(맞춤법 항목을 눌렀을 때 쓰기 칸 선택이 보이게) */
  readonly modal?: boolean | undefined;
  /** 열릴 때 초점(부품 `Sheet`의 `initialFocus`). 견본 제자리 패널에서는 쓰지 않는다. */
  readonly initialFocus?: SheetProps['initialFocus'];
  /**
   * 견본·시험용: 시트(포털·모달) 대신 가장 가까운 `transform` 조상 안 아래쪽에 종이 패널로 그린다.
   * 운영 화면은 쓰지 않는다(`/dev/screens/student`가 상태별로 늘어놓을 때만).
   */
  readonly inline?: boolean | undefined;
  readonly showGulbeot?: boolean | undefined;
  /**
   * 머리 제목 앞에 둘 그림(결과 패널 기다림·한도의 표정 글벗). 주면 `showGulbeot`의 기본 얼굴 대신 이것 하나만 그린다
   * (화면당 그림 한 장, PRD 8.10). 부품 `Sheet`에 머리 그림 자리가 없어 제목 앞에 함께 넣는다.
   */
  readonly headerMedia?: ReactNode | undefined;
  readonly headerIcon?: IconName | undefined;
  readonly footer?: ReactNode | undefined;
  /** 시트는 `body` 아래 포털이라 화면 뿌리의 CSS 변수(글자 크기 등)가 닿지 않는다. 본문 감싸개에 직접 준다. */
  readonly bodyStyle?: CSSProperties | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode | undefined;
}

/**
 * 학생 화면의 시트 한 곳(PRD 7.3, F-01, F-06, F-10, F-11, F-13). 부품 `Sheet`를 그대로 쓰고,
 * 견본 화면에서만 같은 머리·본문·바닥을 제자리 종이 패널로 그린다(내용이 같아야 캡처가 의미 있다).
 */
export function SheetSurface({
  open,
  onOpenChange,
  title,
  mode = 'bottom',
  height,
  modal,
  initialFocus,
  inline = false,
  showGulbeot = false,
  headerMedia,
  headerIcon,
  footer,
  bodyStyle,
  className,
  children,
}: SheetSurfaceProps) {
  const body = (
    <div className={styles.body} style={bodyStyle}>
      {children}
    </div>
  );

  if (inline) {
    if (!open) return null;
    return (
      <div className={styles.inline} data-sheet-inline={mode}>
        <Panel
          className={cx(styles.inlinePanel, className)}
          title={title}
          icon={headerIcon}
          headerMedia={headerMedia ?? (showGulbeot ? <Gulbeot size={32} /> : undefined)}
          onClose={() => onOpenChange(false)}
          footer={footer}
        >
          {body}
        </Panel>
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      mode={mode}
      height={height}
      modal={modal}
      initialFocus={initialFocus}
      title={
        headerMedia ? (
          <span className={styles.titleWithMedia}>
            {headerMedia}
            <span>{title}</span>
          </span>
        ) : (
          title
        )
      }
      headerIcon={headerIcon}
      showGulbeot={headerMedia ? false : showGulbeot}
      footer={footer}
      className={className}
    >
      {body}
    </Sheet>
  );
}
