# P5-5b v1 2차 독립 코드 검토

검토자: Codex. 기준: `AGENTS.md`, `P5-5a_v0_review.md`, PRD §9·§12.3·§12.4·§13·§16 및 관련 기능, PLAN §4·§7·§8, `docs/privacy-policy.md`.

이 보고서만 추가했다. 아래 재현은 **소스에서 추적한 회귀 시험 절차이며 실행 결과가 아니다.** 서버·core 시험은 자원 보호가 실행을 보류했다. 다른 에이전트가 소스를 수정 중이므로 파일:줄과 함께 적은 함수·분기 내용을 기준으로 찾는다.

## 발견

### B01. [상] 새 방 만들기가 만료 방을 직접 삭제하여 연결·AI·메모리 정리를 건너뛴다

- 위치: `apps/server/src/application/createRoom.ts:98`, `:191`; `apps/server/src/store/repos/rooms.ts:132`–`133`.
- 문제: 만료된 PIN·입장 코드 재사용 때 `DELETE FROM rooms`를 직접 실행한다. `deleteRoom`의 방 잠금, AI 중단, `room.status`, 연결 닫기, 저장 예약 버림, 메모리 제거, WAL 체크포인트를 호출하지 않는다. 이미 행이 없어졌으므로 이후 retention의 `listExpiredIds`에도 나오지 않아 이 경로로 빠진 방은 정리 대상으로 다시 발견되지 않는다. 열린 Y.Doc와 기존 연결에는 글이 남고, 해당 글 저장은 `persistence.ts:110`에서 행 없음으로 건너뛴다. PLAN §7.7의 만료·지금 삭제 공통 절차와 방침의 삭제 설명에 어긋난다.
- 재현: 학생과 교사가 글을 열고 있는 방의 만료 시각을 지난 뒤, retention 회차 전에 같은 PIN으로 새 방을 만든다. 옛 방 DB 행은 없어지지만 기존 연결·메모리 문서가 제거되지 않으며 삭제 이벤트도 없다. 진행 중 AI가 있다면 공통 삭제 경로의 취소도 받지 않는다.
- 고치는 방향: 충돌한 만료 방 ID를 찾아 공통 삭제 유스케이스로 정리한 후 새 방 생성 트랜잭션에서 유일성을 다시 확인한다. 저장소의 직접 삭제를 예약 작업과 별개의 삭제 경로로 유지하지 않는다.

### B02. [상] 최초 동기화 전에 메모를 쓰면 여전히 별도 Y.Text를 만들어 충돌한다 — 1차 3번 잔여

- 위치: `apps/web/src/adapters/editor/editor.ts:162`–`168` (`ensureMemoText`); `apps/web/src/adapters/realtime/docProvider.ts:201` 이후 `provider.attach()`와 즉시 반환; `apps/server/src/realtime/precheck.ts:153`의 `memoReplaced`.
- 문제: 서버의 메모 선생성만으로는 해결되지 않는다. 글 제공자는 서버 초기 상태를 받기 전에 반환하고 편집기가 올라간다. 이때 `viewDoc`에 메모가 없으면 `ensureMemoText`가 새 객체를 만들어 `INIT_MEMO`로 전송한다. 서버가 만든 객체를 아직 못 받은 상황을 예전 글의 없는 칸으로 오인한다. 로컬 객체가 병합에서 지면 입력이 사라지고, 이기면 서버의 `memoReplaced`가 거부하여 그 연결을 읽기 전용으로 만든다. 둘 다 정상 메모 편집이 아니다.
- 재현: 기기 사본이 없는 새 글/새 기기에서 방 hello는 받되 doc 초기 동기화를 지연시킨다. 도움 메모에 먼저 입력한 뒤 서버 초기 상태와 로컬 업데이트를 합친다. 또는 netDoc에는 초기 메모가 왔지만 반영 문 때문에 viewDoc 반영 전인 시점에 입력한다. 서버·기기 clientID 순서 양쪽을 시험해야 한다.
- 고치는 방향: 서버 초기 메모 객체를 확보하기 전에는 동일 키 객체를 생성하지 않도록 한다. 그동안의 입력을 별도로 보존하고 공통 객체에 반영하거나, 초기 상태 준비 후 메모 입력을 시작하게 한다. `memoReplaced` 검사만 약화해서 해결하지 않는다.

### B03. [상] 쓰기 주소 직접 진입·새로고침은 정책 재동의를 건너뛴다

