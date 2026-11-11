# P4 서버 기능 (Claude 서브에이전트, P3-3에 이어서)

cwd: /Users/bodyking/Desktop/Architecture/writeessay
사용자 지시(2026-11-11): 묻지 말고 마지막 phase까지 진행. 막히는 결정은 PRD → PLAN 순으로 정하고 "정한 것"에 적는다. AGENTS.md 규칙 그대로(git 금지, 4460~4462 띄우지 않기, 새 의존성 금지, 바뀔 수 있는 수치는 config).
P3-3 보고에 대한 Claude 결정:
- 아직 없는 명령을 `E_VERSION`으로 답한 것은 이번에 명령을 다 채우면서 없어진다. 끝까지 모르는 이름만 `E_VERSION`.
- `hello.participants`를 규약에 더했다(`participantSummarySchema`, 교사만, 학생은 null). 지금 `roomChannel.ts`에 `[]` + TODO로 두었으니 채운다. `participant.update`도 보낸다(접속·별명·presence 바뀔 때).
- `X-Device-Id` 머리는 기기 쪽이 보내게 했다(`adapters/api/http.ts`). PLAN §7.2는 Claude가 고친다.
- `hello.config` 키 목록은 서버(`clientConfig.ts`)에 두어도 된다.
공용 규약은 `packages/core/src/protocol/room.ts`·`api/index.ts`(Claude 것). 고쳐야 하면 **더하기만** 하고 보고에 적는다.
동시에 다른 작업이 `packages/core/src/domain/**`(status.ts 제외)·`genres.ts`·`structure.ts`·`copy/ko.ts`를 쓰고 있다(Antigravity P3-1d). 건드리지 않는다. 그 파일이 이미 생겼으면 TODO(P3-1d) 자리를 그것으로 바꿔도 된다(가져다 쓰기만).
이미 있는 AI 모듈(Claude가 씀, 고치지 말고 쓰기만): `apps/server/src/ai/{port,schemas,validate,prompts/index,anthropic,fake,run}.ts`, 시험 `test/ai.test.ts`.

