# P5-5b 검토 고치기 (Claude 서브에이전트 3갈래)

cwd: /Users/bodyking/Desktop/Architecture/writeessay
근거: `docs/reviews/P5-5b_v1_review.md`(Codex 2차 독립 검토, 정적 추적이라 실행 확인 안 됨). 먼저 읽을 것: AGENTS.md, 그 보고서의 맡은 번호, PRD 해당 절, PLAN §4·§6·§7·§8, `docs/decisions.md` ADR-056·057.

## 공통 규칙
- 맡은 번호마다 **먼저 실패하는 시험으로 재현**한다. 재현이 안 되면(보고서가 틀렸으면) 고치지 말고 근거와 함께 "결함 아님"으로 보고한다.
- 고칠 수 있는 파일은 갈래별 목록뿐. 목록 밖을 고쳐야 하면 고치지 말고 "고쳐야 할 것"으로 보고한다. 다른 두 갈래와 화면 시험 에이전트(`tests/e2e/**`)가 같은 시간에 일한다.
- git·새 의존성·4460~4462 포트·서버 띄우기 금지. 시험은 바뀐 범위만 `npx vitest run --project <web|server|core|integration> --maxWorkers=1 <파일>`(자원 보호 장치 없이 돌려도 되는 가벼운 범위). 전체 시험·빌드·Playwright는 돌리지 않는다(통합 담당이 끝에 한 번).
- 타입: `npx tsc -p apps/web --noEmit`, `npx tsc -p apps/server --noEmit`, 시험 tsconfig(`apps/server/tsconfig.test.json`, `packages/core/tsconfig.test.json`)도. `npx prettier --check <바꾼 파일>`, `node tools/checks/layers.mjs && node tools/checks/forbidden.mjs`.
- 문구는 `packages/core/src/copy/ko.ts`에만(새 키가 필요하면 그 파일에 더해도 됨 — 세 갈래 중 **flow 갈래만** ko.ts를 고친다. 다른 갈래는 필요한 키를 보고). 수치는 `config.ts`(PRD 12.3과 짝이 맞아야 해서 새 키는 만들지 말고 보고). 오류 코드는 `errors.ts`의 것만.
- 기대값을 약하게 하거나 시험을 지워서 통과시키지 않는다. 같은 실패 3번이면 멈추고 보고.
- 보고(한국어, 짧게): 번호별 재현 시험 이름·고친 방식·바꾼 파일, 결함 아님 판정과 근거, 돌린 명령과 실제 출력 마지막 줄들, 고쳐야 할 것.

## 갈래 S — 서버: B01, B09, B10, B03(서버 쪽)
고칠 수 있는 파일: `apps/server/src/**`, `apps/server/test/**`, `packages/core/src/api/**`, `packages/core/src/protocol/**`와 그 시험.
- B01: 만료 방과 PIN·입장 코드가 겹칠 때 직접 `DELETE` 대신 공통 삭제 유스케이스(`application/deleteRoom.ts`)로 정리하고 새 방 만들기에서 유일성을 다시 확인. 저장소의 직접 삭제 경로를 없앤다.
- B09: 맞춤법 조각 요청 전체가 하나의 절대 deadline을 나눠 쓰게(`ai/run.ts`·`application/aiRequest.ts`). 예산이 끝나면 새 조각을 시작하지 않고 실행 중인 호출도 중단.
- B10: 노래 분위기 직접 입력 한도를 화면·Yjs 검사·API 스키마가 같은 설정값(`DOC_TITLE_MAX_CHARS` 등 지금 화면이 쓰는 값)으로. 상수 32를 없앤다.
- B03(서버): 참가자 동의 판이 지금 `POLICY_VERSION`과 다르면 글 편집(문서 연결의 쓰기)과 AI 요청을 막고 `consent.update`는 허용. 맞는 오류 코드는 `errors.ts`에서 고르되 없으면 보고(PRD 12.4). 기기 쪽 화면 흐름은 flow 갈래가 한다 — 서버가 무엇을 돌려주는지(코드·이벤트)를 보고에 정확히 적는다.

## 갈래 RT — 기기 실시간·저장: B02, B07, B08
고칠 수 있는 파일: `apps/web/src/adapters/realtime/**`(단 `lazy.ts`는 통합 담당이 방금 고침 — 필요하면 보고), `apps/web/src/adapters/editor/**`, `apps/web/src/adapters/local/**`, `apps/web/src/app/student/hooks/useSubmit.ts`, `apps/web/src/app/student/RoomFlow.tsx`, `apps/web/src/application/openWriting.ts`와 각 시험.
- B02: 서버 초기 상태를 받기 전에는 메모 칸 객체를 기기가 새로 만들지 않는다. 그 사이 입력은 잃지 않게(보존 뒤 반영하거나 초기 동기화 전에는 메모 칸을 읽기 전용·보류). 반영 문 규칙(PLAN §6.3: 조합 중 입력칸 값·선택·초점·readOnly를 건드리지 않음)을 지킨다. `memoReplaced` 검사는 약하게 하지 않는다.
- B07: 영구 거절(`retryable:false`) 명령은 사본을 지킨 채 실패로 알리고 대기열 맨 앞에서 빼서 뒤 제출이 진행되게. 쓰기 화면 제출 잠금이 풀리게.
- B08: `E_SERVER_DOWN`로 멈춘 채널에서 다시 하기가 새 채널·재인증을 시작하게. 영구 자격 오류와 회복 가능한 실패를 나눈다. `useReentry.ts`를 고쳐야 하면 보고(flow 갈래 파일).

## 갈래 FLOW — 입장·재동의·삭제 정리·이어 쓰기·연결 점검: B03(화면), B04, B05, B06, B11
고칠 수 있는 파일: `apps/web/src/app/student/**`(단 `hooks/useSubmit.ts`·`RoomFlow.tsx` 제외), `apps/web/src/app/teacher/**`, `apps/web/src/application/**`(단 `openWriting.ts` 제외), `apps/web/src/adapters/api/**`, `apps/web/src/ports/**`(모양을 바꾸면 RT 갈래와 겹치지 않는지 확인), `packages/core/src/copy/ko.ts`, 각 시험.
- B03(화면): 쓰기 주소 직접 진입·새로고침에서도 hello의 정책 판이 기기 동의 판과 다르면 재동의 화면을 먼저 보인다(입장 화면과 같은 부품 재사용). 서버 쪽 막기는 S 갈래 — 서버가 돌려줄 코드를 아직 모르면 hello의 `POLICY_VERSION`과 `me.consentVersion` 비교로 화면을 막는다.
- B04: 삭제·만료 확인 뒤 기기 사본 정리를 학생·교사 공통으로(교사 다른 기기 포함), `resume.pending`에도 만료 정보를 두고 같은 정리에 넣는다. `E_AUTH`를 곧바로 삭제로 보지 말고 방 조회로 확인하는 등 안전한 판단.
- B05·B06: 이어 쓰기 요청의 토큰·commandId를 요청 전에 기기에 적어 같은 요청을 다시 보내게, 승인된 학생 기억을 저장한 뒤에 pending을 지운다. 서버 쪽 고칠 것이 있으면 보고(S 갈래 파일).
- B11: 연결 점검 전체에 deadline(PRD 16.4의 10초 — 설정에 맞는 키가 있으면 그것, 없으면 보고)과 취소 신호, 끝나지 않은 단계는 실패로 확정하고 진행 표시를 푼다.