- 위치: `apps/web/src/app/student/WritePage.tsx:59`–`73`; `apps/web/src/app/student/hooks/useReentry.ts:68`–`76`; `apps/server/src/realtime/auth.ts:104`의 `verifyStudent`; `apps/server/src/application/aiRequest.ts:83`의 `prepareAiRequest`.
- 문제: 정책 버전 비교는 `RoomEntryPage`가 부르는 `useReentry`에만 있다. 저장된 기억으로 `/:code/write/:docId`를 새로고침하면 `WritePage`는 바로 연결·글 열기를 진행한다. `RoomFlow`도 재동의를 검사하지 않으며, 서버 인증·문서 권한·AI 요청에도 참가자의 동의 버전을 검사하는 관문이 없다. 새 정책을 확인하지 않은 상태로 글 편집과 AI 전송을 계속할 수 있다. PRD F-03 및 방침 §9.2와 불일치한다.
- 재현: 기존 정책에 동의한 기기 기억을 유지하고 서버 `POLICY_VERSION`을 바꾼다. 저장된 쓰기 주소로 직접 열거나 그 주소에서 새로고침한 뒤 AI를 요청한다. 입장 화면을 경유할 때와 달리 재동의가 요구되지 않는다. 오프라인 입장 후 쓰기 화면에서 재연결하는 경우도 포함한다.
- 고치는 방향: 모든 학생 경로가 공유하는 곳에서 최신 hello의 정책 버전을 확인하고, 재동의 전 서버 편집·AI 사용을 제한한다. 오프라인 사본은 보존하되 새 정책 확인 후 업로드하는 흐름을 정한다. 서버에서도 재동의 명령에 접근할 수 있는 상태와 편집·AI 허용을 구분한다.

### B04. [상] 삭제 이벤트를 놓친 기기·다른 교사 기기·이어 쓰기 대기의 사본이 정리되지 않는다 — 1차 6번 잔여

- 위치: `apps/web/src/application/purgeLocal.ts:13`–`24`, `:60`–`64`; `apps/web/src/app/student/hooks/useReentry.ts:81`–`91`; `apps/web/src/app/teacher/DashboardRoute.tsx:151`–`154`; `apps/web/src/application/teacher.ts:63`의 `connectTeacher`; `apps/web/src/application/resumeOnDevice.ts:10`–`18`.
- 문제: 시작 시 정리는 원래 `expiresAt`만 보고, 삭제 이벤트 정리는 학생 `connectStudent`에만 연결된다. 오프라인 중 교사가 조기 삭제한 방에 재접속하면 서버는 토큰 행이 없어 `E_AUTH`를 준다. 기기는 기억만 지우고 글·AI 결과·outbox를 지우지 않으므로 원래 만료일까지 남는다. 다른 교사 기기는 삭제 이벤트를 받아도 기억만 지운다(삭제 버튼을 직접 누른 기기의 별도 정리와 다름). 또한 `kv['resume.pending']`의 별명·토큰은 만료 시각이 없고 만료/방 삭제 정리 어디에서도 처리하지 않아 원래 만료일 이후에도 남는다. 방침 §5.8(`docs/privacy-policy.md:95`)의 재실행/재연결 시 사본 삭제 설명과 다르다.
- 재현: (a) 학생 기기를 오프라인으로 둔 뒤 교사가 방을 지금 삭제하고, 학생 기기를 다시 연결한다. (b) 교사 기기 둘에서 학생 글을 열어 둔 뒤 한 기기에서 지금 삭제한다. (c) 새 기기에서 이어 쓰기 요청을 남긴 뒤 방을 만료시키고 앱을 다시 연다. 각 기기 저장소의 글·AI·outbox 및 `resume.pending`을 확인한다.
- 고치는 방향: 삭제·만료 확인과 무효 토큰 이후의 정리를 학생·교사 공통으로 연결한다. `E_AUTH`를 무조건 삭제로 해석하기 곤란하면 방 존재 확인 또는 안전한 삭제 확인 계약을 마련한다. pending 요청에도 만료 정보를 보관하여 동일 정리에 포함한다. 정리 중 새 쓰기가 사본을 다시 만들지 않도록 제공자·AI 저장과 순서도 맞춘다.

### B05. [중] 이어 쓰기 요청 응답을 잃고 새로고침하면 기존 요청과 새 토큰이 어긋난다

