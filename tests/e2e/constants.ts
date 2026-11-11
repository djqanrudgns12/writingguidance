/**
 * Playwright 화면 시험(`tests/e2e`)과 `playwright.config.ts`가 함께 쓰는 고정 설정값.
 * 운영(4460)·개발(4461, 4462) 포트와 겹치지 않도록 시험 전용 4465 포트를 쓴다.
 */
export const E2E_HOST = '127.0.0.1';
export const E2E_PORT = 4465;
export const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`;

/**
 * 시험 전용 `dev` 자격 고정 토큰(base64url 43자).
 * 실제 비밀값이 아니며, 시험 서버(`DEV_SECRET`)와 시험 페이지(`#dev=`) 주소를 맞추는 데만 쓴다.
 */
export const E2E_DEV_SECRET = 'e'.repeat(43);

export const E2E_DB_DIR = '.local/e2e';
export const E2E_DB_PATH = `${E2E_DB_DIR}/e2e.sqlite`;
export const E2E_WEB_DIST_DIR = 'apps/web/dist-devices';

/**
 * 시험 전용 선생님 시작 코드(숫자 8자리, `TEACHER_START_CODE_LENGTH`). 실제 운영 값이 아니다.
 * 시험 서버 환경(`TEACHER_START_CODE`)과 화면·REST 시험이 같은 값을 쓴다.
 */
export const E2E_START_CODE = '24681357';

/** PLAN §10.5 시험 설정: 스냅샷 1초, 보관 2분. 만료 시험(`retention.spec.ts`)이 이 값을 기준으로 기다린다. */
export const E2E_SNAPSHOT_INTERVAL_SEC = 1;
export const E2E_ROOM_TTL_MINUTES = 2;

/**
 * 시험 전용 AI 하루 한도(참가자당). 한도 안내 시험(`ai-panels.spec.ts`)이 버튼 몇 번으로 닿게 줄인다.
 * 버튼별 쿨다운(`AI_COOLDOWN_SEC`)은 기본값 그대로라, 서로 다른 버튼 셋을 누르면 넷째에서 한도에 닿는다.
 */
export const E2E_AI_DAILY_PER_PARTICIPANT = 3;

/**
 * 시험 하나가 같은 IP(127.0.0.1)에서 수업방을 여러 개 만든다. 하루 만들기 한도(기본 IP 30·기기 10)를
 * 시험 실행 한 번이 넘지 않게 넉넉히 둔다(한도 동작 자체는 서버 통합 시험이 본다).
 */
export const E2E_ROOM_CREATE_PER_DAY = 1000;

/** 화면 폭(PLAN §10.5): 기본 360·1280, 배치 시험만 360·768·1024·1280. */
export const E2E_DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
export const E2E_PHONE_VIEWPORT = { width: 360, height: 740 } as const;
export const E2E_LAYOUT_WIDTHS = [360, 768, 1024, 1280] as const;
