# P6-webkit · Safari 엔진(WebKit) 화면 시험 (맡은 이: Codex)

사용자 승인(2026-11-13): "사파리엔진 자동시험은 진행해". Playwright WebKit 브라우저 내려받기도 승인됨.

## 목표
- `playwright.config.ts`에 WebKit 프로젝트를 더한다(예: `webkit-1024` iPad 가로 폭에 가까운 크기, 필요하면 `webkit-360`). 기존 chromium 프로젝트는 그대로.
- `.github/workflows/ci.yml` e2e 작업이 chromium과 webkit을 모두 설치·실행하게 한다(`npx playwright install --with-deps chromium webkit`). 맥미니 자원이 빠듯해 넓은 실행은 GitHub CI가 기준이다.
- WebKit에서만 실패하는 시험을 고친다. 시험 쪽 차이(타이밍, 키 입력 흉내, 클립보드 권한 등)면 시험을 고치고, **앱 결함이면 고치지 말고 보고**한다(파일 소유 밖). 기대값을 약하게 하거나 WebKit에서 통째로 건너뛰지 않는다. 브라우저 한계로 정말 불가능한 것만 `test.skip(browserName === 'webkit', '이유')`로 이유를 적어 건너뛰고 보고한다.

## 고칠 수 있는 파일
`playwright.config.ts`, `.github/workflows/ci.yml`(e2e 작업만), `tests/e2e/**`.
그 밖(`apps/**`, `packages/**`, 문서)은 고치지 않는다. 지금 Claude가 `packages/core/src/copy/ko.ts`, `PRD.md`, `docs/**`, 서버·웹 동의 판 코드를 고치는 중이다.

## 실행
- 맥미니에서 돌릴 때는 반드시 `resource-guard`로 감싸고 `--workers=1`. 반환값 75는 자원 대기이니 바로 반복하지 말고 `--wait-seconds 600`.
  `/Users/bodyking/.local/bin/resource-guard run --profile test --wait-seconds 600 -- npx playwright test --project=webkit-1024 --workers=1`
- 내려받기: `npx playwright install webkit`(맥미니).
- git commit·push 금지. 결과는 Claude가 커밋해 GitHub CI로 확인한다.

## 완료 기준·보고
- 바꾼 파일, 돌린 명령과 실제 출력 마지막 20줄, WebKit 통과/실패/건너뜀 수, 찾은 앱 결함(파일·줄·재현), 확인 못 한 것. 한국어로.