- 위치: `apps/web/src/application/resumeOnDevice.ts:33`–`42`; `apps/web/src/app/student/NicknamePage.tsx:42`–`46`; `apps/server/src/application/resume.ts:74`–`75`.
- 문제: 요청 토큰·commandId를 영속화하기 전에 POST를 보내고, 응답을 받은 뒤에만 pending을 저장한다. 서버가 요청을 만든 뒤 응답을 잃고 페이지를 다시 열면 새 토큰을 만든다. 서버는 같은 참가자·deviceId의 기존 PENDING 요청 ID를 그대로 반환하지만 토큰 해시는 갱신하지 않는다. 기기는 옛 요청 ID와 새 토큰을 저장하여 이후 조회·취소 모두 `E_AUTH`가 된다.
- 재현: 최초 resume POST를 서버에는 전달하되 응답은 버린다. 새로고침 후 같은 별명으로 다시 요청한다. 반환된 기존 requestId를 새 토큰으로 조회하면 거절된다. 교사가 허용해도 등록되는 것은 기기가 잃어버린 옛 토큰이다.
- 고치는 방향: 네트워크 요청 전에 토큰·commandId·대상을 저장하고 새로고침 후 같은 요청을 재전송한다. 서버도 기존 요청 재사용 시 토큰 불일치를 성공으로 반환하지 않아야 한다. 토큰을 무인증 요청으로 교체하는 방식은 피한다.

### B06. [중] 승인받은 토큰을 기억하기 전에 pending을 삭제하여 복구 경로를 잃는다

- 위치: `apps/web/src/application/resumeOnDevice.ts:74`–`89`; `apps/web/src/app/student/ResumeWaitPage.tsx`의 `participantId` 콜백과 오류 후 재시도 효과.
- 문제: APPROVED를 받자마자 pending을 삭제하고, 그 뒤 웹소켓 hello로 participantId를 얻어 `rememberStudent`를 호출한다. 이 사이 연결 실패·저장 실패·새로고침이면 승인된 토큰이 기기 기억 어디에도 없다. 다시 하기에서 `pendingResume`은 null이므로 별명 화면으로 돌아가 이미 승인된 상태를 이어 갈 수 없다.
- 재현: 승인 응답 직후 `waitHello`를 실패시키거나 `rememberStudent` 쓰기를 실패시킨다. 다시 하기 또는 새로고침 후 승인된 기기 토큰을 복구할 수 없고 교사 승인을 새로 요청해야 한다.
- 고치는 방향: 승인된 학생 기억의 저장 완료 후 pending을 지운다. 실패 시 pending으로 같은 토큰·승인 결과를 다시 조회하도록 보존하고, 취소 신호가 온 경우 뒤늦은 기억 저장도 통제한다.

### B07. [중] 동기화 영구 거절을 대기열에 남겨 해당 제출과 뒤 제출을 계속 막는다 — 1차 7번 잔여

- 위치: `apps/web/src/adapters/realtime/outbox.ts:74`–`80`; `apps/web/src/adapters/realtime/docProvider.ts:108`–`111`, `:175`–`177`; `apps/web/src/app/student/hooks/useSubmit.ts`의 queue 결과 구독.
- 문제: waiter의 미종료는 고쳤지만 `waitDocSynced`가 `retryable:false`로 거절되어도 항목을 남기고 결과를 화면에 알리지 않는다. 다음 flush도 맨 앞의 같은 항목에서 끝난다. `rejected`는 해당 제공자에서 해제되지 않으며, queue에 남아 있는 동안 쓰기 화면도 제출 잠금을 유지한다. 본문 초과 등으로 영구 거절된 제출 하나가 수업방 대기열 전체를 막고 사용자는 실패를 처리할 수 없다.
- 재현: 글 A를 오프라인에서 한도 초과 상태로 제출하고 재연결하여 `E_DOC_TOO_LARGE`를 받게 한다. 이후 글 B의 정상 제출을 넣거나 flush를 다시 호출한다. A의 실패 결과가 전달되지 않고 B도 보내지지 않는다. 기존 outbox 시험은 영구 거절 항목을 유지하는 동작만 확인한다.
- 고치는 방향: 일시 중단과 영구 거절을 구분한다. 영구 거절 명령은 글 사본을 보존한 채 실패로 알리고 대기열에서 제거하거나 별도 보류하여 뒤의 독립적인 문서 제출을 진행한다. 화면 잠금을 풀고 사본에서 복구할 수 있게 한다.

### B08. [중] 일시 인증 실패 재시도 소진 후 학생의 다시 하기가 같은 실패 세션을 재사용한다 — 1차 8번 잔여

