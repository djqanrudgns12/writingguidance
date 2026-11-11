-- 0001_init: 첫 스키마 (PLAN §5.2)
-- 규칙
--   * 시각은 UTC 밀리초 정수, ID는 UUID 문자열.
--   * 수업방을 지우면 외래키 ON DELETE CASCADE로 그 방의 모든 행이 함께 사라진다(PRD F-24).
--   * 길이·개수처럼 바뀔 수 있는 값은 CHECK에 넣지 않는다(PRD 0.2-5 "설정 한 곳"). 그런 검사는
--     config 값으로 만든 zod 스키마가 한다. CHECK는 상태값·불리언 같은 불변식만.
--   * 적용된 이 파일은 고치지 않는다. 바꿀 것은 새 마이그레이션으로, 열은 더하기만 한다(PLAN §15.4).
--   * schema_migrations 표는 마이그레이션 도구(src/store/migrate.ts)가 만든다.

CREATE TABLE rooms (
  id             TEXT PRIMARY KEY,
  entry_code     TEXT NOT NULL UNIQUE,
  pin_hmac       TEXT NOT NULL UNIQUE,
  pin_enc        TEXT NOT NULL,                         -- AES-256-GCM, base64(iv|암호문|태그)
  class_name     TEXT NOT NULL,
  title          TEXT NOT NULL,
  school_name    TEXT,
  show_school    INTEGER NOT NULL DEFAULT 0 CHECK (show_school IN (0, 1)),
  settings_json  TEXT NOT NULL,                         -- {genres[], aiButtons{SPELL,FEEDBACK,DIRECTION,POLISH}, undoLevel, sound, diagnostics}
  retention_days INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  closed_at      INTEGER
);
CREATE INDEX rooms_expires ON rooms (expires_at);

CREATE TABLE teacher_sessions (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,                    -- SHA-256(기기가 만든 토큰)
  kind         TEXT NOT NULL CHECK (kind IN ('LINK', 'PIN')),
  device_id    TEXT,                                     -- PIN 세션만
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX teacher_sessions_room ON teacher_sessions (room_id);

CREATE TABLE participants (
  id              TEXT PRIMARY KEY,
  room_id         TEXT REFERENCES rooms (id) ON DELETE CASCADE,   -- NULL = 개인 모드 [v1.1]
  nickname        TEXT NOT NULL,
  nickname_norm   TEXT NOT NULL,
  school_norm     TEXT,                                            -- 개인 모드만
  consent_version TEXT NOT NULL,
  consent_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  expires_at      INTEGER,                                         -- 개인 모드만
  UNIQUE (id, room_id)                                             -- 아래 복합 외래키의 대상
);
CREATE UNIQUE INDEX participants_room_nick ON participants (room_id, nickname_norm) WHERE room_id IS NOT NULL;
CREATE INDEX participants_personal_expiry ON participants (expires_at) WHERE room_id IS NULL;

CREATE TABLE devices (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,                  -- SHA-256(기기가 만든 토큰)
  device_id      TEXT NOT NULL,
  approved_at    INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  revoked_at     INTEGER
);
CREATE INDEX devices_participant ON devices (participant_id);

CREATE TABLE resume_requests (
  id                TEXT PRIMARY KEY,
  room_id           TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  participant_id    TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  device_token_hash TEXT NOT NULL UNIQUE,               -- 새 기기가 만든 토큰의 해시. 허용되면 devices로 옮긴다
  status            TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  created_at        INTEGER NOT NULL,
  decided_at        INTEGER,
  FOREIGN KEY (participant_id, room_id) REFERENCES participants (id, room_id) ON DELETE CASCADE  -- 같은 방 소속 보장
);
CREATE INDEX resume_requests_room_status ON resume_requests (room_id, status);
CREATE UNIQUE INDEX resume_requests_one_pending ON resume_requests (participant_id, device_id) WHERE status = 'PENDING';

CREATE TABLE documents (
  id                TEXT PRIMARY KEY,
  room_id           TEXT REFERENCES rooms (id) ON DELETE CASCADE,   -- NULL = 개인 모드
  participant_id    TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  genre             TEXT NOT NULL,                      -- 만들 때 정해지고 바뀌지 않음
  subtype           TEXT,                               -- 캐시: 원본은 Yjs meta.subtype, 저장 때 갱신(요약용)
  purpose           TEXT,
  ydoc_state        BLOB NOT NULL,                      -- 글의 진짜 원본
  title_text        TEXT NOT NULL DEFAULT '',           -- 캐시(저장 때 갱신)
  plain_text        TEXT NOT NULL DEFAULT '',           -- 캐시
  char_count        INTEGER NOT NULL DEFAULT 0,         -- 캐시
  status            TEXT NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'REOPENED')),
  submit_generation INTEGER NOT NULL DEFAULT 0,         -- 다시 쓰게 하기마다 +1 (늦은 옛 제출 거부)
  submitted_at      INTEGER,
  reopened_at       INTEGER,
  last_input_at     INTEGER,
  last_input_by     TEXT CHECK (last_input_by IN ('STUDENT', 'TEACHER')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  -- 글과 학생이 같은 방임을 보장한다. 개인 모드는 room_id가 NULL이라 SQLite가 이 검사를 건너뛴다.
  FOREIGN KEY (participant_id, room_id) REFERENCES participants (id, room_id)
);
CREATE INDEX documents_room ON documents (room_id);
CREATE INDEX documents_participant ON documents (participant_id);

CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('AUTO', 'SUBMIT', 'AI', 'TEACHER', 'RESTORE')),
  author      TEXT NOT NULL CHECK (author IN ('STUDENT', 'TEACHER', 'SYSTEM')),
  title_text  TEXT NOT NULL,
  body_text   TEXT NOT NULL,
  char_count  INTEGER NOT NULL
);
CREATE INDEX snapshots_doc_time ON snapshots (document_id, created_at);

CREATE TABLE notices (
  id      TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('MANUAL', 'TIMER')),
  text    TEXT NOT NULL,
  sound   INTEGER NOT NULL CHECK (sound IN (0, 1)),
  sent_at INTEGER NOT NULL
);
CREATE INDEX notices_room_time ON notices (room_id, sent_at);

CREATE TABLE timers (
  room_id             TEXT PRIMARY KEY REFERENCES rooms (id) ON DELETE CASCADE,
  status              TEXT NOT NULL CHECK (status IN ('IDLE', 'RUNNING', 'PAUSED')),
  duration_ms         INTEGER,
  ends_at             INTEGER,
  paused_remaining_ms INTEGER,
  alerts_json         TEXT NOT NULL,                    -- {m5, m1, end}
  end_text            TEXT NOT NULL,
  started_at          INTEGER
);

CREATE TABLE ai_usage (
  id             TEXT PRIMARY KEY,
  command_id     TEXT NOT NULL UNIQUE,                  -- 같은 요청을 두 번 세지 않음
  room_id        TEXT REFERENCES rooms (id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  document_id    TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  button         TEXT NOT NULL CHECK (button IN ('SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH')),
  status         TEXT NOT NULL CHECK (status IN ('RESERVED', 'OK', 'FAILED', 'REFUNDED')),  -- 한도 예약 → 정산 (PLAN §8.2)
  error_code     TEXT,
  model          TEXT,
  latency_ms     INTEGER,
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  created_at     INTEGER NOT NULL,
  finished_at    INTEGER
);
CREATE INDEX ai_usage_participant_time ON ai_usage (participant_id, created_at);
CREATE INDEX ai_usage_room_time ON ai_usage (room_id, created_at);
CREATE INDEX ai_usage_participant_button_time ON ai_usage (participant_id, button, created_at);  -- 쿨다운

CREATE TABLE ai_daily (
  day   TEXT NOT NULL,                                  -- 'YYYY-MM-DD' (설정 시간대 기준)
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL', 'PERSONAL')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, scope)
);

CREATE TABLE rate_buckets (
  bucket       TEXT NOT NULL,   -- pin_device·pin_ip·pin_global(시작 코드 실패도 여기서 셈)·room_create_device·room_create_ip·code_lookup_device·code_lookup_ip·personal_device·personal_ip·check_ai_teacher
  key_hmac     TEXT NOT NULL,   -- 기기 ID·IP·교사 세션의 HMAC (원문 없음)
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key_hmac, window_start)
);

CREATE TABLE commands (
  id          TEXT PRIMARY KEY,                         -- commandId
  room_id     TEXT REFERENCES rooms (id) ON DELETE CASCADE,
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('STUDENT', 'TEACHER', 'ANON')),
  actor_id    TEXT NOT NULL,                            -- 기기 행 ID·교사 세션 ID·(입장 전) 기기 ID의 HMAC
  name        TEXT NOT NULL,
  args_hash   TEXT NOT NULL,                            -- 같은 commandId에 다른 인자면 E_INPUT
  result_json TEXT NOT NULL,                            -- 비밀(토큰·PIN) 금지
  created_at  INTEGER NOT NULL
);
CREATE INDEX commands_created ON commands (created_at);

CREATE TABLE personal_keys (                            -- [v1.1]
  key_hmac       TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  expires_at     INTEGER NOT NULL
);
