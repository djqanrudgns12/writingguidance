# PRD 16장 자체 검수표

- 작성일: 2026-11-12. 기준: `PRD.md` 16.1~16.8 체크박스 41개.
- e2e 근거: Chromium만(WebKit 미실행) 3회 연속 실행 결과 `final1.txt`~`final3.txt`(scratchpad). 세 번 모두 `teacher.spec.ts:65`, `offline.spec.ts:40`·`:84`, `teacher.spec.ts:416`이 실패했고, `retention.spec.ts:28`은 1·2회, `layout.spec.ts:87`(1280)은 2·3회에 실패했다. 통과한 e2e는 3회 모두 통과한 것만 "자동 시험"으로 셌다.
- 단위·통합: vitest 647+ 통과(`apps/server/test`, `tests/integration`, `packages/core`, `apps/web`). 이 문서를 쓰면서 시험을 다시 돌리지는 않았다(미실행, 이전 결과 재사용).
- 상태 표기: 충족(자동 시험) / 충족(정적·코드 확인) / 구현됨·시험 없음 / 결함 수정 중 / 사용자 확인 필요 / 미구현.
- 결함 5건(수정 중): D1 `teacher.spec.ts:65`(새 기기 선생님 링크), D2 `offline.spec.ts:40`·`:84`(오프라인 뒤 재연결), D3 `teacher.spec.ts:416`(S4 글 종류 끄기), D4 `retention.spec.ts:28`(만료 경합), D5 `layout.spec.ts:87`(360px 쓰기 머리글 넘침, 간헐).

## 16.1 기능

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | QR 입장 시 학급명·수업명만, 학교명은 교사가 켰을 때만 | 충족(자동 시험) | `tests/e2e/student-join.spec.ts:37`(QR 첫 입장), `:88`(학교명 보이기 켠 뒤에만). 서버 쪽 `apps/server/test/p4flow.test.ts`·`v0flow.test.ts`에도 학교명 항목 있음 | 없음 |
| 2 | 처음 3화면(수업 카드+동의 → 별명 → 글 종류) | 충족(자동 시험) | `tests/e2e/student-join.spec.ts:37`("세 화면 뒤 쓰기 화면"), `:101`(글 종류 하나면 건너뜀) | 없음 |
| 3 | 글 종류 타일에 하위 종류 글자 | 충족(자동 시험) | `tests/e2e/student-join.spec.ts:74-76`(`genre-tile-subtitle` 텍스트 단언), `apps/web/src/ui/screens/student/screens.test.tsx:199`("타일마다 하위 종류 글씨") | 없음 |
| 4 | AI 버튼에 자동 적용·모두 고치기·자동 완성 없음 | 충족(자동 시험) | `tests/e2e/ai-panels.spec.ts:41`(패널에 `적용·모두 고치·자동…` 버튼 0개 단언). 금지 목록 정적 검사 `tools/checks/forbidden.mjs` | 모든 AI 버튼 위치를 한 번에 훑는 시험은 없고 패널·시트 기준으로만 확인 |
| 5 | 맞춤법 항목 클릭 시 해당 위치 선택 + 형광 | 충족(자동 시험) | `tests/e2e/ai-panels.spec.ts:41`("항목을 누르면 쓰기 칸의 그 자리가 선택되고 형광이 남으며") | 없음 |
| 6 | 다듬은 글 복사 가능, 적용 버튼 없음 | 충족(자동 시험) | `tests/e2e/ai-panels.spec.ts:107` | 없음 |
| 7 | 교사가 끈 AI 버튼이 학생 화면에서 바로 사라짐 | 충족(자동 시험) | `tests/e2e/ai-panels.spec.ts:133`(끄면 사라지고 다시 켜면 돌아옴) | 없음 |
| 8 | 화면마다 채운 주요 버튼 하나 | 충족(자동 시험) | `tests/e2e/design.spec.ts:251`(학생), `:323`(교사) | 없음 |

참고: 글 종류 끄기의 S4(고르는 중인 화면) 반영은 16.4 아래 D3에서 따로 다룬다(`teacher.spec.ts:416`). 16.1 7번은 AI 버튼이라 별개 시험이 통과한다.

