### 12.3 설정값 한곳 모음 (`config`)

| 키 | 기본값 |
|---|---|
| ROOM_TTL_DAYS / PERSONAL_TTL_DAYS | 30 / 30 |
| PIN_IP_MAX_FAILS / PIN_GLOBAL_SLOW_FAILS / PIN_GLOBAL_DELAY_MS | 30 / 100 (10분 창) / 2,000 |
| TEACHER_START_CODE_REQUIRED | true |
| WS_MAX_PAYLOAD_BYTES / AI_REQUEST_MAX_BYTES | 1 MiB / 96 KB |
| UNDO_GROUP_MS (세밀하게·보통·크게) | 400 · 800 · 1600 |
| TIMER_PRESETS_MIN | 5·10·15·20 |
| AI_MIN_CHARS | 기본 20, 시 10, 포스터·표어 4 |
| AI_PROVIDER / MODEL_SPELL | 6.4.1 |
| AI_EFFORT_* (버튼별 생각 깊이) | 6.4.1 |
| TIMEZONE | Asia/Seoul |

### 12.4 오류 코드

| 코드 | 뜻 | 화면 문구 |
|---|---|---|
| E_OFFLINE | 인터넷 끊김 | 인터넷이 끊겼어요. |
| E_AI_TIMEOUT / E_AI_FORMAT | AI 시간 초과·형식 | 조금 오래 걸려요. |
