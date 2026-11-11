import { ko } from '@geulbang/core/copy';
import { Button } from '../../components/Button.tsx';
import { Icon, type IconName } from '../../icons/Icon.tsx';
import { TeacherFrame } from './TeacherFrame.tsx';
import styles from './TeacherRegister.module.css';

/**
 * 등록 링크(`/t/register#코드`) 처리 단계(PRD F-15, PLAN §6.1).
 * - saving: `#` 뒤 코드를 기기에 저장하는 중
 * - saved: 저장했고 주소창에서도 지움
 * - invalid: 주소에 코드가 없거나 모양이 틀림
 * - blocked: 이 기기에 저장할 수 없음(사생활 보호 모드 등)
 */
export type TeacherRegisterState = 'saving' | 'saved' | 'invalid' | 'blocked';

export interface TeacherRegisterViewProps {
  readonly state: TeacherRegisterState;
  /** 저장 뒤 바로 수업방 만들기(T1)로. */
  readonly onCreateRoom: () => void;
  /** 선생님 홈(T0)으로. */
  readonly onTeacherHome: () => void;
}

const ICON_BY_STATE: Record<TeacherRegisterState, IconName> = {
  saving: 'sending',
  saved: 'check',
  invalid: 'warning',
  blocked: 'warning',
};

function messageFor(state: TeacherRegisterState): string {
  if (state === 'saving') return ko.common.loading;
  if (state === 'saved') return ko.teacher.registerLinkSavedToast;
  if (state === 'invalid') return ko.errors.E_START_CODE_INVALID;
  return ko.teacher.checkStorageFail;
}

/** 등록 링크 처리 화면. 별도 화면 없이 지나가는 단계라 카드 한 장과 다음 단추만 둔다. */
export function TeacherRegisterView({ state, onCreateRoom, onTeacherHome }: TeacherRegisterViewProps) {
  const tone = state === 'saved' ? styles.ok : state === 'saving' ? styles.pending : styles.problem;
  return (
    <TeacherFrame title={ko.teacher.registerHeading}>
      <div className={[styles.card, tone].join(' ')} role="status" aria-live="polite" data-state={state}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name={ICON_BY_STATE[state]} size={32} />
        </span>
        <p className={styles.message}>{messageFor(state)}</p>
      </div>
      {state === 'saved' ? (
        <div className={styles.actions}>
          <Button variant="primary" size="lg" icon="write" fullWidth onClick={onCreateRoom}>
            {ko.teacher.createNewRoomAction}
          </Button>
          <Button variant="ghost" fullWidth onClick={onTeacherHome}>
            {ko.teacher.goTeacherHomeAction}
          </Button>
        </div>
      ) : state === 'saving' ? null : (
        <div className={styles.actions}>
          <Button variant="secondary" fullWidth onClick={onTeacherHome}>
            {ko.teacher.goTeacherHomeAction}
          </Button>
        </div>
      )}
    </TeacherFrame>
  );
}