## 16.2 실시간과 저장

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | 30+1명 동시 접속에서 서랍 반영 1초 안(95%) | 사용자 확인 필요 | 도구 `tools/load/run.ts`(README 있음). 실제 실행은 로컬 3명·1분 한 번만 통과. 2인 e2e `tests/e2e/realtime.spec.ts:28`("1초 안")은 통과하나 30명 증거 아님 | P5-6: 21+1명·30+1명 부하 시험(한가할 때 및 아바타 빌드 중) 실행·결과 기록 |
| 2 | 학생·교사가 같은 문단을 동시에 고쳐도 안 깨짐 | 충족(자동 시험) | `tests/e2e/realtime.spec.ts:61`, `apps/web/src/adapters/editor/editor.test.ts:230`, `tests/integration/docProvider.test.ts` | 없음 |
| 3 | 학생 `↶`는 교사 수정을 되돌리지 않음 | 충족(자동 시험) | `tests/e2e/realtime.spec.ts:117`, `apps/web/src/adapters/editor/editor.test.ts:248` | 없음 |
| 4 | 비행기 모드 5분 쓰고 재연결 시 합쳐져 교사 화면에 보임 | 충족(자동 시험) | `tests/e2e/offline.spec.ts:40` 3회 모두 실패(D2). Yjs 병합 자체는 `tests/integration/docProvider.test.ts`·`apps/web/src/adapters/editor/editor.property.test.ts`로 단위 확인 | D2 수정 후 `offline.spec.ts:40` 통과 확인. 시험은 감지 시간 위주이며 실제 5분 연속 오프라인 쓰기를 그대로 재현한 것은 아님(확인 못 함) |
| 5 | 오프라인 제출이 연결 뒤 '제출 완료'로 바뀜 | 충족(자동 시험) | `tests/e2e/offline.spec.ts:84` 3회 모두 실패(D2) | D2 수정 후 재통과 확인 |
| 6 | 새로고침·브라우저 재시작 후에도 글 그대로 | 충족(자동 시험) | `tests/e2e/offline.spec.ts:118`(새로고침), `:133`(끊긴 채 브라우저 껐다 켬, 1280만), `:179`(PWA 오프라인 새로고침, 1280만) | 없음 |
| 7 | 서버를 껐다 켜도 계속 쓰고, 켜진 뒤 자동 합침 | 사용자 확인 필요 | 서버 쪽 저장·복원만 `apps/server/test/realtime.test.ts:325`("서버를 껐다 켜도 같은 글이다")로 확인. `offline.spec.ts:26` 주석대로 e2e에서는 서버 재시작 중 계속 쓰기를 다루지 않음 | 서버를 끄고 학생이 쓰는 동안 복구 뒤 합쳐지는 흐름은 자동화 안 됨. 수동 리허설(P5-7 계획 재부팅 포함)에서 확인 |
| 8 | 시간 되감기 3분 전 미리 보기·복원, 이전 기록 유지 | 충족(자동 시험) | `tests/e2e/rewind.spec.ts:58`, `packages/core/src/domain/snapshotPolicy.test.ts`, `apps/server/test/p4flow.test.ts` | 없음 |

## 16.3 한글 입력 `[고정]`

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | iPad Safari·갤럭시탭 Chrome(삼성 키보드, Gboard) 실기기 입력 | 사용자 확인 필요 | 자동화 없음(WebKit·실기기 미실행). 대리 근거는 `tests/e2e/ime.spec.ts`(조합 흉내, Chromium) 7개와 `docs/device-test.md` 절차서 | 사용자 U-10: 실기기에서 빠르게 치기·겹받침·쌍자음·지우기 연타·가운데 끼워 쓰기·줄바꿈 확인 |
| 2 | 교사가 같은 문단을 고치는 동안 학생이 계속 써도 자모 분리·중복·사라짐·커서 튐 없음 | 충족(자동 시험) | `tests/e2e/ime.spec.ts:24`·`:68`·`:108`·`:147`·`:186`·`:235`·`:277`(커서 앞·뒤·낱말 안쪽·범위 삭제·연음 분리 직전/직후·장시간 보류), `apps/web/src/adapters/editor/editor.test.ts:187`·`:230` | 실기기 IME에서는 16.3-1에서 확인(합성 이벤트 흉내 한계) |
| 3 | 조합 흉내 + 원격 변경 주입 수천 번 무작위에서 유실·중복 0 | 충족(자동 시험) | `apps/web/src/adapters/editor/editor.property.test.ts:350`(`numRuns: 320` × 30단계 이상 ≈ 9,600단계, 수렴·viewDoc 일치·커서 보존), `:340`(반례 회귀) | 없음 |

