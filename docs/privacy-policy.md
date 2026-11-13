# 쌤유 글방 개인정보처리방침

> **시행일**: 2026년 11월 13일 · **정책 버전**: `2026-11-v2` (`POLICY_VERSION`)

**쌤유 글방**(짧은 이름: **글방**, 주소: `https://write.ssamuniverse.com`)은 초등학생이 글의 종류를 고르고 글을 쓰면 AI 친구 **글벗**이 맞춤법·글벗 한마디·다음 방향·다듬은 글을 보여 주고, 선생님이 수업방에서 학생 글을 실시간으로 보며 함께 지도하는 글쓰기 도우미 웹앱입니다.
이 문서는 초등학생 보호자와 선생님이 쌤유 글방에서 어떤 정보를 다루고 어떻게 지키는지를 쉬운 말로 알리기 위해 작성되었습니다.

---

## 1. 누가 운영하나요?

1. 쌤유 글방(`PUBLIC_ORIGIN` 기본값 `https://write.ssamuniverse.com`)은 학교 수업용 글쓰기 도우미로 운영됩니다.
2. 개인정보 보호 및 서비스 이용에 관한 문의, 열람·정정·삭제 요청은 수업을 운영하는 **담당 선생님**께 해 주세요. 선생님이 화면에서 바로 처리하고, 선생님이 처리하기 어려운 요청은 운영자에게 전달해 처리합니다.
3. 이 개인정보처리방침은 2026년 11월 13일부터 적용되며, 현재 정책 버전은 `2026-11-v2`(`POLICY_VERSION` 기본값 `'2026-11-v2'`)입니다.

---

## 2. 왜 앱 안에 별도의 보호자 동의 절차를 두지 않나요?

1. 쌤유 글방은 회원가입이나 로그인 없이 이용하는 수업용 도구입니다.
2. 학생의 진짜 이름(실명), 전화번호, 집 주소, 이메일, 주민등록번호 등을 입력받지 않으며, 수업방 안에서 쓰는 **별명**과 **작성한 글**만 최소한으로 다루고 수업방을 만든 날부터 30일(`ROOM_TTL_DAYS` 기본값 `30`) 뒤에 자동으로 모두 지웁니다.
3. 이처럼 개인을 바로 알아볼 수 있는 정보를 받지 않고 짧은 기간만 보관한 뒤 파기하므로, 앱 안에 별도의 보호자 동의 절차를 두지 않고 학생 첫 입장 화면의 쉬운 안내(`알겠어요` 확인)와 이 개인정보처리방침으로 안내합니다.
4. 학생이 수업방에 처음 들어올 때(그리고 개인 모드를 처음 쓸 때) 수업 카드 아래에 **"이 앱은 별명과 내가 쓴 글을 저장해요 / 글은 {삭제 예정일}에 자동으로 지워져요 / 글벗(AI) 버튼을 누르면 별명은 빼고 글 내용만 AI에게 보내서 살펴봐요 / 진짜 이름, 전화번호, 주소는 적지 않아요. 이야기 속 인물 이름은 괜찮아요"**라는 안내를 보여 주고, 학생이 `알겠어요`에 체크한 뒤 `시작하기`를 눌러야 글쓰기를 시작할 수 있습니다.
5. 참고(학교·운영자 판단 사항): 만 14세 미만 아동의 개인정보를 수집할 때는 법정대리인(보호자)의 동의를 받는 것이 원칙이므로, 학교 수업에서 이 앱을 사용할 때 가정통신문 안내나 학교 내부 절차가 필요한지는 운영자와 담당 선생님이 학교 기준에 따라 판단합니다.

---

## 3. 무엇을 모으고 어디에 저장하나요?

### 3.1 모으지 않는 정보

1. 회원가입이나 로그인이 없으므로 아이디, 비밀번호, 실명, 생년월일, 전화번호, 집 주소, 이메일을 받지 않습니다.
2. 별명 입력 화면에서 **"진짜 이름, 전화번호, 주소는 적지 않아요."**라는 주의 문구를 늘 보여 주어 학생이 실명이나 연락처를 적지 않도록 안내합니다(소설이나 이야기 속 등장인물의 가명은 적어도 괜찮습니다).
3. 브라우저 쿠키(Cookie)는 사용하지 않습니다.

### 3.2 서버 데이터베이스(`geulbang.sqlite`)에 저장하는 정보

수업 중에 글이 날아가지 않게 하고 선생님이 실시간으로 지도할 수 있도록, 서버 데이터베이스의 아래 칸(테이블·열)에 정보를 저장합니다.

1. **학생 참가자 정보 (`participants` 표)**
   - 수업방 안에서 쓰는 **별명**(`nickname`, 최대 `NICKNAME_MAX_LENGTH` 기본값 `12`자)과 같은 수업방 안 중복 확인을 위해 공백·대소문자 등을 정리한 **정규화 별명**(`nickname_norm`).
   - 학생 안내 문구를 확인한 **정책 버전**(`consent_version`, 기본값 `'2026-11-v2'`)과 **확인 시각**(`consent_at`), **처음 들어온 시각**(`created_at`), **마지막 접속 시각**(`last_seen_at`).
   - 추후 제공 예정인 개인 모드(`PERSONAL_MODE_ENABLED` 기본값 `false`, v1.1 예정)를 사용할 때만 정규화된 **학교 이름**(`school_norm`, 입력 최대 `SCHOOL_NAME_MAX_CHARS` 기본값 `40`자), **만료 시각**(`expires_at`), 그리고 학교 이름과 별명으로 내 글을 다시 찾기 위한 단방향 해시값(`personal_keys.key_hmac`)을 저장합니다.
2. **학생이 쓴 글과 시간 되감기 기록 (`documents`, `snapshots` 표)**
   - **작성 중인 글(`documents` 표)**: 고른 글 종류(`genre`), 하위 종류(`subtype`), 용도(`purpose`), 실시간 공동 편집 원본 데이터(`ydoc_state` — 본문 `body`, 제목 `title`, 도움 질문 메모 `memo`, 하위 종류·직접 입력한 용도·노래 가사 분위기·빠르기·웹툰 컷 수 등 `meta` 포함), 빠른 조회와 내려받기를 위한 제목·본문·글자 수 사본(`title_text`, `plain_text`, `char_count` — 본문 최대 `DOC_MAX_CHARS` 기본값 `50,000`자, 제목 최대 `DOC_TITLE_MAX_CHARS` 기본값 `40`자, 메모 칸당 최대 `MEMO_MAX_CHARS` 기본값 `300`자), 제출 상태(`status`: `DRAFT`·`SUBMITTED`·`REOPENED`)와 제출 세대 번호(`submit_generation`), 제출·재열림·마지막 입력 시각(`submitted_at`, `reopened_at`, `last_input_at`), 마지막으로 고친 사람 구분(`last_input_by`: `STUDENT`·`TEACHER`), 처음 만든 시각(`created_at`)과 수정 시각(`updated_at`).
   - **시간 되감기 스냅샷(`snapshots` 표)**: 글을 쓰다 실수로 지웠을 때 이전 상태로 되돌릴 수 있도록, 글이 바뀐 채 `SNAPSHOT_INTERVAL_SEC`(기본값 `30`초)가 지날 때마다(`AUTO`), 그리고 제출할 때(`SUBMIT`), AI 글벗을 부를 때(`AI`), 선생님이 그 글에 처음 입력할 때(`TEACHER`), 이전 글로 복원하기 직전(`RESTORE`)에 그때의 제목(`title_text`), 본문(`body_text`), 글자 수(`char_count`), 작성 주체(`author`), 시각(`created_at`)을 저장합니다(글 하나당 최대 `SNAPSHOT_MAX` 기본값 `300`개까지 보관하며, 넘으면 자동 스냅샷만 간격을 넓혀 정리합니다).
