import { defaultConfig, type AiButton, type GenreId } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { type FormEvent } from 'react';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Switch } from '../../components/Switch.tsx';
import { TextField } from '../../components/TextField.tsx';
import { CodeKeypadField } from './CodeKeypadField.tsx';
import styles from './CreateRoom.module.css';
import { AiButtonSwitches, GenreChecks } from './RoomOptionFields.tsx';
import { TeacherFrame } from './TeacherFrame.tsx';

/** T1 입력값(PRD F-15 표). 화면은 값을 들고 있지 않고 결합 쪽이 준다. */
export interface CreateRoomValues {
  readonly startCode: string;
  readonly className: string;
  readonly title: string;
  readonly schoolName: string;
  readonly showSchool: boolean;
  readonly genres: readonly GenreId[];
  readonly aiButtons: readonly AiButton[];
  readonly pin: string;
  readonly pinConfirm: string;
}

/** 숫자판이 붙을 수 있는 칸. */
export type CreateRoomCodeField = 'startCode' | 'pin' | 'pinConfirm';

/** 칸별 오류 문구. 어떤 문구를 보일지는 결합 쪽이 `ko`에서 골라 준다. */
export type CreateRoomErrors = Partial<
  Record<
    'startCode' | 'className' | 'title' | 'schoolName' | 'genres' | 'pin' | 'pinConfirm' | 'form',
    string
  >
>;

export interface CreateRoomViewProps {
  /** 이 기기에 시작 코드가 없으면 맨 위에 시작 코드 칸을 붙인다(PRD F-15, PLAN §6.1). */
  readonly needsStartCode: boolean;
  readonly values: CreateRoomValues;
  readonly onChange: (patch: Partial<CreateRoomValues>) => void;
  /** 지금 화면 숫자판이 붙은 칸. 없으면 숫자판을 접는다. */
  readonly activeCodeField: CreateRoomCodeField | null;
  readonly onActiveCodeFieldChange: (field: CreateRoomCodeField) => void;
  readonly errors?: CreateRoomErrors | undefined;
  /** 시작 코드를 너무 많이 틀려 잠겼을 때(PIN과 같은 칸, PRD F-15). */
  readonly startCodeLocked?: boolean | undefined;
  readonly submitting?: boolean | undefined;
  readonly onSubmit: () => void;
  readonly onBack?: (() => void) | undefined;
  readonly startCodeLength?: number | undefined;
  readonly pinMaxLength?: number | undefined;
  /** PIN 칸은 이 길이부터 보이고 칠수록 `pinMaxLength`까지 늘어난다(PRD F-20 6~8자리). */
  readonly pinMinLength?: number | undefined;
  readonly classNameMaxChars?: number | undefined;
  readonly titleMaxChars?: number | undefined;
  readonly schoolNameMaxChars?: number | undefined;
}

/**
 * T1 수업방 만들기(PRD F-15). 한 화면에서 위에서 아래로 입력하고 맨 아래 `수업방 열기` 하나가 주요 단추다.
 * 큰 카드 여러 장 대신 줄로 나눈 묶음으로 둔다(교사 화면은 정돈된 출석부, PRD 8.4).
 */
export function CreateRoomView({
  needsStartCode,
  values,
  onChange,
  activeCodeField,
  onActiveCodeFieldChange,
  errors = {},
  startCodeLocked = false,
  submitting = false,
  onSubmit,
  onBack,
  startCodeLength = defaultConfig.TEACHER_START_CODE_LENGTH,
  pinMaxLength = defaultConfig.PIN_MAX_LENGTH,
  pinMinLength = defaultConfig.PIN_MIN_LENGTH,
  classNameMaxChars = defaultConfig.CLASS_NAME_MAX_CHARS,
  titleMaxChars = defaultConfig.ROOM_TITLE_MAX_CHARS,
  schoolNameMaxChars = defaultConfig.SCHOOL_NAME_MAX_CHARS,
}: CreateRoomViewProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitting) onSubmit();
  };

  return (
    <TeacherFrame title={ko.teacher.createRoomHeading} onBack={onBack}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {needsStartCode ? (
          <section className={styles.section}>
            <CodeKeypadField
              label={ko.teacher.startCodeLabel}
              hint={ko.teacher.startCodeHint}
              error={startCodeLocked ? ko.errors.E_PIN_LOCKED : errors.startCode}
              value={values.startCode}
              length={startCodeLength}
              disabled={startCodeLocked || submitting}
              onChange={startCode => onChange({ startCode })}
              showKeypad={activeCodeField === 'startCode'}
              onActivate={() => onActiveCodeFieldChange('startCode')}
            />
          </section>
        ) : null}

        <section className={styles.section}>
          <div className={styles.twoCol}>
            <TextField
              label={ko.teacher.classNameLabel}
              placeholder={ko.teacher.classNamePlaceholder}
              value={values.className}
              maxLength={classNameMaxChars}
              required
              autoComplete="off"
              error={errors.className}
              onChange={e => onChange({ className: e.target.value })}
            />
            <TextField
              label={ko.teacher.roomTitleLabel}
              placeholder={ko.teacher.roomTitlePlaceholder}
              value={values.title}
              maxLength={titleMaxChars}
              required
              autoComplete="off"
              error={errors.title}
              onChange={e => onChange({ title: e.target.value })}
            />
          </div>
          <div className={styles.schoolRow}>
            <TextField
              label={ko.teacher.schoolNameLabel}
              placeholder={ko.teacher.schoolNamePlaceholder}
              value={values.schoolName}
              maxLength={schoolNameMaxChars}
              autoComplete="off"
              error={errors.schoolName}
              onChange={e => onChange({ schoolName: e.target.value })}
            />
            <Switch
              className={styles.schoolSwitch}
              label={ko.teacher.showSchoolSwitch}
              checked={values.showSchool}
              disabled={values.schoolName.trim() === ''}
              onCheckedChange={showSchool => onChange({ showSchool })}
            />
          </div>
        </section>

        <section className={styles.section}>
          <GenreChecks
            legend={ko.teacher.visibleGenresLabel}
            value={values.genres}
            error={errors.genres}
            onChange={genres => onChange({ genres })}
          />
        </section>

        <section className={styles.section}>
          <AiButtonSwitches
            legend={ko.teacher.enabledAiButtonsLabel}
            value={values.aiButtons}
            onChange={aiButtons => onChange({ aiButtons })}
          />
        </section>

        <section className={styles.section}>
          <div className={styles.pinPair}>
            <CodeKeypadField
              label={ko.teacher.pinCreateLabel}
              hint={ko.teacher.pinLengthHint}
              error={errors.pin}
              value={values.pin}
              length={pinMaxLength}
              minLength={pinMinLength}
              masked
              disabled={submitting}
              onChange={pin => onChange({ pin })}
              showKeypad={activeCodeField === 'pin'}
              onActivate={() => onActiveCodeFieldChange('pin')}
            />
            <CodeKeypadField
              label={ko.teacher.pinConfirmLabel}
              error={errors.pinConfirm}
              value={values.pinConfirm}
              length={pinMaxLength}
              minLength={pinMinLength}
              masked
              disabled={submitting}
              onChange={pinConfirm => onChange({ pinConfirm })}
              showKeypad={activeCodeField === 'pinConfirm'}
              onActivate={() => onActiveCodeFieldChange('pinConfirm')}
            />
          </div>
        </section>

        {errors.form ? <Banner tone="danger" icon="warning" message={errors.form} /> : null}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting}>
          {ko.teacher.openRoomAction}
        </Button>
      </form>
    </TeacherFrame>
  );
}