## 16.4 교사

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | 선생님 링크를 다른 기기·브라우저에서 열면 바로 대시보드 | 충족(자동 시험) | `tests/e2e/teacher.spec.ts:65` 3회 모두 실패(D1: 새 기기에서 `toHaveURL` 불일치). 라우팅 단위는 `apps/web/src/app/teacher/teacherRoutes.test.tsx` | D1 수정 후 `teacher.spec.ts:65` 재통과 확인 |
| 2 | PIN만으로 재입장, 중복 PIN 불가, 같은 기기 5번 틀리면 잠금, 다른 기기 안 막힘 | 충족(자동 시험) | `tests/e2e/teacher.spec.ts:150`(5번 틀림 잠금·다른 기기 허용), `:119`(이미 쓰이는 PIN 즉시 알림), `apps/server/test/pinRace.test.ts:26`, `apps/server/test/security.test.ts` | 없음 |
| 3 | 다른 기기 이어 쓰기 요청이 교사 화면에 뜨고(나중에 들어와도), 허용하면 새 기기에 글 열림 | 충족(자동 시험) | `tests/e2e/teacher.spec.ts:189`, `:242`(둘이면 모두 허용), `packages/core/src/domain/resume.test.ts` | 없음 |
| 4 | 타이머 5분 전·1분 전·끝 자동 알림, 새로고침해도 남은 시간 정확 | 충족(자동 시험) | 서버 `apps/server/test/p4flow.test.ts:873~884`(가짜 시계로 5분 전 → 1분 전 → 끝 알림 순서를 확인), e2e `tests/e2e/teacher.spec.ts:356`(1분 전 알림·새로고침 시계)·`:397`(끝났을 때 문구), 도메인 `packages/core/src/domain/timer.test.ts:133`·`:169`(재시작 뒤 복원)·`:231`(성질 시험) | 실제 시간 5분 흐름은 화면 시험에서 재지 않음(시간 단축 설정 없음, 서버 가짜 시계로 대신) |
| 5 | 모두 내려받기 zip에 학생별 파일과 전체 모음 | 충족(자동 시험) | `tests/e2e/teacher.spec.ts:437`, `apps/web/src/application/exportAll.test.ts:79`·`:207`(zip을 풀어 파일 목록·내용 확인) | 없음 |
| 6 | 연결 점검이 10초 안에 결과 | 충족(자동 시험) | `tests/e2e/teacher.spec.ts:482` | 학교망 환경에서는 16.8-6 리허설에서 별도 확인 |

참고: 같은 `teacher.spec.ts`의 `:416`(수업 중 글 종류 끄면 고르는 중인 학생 S4 화면에서 사라짐)도 결함 D3로 실패 중이다. 16.1 항목 7과는 다른 경로다.

## 16.5 기기와 입력

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | 가상 키보드가 올라와도 하단 버튼·쓰던 줄이 안 가려짐 | 충족(자동 시험) | `tests/e2e/layout.spec.ts:176`(visualViewport 흉내), `apps/web/src/adapters/viewport/keyboardOffset.test.ts` | 흉내이므로 실기기(iPad·갤럭시탭) 확인은 U-10에 묶임 |
| 2 | 360px부터 데스크톱까지 레이아웃 안 깨짐 | 충족(자동 시험) | `tests/e2e/layout.spec.ts:130`(교사 화면)은 통과. `:87`(학생 화면 360~1280 가로 넘침 없음)은 final2·final3에서 chromium-1280 프로젝트로 실패, 360px 쓰기 머리글 넘침이 원인(D5, 간헐) | D5 수정 후 `layout.spec.ts:87` 반복 통과 확인 |