3. **수업방·선생님 설정 및 알림 정보 (`rooms`, `teacher_sessions`, `notices`, `timers` 표)**
   - **수업방 정보(`rooms` 표)**: 선생님이 입력한 학급명(`class_name`, 최대 `CLASS_NAME_MAX_CHARS` 기본값 `30`자), 수업명(`title`, 최대 `ROOM_TITLE_MAX_CHARS` 기본값 `40`자), 학교명(`school_name`, 선택 입력, 최대 `SCHOOL_NAME_MAX_CHARS` 기본값 `40`자, 선생님이 `학생에게 보이기`(`show_school`)를 켰을 때만 학생 화면에 표시), 6자리 숫자 입장 코드(`entry_code`, `ENTRY_CODE_LENGTH` 기본값 `6`), 수업방 설정(`settings_json`: 보여 줄 글 종류, 켜진 AI 버튼, 이전으로 묶음 단위, 알림 소리, 진단 모드 여부), 보관 일수(`retention_days`), 수업방 상태(`status`), 만든 시각(`created_at`), 만료 시각(`expires_at`), 닫은 시각(`closed_at`).
   - **선생님 PIN(`rooms.pin_hmac`, `rooms.pin_enc`)**: 선생님이 정한 6~8자리 숫자 PIN(`PIN_MIN_LENGTH` 기본값 `6` ~ `PIN_MAX_LENGTH` 기본값 `8`)은 원래 숫자 그대로(평문) 저장하지 않고, 중복 확인·입장용 단방향 HMAC-SHA256 값(`pin_hmac`)과 수업 준비 화면의 `보기` 기능을 위한 AES-256-GCM 암호문(`pin_enc`)으로만 저장합니다.
   - **선생님 접속 세션(`teacher_sessions` 표)**: 선생님 기기가 만든 인증 토큰의 SHA-256 해시값(`token_hash`), 들어온 방식(`kind`: 선생님 링크 `LINK` 또는 `PIN`), 기기 식별값(`device_id`, PIN으로 들어온 세션만), 만든 시각(`created_at`), 마지막 접속 시각(`last_seen_at`), 폐기 시각(`revoked_at`).
   - **알림과 타이머(`notices`, `timers` 표)**: 선생님이 학생들에게 보낸 알림 문구(`notices.text`, 최대 `NOTICE_MAX_CHARS` 기본값 `60`자)·종류(`kind`)·소리 설정(`sound`)·보낸 시각(`sent_at`)과 수업방 타이머 상태(`timers`).
4. **기기 식별값과 기기 토큰 해시 (`devices`, `resume_requests`, `commands` 표)**
   - 같은 태블릿이나 PC에서 다시 들어왔을 때 암호 없이 자기 글을 바로 이어 쓸 수 있도록, 브라우저가 무작위로 만든 기기 식별값(`device_id`, UUID 형식)과 256비트(32바이트) 무작위 기기 토큰을 사용합니다.
   - **인증 토큰 원문은 기기에만 보관**하며, 서버 데이터베이스에는 원래 토큰을 되살릴 수 없는 **SHA-256 단방향 해시값**(`devices.token_hash`, `resume_requests.device_token_hash`, `teacher_sessions.token_hash`)만 저장합니다.
   - `devices` 표에는 기기 식별값(`device_id`), 토큰 해시(`token_hash`), 승인 시각(`approved_at`), 마지막 접속 시각(`last_seen_at`), 선생님이 연결을 끊은 시각(`revoked_at`)을 기록하며, 다른 기기에서 이어 쓰기를 요청할 때는 `resume_requests` 표에 새 기기 식별값(`device_id`), 새 기기 토큰 해시(`device_token_hash`), 처리 상태(`status`), 요청·결정 시각(`created_at`, `decided_at`)을 기록합니다.
   - 네트워크가 불안정해 같은 요청이 두 번 전달되더라도 한 번만 처리되도록 `commands` 표에 명령 고유 번호(`id`), 실행 주체 종류(`actor_kind`)와 식별값(`actor_id` — 기기 행 ID, 교사 세션 ID, 또는 입장 전 기기 ID의 HMAC 해시), 명령 이름(`name`), 요청 내용 해시(`args_hash`), 비밀값을 뺀 처리 결과(`result_json`), 실행 시각(`created_at`)을 기록합니다.
5. **접속 IP 주소와 속도 제한 기록 (`rate_buckets` 표)**
   - **접속 IP 주소의 원문은 데이터베이스나 서버 로그 어디에도 저장하지 않습니다.**
   - PIN 번호 무차별 대입이나 과도한 요청을 막기 위해, 접속 IP 주소(`x-we-client-ip`)와 기기 식별값(`device_id`), 교사 세션 키를 서버 비밀키(`ID_HMAC_KEY`)로 변환한 **단방향 HMAC-SHA256 해시값(`rate_buckets.key_hmac`)**과 시간 창 시작 시각(`window_start`), 요청 횟수(`count`)만 `rate_buckets` 표에 기록합니다.
6. **AI 글벗 사용량 기록 (`ai_usage`, `ai_daily` 표)**
   - AI 사용 한도를 관리하기 위해 **글 본문이나 AI 응답 내용, 학생 별명은 빼고**, 어떤 버튼(`button`: `SPELL`·`FEEDBACK`·`DIRECTION`·`POLISH`)을 눌렀는지, 처리 상태(`status`: `RESERVED`·`OK`·`FAILED`·`REFUNDED`), 오류 코드(`error_code`), 사용한 AI 모델 이름(`model`), 응답에 걸린 시간(`latency_ms`), 입력·출력 토큰 수(`tokens_in`, `tokens_out`), 요청·완료 시각(`created_at`, `finished_at`)과 날짜별 전체 호출 횟수(`ai_daily.count`)만 기록합니다.

### 3.3 학생·선생님 기기(브라우저)에 저장하는 정보

1. 인터넷이 잠시 끊겨도 쓰던 글이 사라지지 않도록, 기기 브라우저 안의 저장소(IndexedDB `geulbang`)에 작성 중인 글과 변경 조각(`doc_state`, `doc_updates`), 오프라인 제출 대기 명령(`outbox`), 마지막으로 받은 AI 결과(`ai_results`), 그리고 기기 설정·기억(`kv`: 무작위 `deviceId`, 글자 크기 설정, 최근 들어간 수업방 최대 `RECENT_ROOMS_MAX` 기본값 `5`개의 수업방 정보·별명·기기 토큰·선생님 토큰·만료 시각, 선생님 시작 코드, 안내 확인 기록)을 저장합니다.
2. 홈 화면을 열 때 이어 쓰기 카드를 빠르게 보여 주기 위해, 최근 수업방 목록에서 **인증 토큰을 뺀 사본**(`geulbang.recentRooms`)만 브라우저 `localStorage`에 함께 저장합니다.
3. 한글 입력 진단 기록(진단 모드): 운영자가 실기기에서 한글 입력이 깨지지 않는지 시험할 때만 서버 설정(`IME_DIAGNOSTICS_ENABLED`)으로 켤 수 있으며, 정해진 시험 문장으로만 사용합니다. 이때 입력 이벤트 흐름은 그 기기 안에만 모이고 서버로 자동 전송되지 않으며, 실제 수업에서는 꺼 둡니다.

---

## 4. 왜 정보를 모으나요? (수집·이용 목적)

1. **글쓰기와 자동 저장·복구**: 학생이 쓴 글을 기기와 서버에 실시간으로 저장하고, 인터넷이 끊겼을 때 이어 쓰거나 `이전으로`·`시간 되감기`로 지난 글을 되살리며, 텍스트 파일(`.txt`)이나 노래 가사 양식으로 내보내는 기능을 제공하기 위해 사용합니다.
2. **글벗(AI) 글쓰기 도움**: 학생이 `맞춤법`, `글벗 한마디`, `다음 방향`, `다듬은 글` 버튼을 눌렀을 때 글 종류와 도움 질문 메모에 맞는 AI 도움말을 보여 주기 위해 사용합니다.
3. **선생님의 실시간 수업 운영**: 선생님이 대시보드에서 학급 학생들의 접속·작성·제출 상태를 한눈에 보고, 실시간으로 글을 함께 고치거나 알림·타이머를 보내며, 제출된 글을 모아서 내려받는(`모두 내려받기`) 기능을 제공하기 위해 사용합니다.
4. **기기 기억과 이어 쓰기 승인**: 같은 기기로 다시 들어왔을 때 별도 암호 없이 자기 글을 바로 이어 쓰고, 다른 기기에서 같은 별명으로 들어올 때 선생님의 승인(`허용`/`거절`)을 거쳐 친구가 남의 별명으로 들어가는 일을 막기 위해 사용합니다.
5. **서비스 보호와 비용·남용 방지**: 선생님 시작 코드와 PIN 시도 제한, 입장 코드 조회 제한, 수업방 만들기 제한, 하루 AI 사용 한도(`AI_DAILY_PER_PARTICIPANT` 학생당 하루 기본값 `60`회, `AI_DAILY_PER_ROOM` 수업방당 하루 기본값 `1,500`회, `AI_DAILY_GLOBAL` 전체 하루 기본값 `3,000`회, 개인 모드 `AI_DAILY_PERSONAL_GLOBAL` 하루 기본값 `500`회, 버튼 쿨다운 `AI_COOLDOWN_SEC` 기본값 `10`초)를 확인해 비정상적인 접근과 과도한 비용 발생을 막기 위해 사용합니다.

