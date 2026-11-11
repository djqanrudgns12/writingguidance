# P6-autodeploy · 푸시 자동 배포 (맡는 이: Codex)

> 작업 폴더 `/Users/bodyking/Desktop/Architecture/writeessay`. 먼저 `AGENTS.md`를 읽는다. 참고 구현은 `../rollingthunder/ops/macmini/scripts/auto-deploy.sh`·`deploy-app.sh`·`setup-deploy-key.sh`, `../rollingthunder/ops/macmini/launchd/net.rollinthunder.autodeploy.plist`, 결정 기록 `../rollingthunder/wiki/decisions/푸시-자동-배포.md`(읽기만, 고치지 않음).

## 목표

사용자가 GitHub `djqanrudgns12/writingguidance`의 `main`에 푸시하면, 맥미니의 서비스 계정 `wesvc`가 1분마다 확인해 **GitHub 시험(CI)이 통과한 새 커밋만** 기존 `deploy.sh` 절차(빌드 → 사전 호환 검사 → 마이그레이션 → 링크 교체 → 헬스체크 → 실패 시 자동 되돌림)로 배포한다. 들어오는 연결(웹훅·self-hosted 러너)은 만들지 않는 pull 방식이다.

## 정한 설계 (Claude, ADR-058로 기록 예정)

1. **launchd 데몬 `com.ssamwrite.autodeploy`**(wesvc, `StartInterval 60`, `RunAtLoad`). 실행 파일은 운영 중 릴리스의 `app/ops/scripts/auto-deploy.sh`, 없으면 `bootstrap/scripts/auto-deploy.sh`(watch plist와 같은 방식). 로그 `logs/autodeploy.log`, 매분 바뀌는 "지금 상태" 한 줄은 `state/autodeploy-status`에 덮어쓴다.
2. **저장소 읽기**: 기본은 공개 HTTPS `https://github.com/djqanrudgns12/writingguidance.git`(익명). `$WE_SECRETS/github_deploy_key`가 있으면 SSH `git@github.com:djqanrudgns12/writingguidance.git` + 고정 known_hosts(`$WE_SECRETS/github_known_hosts`, `StrictHostKeyChecking yes`)로 읽는다(저장소를 비공개로 바꿀 때 대비). 값은 `env.sh`의 `WE_REPO_HTTPS`·`WE_REPO_SSH`·`WE_DEPLOY_BRANCH`(기본 main)로.
3. **배포 조건(순서대로, 하나라도 아니면 실패로 세지 않고 "대기" 상태만 남김)**
   - 일시정지 파일 `$WE_HOME/AUTO_DEPLOY_PAUSED` 없음
   - 평일 08:00~16:00 KST 아님(`we_is_school_hours`) — 대기 문구 "수업 시간 — 16:00 뒤 배포"
   - 첫 배포가 끝나 있음(`$WE_APP/.we-commit` 있음). 없으면 "첫 배포 전 — sh ops/we.sh deploy --init"
   - 다른 배포·되돌리기 잠금 없음
   - 활성 실시간 연결 0(`/internal/health`의 `connections`)
   - `git ls-remote`로 본 main SHA ≠ 운영 SHA
   - 새 커밋이 운영 커밋의 **후손**(강제 푸시·되감기는 거부 → 최종 실패 기록 + 알림, 수동 배포 안내)
   - **CI 관문**: `GET https://api.github.com/repos/djqanrudgns12/writingguidance/commits/<sha>/check-runs?check_name=verify`(익명 curl, `--max-time 10`, JSON은 `$NODE_BIN`으로 파싱). `conclusion=success`면 진행, 진행 중·아직 없음이면 대기("시험 기다리는 중"), `failure`·`cancelled`·`timed_out`이면 배포하지 않고 최종 실패 기록 + 알림. 익명 한도(시간당 60회)를 지키려고 같은 SHA 조회는 2분에 한 번만(상태 파일에 시각 기록). `WE_AUTODEPLOY_REQUIRE_CI=0`이면 관문을 끈다(기본 1).
4. **실패 처리**: 같은 커밋이 2번 실패하면 멈춤(`state/autodeploy-failed`: `sha 횟수 이유`) + `we_notify`. 새 커밋 푸시나 `--retry`로 재개. 성공·최종 실패 모두 `we_notify`(제목 `[글방] deploy OK <sha8>` / `[글방] deploy FAILED <sha8>`), 본문에 커밋 목록(최대 20줄)·바뀐 `apps/server/migrations` 파일.
5. **deploy.sh 변경**
   - 새 원본 방식 `--git <40자 SHA>`: 번들 대신 `$WE_HOME/repo-cache`(이미 쓰는 bare 저장소)에서 그 커밋을 꺼낸다. 자동 배포가 먼저 `git fetch`로 받아 둔다. 번들 방식은 그대로 둔다.
   - "지금은 안 됨" 조건(수업 시간 금지창, 활성 연결, 잠금)은 종료 코드 **75**로 바꾼다(지금은 1). 사람이 부를 때 보이는 문구는 그대로.
   - 성공 시 릴리스 폴더에 `.we-commit`(40자 SHA)을 남긴다. 번들 배포도 같다.
   - 마지막 실패 원인을 `ERROR: ` 한 줄로 남기는 지금 방식 유지(자동 배포가 로그에서 그 줄을 읽음).