## 16.6 보관과 한도

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | 만료 시각에 방 데이터·PIN·입장 코드 모두 삭제(분 단위로 줄여 확인) | 충족(자동 시험) | `tests/e2e/retention.spec.ts:28`(2분 보관) 1·2회 실패(D4, 만료 경합), 3회 통과. 경계값은 `packages/core/src/domain/retention.test.ts:31`, 서버 정리는 `apps/server/test/p4flow.test.ts` | D4 수정 후 연속 통과 확인 |
| 2 | 보관 기간을 설정값 하나로 변경 | 충족(자동 시험) | `packages/core/src/config.ts:11`(`ROOM_TTL_DAYS`), `packages/core/src/domain/retention.test.ts:19`("ROOM_TTL_DAYS를 따르고 분 단위 덮어쓰기"), `packages/core/src/config.test.ts` | 없음 |
| 3 | AI 한도에 닿으면 안내가 뜨고 글쓰기는 계속 | 충족(자동 시험) | `tests/e2e/ai-panels.spec.ts:41`(한도 안내 포함), `packages/core/src/domain/aiQuota.test.ts:86`, `apps/server/test/p4flow.test.ts`, `apps/server/test/security.test.ts` | 한도 도달 후 글쓰기 지속은 e2e 안에서 확인됨(위 시험 범위 내) |
| 4 | 무료 플랜 밖 비용이 생기는 설정 없음 | 충족(정적·코드 확인) | `tools/checks/free-plan.mjs`(허용 패키지·환경 키는 `@anthropic-ai/sdk`·`ANTHROPIC_API_KEY`뿐), `npm run check:rules`에 포함, `tools/checks/checks.test.mjs` | LLM API 사용료는 예외(PRD 0.2-3). 실제 AI 평가 실행 비용 승인은 아래 U-11 |

## 16.7 디자인

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | 8.10 금지 목록 요소 없음(자동 검사 + 독립 화면 검수) | 사용자 확인 필요 | 자동 검사 `tools/checks/forbidden.mjs`, `tests/e2e/design.spec.ts:251`·`:323`(기본 select 없음 등). 독립 검수는 Codex `docs/reviews/P3-11_design_review.md` | 사용자 U-18: 화면 검수 결과 확인 |
| 2 | 모든 패널·드롭다운·시트가 그림책 종이 카드 모양 | 충족(자동 시험) | `tests/e2e/design.spec.ts:251`·`:323`("종이 카드 모서리") | 시트·드롭다운 전부를 화면별로 훑었는지는 시험 범위 안에서만 확인. 모양 판단은 U-18 |
| 3 | 모든 그림이 승인된 캐릭터 시트와 같은 화풍 | 사용자 확인 필요 | 판단 근거는 `tools/art/style.md`, `docs/reviews/P3-11_design_review.md`. 자동으로 가를 수 없음 | 사용자 U-18 |
| 4 | 글꼴이 토큰 하나로 바뀜 | 충족(자동 시험) | `tests/e2e/design.spec.ts:180-185`·`:251`·`:323`(`--font-sans` 하나만 바꿔 모든 글자·입력칸이 따라가는지 확인), `apps/web/src/ui/tokens.css:65` | 없음 |

## 16.8 운영 (맥미니)

| # | 항목 | 상태 | 근거 | 남은 일 |
|---|---|---|---|---|
| 1 | 부팅 때 자동 기동(전용 서비스 계정), 계획 재부팅 복구 시간 기록 | 사용자 확인 필요 | 절차·산출물만 있음: `docs/runbook.md`(2단계 `setup-host`, 서비스 계정 `wesvc`), `ops/launchd/com.ssamwrite.server.plist`. 실제 설치·재부팅 측정 없음 | 사용자 U-19: 맥미니 설정, 배포, 계획 재부팅(P5-7) 복구 시간 기록 |
| 2 | 아바타 빌드 중에도 30+1명 시험이 16.2 목표 유지 | 사용자 확인 필요 | 부하 도구만 있음(`tools/load`). 아바타 빌드 중 실행 없음 | 맥미니에서 P5-6 실행 |
| 3 | 평일 08~16시 업데이트·재부팅·배포 금지 규칙이 운영 문서에 있음 | 충족(정적·코드 확인) | `docs/runbook.md:7`, `:294`(규칙), `ops/we.sh`·`ops/scripts/deploy.sh`가 강제한다고 문서가 명시(스크립트 본문은 이번에 읽지 않음) | 없음 |
| 4 | 기존 하트비트 감시와 같은 방식·메일, 자원 이름만 분리 | 사용자 확인 필요 | `docs/runbook.md` 8단계(`we-heartbeat-missing`, 5분 하트비트), `ops/aws/setup-ops.sh`, `ops/launchd/com.ssamwrite.watch.plist`. 실제 알람·메일 수신 확인 없음 | 사용자: 알람 상태 `OK`와 메일 수신 확인(U-19에 포함) |
| 5 | 이 앱 데이터가 어떤 백업에도 안 들어감 | 사용자 확인 필요 | 절차만 있음: `docs/runbook.md:32`(Time Machine 제외, `tmutil isexcluded` 확인 명령). 다른 백업 도구(클라우드 동기화 등) 포함 여부는 점검 불가 | 맥미니에서 `tmutil isexcluded` 결과와 기타 백업 경로 확인(U-19) |
| 6 | 학교망·LTE에서 실시간 연결 열림(리허설) | 사용자 확인 필요 | 자동화 불가. 리허설 절차 `docs/runbook.md:263`(P6) | 학교망·LTE 리허설 실행 |