- 위치: `apps/web/src/adapters/realtime/roomChannel.ts:129`–`141`, `:75`–`79`; `apps/web/src/app/student/RoomFlow.tsx:125`; `apps/web/src/app/student/hooks/useReentry.ts:54`–`68`, `:124`; `apps/web/src/application/openWriting.ts:47`.
- 문제: 내부 인증 실패가 재시도 상한에 도달하면 `E_SERVER_DOWN/failed`가 되며 더는 attach하지 않는다. stale 재연결도 ready에서만 수행한다. 이후 학생의 다시 하기는 attempt만 바꾸고 `RoomFlow.session`이 같은 토큰의 기존 failed 채널을 반환하므로 `waitHello`가 즉시 다시 거절한다. 소켓이 그대로 살아 있으면 서버가 회복되어도 재인증이 시작되지 않는다. 마지막 글이 있으면 오프라인 쓰기로 넘어가도 실패한 방 채널 때문에 제출이 진행되지 않는다.
- 재현: room 인증 훅에서 일시 오류를 재시도 상한까지 발생시킨 뒤 서버 상태를 복구하되 소켓은 유지한다. 학생 입장 화면의 다시 하기를 누른다. 새 인증 시도 없이 동일 오류/오프라인 쓰기 경로로 돌아간다.
- 고치는 방향: `E_SERVER_DOWN`에 대한 다시 하기가 채널/세션을 새로 만들거나 명시적 재인증을 수행하도록 한다. 영구 자격 오류와 회복 가능한 failed 상태를 분리한다.

### B09. [중] 긴 맞춤법 요청의 전체 시간 예산이 조각마다 새로 시작한다

- 위치: `apps/server/src/application/aiRequest.ts:214`–`221`; `apps/server/src/ai/run.ts:134`–`150`.
- 문제: 맞춤법 조각을 제한된 병렬도로 실행하면서 각 `runStructured`가 시작할 때 새로운 전체 deadline을 만든다. 상위 요청에는 공유 deadline이 없어 뒤의 조각 묶음도 각각 전체 예산을 받는다. PLAN §8.2가 정한 버튼 요청 전체 예산은 실제로 조각 하나의 예산이 된다. 느리지만 개별 timeout 이내인 응답이 여러 묶음 이어지면 전체 제한을 넘어 호출·예약을 유지한다.
- 재현: 기본 최대 맞춤법 입력을 여러 조각으로 나누고 가짜 AiPort가 각 조각을 시도 제한 직전에 성공시키게 한다. 앞 묶음이 끝난 뒤 다음 묶음이 새 deadline으로 시작하는지, 전체 요청 시간이 약정 예산을 넘는지 확인한다.
- 고치는 방향: 버튼 요청 시작 시 절대 deadline을 한 번 정하고 모든 조각·재시도에 남은 시간을 전달한다. 예산이 끝나면 새 조각을 시작하지 않고 실행 중인 호출도 함께 중단한다.

### B10. [중] 화면에서 허용한 노래 분위기 길이를 AI API가 거부한다

- 위치: `apps/web/src/app/student/WritePage.tsx:425`–`429`; `apps/server/src/realtime/docMeta.ts`의 `moodCustom`; `packages/core/src/api/index.ts:142`.
- 문제: 화면과 Yjs 검사는 직접 입력 분위기를 `DOC_TITLE_MAX_CHARS`(기본 40)까지 허용한다. `songForAi`와 `buildAiRequest`는 그대로 `meta.mood`에 넣는데 API 스키마는 상수 32자로 제한한다. 저장과 화면에서는 정상인 33~40자 분위기가 있으면 노래의 AI 버튼 요청이 `E_INPUT`으로 실패한다.
- 재현: 노래 가사에서 직접 입력 분위기를 33자 이상, 설정 상한 이하로 적고 빠르기를 선택한다. 충분한 본문으로 글벗을 요청한다. 요청 스키마 단계에서 거절된다.
- 고치는 방향: 분위기 입력·Yjs 검증·API 요청의 공통 설정 한도를 맞춘다. 화면에서 허용한 값을 API 호출 직전 몰래 자르지 않는다.

### B11. [중] 연결 점검의 10초 완료 기준을 보장하는 전체 timeout이 없다

- 위치: `apps/web/src/application/teacher.ts:137`–`165`; `apps/web/src/adapters/api/http.ts:45`–`50`; `apps/server/src/http/routes/teacher.ts`의 `check-ai` timeout.
- 문제: 서버 REST 조회, 실시간 왕복, AI 점검을 순서대로 기다린다. REST fetch에는 기본 timeout이 없고 점검 호출은 signal도 넘기지 않는다. AI만 해도 `AI_TIMEOUT_SEC`를 기다릴 수 있다. 각 단계 시간이 합산되며 하나의 REST 응답이 오지 않으면 다음 단계와 결과까지 무기한 기다린다. PRD §16.4의 연결 점검 10초 완료 기준을 충족하지 못한다.
- 재현: `teacherRoom` fetch를 끝나지 않는 응답으로 만들거나, 다른 단계는 즉시 성공하고 AI 점검만 10초 이상 지연시킨다. 점검이 완료되지 않는다.
- 고치는 방향: 점검 전체의 deadline·취소 신호를 두고 각 단계에 남은 시간을 전달한다. 기한이 되면 미완료 단계를 실패 결과로 확정하고 UI의 진행 상태도 해제한다.

