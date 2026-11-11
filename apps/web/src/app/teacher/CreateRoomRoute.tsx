import { GENRE_IDS, AI_BUTTONS, type Config } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import type { ErrorCode } from '@geulbang/core/errors';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  createRoom,
  newCreateRoomAttempt,
  type CreateRoomAttempt,
  type CreateRoomForm,
} from '../../application/createRoom.ts';
import { LoadingView } from '../../ui/screens/common/Loading.tsx';
import {
  CreateRoomView,
  type CreateRoomCodeField,
  type CreateRoomErrors,
  type CreateRoomValues,
} from '../../ui/screens/teacher/index.ts';
import { useAppDeps } from '../providers.tsx';
import { errorCodeOf, errorMessage } from './errors.ts';
import { forgetStartCode, isStartCodeShape, readStartCode, writeStartCode } from './hooks/startCode.ts';
import { teacherPaths } from './paths.ts';

const INITIAL_VALUES: CreateRoomValues = {
  startCode: '',
  className: '',
  title: '',
  schoolName: '',
  showSchool: false,
  genres: GENRE_IDS,
  aiButtons: AI_BUTTONS,
  pin: '',
  pinConfirm: '',
};

type ValidationConfig = Pick<Config, 'PIN_MIN_LENGTH' | 'PIN_MAX_LENGTH' | 'TEACHER_START_CODE_LENGTH'>;

/** 보내기 전에 기기에서 보는 것(PRD F-15 필수 칸, F-20 PIN 길이). 서버도 같은 것을 다시 본다. */
export function validateCreateRoom(
  values: CreateRoomValues,
  needsStartCode: boolean,
  config: ValidationConfig,
): CreateRoomErrors {
  const errors: CreateRoomErrors = {};
  if (needsStartCode && !isStartCodeShape(values.startCode, config)) {
    errors.startCode = ko.errors.E_START_CODE_INVALID;
  }
  if (values.className.trim() === '') errors.className = ko.teacher.classNameRequired;
  if (values.title.trim() === '') errors.title = ko.teacher.roomTitleRequired;
  const pinOk =
    /^\d+$/.test(values.pin) &&
    values.pin.length >= config.PIN_MIN_LENGTH &&
    values.pin.length <= config.PIN_MAX_LENGTH;
  if (!pinOk) errors.pin = ko.teacher.pinTooShortError;
  else if (values.pinConfirm !== values.pin) errors.pinConfirm = ko.teacher.pinMismatchError;
  return errors;
}

/** 서버가 거절한 이유를 칸에 붙인다. 칸이 정해지지 않은 것은 맨 아래 띠로. */
function errorsForCode(code: ErrorCode, needsStartCode: boolean): CreateRoomErrors {
  if (code === 'E_PIN_TAKEN') return { pin: ko.errors.E_PIN_TAKEN };
  if (code === 'E_START_CODE_INVALID' && needsStartCode) return { startCode: ko.errors.E_START_CODE_INVALID };
  return { form: errorMessage(code) };
}

function toForm(values: CreateRoomValues, startCode: string | null): CreateRoomForm {
  const schoolName = values.schoolName.trim();
  return {
    className: values.className.trim(),
    title: values.title.trim(),
    ...(schoolName ? { schoolName } : {}),
    showSchool: schoolName !== '' && values.showSchool,
    genres: values.genres,
    aiButtons: values.aiButtons,
    pin: values.pin,
    startCode,
  };
}

/**
 * T1 수업방 만들기(PRD F-15, PLAN §2.3 ①). 시작 코드는 기기에 없을 때만 맨 위 칸으로 받는다.
 * 명령 ID·링크 토큰은 시도마다 하나: 응답이 사라져 같은 내용으로 다시 누르면 같은 것을 보내 서버가 같은 결과를 준다.
 * 내용을 고친 뒤 누르면 새 시도로 본다(같은 명령 ID에 다른 인자는 서버가 `E_INPUT`으로 막으므로).
 */
