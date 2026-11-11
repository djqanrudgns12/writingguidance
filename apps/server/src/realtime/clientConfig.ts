import type { Config } from '@geulbang/core/config';
import type { ServerConfig } from '../config.ts';

/**
 * `hello.config`: 기기가 알아야 하는 설정만(PLAN §13.1). 서버 설정을 바꾸면 앱을 다시 빌드하지 않아도 기기 동작이 바뀐다.
 * 속도 제한·AI 모델·제공사·하루 한도처럼 기기가 쓸 일이 없는 값은 보내지 않는다.
 */
export const CLIENT_CONFIG_KEYS = [
  'EXPIRY_WARNING_DAYS',
  'PIN_MIN_LENGTH',
  'PIN_MAX_LENGTH',
  'ENTRY_CODE_LENGTH',
  'NICKNAME_MAX_LENGTH',
  'CLASS_NAME_MAX_CHARS',
  'ROOM_TITLE_MAX_CHARS',
  'SCHOOL_NAME_MAX_CHARS',
  'DOC_MAX_CHARS',
  'DOC_TITLE_MAX_CHARS',
  'MEMO_MAX_CHARS',
  'COMMAND_ACK_TIMEOUT_MS',
  'UNDO_GROUP_MS',
  'SNAPSHOT_MAX',
  'IME_IDLE_MS',
  'IME_LONG_IDLE_MS',
  'IME_MAX_HOLD_MS',
  'IME_RELAXED_IDLE_MS',
  'IME_STUCK_MS',
  'IME_HOLD_NOTICE_MS',
  'HEARTBEAT_SEC',
  'CLIENT_STALE_SEC',
  'ACTIVE_WINDOW_SEC',
  'IDLE_AFTER_SEC',
  'OFFLINE_AFTER_SEC',
  'RECONNECT_BACKOFF_MS',
  'NOTICE_SHOW_SEC',
  'NOTICE_REPLAY_SEC',
  'NOTICE_MAX_CHARS',
  'TIMER_PRESETS_MIN',
  'TIMER_MAX_MIN',
  'RESUME_WAIT_HINT_MIN',
  'RESUME_LONGPOLL_SEC',
  'AI_COOLDOWN_SEC',
  'AI_MAX_INPUT_CHARS',
  'AI_SPELL_CHUNK_CHARS',
  'AI_SPELL_MAX_CHARS',
  'AI_MIN_CHARS',
  'LARGE_DELETE_CHARS',
  'RECENT_ROOMS_MAX',
  'FONT_SIZES',
  'POLICY_VERSION',
] as const satisfies ReadonlyArray<keyof Config>;

export function clientConfigOf(config: ServerConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CLIENT_CONFIG_KEYS) out[key] = config.product[key];
  // 실기기 한글 진단(PRD 13.2)은 운영 환경 변수라 제품 설정 밖에 있다. 쓰기 화면이 이 값으로 진단을 켠다(PLAN P2-3).
  out['IME_DIAGNOSTICS_ENABLED'] = config.ops.IME_DIAGNOSTICS_ENABLED;
  return out;
}