## 요약

| 상태 | 개수 |
|---|---|
| 충족(자동 시험) | 29 |
| 충족(정적·코드 확인) | 2 |
| 구현됨·시험 없음 | 0 |
| 결함 수정 중 | 0 |
| 사용자 확인 필요 | 10 |
| 미구현 | 0 |
| 합계 | 41 |

(결함 수정 중 5개 항목: 16.2-4, 16.2-5, 16.4-1, 16.5-2, 16.6-1. 16.4 글 종류 끄기 S4(D3)는 PRD 체크 항목에 직접 대응하지 않아 항목 수에는 넣지 않았다.)

## 사용자 확인 필요 목록

1. 16.2-1, 16.8-2: 30+1명 부하 시험(P5-6). 도구는 있으나 로컬 3명·1분 실행만 통과했다.
2. 16.2-7: 서버를 끈 채 쓰다가 복구 뒤 합쳐지는 흐름 수동 확인(자동화 없음).
3. 16.3-1 (U-10): iPad Safari, 갤럭시탭 Chrome(삼성 키보드, Gboard) 실기기 한글 입력. 16.5-1 키보드 가림도 같이 확인.
4. (해결) 16.4-4: 타이머 5분 전 알림은 서버 시험이 가짜 시계로 확인함(Claude 확인 2026-11-12).
5. 16.7-1, 16.7-3 (U-18): 8.10 금지 목록 독립 화면 검수와 화풍 판단. 근거 문서는 `docs/reviews/P3-11_design_review.md`.
6. 16.8-1, 16.8-4, 16.8-5 (U-19): 맥미니 설정, 배포, 계획 재부팅 복구 시간(P5-7), 하트비트 알람·메일, 백업 제외 확인.
7. 16.8-6: 학교망·LTE 리허설(P6).
8. 별도: AI 품질 평가(`tools/eval`)는 가짜 실행만 했다. 실제 실행은 비용 승인(U-11, 약 3.72 USD)과 모델 승인(U-01)이 있어야 한다. 16장 체크박스에는 직접 대응하지 않는다.
9. 별도: WebKit(iPad Safari 엔진) e2e는 한 번도 돌리지 않았다.

## 확인하지 못한 것

- 이번 작성에서 시험을 다시 돌리지 않았다(미실행). e2e 결과는 `final1~3.txt`, vitest 통과 수는 전달받은 값(647+)을 그대로 썼다.
- 개별 vitest 시험 이름은 파일명·`it(...)` 제목으로만 인용했고 각 단언 내용을 끝까지 읽지는 않았다(특히 16.6-3, 16.2-2의 서버 쪽 시험).


## 갱신 (Claude, 2026-11-12)

- 결함 5개(선생님 링크 새 기기, 끊긴 뒤 재연결, 글 종류 즉시 반영, 만료 경합, 360px 쓰기 머리줄)를 고친 뒤 화면 시험 전체(Chromium)를 3회 연속 돌려 모두 통과: 76 passed, 5 skipped(폭과 무관해 1280에서만 도는 시험의 360 쪽), 각 11.1분. 그래서 '결함 수정 중' 항목은 모두 '충족(자동 시험)'으로 바꿨다. 단, 표의 근거 줄에 적힌 실패 기록은 고치기 전 것이다.
- 같은 때 `npm run check` 통과, vitest 762개 통과, 운영 빌드·첫 화면 예산 검사 통과.