## 만들 것 (순서대로, 앞 것이 끝나면 다음)
1. **P4-3 제출·다시 쓰게 하기·잠금**(PLAN §2.3 ⑥, §4.3, §4.7 대응 3): `doc.submit`(세대 낮으면 `E_STALE`, 서버 상태 벡터가 기기 것을 다 포함하지 않으면 `E_SYNC_PENDING`, 아니면 한 트랜잭션: 저장+SUBMIT 스냅샷+SUBMITTED+명령 기록 → 그 학생 연결 읽기 전용(`locks.ts`) → `doc.status` 방송(수업방 채널 이벤트는 `generation` 포함, 글 채널 `doc.status`는 `locked`) → ack), `doc.reopen`(교사, 세대+1, REOPENED, 잠금 풀기). 상태가 바뀔 때 `decideAccess`로 열린 연결 읽기 전용 다시 계산.
2. **P4-16 AI 요청**: `POST /api/rooms/:roomId/ai`(학생 Bearer, 본문 `aiRequestBody`, 크기 `AI_REQUEST_MAX_BYTES`), `application/aiRequest.ts`(PLAN §8.2: 방 ACTIVE·버튼 켜짐·글이 그 학생 것·`AI_MIN_CHARS` → **한도 예약** 한 트랜잭션: commandId 중복이면 앞 결과, 버튼별 쿨다운 `AI_COOLDOWN_SEC`, 참가자·방·전체 하루(KST 하루, `TIMEZONE`), `ai_usage` RESERVED → AI 스냅샷(서버 문서 기준) → `ai/run.ts`의 `runStructured`/`runPolish` → 정산 OK/FAILED/REFUNDED). 맞춤법은 `AI_SPELL_CHUNK_CHARS`로 문단 경계 조각, 동시에 `AI_SPELL_MAX_PARALLEL`, `AI_SPELL_MAX_CHARS` 넘으면 뒤쪽. 응답: 구조화는 `aiStructuredResult`(`textHash` = 보낸 글 sha256), 다듬은 글은 `application/x-ndjson`으로 `PolishLine` 한 줄씩, 연결이 끊기면 중단·정산. 글 종류 관점(lens)은 genres.ts가 있으면 거기서, 없으면 기본 문장 + TODO. `AI_PROVIDER=fake`면 `ai/fake.ts`, `anthropic`이면 `ANTHROPIC_API_KEY`(비밀값, 없으면 AI 요청은 `E_AI_PROVIDER`, 서버는 뜬다). 교사 `POST /api/teacher/rooms/:roomId/check-ai`(`CHECK_AI_PER_DAY`). 로그에는 메타데이터만(PRD 6.6).
3. **P4-5 교사 들어오기**: `POST /api/teacher/pin`(PIN 칸·잠김, PIN 세션 토큰 해시 등록), 선생님 링크 토큰 인증(이미 있음)으로 `GET /api/teacher/rooms/:roomId`, `GET .../pin`(복호화, `pinCrypto`), 교사 Bearer 확인 미들웨어 하나.
4. **P4-4 이어 쓰기**: `POST /api/rooms/:roomId/resume-requests`, `GET .../:id?wait=`(긴 조회 `RESUME_LONGPOLL_SEC`, 한 요청에 조회가 겹치면 앞의 것을 끝냄, Bearer 새 기기 토큰 해시 확인), `DELETE .../:id`, 교사에게 `resume.pending`(hello의 `pendingResumes` 포함), `resume.decide`(허용이면 한 트랜잭션 `WHERE status='PENDING'` + devices 등록, 모두 허용), `resume.decided`. `device.list`/`device.revoke`(끊긴 기기는 그 소켓 문서 연결 닫기).
5. **P4-6 알림·타이머·스냅샷**: `notice.send`(→ `notice` 이벤트), `timer.start/pause/resume/cancel`(서버 메모리 예약, 재시작하면 DB에서 다시, 알림 시각 `alerts`, 끝날 때 `endText` 알림), `snapshot.list/get/restore`(restore는 RESTORE 스냅샷을 먼저 남기고 대상 글을 돌려줌, 학생은 자기 글만).
6. **P4-7 수업방**: `room.update`(→ `room.settings`), `room.close`/`room.reopen`(→ `room.status`, 학생 연결 읽기 전용 다시 계산), `room.delete` + `application/deleteRoom.ts`(PLAN §7.7 순서 그대로, `roomState.forgetRoom` 포함), `consent.update`(이미 있음).
7. **P4-8 내려받기·만료**: `GET /api/teacher/rooms/:roomId/export?scope=submitted|all`(`exportResult`), `jobs/retention.ts`(60초마다 만료 방 → `deleteRoom`, `commands.prune`도), `jobs/timers.ts` 연결.
8. **시험(P4-9 일부)**: 위 각 항목의 통합 시험(시험 서버 + Node 클라이언트, AI는 fake). 특히 PLAN §10.4 신뢰성 시험: 제출 ack 유실 뒤 옛 제출 `E_STALE`, 서버가 변경을 다 받기 전 제출 `E_SYNC_PENDING`, 이어 쓰기 허용 응답 유실 뒤 이어짐, AI 동시 요청이 한도를 넘지 않음, 만료 삭제와 저장 재시도가 겹칠 때, 잠금 중 편집 거부 → 해제 뒤 재동기화.

## 확인
```bash
npx tsc -b packages/core && npx tsc -p apps/server/tsconfig.test.json && node tools/checks/layers.mjs && node tools/checks/forbidden.mjs && node tools/checks/prd-sync.mjs && npx prettier --check apps/server
```
```bash
npx vitest run --project server --project integration --maxWorkers=1
```
같은 실패 3번이면 멈추고 보고. 너무 길어지면 7·8번까지 못 가도 된다: 끝낸 번호와 남은 번호를 분명히 적는다.

## 보고 (짧게, 한국어)
끝낸 번호, 만든·바꾼 파일, 정한 것, 규약에 더한 것, TODO, 돌린 명령과 실제 출력 마지막 20줄, 확인하지 못한 것.
