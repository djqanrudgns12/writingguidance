import { defaultConfig } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import { CodeInput, Keypad, TextButton } from '../../components/index.ts';
import { Icon } from '../../icons/Icon.tsx';
import { SheetSurface } from '../common/SheetSurface.tsx';
import styles from './EntryCodeSheet.module.css';

export type EntryCodeStatus = 'idle' | 'checking' | 'error';

export interface EntryCodeSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 지금까지 누른 숫자(0~6자리). */
  readonly code: string;
  readonly onCodeChange: (code: string) => void;
  /** 6자리를 다 누르면 바로 부른다(PRD F-01: 다 누르면 바로 확인). */
  readonly onComplete: (code: string) => void;
  readonly status?: EntryCodeStatus | undefined;
  /** `status: 'error'`일 때 보일 말. 보통 `ko.errors.E_ROOM_NOT_FOUND` 등. */
  readonly errorMessage?: string | undefined;
  /** 개인 모드(F-25, `PERSONAL_MODE_ENABLED`)가 켜졌을 때만 `혼자 쓸래요`가 생긴다. */
  readonly onSolo?: (() => void) | undefined;
  /** 클립보드 읽기를 결합하는 쪽이 맡을 때만 `붙여넣기`가 생긴다(물리 키보드 붙여넣기는 늘 된다). */
  readonly onPasteRequest?: (() => void) | undefined;
  readonly inline?: boolean | undefined;
}

const CODE_LENGTH = defaultConfig.ENTRY_CODE_LENGTH;

/**
 * 입장 코드 시트(PRD F-01·F-02, PLAN §6.7): 6칸 + 화면 숫자 키패드 + 물리 키보드 숫자 + 붙여넣기.
 * 값은 바깥이 쥐고, 이 시트는 다음 값을 계산해 알리기만 한다.
 */
export function EntryCodeSheet({
  open,
  onOpenChange,
  code,
  onCodeChange,
  onComplete,
  status = 'idle',
  errorMessage,
  onSolo,
  onPasteRequest,
  inline,
}: EntryCodeSheetProps) {
  const checking = status === 'checking';

  const push = (next: string) => {
    const digits = next.replace(/\D+/g, '').slice(0, CODE_LENGTH);
    if (digits === code) return;
    onCodeChange(digits);
    if (digits.length === CODE_LENGTH) onComplete(digits);
  };

  return (
    <SheetSurface open={open} onOpenChange={onOpenChange} title={ko.student.codeSheetTitle} inline={inline}>
      {onSolo ? (
        <div className={styles.soloRow}>
          <TextButton tone="ink" icon="student" onClick={onSolo}>
            {ko.student.homeSoloAction}
          </TextButton>
        </div>
      ) : null}
      <p className={styles.hint}>{ko.student.codeSheetHint}</p>
      <CodeInput
        value={code}
        length={CODE_LENGTH}
        disabled={checking}
        error={status === 'error' ? errorMessage : undefined}
        onChange={next => {
          onCodeChange(next);
        }}
        onComplete={onComplete}
        className={styles.code}
      />
      {checking ? (
        <p className={styles.checking} role="status" aria-live="polite">
          <Icon name="sending" size={16} />
          <span>{ko.student.codeSheetChecking}</span>
        </p>
      ) : null}
      <Keypad
        disabled={checking}
        onDigit={digit => push(code + digit)}
        onBackspace={() => push(code.slice(0, -1))}
        className={styles.keypad}
      />
      {onPasteRequest ? (
        <div className={styles.pasteRow}>
          <TextButton icon="copy" onClick={onPasteRequest} disabled={checking}>
            {ko.student.codeSheetPasteAction}
          </TextButton>
        </div>
      ) : null}
    </SheetSurface>
  );
}