---

## 5. 얼마나 보관하고 어떻게 지우나요? (보관 기간과 파기)

1. **수업방 데이터 30일 후 자동 삭제**: 수업방과 그 안에서 만들어진 모든 데이터는 수업방을 만든 날부터 **`ROOM_TTL_DAYS`(기본값 `30`일)** 동안만 보관하며, 만료 시각이 지나면 서버 예약 작업(60초 주기)이 자동으로 영구 삭제합니다.
2. **연쇄 삭제되는 항목**: 수업방이 삭제될 때 데이터베이스 외래키 연쇄 삭제(`ON DELETE CASCADE`) 규칙에 따라 그 수업방의 글(`documents`), 시간 되감기 스냅샷(`snapshots`), 참가자 별명·동의 기록(`participants`), 기기 토큰 해시(`devices`), 선생님 세션(`teacher_sessions`), 알림(`notices`), 타이머(`timers`), 이어 쓰기 요청(`resume_requests`), AI 사용 기록(`ai_usage`), 명령 기록(`commands`), 입장 코드와 PIN이 **모두 함께 삭제**됩니다.
3. **삭제 전 미리 알림**: 자동 삭제 **`EXPIRY_WARNING_DAYS`(기본값 `3`일)** 전부터 선생님 대시보드 상단에 삭제 예정일을 알리고 필요한 글을 미리 내려받도록 안내합니다.
4. **선생님의 '지금 삭제'(즉시 파기)**: 선생님이 대시보드 메뉴에서 `··· > 지금 삭제`를 누르면 30일이 지나기 전이라도 진행 중인 AI 요청을 즉시 멈추고 그 수업방의 모든 글, 지난 기록, 참가자·기기 정보, PIN, 입장 코드를 서버에서 **즉시 삭제**합니다.
5. **개인 모드 보관 기간(v1.1 예정)**: 개인 모드(`PERSONAL_MODE_ENABLED` 기본값 `false`)가 켜진 경우, 처음 저장한 날부터 **`PERSONAL_TTL_DAYS`(기본값 `30`일)** 뒤에 자동 삭제합니다.
6. **단기 운영 기록의 자동 삭제**:
   - 속도 제한 카운터(`rate_buckets`의 IP·기기 HMAC 해시): 시간 창 시작 시각부터 **24시간(1일)**이 지나면 자동으로 지웁니다.
   - 중복 실행 방지용 명령 기록(`commands`): 만든 시각부터 **`COMMAND_RETENTION_DAYS`(기본값 `7`일)**가 지나면 자동으로 지웁니다(수업방이 먼저 삭제되면 그때 함께 지워집니다).
   - 일별 AI 호출 횟수 합계(`ai_daily`): **7일**이 지나면 자동으로 지웁니다.
   - 서버 실행 로그 파일: 글 본문·별명·IP 원문·토큰을 담지 않으며, 날마다 새 파일로 바꾸고 **`LOG_RETENTION_DAYS`(기본값 `7`일)**가 지나면 자동으로 지웁니다.
7. **백업하지 않으며 빈자리까지 덮어쓰기**: 30일 뒤에 완전히 사라진다는 약속을 지키기 위해, 이 앱의 데이터베이스 파일은 서버의 자동 백업(Time Machine 등) 대상에서 제외하며 별도 백업을 만들지 않습니다. 또한 데이터베이스 설정(`PRAGMA secure_delete = ON`)을 통해 지워진 행의 디스크 자리를 `0`으로 덮어쓰고, 삭제 후 `PRAGMA wal_checkpoint(TRUNCATE)`로 작업 로그(WAL) 파일에 남은 이전 데이터까지 비웁니다.
8. **기기에 남은 사본 삭제**: 학생과 선생님의 기기(IndexedDB 및 `localStorage`)에 저장된 수업방 기억과 글 사본은 만료 시각이 지나거나 선생님이 수업방을 삭제한 뒤 앱을 다시 열 때(또는 서버에 연결될 때) 자동으로 지워집니다.

---

## 6. 누구에게 정보를 넘기나요? (위탁 및 국외 이전 안내)

### 6.1 국내 서버 저장과 네트워크 전송 경로

1. 학생이 쓴 글과 수업방 정보는 운영자가 **대한민국 국내**에서 직접 운영하는 서버에 저장합니다.
2. 학생·선생님 기기와 국내 서버가 데이터를 주고받을 때 빠른 연결과 디도스(DDoS)·원본 서버 보호를 위해 **Amazon Web Services(AWS CloudFront 서울 거점)**와 **Cloudflare(DNS·원본 보호 방화벽·암호화 터널)**의 네트워크 구간을 거치지만, 이 전송 구간에는 학생의 글이나 데이터베이스를 따로 저장하지 않습니다.

### 6.2 AI 글벗 기능을 위한 국외 이전 (Anthropic)

학생이 쓰기 화면에서 AI 글벗 버튼(`맞춤법`, `글벗 한마디`, `다음 방향`, `다듬은 글`)을 **직접 눌렀을 때만** AI 도움말을 만들기 위해 아래와 같이 글 내용을 국외 AI 제공사로 보냅니다. (선생님이 수업 준비 화면에서 `연결 점검`을 누르면 학생 글 없이 짧은 연결 확인 신호만 보냅니다.)

| 항목 | 내용 |
|---|---|
| **이전받는 자 (제공사)** | **Anthropic, PBC** (미국) — 설정 키 `AI_PROVIDER`(기본값 `'anthropic'`), 사용 모델 `MODEL_SPELL`·`MODEL_FEEDBACK`·`MODEL_DIRECTION`·`MODEL_POLISH`(기본값 `'claude-haiku-5-5'`) 및 대체 모델 `MODEL_FALLBACK`(기본값 `'claude-sonnet-5-5'`) |
| **이전되는 국가** | 미국 (Anthropic API 서버) |
| **이전 일시 및 방법** | 학생이 쓰기 화면에서 AI 버튼 4개 중 하나를 누른 시점에 암호화된 네트워크(HTTPS)를 통해 API로 전송 |
| **이전하는 항목** | ① **학생이 쓴 글 본문** (`text`: 맞춤법은 최대 `AI_SPELL_MAX_CHARS` 기본값 `18,000`자까지 문단 단위로 나누어 전송, 다른 버튼은 최대 `AI_MAX_INPUT_CHARS` 기본값 `6,000`자까지 전송하며 넘으면 뒷부분만 전송)<br>② **도움 질문에 적은 메모** (`helpNotes`: 메모를 적은 질문과 메모 내용)<br>③ **글 종류·하위 종류·용도 및 노래 분위기·빠르기** (`genre`, `subtype`, `purpose`·직접 입력한 `purposeCustom`, 노래 가사일 때 고른 `mood`·`tempo`) |
| **이전하지 않는 항목** | **학생 별명(`nickname`), 학교 이름(`school_name`), 학급명(`class_name`), 수업명(`title`), 글 제목(`title_text`), 참가자·기기 식별값(`participant_id`·`device_id`), 접속 IP 주소는 AI 회사로 보내지 않습니다.** |
| **제공사의 이용 목적** | 학생 글에 대한 맞춤법 교정 예시, 글벗 한마디(잘한 점·다듬을 점), 다음 전개 방향, 다듬은 글 생성 및 API 안전·부정 이용 점검 |
| **제공사의 보유·이용 기간** | Anthropic 상용 API 정책에 따라 **API로 전달된 글은 AI 모델 학습에 사용되지 않으며, 최대 30일 안에 삭제**됩니다(다만 제공사의 신뢰·안전 정책 위반으로 분류된 경우 최대 2년간 보관될 수 있습니다). |