6. **rollback.sh**: 사람이 되돌리면 `AUTO_DEPLOY_PAUSED`를 만들고 "자동 배포를 멈췄습니다. 고친 커밋을 푸시한 뒤 `sh ops/we.sh autodeploy resume`" 안내를 찍는다(되돌린 커밋을 곧바로 다시 올리지 않게). deploy.sh가 헬스체크 실패로 스스로 되돌릴 때는 만들지 않는다(실패 횟수로 멈춤).
7. **명령** (`ops/we.sh`)
   - `autodeploy status|dry-run|retry|pause|resume|run` → wesvc로 `auto-deploy.sh --status` 등. `pause`/`resume`은 일시정지 파일만 만들고 지움.
   - `setup-deploy-key` → wesvc로 `setup-deploy-key.sh`: ed25519 키 생성(있으면 그대로), GitHub 공식 호스트 키를 known_hosts에 쓰고 지문을 공식 값(`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`)과 대조, 공개 키와 등록 명령(`gh repo deploy-key add <파일> -R djqanrudgns12/writingguidance -t macmini-wesvc`, 읽기 전용) 안내만 출력. 비밀 키는 출력하지 않는다.
   - `we.sh deploy`가 bootstrap에 복사하는 스크립트 목록에 `auto-deploy.sh`·`setup-deploy-key.sh`를 더한다.
   - `install-daemons`에 `autodeploy` 항목 추가(선행 조건: `$we_home/app/.we-commit` 있음). `status.sh`에 자동 배포 상태 한 줄.
8. **로그 정리**: `logs/autodeploy-run-<sha>.log`는 최근 20개만.

## 맡는 파일 (이 밖은 고치지 않음)

- 새로: `ops/scripts/auto-deploy.sh`, `ops/scripts/setup-deploy-key.sh`, `ops/launchd/com.ssamwrite.autodeploy.plist`, `tests/ops/autodeploy.test.mjs`
- 고침: `ops/scripts/deploy.sh`, `ops/scripts/rollback.sh`, `ops/scripts/env.sh`, `ops/scripts/install-daemons.sh`, `ops/scripts/status.sh`, `ops/we.sh`
- Claude가 동시에 고치는 중(건드리지 않음): `docs/**`, `.github/**`, `PRD.md`, `AGENTS.md`, `apps/**`, `packages/**`, `package.json`

## 시험

`tests/ops/autodeploy.test.mjs`(`node --test`, 의존성 추가 없음): 임시 폴더에 `WE_HOME`·로컬 bare 저장소(원격 대신)·가짜 배포 명령(`WE_AUTODEPLOY_DEPLOY_CMD` 같은 시험용 환경 변수로 deploy.sh 대신)·가짜 CI 응답(`WE_AUTODEPLOY_CI_CMD` 등)을 두고 다음을 확인한다.
- 같은 SHA면 아무것도 안 함 / 새 후손 커밋 + CI 성공이면 배포 1회
- 수업 시간(`WE_TEST_KST_DOW_HOUR=4:10`)·일시정지·활성 연결·CI 진행 중이면 대기(실패 기록 없음)
- CI 실패·강제 푸시면 배포 없이 최종 실패 기록
- 배포 실패 1회 → 다음 회차 재시도, 2회 → 멈춤, `--retry`로 재개
- 배포 명령이 75를 돌려주면 실패로 세지 않음
- `WE_SERVICE_USER` 검사 때문에 시험이 막히면 시험용 우회는 환경 변수 하나로만, 운영 기본값은 그대로.

`env.sh`가 `id -un` = wesvc를 요구하는 곳은 시험에서만 풀리게 한다(운영 동작 불변). 셸 전부 `sh -n`, plist `plutil -lint`.

## 하지 않는 것

sudo, `launchctl`, 실제 배포, 비밀값 읽기·쓰기, GitHub에 실제 요청(시험은 가짜로), git commit·push, 새 의존성, 맥미니 서비스 끄기·재시작.

## 완료 보고

바꾼 파일 목록, `node --test tests/ops/autodeploy.test.mjs`와 `sh -n`·`plutil -lint` 실제 출력 마지막 20줄, 남은 문제, 사용자가 맥미니에서 해야 할 명령 순서(첫 배포 → 데몬 등록 → 자동 배포 켜기) 초안.
