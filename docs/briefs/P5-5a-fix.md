# P5-5a 검토 지적 고치기 (Claude 서브에이전트)

cwd: /Users/bodyking/Desktop/Architecture/writeessay
검토 보고서: `docs/reviews/P5-5a_v0_review.md`(Codex). 1~8번을 모두 고친다(기기 AI 작업이 끝나 `adapters/local/**`가 비었다).
사용자 지시: 묻지 말고 진행, 빠르게. AGENTS.md 규칙 그대로(git 금지, 새 의존성 금지, 4460~4462 띄우지 않기, 수치는 config).
## Claude가 정한 설계
- **1번 PIN 감속**: 감속 대기 뒤 PIN 조회 직전에 잠금을 다시 확인한다. 조회·실패 기록 사이에 await를 두지 않는다. 병렬 요청 회귀 시험.
- **2번 meta 검사**: `precheck.ts`가 PLAN §4.2 meta 키만 허용(`subtype`, `purposeCustom`, `mood`, `moodCustom`, `tempo`, `cutCount`). 값 검사: subtype은 그 글 genre의 카탈로그(`packages/core/src/genres.ts`), mood·tempo는 카탈로그 값(있으면) 아니면 짧은 문자열, purposeCustom·moodCustom은 `DOC_TITLE_MAX_CHARS` 이하 문자열, cutCount는 0 이상 정수(상한은 genres/structure에 있으면 그것). 어기면 기존처럼 그 연결 읽기 전용 + `doc.error`. 이미 저장된 잘못된 값이 hello·요약을 무효화하지 않게, 서버가 hello·요약을 만들 때 모르는 subtype은 null로 바꿔 보낸다(방어). 
- **3번 메모 동시 생성**: 서버가 `doc.create`의 초기 문서(`initialDocState`)에서 **그 genre의 모든 하위 종류·용도에 나오는 도움 질문 ID 전부**에 빈 `Y.Text`를 미리 만들어 둔다(PLAN §4.2 `memo: Y.Map<Y.Text>`). 편집기(`apps/web/src/adapters/editor/editor.ts`)의 INIT_MEMO 생성은 그 키가 없을 때만 쓰는 예전 글 대비로 남긴다. precheck는 이미 있는 memo 키의 값을 다른 Y.Text로 **바꾸는** 업데이트를 거부한다(같은 키 덮어쓰기 금지). 회귀 시험: 두 기기 동시 첫 입력이 모두 남음.
- **4번 기기 저장 실패**: `docProvider.ts`가 `appendUpdate` 실패를 삼키지 않는다. 실패한 업데이트를 메모리에 남겨 두고 다음 쓰기 때 먼저 다시 쓰며(합쳐서), `SyncedDoc`에 `storageFailed: Observable<boolean>`을 더한다. `flushLocal()`은 남은 실패가 있으면 거부(reject)한다. 제출(`application/submitDoc.ts`)은 그 거부를 그대로 올린다(화면이 E_STORAGE_BLOCKED 띠). 시험: 실패 → 다시 성공하면 빠짐없이 들어감, 실패 중 flushLocal 거부.
- **5번 삭제까지 확인**: 저장 확인·제출 검사를 **상태 벡터 + 삭제 집합**으로 바꾼다. 규약: `doc.persisted` 데이터에 `snapshot`(base64url, `Y.encodeSnapshot(Y.snapshot(doc))`)을 더한다(판 N-1 호환: `stateVector`도 계속 보냄). `doc.submit` 인자에 `snapshot`을 더한다(`stateVector`는 남김, 서버는 snapshot이 있으면 그것으로 검사). 덮음 판정 함수 하나를 `packages/core/src/protocol/coverage.ts`(새)로: 받은 쪽 snapshot이 기기 snapshot의 상태 벡터를 다 포함하고 **기기 삭제 집합의 모든 구간이 받은 쪽 삭제 집합 구간에 들어 있으면** 덮음. 기기 `saveState.ts`·`docProvider.ts`는 이 함수로 `saved`를 정하고, 서버 제출 검사도 같은 함수(삭제만 남은 경우 `E_SYNC_PENDING`). 대기열: `session.ts`의 `waitDocSynced`가 그 글 제공자가 열려 있지 않으면 **열어서** 동기화가 끝날 때까지 기다린 뒤 제출한다(열린 제공자는 세션이 닫힐 때 같이 닫음). `protocol/room.ts`·`docEvents.ts`는 더하기만. PLAN §2.3 ⑥·§6.5의 "상태 벡터" 문장 수정은 Claude가 한다(보고에 바꿀 문장 적기).
- **7번 waitSynced 끝나지 않음**: 글을 닫거나 영구 거절(`failure`·`rejected`)되면 waitSynced가 거부된다. outbox는 그 거부를 받으면 그 항목을 남긴 채(지우지 않음) 이번 실행을 끝내고 다음 flush에서 다시 시도한다(새 제공자로). running이 풀리는지 시험.
- **6번 만료 사본 정리**: 앱 시작 때(그리고 화면이 다시 보일 때 `visibilitychange`) `memory.purgeExpired(now)` → 돌려준 방 ID들의 기기 사본(글·업데이트·AI 결과·대기열)을 지우고 `localStore.purgeExpired(now)`도 부른다. 이 연결은 `apps/web/src/application/purgeLocal.ts`(새, PLAN §3의 이름)로 두고 `app/providers.tsx`가 시작 때 부른다. **모든 글 열기 경로**(`application/openWriting.ts`의 `openDoc`, 교사 서랍이 쓸 열기, 이어 쓰기)에서 `setDocMeta(docId, {roomId, expiresAt})`를 기록한다(교사 열기는 지금 없으니 `openDocForRoom(session, docId, roomId, expiresAt)` 같은 공용 함수 하나로). `localDocStore.ts`의 `purgeExpired`가 상태 행 없이 업데이트만 있는 사본도 지울 수 있게 한다(메타가 없는 사본은 방 ID로 지우는 `purgeRoom(roomId)`를 더함). `room.status`가 `DELETED`·`EXPIRED`로 오면 그 방 사본을 지운다.
- **8번 수업방 채널 인증**: `roomChannel.ts`가 우리 오류 코드(`isErrorCode`)만 영구 실패로, 그 밖(`permission-denied` 등)은 `docProvider.ts`의 `reattachSoon`처럼 잠시 뒤 `socket.attach(provider)`로 다시 인증한다(횟수 제한). 소켓은 살아 있는데 room 연결만 닫히면 다시 붙인다(PLAN §4.7 대응 4).
## 고칠 수 있는 파일
`apps/server/src/{application/enterWithPin.ts,realtime/precheck.ts,realtime/commands/docCommands.ts,realtime/persistence.ts,realtime/roomChannel.ts,realtime/roomState.ts}`와 필요한 서버 파일(시험 포함), `packages/core/src/protocol/{docEvents.ts,room.ts,coverage.ts(새),index.ts}`(더하기), `apps/web/src/adapters/realtime/**`, `apps/web/src/adapters/editor/editor.ts`, `apps/web/src/adapters/local/**`, `apps/web/src/ports/{realtime,localStore,deviceMemory}.ts`, `apps/web/src/application/{submitDoc,openWriting,purgeLocal}.ts`, `apps/web/src/app/providers.tsx`, 시험 파일들, `tests/integration/**`. **고치지 않는 것**: `application/{aiChip,requestAi,exportStudent,exportAll}.ts`(끝난 작업, 읽기만), `apps/web/src/ui/**`·`dev/**`(화면 작업), `packages/core/src/{domain,copy}/**`·`genres.ts`·`structure.ts`(읽기만).
## 확인
```bash
npx tsc -b packages/core && npm run typecheck && node tools/checks/layers.mjs && node tools/checks/forbidden.mjs && npx prettier --check apps/server apps/web/src/adapters/realtime apps/web/src/adapters/editor packages/core/src/protocol tests/integration
```
```bash
npx vitest run --maxWorkers=1
```
(전체 시험도 가볍게 돈다. 같은 실패 3번이면 멈추고 보고.) 편집기 시험(`src/adapters/editor`)은 하나도 깨지면 안 된다.
## 보고 (짧게, 한국어)
번호별 고친 내용·파일, 더한 규약, PLAN에서 Claude가 바꿀 문장, 돌린 명령과 실제 출력 마지막 20줄, 확인하지 못한 것.