export function CreateRoomRoute() {
  const deps = useAppDeps();
  const navigate = useNavigate();
  const { config } = deps;
  /** undefined = 기기에서 읽는 중 */
  const [storedCode, setStoredCode] = useState<string | null | undefined>(undefined);
  const [values, setValues] = useState<CreateRoomValues>(INITIAL_VALUES);
  const [activeField, setActiveField] = useState<CreateRoomCodeField | null>(null);
  const [errors, setErrors] = useState<CreateRoomErrors>({});
  const [startCodeLocked, setStartCodeLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const attemptRef = useRef<{ readonly key: string; readonly attempt: CreateRoomAttempt } | null>(null);

  useEffect(() => {
    let cancelled = false;
    readStartCode(deps.localStore.kv).then(
      code => {
        if (!cancelled) setStoredCode(code);
      },
      () => {
        if (!cancelled) setStoredCode(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deps]);

  const needsStartCode = config.TEACHER_START_CODE_REQUIRED && storedCode === null;

  useEffect(() => {
    if (storedCode !== undefined) setActiveField(needsStartCode ? 'startCode' : 'pin');
  }, [storedCode, needsStartCode]);

  if (storedCode === undefined) return <LoadingView />;

  const submit = async () => {
    const found = validateCreateRoom(values, needsStartCode, config);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const startCode = !config.TEACHER_START_CODE_REQUIRED
      ? null
      : needsStartCode
        ? values.startCode
        : (storedCode ?? null);
    const form = toForm(values, startCode);
    const key = JSON.stringify(form);
    if (!attemptRef.current || attemptRef.current.key !== key) {
      attemptRef.current = { key, attempt: newCreateRoomAttempt(deps) };
    }
    const { attempt } = attemptRef.current;
    setSubmitting(true);
    try {
      const created = await createRoom(deps, form, attempt);
      attemptRef.current = null;
      if (needsStartCode && startCode)
        await writeStartCode(deps.localStore.kv, startCode).catch(() => undefined);
      navigate(teacherPaths.prep(created.roomId));
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === 'E_START_CODE_INVALID' && !needsStartCode) {
        // 기기에 저장된 코드가 바뀌었다: 지우고 칸을 열어 다시 받는다.
        await forgetStartCode(deps.localStore.kv).catch(() => undefined);
        setStoredCode(null);
        setErrors({ startCode: ko.errors.E_START_CODE_INVALID });
      } else if (code === 'E_PIN_LOCKED' && needsStartCode) {
        setStartCodeLocked(true);
        setErrors({});
      } else {
        setErrors(errorsForCode(code, needsStartCode));
      }
      setSubmitting(false);
    }
  };

  return (
    <CreateRoomView
      needsStartCode={needsStartCode}
      values={values}
      onChange={patch => {
        setValues(v => ({ ...v, ...patch }));
        // 고친 칸의 오류는 지운다(다시 누를 때 다시 본다).
        setErrors(e => {
          const next = { ...e };
          for (const k of Object.keys(patch) as (keyof CreateRoomValues)[]) {
            if (k in next) delete next[k as keyof CreateRoomErrors];
          }
          return next;
        });
      }}
      activeCodeField={activeField}
      onActiveCodeFieldChange={setActiveField}
      errors={errors}
      startCodeLocked={startCodeLocked}
      submitting={submitting}
      onSubmit={() => void submit()}
      onBack={() => navigate(teacherPaths.home)}
      startCodeLength={config.TEACHER_START_CODE_LENGTH}
      pinMaxLength={config.PIN_MAX_LENGTH}
      pinMinLength={config.PIN_MIN_LENGTH}
      classNameMaxChars={config.CLASS_NAME_MAX_CHARS}
      titleMaxChars={config.ROOM_TITLE_MAX_CHARS}
      schoolNameMaxChars={config.SCHOOL_NAME_MAX_CHARS}
    />
  );
}
