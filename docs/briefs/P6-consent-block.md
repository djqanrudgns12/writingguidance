# P6-consent-block · 동의 판이 지난 학생의 새 글·제출·이어 쓰기 막기 (맡은 이: Claude 서브에이전트)

사용자 결정(2026-11-13): "동의 판이 지난 학생도 막아". (FINAL_REPORT §6-2: 지금은 글 편집·AI만 막고 새 글 만들기·제출·이어 쓰기는 막지 않음.)

## 목표
- 서버: 학생 참가자의 `consentVersion !== POLICY_VERSION`이면 **새 글 만들기, 제출, 이어 쓰기 요청**을 거부한다. 오류는 이미 쓰는 모양과 같게 `AppError('E_INPUT', ..., { consentVersion: 'outdated' })`(새 오류 코드 금지). 교사는 대상 아님. 동의 판 검사는 한 곳의 작은 함수로 모아 재사용한다.
- 웹: 이 거부(`fields.consentVersion === 'outdated'`)를 받으면 지금 있는 재동의 화면 흐름으로 보낸다(편집 막힘과 같은 길). 가능하면 요청 전에 이미 아는 경우(기기가 가진 판이 지난 경우) 미리 재동의로 보낸다.
- 시험: 서버 시험(세 동작 각각 거부·재동의 뒤 허용), 웹 시험(재동의로 이동). 관련 기존 시험: `apps/server/test/reviewFixes5b.test.ts`, `apps/server/test/v0flow.test.ts`, `apps/web/src/app/student/reconsent.test.tsx`.

## 고칠 수 있는 파일
`apps/server/src/**`, `apps/server/test/**`, `apps/web/src/**`(단, `ko.ts`는 `packages`에 있어 범위 밖), 새 시험 파일.
고치지 않는 것: `packages/core/**`(ko.ts·config.ts·errors.ts 포함: 문구가 더 필요하면 보고), `PRD.md`, `docs/**`, `tests/e2e/**`, `playwright.config.ts`, `.github/**`. 다른 에이전트가 동시에 고치는 중이다.

## 규칙
`AGENTS.md` 3절 코드 규칙(strict, `.ts` 확장자 import, enum 금지, 화면 문구는 ko.ts만, 숫자는 config.ts만). git commit 금지.
검사는 바뀐 범위만: `npx vitest run <파일들> --maxWorkers=1`(서버는 `apps/server`, 웹은 `apps/web`에서) 와 `npx tsc -p <패키지> --noEmit`. 무거운 전체 시험·e2e·빌드는 돌리지 않는다.

## 보고
한국어로. 바꾼 파일, 막은 지점(파일:줄), 돌린 명령과 출력 마지막 20줄, 남은 문제.