1. **주의할 점**: 서버는 별명이나 학교 이름을 AI 회사로 보내지 않지만, **학생이 글 본문이나 도움 질문 메모 칸에 스스로 적은 글자**는 AI 검토를 위해 전송됩니다. 다만 전화번호·이메일·주민등록번호 꼴·웹 주소처럼 형식이 정해진 정보와 쓰면 안 되는 표현은 **보내기 전에 서버가 가린 표시(예: `[전화번호1]`)로 바꿔** 보내고, 결과에는 "개인정보는 쓰지 않는 게 좋아요" 안내를 붙입니다(2026-11-13). 이름·집 주소 문장은 자동으로 가릴 수 없으므로 글 본문과 메모 칸에 자기나 친구의 진짜 이름, 전화번호, 집 주소 같은 개인정보를 적지 않도록 지도해 주시기 바랍니다.
2. **AI 사용 알림**: 학생이 첫 화면 안내와 결과 창 머리(`글벗(AI)`)에서 글벗이 사람 선생님이 아니라 인공지능(AI)이라는 점을 늘 알 수 있도록 표시합니다.
3. 만약 추후 AI 제공사나 모델을 다른 회사로 바꾸게 되면, 이 방침의 국외 이전 항목과 정책 버전(`POLICY_VERSION`)을 고치고 다시 안내합니다.
4. **맞춤법 사전 확인(국내)**: 맞춤법 결과의 정확도를 높이려고, AI가 짚은 **낱말 하나**(예: `몇일`)를 국립국어원 표준국어대사전 Open API(대한민국)에 조회해 비표준어인지 확인합니다. 글 전체·별명·학교·기기 정보는 보내지 않으며, 조회 결과는 판정에만 쓰고 저장하지 않습니다(서버 메모리에 낱말별 결과만 잠시 기억). 사전 저작권: 국립국어원 표준국어대사전(CC BY-SA 2.0 KR).

---

## 7. 학생·보호자·선생님의 권리와 요청 방법

1. **선생님을 통한 즉시 열람·수정·삭제**: 학생과 보호자는 언제든지 수업을 운영하는 선생님께 자신이 쓴 글이나 별명 기록의 확인, 수정, 삭제를 요청할 수 있습니다.
2. **선생님이 화면에서 바로 할 수 있는 일**:
   - 실시간 대시보드 서랍에서 학생 글을 열람·수정하거나 제출된 글을 `다시 쓰게 하기`로 열어 줄 수 있습니다.
   - 서랍 메뉴의 `기기 연결 끊기`에서 잘못 연결된 기기 토큰을 즉시 끊을 수 있습니다.
   - `내려받기`(`제출한 글만` 또는 `모든 글`)로 수업 글을 `.zip` 파일로 받은 뒤, `··· > 수업방 닫기`로 새 입장과 편집을 막거나 `··· > 지금 삭제`로 수업방의 모든 데이터를 서버에서 즉시 삭제할 수 있습니다.
3. **학생이 직접 할 수 있는 일**: 학생은 글을 제출하기 전(또는 선생님이 다시 열어 준 뒤) 언제든 자기 글을 고치거나 지울 수 있으며, 사용 중인 태블릿·PC 브라우저 설정에서 사이트 데이터를 삭제해 기기에 남은 사본을 지울 수 있습니다.
4. **운영자에게 요청하기**: 수업방 PIN을 잊어버렸거나 선생님 화면에서 처리하기 어려운 경우, 또는 개인정보 열람·정정·삭제·처리정지를 운영자에게 요청하려는 경우 담당 선생님께 수업방 정보(학급명·수업명·입장 코드·별명 등)와 함께 말씀해 주시면, 선생님을 통해 운영자가 확인한 뒤 지체 없이 처리합니다.

---

## 8. 정보를 안전하게 지키기 위한 조치 (안전 조치)

1. **기기 생성 무작위 토큰과 해시 저장**: 학생 기기 토큰과 선생님 토큰은 기기 브라우저가 직접 만드는 256비트(32바이트, `base64url` 43자) 무작위 값입니다. 서버는 토큰 원문을 저장하지 않고 `SHA-256` 해시값만 저장하므로, 데이터베이스가 노출되더라도 원래 토큰을 알 수 없습니다.
2. **주소창 토큰·코드 즉시 제거와 첫 메시지 인증**: 선생님 링크(`/t/{토큰}`)나 선생님 시작 코드 등록 링크(`/t/register#{코드}`)를 열면 토큰·코드를 기기에 저장한 즉시 브라우저 주소창에서 지워(`history.replaceState`), 방문 기록이나 화면 공유를 통해 새어 나가지 않게 합니다. 실시간 웹소켓 연결(`/ws`)도 주소(URL)에 토큰을 넣지 않고 연결 직후 인증 메시지로만 확인합니다.
3. **선생님 PIN 암호화·해시 및 잠금 제한**: 선생님 PIN은 평문으로 저장하지 않고 HMAC-SHA256(`PIN_HMAC_KEY`)과 AES-256-GCM 암호문(`PIN_ENC_KEY`, 12바이트 무작위 IV + 16바이트 인증 태그)으로만 저장합니다. 같은 기기에서 PIN(또는 선생님 시작 코드)을 `PIN_MAX_FAILS`(기본값 `5`회) 틀리면 `PIN_LOCK_MIN`(기본값 `10`분) 동안 잠그고, 같은 IP에서 `PIN_IP_MAX_FAILS`(기본값 `30`회) 틀리면 그 IP의 PIN 입력을 잠그며, 전체 실패가 `PIN_GLOBAL_SLOW_FAILS`(기본값 `100`회)를 넘으면 응답을 `PIN_GLOBAL_DELAY_MS`(기본값 `2,000`ms) 늦춥니다.
4. **선생님 시작 코드로 무단 수업방 개설 차단**: 주소를 아는 아무나 수업방을 열어 AI를 쓰지 못하도록, 처음 수업방을 만들 때 운영자가 정한 `TEACHER_START_CODE_LENGTH`(기본값 `8`자리) 숫자 **선생님 시작 코드**(`TEACHER_START_CODE_REQUIRED` 기본값 `true`)를 확인합니다.
5. **엄격한 권한 분리와 이어 쓰기 승인**: 학생은 자기 글과 수업방 공용 알림·타이머만 받을 수 있으며 다른 학생의 글이나 요약 정보에는 접근할 수 없습니다(`E_FORBIDDEN`). 다른 기기에서 이미 있는 별명으로 이어 쓰기를 요청하면 선생님이 대시보드에서 `허용`해야만 열립니다.
6. **네트워크 암호화·원본 서버 잠금·보안 헤더**:
   - 모든 통신은 HTTPS/WSS 암호화 통로를 사용합니다.
   - 국내 맥미니 서버는 외부 인터넷에 직접 포트를 열지 않고 내부 주소(`127.0.0.1:4460`)에서만 실행되며, CloudFront가 붙이고 Cloudflare 방화벽(WAF)이 검사하는 원본 보호 비밀 헤더(`x-we-origin-auth`)와 전용 Cloudflare 터널을 통과한 요청만 받습니다.
   - 모든 응답에 `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`(카메라·마이크·위치 권한 차단) 보안 헤더를 적용합니다.
   - **다른 서비스와의 분리**: 같은 서버 장비에서 도는 다른 서비스(쌤유니버스 등)와 도메인 출처(`write.ssamuniverse.com`), 전용 시스템 계정(`wesvc`), 데몬, 터널, 데이터베이스 파일을 완전히 분리해 서로 영향을 주지 않게 합니다.
7. **서버 로그 내 개인정보 기록 금지**: 서버 실행 기록(`apps/server/src/log.ts`)에는 오류 코드, 요청 경로, 응답 시간, 요청 ID, 그리고 수업방 ID의 짧은 HMAC(`roomHash`)만 남기며, **글 본문, 별명, 접속 IP 원문, 인증 토큰은 로그에 기록하지 않습니다.** 오류 메시지도 학생 글이 섞이지 않도록 앞부분 300자로 잘라 기록합니다.

---

## 9. 개인정보처리방침이 바뀔 때 알리는 방법