## 1차 지적 중 남은 것

| 1차 번호 | 잔여 상태 | 이번 근거 |
|---|---|---|
| 3: 메모 객체 충돌 | 부분 수정. 서버 선생성 이후에도 기기 초기 상태 수신 전 객체 생성 가능 | B02 |
| 6: 만료 기기 사본 | 부분 수정. 시작/복귀 정리와 메타 기록은 연결되었으나 조기 삭제·교사·pending 정리 누락 | B04 |
| 7: waitSynced 대기열 정지 | 부분 수정. promise는 종료되나 영구 거절 항목이 계속 맨 앞을 막음 | B07 |
| 8: 인증 일시 실패 | 부분 수정. 오류 분류·재시도 이후 상한 소진 상태의 복구 경로 누락 | B08 |

1차 1·2·4·5번의 원래 지적에 대해서는 지연 뒤 PIN 재검사, meta 검사/출력 정제, 미기록 업데이트 보존과 flush 실패, 삭제 집합을 포함한 snapshot 및 대기열 문서 열기 코드가 추가된 것을 읽었다. **정적 확인이며 회귀 시험 통과 판정은 아니다.** 구형 vector-only 호환 경로는 남아 있고, ADR-056은 v0 배포 전이라는 전제를 명시한다.

## 수정 범위와 확인하지 못한 것

- 변경 파일: `docs/reviews/P5-5b_v1_review.md` 하나. 위 앱·서버·규약·문서 변경은 통합 담당에게 넘길 **고쳐야 할 것**이며 이 검토에서 수정하지 않았다.
- 검토 범위: 서버 유스케이스·명령·권한·PIN·AI 예약/정산/재시도/스트림/프롬프트·만료/타이머·내보내기, 기기 세션/대기열/저장/학생·교사 결합, core API/실시간 규약/하루 경계, 처리방침의 실제 동작 대응.
- 서버·core 시험: **미실행**(아래 자원 입장 거부). 웹 시험·타입 검사·빌드·Playwright·브라우저·실기기·실제 LLM 호출: **미실행**. 이전 검사 결과 **재사용 없음**.
- Git 명령·서버 시작·서비스 조작·배포·비밀값 파일 접근·다른 에이전트 호출은 하지 않았다. 실행 환경에서의 재현과 수정 후 회귀 확인은 남아 있다. 법률 적합성이나 제공사 정책의 최신성 검토는 이번 소스 대조 범위가 아니다.

## 실행 명령과 실제 출력

읽기에는 `pwd`, `rg`/`rg --files`, `cat`, `sed -n`, `nl -ba`, 파일 존재 확인을 사용했다. 메모리 레지스트리 `writeessay|P5-5` 검색은 일치가 없었다. 조회 중 `fieldBinding.ts`가 없어 실제 `field.ts`를 찾았고, `tests/server/*review*`는 zsh glob 일치가 없어 검색 범위를 고쳤다. 읽기 출력은 소스 내용이므로 중복 첨부하지 않는다. 검사 실행 시도는 아래 한 번뿐이며 허용된 보고서는 `apply_patch`로 작성했다.

```sh
/Users/bodyking/.local/bin/resource-guard status --profile avatar
```

종료값 `0`. 실제 출력 마지막 20줄:

```text
    "heavy_jobs": [
      {
        "pid": 33889,
        "종류": "빌드·시험 작업"
      },
      {
        "pid": 33893,
        "종류": "빌드·시험 작업"
      }
    ]
  },
  "판단": {
    "allowed": false,
    "workers": 0,
    "reasons": [
      "기존 고부하 작업이 실행 중",
      "예상 여유 메모리가 7GiB 미만"
    ]
  }
}
```

```sh
/Users/bodyking/.local/bin/resource-guard run --profile test -- npx vitest run --project server --project core --maxWorkers=1
```

종료값 `75`. 출력 전체는 다음 한 줄이며 Vitest는 시작되지 않았다. 반복 실행하지 않았다.

```text
새 작업 보류: 기존 고부하 작업이 실행 중. 기존 작업은 그대로 유지합니다.
```