1. 법률이나 서비스 기능, 보관 기간, AI 제공사 등이 바뀌어 이 개인정보처리방침을 고칠 때는 문서 맨 위의 **시행일**과 **정책 버전**(`POLICY_VERSION`)을 함께 갱신하고 앱 화면(`/privacy`)에 게시합니다.
2. 정책 버전(`POLICY_VERSION`)이 바뀌면, 이전에 이미 `알겠어요`에 동의했던 학생이라도 수업방(또는 개인 모드)에 다시 들어올 때 바뀐 안내 화면을 다시 보여 주고 새로운 동의를 받습니다.

---

## 10. 사실 확인 표 (문장별 근거)

> 방침 본문(머리말 및 1~9장)의 각 문장·표 항목에 대한 `PRD.md`, `docs/PLAN.md`, `docs/USER_DECISIONS.md`, `docs/decisions.md` 및 실제 코드 파일 근거입니다.

| 위치 | 방침 문장 (요약) | 근거 (PRD · PLAN · 코드 파일) |
|---|---|---|
| 머리말-1 | 시행일 2026-11-13, 정책 버전 `2026-11-v2` (`POLICY_VERSION`). 운영자 이름·연락처는 싣지 않음(사용자 결정 2026-11-13) | `PRD.md` 12.3(`POLICY_VERSION: 2026-11-v2`)·13.2·17장, `docs/USER_DECISIONS.md` U-07(2026-11-13: 시행일 오늘, 운영자 이름·연락처 제외), `packages/core/src/config.ts` L120 |
| 머리말-2 | 쌤유 글방(짧은 이름 글방, `https://write.ssamuniverse.com`)의 한 줄 정의(글 종류 선택, AI 글벗이 맞춤법·글벗 한마디·다음 방향·다듬은 글을 보여 주기만 함, 교사 실시간 지도) | `PRD.md` 1.1 `[고정]`·12.3(`PUBLIC_ORIGIN`), `packages/core/src/config.ts` L121, `packages/core/src/copy/ko.ts` L10-L11 |
| 머리말-3 | 초등학생 보호자와 교사가 읽는 쉬운 말로 작성됨 | `PRD.md` 13.2, `docs/PLAN.md` §11.8 P5-3 |
| 1-1 | 쌤유 글방(`PUBLIC_ORIGIN` 기본값 `https://write.ssamuniverse.com`)은 학교 수업용 글쓰기 도우미로 운영됨 | `PRD.md` 12.3·13.2, `docs/USER_DECISIONS.md` U-02·U-07, `packages/core/src/config.ts` L121 |
| 1-2 | 문의 및 열람·정정·삭제 요청 창구는 담당 선생님이며, 어려운 요청은 선생님이 운영자에게 전달함 | `PRD.md` 13.2("문의처: 운영자 연락처", "이용자 권리"), `docs/USER_DECISIONS.md` U-07 |
| 1-3 | 2026-11-13부터 적용되며 현재 정책 버전은 `2026-11-v2`(`POLICY_VERSION` 기본값 `'2026-11-v2'`)임 | `PRD.md` 12.3·13.2, `docs/USER_DECISIONS.md` U-07, `packages/core/src/config.ts` L120 |
| 2-1 | 회원가입이나 로그인 없이 이용하는 수업용 도구임 | `PRD.md` 1.4 `[고정]`("회원가입, 로그인" 하지 않음) |
| 2-2 | 실명·전화번호·집 주소·이메일·주민등록번호를 받지 않으며, 별명과 글만 다루고 만든 날부터 30일(`ROOM_TTL_DAYS` 기본값 `30`) 뒤 자동 삭제함 | `PRD.md` F-04·F-24·12.3·13.2, `packages/core/src/config.ts` L10, `apps/server/migrations/0001_init.sql` L40-L52 |
| 2-3 | 앱 안에 별도의 보호자 동의 절차를 두지 않고 학생 첫 입장 안내와 이 개인정보처리방침으로 안내함 | `PRD.md` 1.4 `[고정]`·F-03 `[고정: 사용자 결정]`·13.2 `[고정: 사용자 결정]`, `docs/decisions.md` ADR-044, `docs/USER_DECISIONS.md` U-07 |
| 2-4 | 첫 입장 시 수업 카드 아래 4줄 안내 문구를 보여 주고 `알겠어요` 체크 후 `시작하기`를 눌러야 시작할 수 있음 | `PRD.md` F-03·13.1, `packages/core/src/copy/ko.ts` L97-L105 |
| 2-5 | 만 14세 미만 아동의 개인정보는 법정대리인 동의가 원칙이며, 학교 수업 시 필요한 절차는 운영자·교사가 판단함 | `PRD.md` 13.2("참고(운영자 판단 사항)"), `docs/decisions.md` ADR-044, `docs/USER_DECISIONS.md` U-07 |
| 3.1-1 | 회원가입·로그인이 없어 아이디·비밀번호·실명·생년월일·전화번호·집 주소·이메일을 받지 않음 | `PRD.md` 1.4·13.2, `apps/server/migrations/0001_init.sql` 전체(해당 열 없음) |
| 3.1-2 | 별명 입력 화면에서 "진짜 이름, 전화번호, 주소는 적지 않아요." 주의 문구를 늘 보여 주며 이야기 속 가명은 허용함 | `PRD.md` F-04 `[고정]`·13.1, `packages/core/src/copy/ko.ts` L83·L103 |
| 3.1-3 | 브라우저 쿠키(Cookie)는 사용하지 않음 | `docs/PLAN.md` §7.3("쿠키를 쓰지 않는다"), `apps/server/src/http/bearer.ts` L11 |
| 3.2-1a | `participants` 표에 별명(`nickname`, 최대 `NICKNAME_MAX_LENGTH` 기본값 `12`자)과 정규화 별명(`nickname_norm`)을 저장함 | `PRD.md` F-04·10.2·12.3, `docs/PLAN.md` §5.2, `packages/core/src/config.ts` L35, `apps/server/migrations/0001_init.sql` L40-L53, `apps/server/src/store/repos/participants.ts` L62-L64 |
| 3.2-1b | `participants` 표에 동의한 정책 버전(`consent_version`), 동의 시각(`consent_at`), 생성 시각(`created_at`), 마지막 접속 시각(`last_seen_at`)을 저장함 | `PRD.md` F-03·10.2·13.2, `docs/PLAN.md` §5.2, `apps/server/migrations/0001_init.sql` L46-L49, `apps/server/src/store/repos/participants.ts` L62-L78, `apps/server/src/realtime/auth.ts` L84 |
| 3.2-1c | 개인 모드(`PERSONAL_MODE_ENABLED` 기본값 `false`, v1.1 예정)일 때만 정규화 학교 이름(`school_norm`, 입력 최대 `SCHOOL_NAME_MAX_CHARS` 기본값 `40`자), 만료 시각(`expires_at`), 조회용 키 해시(`personal_keys.key_hmac`)를 저장함 | `PRD.md` F-25·10.2·12.3·13.2, `docs/PLAN.md` §5.2, `packages/core/src/config.ts` L28·L38, `apps/server/migrations/0001_init.sql` L45·L50·L186-L190, `apps/server/src/security/hmac.ts` L64-L66 |
| 3.2-2a | `documents` 표에 글 종류(`genre`), 하위 종류(`subtype`), 용도(`purpose`), Yjs 원본(`ydoc_state` — 본문·제목·메모·메타 포함), 제목·본문·글자 수 캐시(`title_text`, `plain_text`, `char_count` — 최대 `DOC_MAX_CHARS` `50,000`자, `DOC_TITLE_MAX_CHARS` `40`자, `MEMO_MAX_CHARS` `300`자), 상태(`status`), 제출 세대(`submit_generation`), 시각(`submitted_at`, `reopened_at`, `last_input_at`, `created_at`, `updated_at`), 마지막 입력자(`last_input_by`)를 저장함 | `PRD.md` 10.2·12.3, `docs/PLAN.md` §4.2·§5.2, `packages/core/src/config.ts` L34·L39-L40, `apps/server/migrations/0001_init.sql` L81-L102, `apps/server/src/store/repos/documents.ts` L134-L185 |
| 3.2-2b | `snapshots` 표에 `SNAPSHOT_INTERVAL_SEC`(기본값 `30`초) 자동 저장(`AUTO`) 및 주요 시점(`SUBMIT`·`AI`·`TEACHER`·`RESTORE`)마다 제목(`title_text`)·본문(`body_text`)·글자 수(`char_count`)·작성 주체(`author`)·생성 시각(`created_at`)을 글당 최대 `SNAPSHOT_MAX`(기본값 `300`개)까지 저장하고 넘으면 `AUTO`만 솎아냄 | `PRD.md` F-10·10.2·12.3, `docs/PLAN.md` §4.5·§5.2, `packages/core/src/config.ts` L51-L52, `apps/server/migrations/0001_init.sql` L106-L116, `apps/server/src/store/repos/snapshots.ts` L49-L78 |
| 3.2-3a | `rooms` 표에 학급명(`class_name`, 최대 `CLASS_NAME_MAX_CHARS` `30`자), 수업명(`title`, 최대 `ROOM_TITLE_MAX_CHARS` `40`자), 학교명(`school_name`, 선택, 최대 `SCHOOL_NAME_MAX_CHARS` `40`자, `show_school` 켰을 때만 학생에게 표시), 6자리 입장 코드(`entry_code`, `ENTRY_CODE_LENGTH` `6`), 설정(`settings_json`), 보관 일수(`retention_days`), 상태(`status`), 시각(`created_at`, `expires_at`, `closed_at`)을 저장함 | `PRD.md` F-02·F-15·10.2·12.3·13.2, `docs/PLAN.md` §5.2, `packages/core/src/config.ts` L23·L36-L38, `apps/server/migrations/0001_init.sql` L10-L25, `apps/server/src/store/repos/rooms.ts` L124-L144 |
| 3.2-3b | 교사 PIN(`PIN_MIN_LENGTH` `6` ~ `PIN_MAX_LENGTH` `8`자리)은 평문으로 저장하지 않고 `rooms.pin_hmac`(HMAC-SHA256)과 `rooms.pin_enc`(AES-256-GCM 암호문)로만 저장함 | `PRD.md` F-16·F-20·10.2·12.3·13.3, `docs/PLAN.md` §5.2·§7.4, `packages/core/src/config.ts` L15-L16, `apps/server/src/security/hmac.ts` L47-L49, `apps/server/src/security/pinCrypto.ts` L33-L45 |
| 3.2-3c | `teacher_sessions` 표에 교사 토큰의 SHA-256 해시(`token_hash`), 종류(`kind`: `LINK`·`PIN`), 기기 식별값(`device_id`, PIN만), 생성·마지막 접속·폐기 시각(`created_at`, `last_seen_at`, `revoked_at`)을 저장함 | `PRD.md` F-20·F-23·10.2·13.3, `docs/PLAN.md` §5.2, `apps/server/migrations/0001_init.sql` L28-L38, `apps/server/src/store/repos/teacherSessions.ts` L42-L54 |
| 3.2-3d | `notices` 표에 알림 문구(`text`, 최대 `NOTICE_MAX_CHARS` `60`자)·종류(`kind`)·소리(`sound`)·시각(`sent_at`)을, `timers` 표에 타이머 상태를 저장함 | `PRD.md` F-19·10.2·12.3, `docs/PLAN.md` §5.2, `packages/core/src/config.ts` L76, `apps/server/migrations/0001_init.sql` L118-L137 |
| 3.2-4a | 같은 기기 자동 이어 쓰기를 위해 브라우저가 만든 무작위 기기 식별값(`device_id`, UUID)과 256비트(32바이트) 무작위 기기 토큰을 사용함 | `PRD.md` F-14·13.2·13.3, `docs/PLAN.md` §5.4·§7.4, `apps/web/src/adapters/local/deviceMemory.ts` L63·L90-L95, `apps/server/src/security/tokens.ts` L12-L15 |
| 3.2-4b | 인증 토큰 원문은 기기에만 보관하고 서버 DB에는 SHA-256 단방향 해시값(`devices.token_hash`, `resume_requests.device_token_hash`, `teacher_sessions.token_hash`)만 저장함 | `PRD.md` 10.2·13.3, `docs/PLAN.md` §5.2·§5.4·§7.4, `apps/server/src/security/tokens.ts` L7-L8·L25-L30, `apps/server/migrations/0001_init.sql` L31·L59·L71 |
| 3.2-4c | `devices` 표에 `device_id`, `token_hash`, `approved_at`, `last_seen_at`, `revoked_at`을, `resume_requests` 표에 `device_id`, `device_token_hash`, `status`, `created_at`, `decided_at`을 저장함 | `PRD.md` F-14·10.2, `docs/PLAN.md` §5.2, `apps/server/migrations/0001_init.sql` L56-L79, `apps/server/src/store/repos/devices.ts` L58-L74, `apps/server/src/store/repos/resumeRequests.ts` L64-L88 |
| 3.2-4d | `commands` 표에 멱등 처리를 위해 명령 ID(`id`), 실행 주체 종류(`actor_kind`)와 식별값(`actor_id` — 기기 행 ID·교사 세션 ID·입장 전 기기 ID HMAC), 명령 이름(`name`), 인자 해시(`args_hash`), 비밀값을 뺀 결과(`result_json`), 생성 시각(`created_at`)을 저장함 | `docs/PLAN.md` §4.4·§5.2, `apps/server/migrations/0001_init.sql` L174-L184, `apps/server/src/store/repos/commands.ts` L77-L137 |
| 3.2-5a | 접속 IP 주소 원문은 데이터베이스나 서버 로그 어디에도 저장하지 않음 | `PRD.md` 10.2·13.3, `docs/PLAN.md` §5.2·§7.3·§7.6, `apps/server/src/security/clientIp.ts` L3-L6, `apps/server/src/log.ts` L1-L4 |
| 3.2-5b | `rate_buckets` 표에는 접속 IP(`x-we-client-ip`)·기기 ID·교사 세션 키를 `ID_HMAC_KEY`로 변환한 단방향 HMAC-SHA256 해시(`key_hmac`), 시간 창(`window_start`), 횟수(`count`)만 저장함 | `PRD.md` 10.2·12.3, `docs/PLAN.md` §5.2·§7.3·§7.4, `apps/server/migrations/0001_init.sql` L166-L172, `apps/server/src/security/hmac.ts` L51-L77, `apps/server/src/security/rateLimit.ts` L98-L101·L120-L155 |
| 3.2-6 | `ai_usage`·`ai_daily` 표에는 본문·AI 응답·별명 없이 버튼 종류(`button`), 상태(`status`), 오류 코드(`error_code`), 모델(`model`), 지연 시간(`latency_ms`), 입출력 토큰 수(`tokens_in`, `tokens_out`), 시각(`created_at`, `finished_at`) 및 일별 호출 수(`ai_daily.count`)만 저장함 | `PRD.md` 6.6·10.2, `docs/PLAN.md` §5.2·§8.2, `apps/server/migrations/0001_init.sql` L139-L164, `apps/server/src/store/repos/aiUsage.ts` L4-L8·L90-L144 |
| 3.3-1 | 기기 브라우저 IndexedDB(`geulbang`)에 글과 변경 조각(`doc_state`, `doc_updates`), 오프라인 제출 줄(`outbox`), AI 결과(`ai_results`), 기기 설정·기억(`kv`: 무작위 `deviceId`, 글자 크기, 최근 수업방 최대 `RECENT_ROOMS_MAX` `5`개의 정보·별명·토큰·만료 시각, 시작 코드, 안내 기록)을 저장함 | `PRD.md` F-08·F-09·F-13·F-15·F-23·12.3, `docs/PLAN.md` §5.4, `packages/core/src/config.ts` L116, `apps/web/src/adapters/local/idb.ts` L6-L37, `apps/web/src/adapters/local/deviceMemory.ts` L16-L54 |
| 3.3-2 | 빠른 첫 화면 표시를 위해 최근 수업방 목록 중 토큰을 뺀 사본(`geulbang.recentRooms`)만 `localStorage`에 저장함 | `docs/PLAN.md` §5.4·§6.7, `apps/web/src/adapters/local/deviceMemory.ts` L12-L13·L55·L79-L81 |
| 3.3-3 | 진단 모드는 운영자 실기기 시험 때만 서버 설정(`IME_DIAGNOSTICS_ENABLED`)으로 켜며 정해진 시험 문장으로만 쓰고, 이벤트 흐름은 기기에만 남고 서버로 보내지 않으며 실제 수업에서는 꺼 둠 | `PRD.md` 9.3·13.2, `docs/PLAN.md` §6.3·§10.7·§13.1, `apps/server/src/config.ts` L35-L36, `apps/server/src/realtime/clientConfig.ts` L56-L57, `apps/web/src/adapters/editor/diagnostics.ts` L1-L5 |
| 4-1 | 수집·이용 목적 1: 학생 글쓰기, 실시간·오프라인 저장, 이전으로·시간 되감기, 파일·가사 내보내기 제공 | `PRD.md` 1.2·F-06·F-09·F-10·F-12·13.2 |
| 4-2 | 수집·이용 목적 2: 학생이 AI 버튼 4개를 눌렀을 때 글 종류·메모에 맞는 글벗 도움 제공 | `PRD.md` 1.1·1.2·F-07·F-08·6장·13.2 |
| 4-3 | 수집·이용 목적 3: 교사의 실시간 수업 지도(대시보드, 서랍 함께 고치기, 알림·타이머, 모두 내려받기) | `PRD.md` 1.2·F-17·F-18·F-19·F-21·13.2 |
| 4-4 | 수집·이용 목적 4: 같은 기기 자동 이어 쓰기 및 다른 기기 이어 쓰기 시 교사 승인을 통한 별명 도용 방지 | `PRD.md` F-14·F-23·13.2 |
| 4-5 | 수집·이용 목적 5: 시작 코드·PIN·입장 코드·수업방 생성 속도 제한 및 하루 AI 한도(`AI_DAILY_PER_PARTICIPANT` `60`, `AI_DAILY_PER_ROOM` `1,500`, `AI_DAILY_GLOBAL` `3,000`, `AI_DAILY_PERSONAL_GLOBAL` `500`, `AI_COOLDOWN_SEC` `10`초) 확인을 통한 남용·비용 방지 | `PRD.md` F-15·F-20·F-25·F-26·12.3, `packages/core/src/config.ts` L18-L30·L83-L87, `apps/server/src/security/rateLimit.ts` L39-L91, `apps/server/src/application/aiRequest.ts` L130-L141 |
| 5-1 | 수업방 데이터는 만든 날부터 `ROOM_TTL_DAYS`(기본값 `30`일) 동안 보관 후 서버 예약 작업(60초 주기)이 자동 영구 삭제함 | `PRD.md` F-24 `[고정]`·12.3·13.2, `docs/PLAN.md` §5.3·§7.5, `packages/core/src/config.ts` L10, `apps/server/src/jobs/retention.ts` L15-L44 |
| 5-2 | 수업방 삭제 시 `ON DELETE CASCADE`로 글, 스냅샷, 참가자, 기기, 교사 세션, 알림, 타이머, 이어 쓰기 요청, AI 사용 기록, 명령 기록, 입장 코드, PIN이 모두 함께 삭제됨 | `PRD.md` F-24·10.2, `docs/PLAN.md` §5.2·§7.7, `apps/server/migrations/0001_init.sql` L28-L183, `apps/server/src/application/deleteRoom.ts` L14-L21·L72 |
| 5-3 | 삭제 `EXPIRY_WARNING_DAYS`(기본값 `3`일) 전부터 교사 대시보드에 삭제 예정일과 내려받기 안내를 표시함 | `PRD.md` F-17·F-24·12.3, `packages/core/src/config.ts` L12, `packages/core/src/copy/ko.ts` L308 |
| 5-4 | 교사가 `··· > 지금 삭제`를 누르면 30일 전이라도 진행 중 AI 요청을 멈추고 수업방의 모든 글·기록·PIN·입장 코드를 즉시 삭제함 | `PRD.md` F-22·13.2, `docs/PLAN.md` §7.7, `packages/core/src/copy/ko.ts` L349-L351, `apps/server/src/application/deleteRoom.ts` L45-L85 |
| 5-5 | 개인 모드(`PERSONAL_MODE_ENABLED` 기본값 `false`, v1.1 예정)는 처음 저장한 날부터 `PERSONAL_TTL_DAYS`(기본값 `30`일) 뒤 자동 삭제함 | `PRD.md` F-24·F-25·12.3, `docs/PLAN.md` §5.3, `packages/core/src/config.ts` L11·L28 (`apps/server/src/jobs/retention.ts` L11에 v1.1 예정으로 표시) |
| 5-6a | 속도 제한 카운터(`rate_buckets`)는 시간 창 시작 시각 기준 24시간(1일, `86,400,000`ms)이 지나면 자동 삭제됨 | `docs/PLAN.md` §5.3-3, `apps/server/src/jobs/rateBuckets.ts` L8-L12, `apps/server/src/jobs/retention.ts` L45 |
| 5-6b | 명령 중복 방지 기록(`commands`)은 `COMMAND_RETENTION_DAYS`(기본값 `7`일)가 지나면 자동 삭제됨 | `PRD.md` 12.3, `docs/PLAN.md` §4.4·§5.3-4, `packages/core/src/config.ts` L46, `apps/server/src/jobs/retention.ts` L46 |
| 5-6c | 일별 AI 호출 수 합계(`ai_daily`)는 7일(`AI_DAILY_KEEP_DAYS = 7`)이 지나면 자동 삭제됨 | `docs/PLAN.md` §5.3-5, `apps/server/src/jobs/retention.ts` L18·L47 |
| 5-6d | 서버 실행 로그 파일은 본문·별명·IP 원문·토큰을 담지 않으며 날마다 회전해 `LOG_RETENTION_DAYS`(기본값 `7`일) 뒤 삭제됨 | `PRD.md` 12.3·13.3, `docs/PLAN.md` §7.6·§15.2(`setup-host.sh` newsyslog), `packages/core/src/config.ts` L47, `apps/server/src/log.ts` L1-L4 |
| 5-7 | 데이터베이스를 백업(Time Machine 등)하지 않으며, `PRAGMA secure_delete = ON`으로 지운 자리를 0으로 덮고 `PRAGMA wal_checkpoint(TRUNCATE)`로 WAL 파일을 비움 | `PRD.md` F-24·13.2·16.8, `docs/PLAN.md` §5.1·§5.3·§14-11·§15.2, `apps/server/src/store/db.ts` L33·L75-L84, `apps/server/src/application/deleteRoom.ts` L73 |
| 5-8 | 기기(IndexedDB·`localStorage`)에 남은 사본은 만료 시각이 지나거나 수업방 삭제 후 앱을 다시 열 때(또는 서버 연결 때) 자동으로 지워짐 | `PRD.md` F-22·F-23·F-24·13.2, `docs/PLAN.md` §2.3 ⑪·§5.4, `apps/web/src/adapters/local/deviceMemory.ts` L136-L157 |
| 6.1-1 | 글과 수업방 정보는 운영자가 대한민국 국내에서 운영하는 서버(맥미니)에 저장함 | `PRD.md` 11.3·13.2, `docs/PLAN.md` §2.1 |
| 6.1-2 | 전송 구간에 AWS CloudFront(서울 거점)와 Cloudflare(DNS·원본 보호·터널)를 거치지만 이 구간에는 글을 따로 저장하지 않음 | `PRD.md` 11.3·13.2, `docs/PLAN.md` §2.1·§2.2 |
| 6.2-머리 | 학생이 쓰기 화면에서 AI 버튼 4개를 직접 눌렀을 때만 글 내용을 국외 AI 제공사로 보내며, 교사의 `연결 점검`은 학생 글 없이 짧은 연결 확인 신호만 보냄 | `PRD.md` F-08·F-16·6.1·13.1·13.2, `apps/server/src/http/routes/ai.ts` L49-L70, `apps/server/src/http/routes/teacher.ts` L87-L109 |
| 6.2-표(제공사·국가·일시·방법) | 이전받는 자: Anthropic, PBC(미국), 설정 `AI_PROVIDER`(`'anthropic'`), 기본 모델 `claude-haiku-5-5`, 대체 모델 `claude-sonnet-5-5`, AI 버튼 클릭 시 HTTPS API 전송 | `PRD.md` 6.4.1·12.3·13.2, `docs/PLAN.md` §8.1·§8.3, `packages/core/src/config.ts` L102-L107 |
| 6.2-표(이전 항목) | AI로 보내는 항목: ① 글 본문(`text`, 맞춤법 최대 `AI_SPELL_MAX_CHARS` `18,000`자, 그 외 최대 `AI_MAX_INPUT_CHARS` `6,000`자) ② 도움 질문과 메모(`helpNotes`) ③ 글 종류(`genre`)·하위 종류(`subtype`)·용도(`purpose`·`purposeCustom`) 및 노래 가사 분위기(`mood`)·빠르기(`tempo`) | `PRD.md` F-07·F-26·6.1 `[고정]`·12.3, `docs/PLAN.md` §8.1·§8.4, `packages/core/src/config.ts` L88-L90, `apps/server/src/application/aiRequest.ts` L168-L186·L347-L356, `apps/server/src/ai/prompts/index.ts` L69-L101 |
| 6.2-표(제외 항목) | AI로 보내지 않는 항목: 별명(`nickname`), 학교 이름(`school_name`), 학급명(`class_name`), 수업명(`title`), 글 제목(`title_text`), 참가자·기기 식별값, 접속 IP 주소 | `PRD.md` 6.1 `[고정]`·13.1·13.2, `docs/PLAN.md` §8.1, `apps/server/src/application/aiRequest.ts` L173-L186, `apps/server/src/ai/prompts/index.ts` L69-L101 |
| 6.2-표(목적·보유 기간) | Anthropic 상용 API 기준: 전달된 글을 모델 학습에 쓰지 않고 30일 안에 삭제함(정책 위반으로 분류된 경우 최대 2년 보관) | `PRD.md` 13.2("추천 제공사 Anthropic(미국) 기준: API로 받은 글을 학습에 쓰지 않고, 30일 안에 지운다(정책 위반으로 표시된 경우 최대 2년)"), `docs/USER_DECISIONS.md` U-07(결정 시점 공식 문서로 재확인 대상) |
| 6.2-1 | 학생이 본문이나 메모 칸에 직접 적은 글자는 그대로 전송되므로 본문·메모에 실명·연락처·주소를 적지 않도록 안내함 | `PRD.md` F-04·6.1·13.1, `apps/server/src/ai/prompts/index.ts` L84-L97 |
| 6.2-2 | 첫 안내 문구와 결과 창 머리(`글벗(AI)`)에 글벗이 AI라는 점을 표시함 | `PRD.md` 1.1·13.1·13.2, `packages/core/src/copy/ko.ts` L71·L101-L102 |
| 6.2-3 | 제공사를 바꾸면 국외 이전 항목과 정책 버전(`POLICY_VERSION`)을 고치고 다시 안내함 | `PRD.md` F-03·13.2 |
| 7-1 | 학생·보호자는 교사에게 글·별명 기록의 열람·수정·삭제를 요청할 수 있음 | `PRD.md` 13.2("이용자 권리: 교사에게 삭제 요청, 교사는 즉시 삭제 가능(F-22)") |
| 7-2 | 교사는 서랍에서 열람·수정·`다시 쓰게 하기`, `기기 연결 끊기`, `내려받기`, `수업방 닫기`, `지금 삭제`를 바로 실행할 수 있음 | `PRD.md` F-11·F-14·F-18·F-21·F-22·13.2, `docs/PLAN.md` §4.4·§7.2 |
| 7-3 | 학생은 제출 전(또는 다시 열린 뒤) 직접 글을 고치거나 지울 수 있고 브라우저 사이트 데이터 삭제로 기기 사본을 지울 수 있음 | `PRD.md` F-06·F-09·F-11, `apps/web/src/adapters/local/idb.ts` L6-L15 (` 브라우저 설정에서 사이트 데이터 삭제`는 웹 브라우저 일반 동작 — 별도 PRD 문장 없음: **근거 없음(브라우저 일반 기능)**) |
| 7-4 | 담당 선생님을 통해 운영자에게 열람·정정·삭제·처리정지를 요청할 수 있음 | `PRD.md` 13.2("이용자 권리", "문의처: 운영자 연락처"), `docs/USER_DECISIONS.md` U-07 |
| 8-1 | 기기 토큰·교사 토큰은 기기가 만든 256비트(32바이트, `base64url` 43자) 무작위 값이며 서버에는 SHA-256 해시만 저장함 | `PRD.md` 13.3, `docs/PLAN.md` §5.4·§7.4, `apps/server/src/security/tokens.ts` L7-L30 |
| 8-2 | 선생님 링크(`/t/{토큰}`)와 시작 코드 등록 링크(`/t/register#{코드}`)는 기기 저장 직후 주소창에서 지우며, 웹소켓(`/ws`)은 첫 인증 메시지로만 토큰을 보냄 | `PRD.md` F-15·F-20·13.3, `docs/PLAN.md` §4.1·§6.1 |
| 8-3 | PIN은 HMAC-SHA256(`PIN_HMAC_KEY`)과 AES-256-GCM 암호문(`PIN_ENC_KEY`)으로만 저장하며, 기기 `PIN_MAX_FAILS`(`5`회)·IP `PIN_IP_MAX_FAILS`(`30`회) 실패 시 `PIN_LOCK_MIN`(`10`분) 잠금 및 전역 `PIN_GLOBAL_SLOW_FAILS`(`100`회) 초과 시 `PIN_GLOBAL_DELAY_MS`(`2,000`ms) 지연을 적용함 | `PRD.md` F-15·F-20·12.3·13.3, `docs/PLAN.md` §7.4, `packages/core/src/config.ts` L18-L22, `apps/server/src/security/pinCrypto.ts` L5-L45, `apps/server/src/security/rateLimit.ts` L39-L47·L195-L246 |
| 8-4 | 수업방 생성 시 `TEACHER_START_CODE_LENGTH`(기본값 `8`자리) 숫자 선생님 시작 코드(`TEACHER_START_CODE_REQUIRED` 기본값 `true`)를 확인함 | `PRD.md` F-15·12.3, `packages/core/src/config.ts` L26-L27, `apps/server/src/config.ts` L135-L141 |
| 8-5 | 학생은 자기 글과 수업방 공용 정보만 받으며 다른 학생 글 접근은 거부(`E_FORBIDDEN`)되고, 다른 기기 이어 쓰기는 교사 승인이 필요함 | `PRD.md` F-14·12.4·13.3, `docs/PLAN.md` §4.3, `apps/server/src/realtime/auth.ts` L78-L80 |
| 8-6a | HTTPS/WSS 암호화 통신, 내부 포트(`127.0.0.1:4460`) 바인딩, CloudFront·Cloudflare 원본 보호 헤더(`x-we-origin-auth`) 및 전용 터널 사용 | `PRD.md` 11.3, `docs/PLAN.md` §2.1·§7.1·§7.3·§15.2, `apps/server/src/config.ts` L28-L30 |
| 8-6b | `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` 보안 헤더 적용 | `docs/PLAN.md` §7.3, `apps/server/src/http/app.ts` L48-L67 |
| 8-6c | 쌤유니버스 등 다른 서비스와 도메인 출처(`write.ssamuniverse.com`), 서비스 계정(`wesvc`), 데몬, 터널, DB 파일을 분리함 | `PRD.md` 0.2-2·11.3·13.3, `docs/PLAN.md` §2.1·§15.1·§15.2, `docs/decisions.md` ADR-037·ADR-047 |
| 8-7 | 서버 로그(`apps/server/src/log.ts`)에 본문·별명·IP 원문·토큰을 남기지 않으며 수업방 ID는 짧은 HMAC(`roomHash`)으로만 기록하고 오류 메시지는 300자로 자름 | `PRD.md` 6.6·13.3, `docs/PLAN.md` §7.6, `apps/server/src/log.ts` L1-L66 |
| 9-1 | 방침 변경 시 시행일과 정책 버전(`POLICY_VERSION`)을 갱신해 `/privacy` 화면에 게시함 | `PRD.md` F-03·12.3·13.2, `docs/PLAN.md` §6.1(`/privacy`) |
| 9-2 | 정책 버전(`POLICY_VERSION`)이 바뀌면 이미 동의했던 학생도 다시 안내 화면을 보고 새로 동의(`consent.update`)해야 함 | `PRD.md` F-03·13.2, `docs/PLAN.md` §4.4(`consent.update`)·§6.1·§10.5(`student-join.spec.ts`) |
