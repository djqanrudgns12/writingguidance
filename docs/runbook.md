# 쌤유 글방 운영 안내서 (Runbook)

> 대상 환경: 맥미니(Apple Silicon, macOS) 자체 호스팅 · 서비스 계정 `wesvc` · 로컬 서버 `127.0.0.1:4460` · 전용 터널 메트릭 `127.0.0.1:20242` · 공개 주소 `https://write.ssamuniverse.com` (CloudFront 서울 `E3TFCRGRU1HG1Q` → Cloudflare Tunnel `origin-write.ssamuniverse.com`)

## 시작 전 안전 수칙

- **수업 시간 금지창 준수**: 평일(월~금) **08:00~16:00 KST**에는 배포(`deploy`), 패키지 업그레이드(`brew upgrade`), macOS 업데이트, 재부팅을 하지 않는다.
- **소유자 계정 실행**: 아래 명령은 모두 맥미니 소유자 계정(`bodyking`)에서 저장소 루트(`/Users/bodyking/Desktop/Architecture/writeessay`)를 기준으로 실행한다. `sh ops/we.sh ...`는 관리자 권한이 필요한 하위 명령(`setup-host`, `install-daemons`)에서만 내부적으로 `sudo`를 부르므로 앞머리에 `sudo`를 붙이지 않는다.
- **비밀값 노출 금지**: API 키, 선생님 시작 코드, 원본 잠금 비밀값은 채팅창·이슈·커밋·스크린샷에 절대 붙여넣지 않는다.
- **이웃 서비스 보호**: 같은 맥미니에서 도는 쌤유니버스(`clsvc`, 포트 `4390`, 배포 `E1VKUXOJAO8KBE`)와 rollingthunder(`rtsvc`, 포트 `3000`·`8000`·터널 `20241`, 배포 `E3DFFMH3173961`)는 끄거나 건드리지 않는다.

---

## 1부 · 맥미니 초기 설정과 첫 배포 안내 (U-19)

### 1단계 · 저장소와 배포 방식 확인 (U-13 해결: GitHub + 푸시 자동 배포, 약 5분)

원격은 GitHub `djqanrudgns12/writingguidance`, 운영 브랜치는 `main`이다(ADR-058). **첫 배포만** 소유자 작업 저장소의 커밋을 `git bundle`로 넘기고(4단계), 그 뒤로는 맥미니가 1분마다 GitHub `main`을 보고 GitHub 시험(`verify`)이 통과한 커밋을 스스로 배포한다(4-1단계).

```bash
cd /Users/bodyking/Desktop/Architecture/writeessay
git status --short
git fetch origin && git status -sb | head -1
```

- **확인**: 첫 명령은 아무것도 출력하지 않고(미커밋 변경 없음), 둘째 줄이 `## main...origin/main`으로 끝난다(앞서거나 뒤처짐 없음). GitHub 저장소 Actions 탭에서 최신 커밋의 `verify`가 초록이어야 한다.
- **막히면**: 미커밋 변경이 있으면 커밋·푸시한 뒤 다시 확인한다. 저장소를 비공개로 바꿨다면 4-1단계의 배포 키 등록이 필요하다.

---

### 2단계 · 맥미니 서버 계정·폴더·백업 제외 준비 (`setup-host`, 약 10분)

비관리자 숨김 서비스 계정 `wesvc`, sudo 위임 규칙(`/etc/sudoers.d/writeessay`), 서버 루트 `/Users/wesvc/writeessay-server/`(권한 `700`), Time Machine 백업 제외(PRD F-24 무백업 원칙), 일일 로그 회전(`/etc/newsyslog.d/writeessay.conf`, 날마다 회전·7개 보관)을 준비한다.

```bash
sh ops/we.sh setup-host
```

- **확인**:
  ```bash
  tmutil isexcluded /Users/wesvc/writeessay-server
  ls -l /etc/sudoers.d/writeessay /etc/newsyslog.d/writeessay.conf
  ```
  첫 명령에 `[Excluded]      /Users/wesvc/writeessay-server`가 출력되고, 두 설정 파일이 존재해야 한다.
- **막히면 / 되돌리기**:
  - `visudo -cf` 검증이 실패하면 임시 파일만 삭제되고 기존 sudo 설정은 바뀌지 않는다.
  - 아직 운영 데이터가 없는 초기 상태에서 2단계를 통째로 되돌리려면 아래 명령만 순서대로 실행한다(`clsvc`·`rtsvc` 경로는 절대 건드리지 않는다):
    ```bash
    sudo rm -f /etc/sudoers.d/writeessay /etc/newsyslog.d/writeessay.conf
    sudo tmutil removeexclusion -p /Users/wesvc/writeessay-server
    sudo rm -rf /Users/wesvc/writeessay-server
    sudo dscl . -delete /Users/wesvc
    ```

---

### 3단계 · 운영 비밀값과 개발용 API 키 입력 (`init-secrets` · `save-secret`, 약 10분)

1. Anthropic 콘솔에서 **월 지출 한도를 20달러**로 설정하고 API 키를 **2개** 만든다(운영 서버 전용 1개 + 개발·모델 평가 P4-20 전용 1개).
2. 아래 명령으로 내부 무작위 대칭키 4종(`PIN_HMAC_KEY`, `PIN_ENC_KEY`, `ID_HMAC_KEY`, `PERSONAL_HMAC_KEY`)을 생성하고, 운영용 `ANTHROPIC_API_KEY`와 선생님 시작 코드 `TEACHER_START_CODE`(정확히 숫자 8자리)를 화면 노출 없이 `/Users/wesvc/writeessay-server/secrets/app.env`(권한 `600`)에 저장한다.
3. 개발·평가용 키는 소유자 작업 폴더의 `.local/dev.env`(권한 `600`, git 제외)에 별도로 넣는다.

```bash
# 1) 내부 무작위 대칭키 4종 자동 생성 (이미 있는 키는 덮어쓰지 않음)
sh ops/we.sh init-secrets --no-prompt

# 2) 운영 서버용 Anthropic API 키 숨김 입력 (타이핑·붙여넣기 내용이 화면에 표시되지 않음)
sh ops/we.sh save-secret llm-api-key

# 3) 선생님 시작 코드(숫자 8자리) 숨김 입력
sh ops/we.sh save-secret teacher-start-code

# 4) 개발·평가용 API 키 파일 준비 (.local/dev.env, 권한 600)
mkdir -p .local
(umask 077; [ -f .local/dev.env ] || printf 'ANTHROPIC_API_KEY=\n' > .local/dev.env)
chmod 600 .local/dev.env
# 이어서 로컬 편집기로 .local/dev.env의 ANTHROPIC_API_KEY= 뒤에 개발용 키를 넣어 저장한다.
```

- **확인**:
  ```bash
  sh ops/we.sh init-secrets --no-prompt
  ls -l .local/dev.env
  ```
  `현재 등록된 키 이름:` 줄에 `PIN_HMAC_KEY PIN_ENC_KEY ID_HMAC_KEY PERSONAL_HMAC_KEY ANTHROPIC_API_KEY TEACHER_START_CODE` 여섯 이름이 모두 찍히고(`아직 입력이 필요한 키 이름` 안내가 없어야 함), `.local/dev.env` 권한이 `-rw-------`이며 비밀값 원문은 한 글자도 출력되지 않아야 한다.
- **막히면 / 되돌리기**:
  - 키나 시작 코드를 잘못 입력했으면 `sh ops/we.sh save-secret llm-api-key` 또는 `sh ops/we.sh save-secret teacher-start-code`를 다시 실행해 해당 값만 덮어쓴다(`PIN_HMAC_KEY`·`PIN_ENC_KEY`는 유지된다).

---

### 4단계 · 첫 배포와 앱 서버 데몬 기동 (`deploy --init` · `install-daemons server`, 약 15분)

평일 08:00~16:00 KST 밖에서 로컬 커밋을 `git bundle`로 묶어 첫 릴리스(`releases/<sha>`)를 빌드하고(`--init`은 운영 SQLite 파일이 아직 없을 때 최초 1회 생성을 허용하는 플래그), `com.ssamwrite.server` 데몬(`127.0.0.1:4460`, `ProcessType Interactive`)을 등록한다.

```bash
# 1) 첫 릴리스 빌드 · 스키마 사전 검사 · 운영 DB 최초 생성(--init은 첫 배포 1회만 사용)
sh ops/we.sh deploy --init

# 2) 앱 서버 launchd 시스템 데몬 등록 및 기동
sh ops/we.sh install-daemons server
```

- **확인**:
  ```bash
  sh ops/we.sh healthcheck --local-only
  ```
  아래 두 줄이 모두 `[OK]`로 나와야 한다:
  - `[OK]   ① 로컬 /internal/health (release=releases/..., schema=..., conn=0)`
  - `[OK]   로컬 웹소켓 업그레이드 (ws://127.0.0.1:4460/ws -> HTTP 101)`
- **막히면 / 되돌리기**:
  - 종료 코드 `75`가 나오면 `resource-guard`가 다른 고부하 작업이 끝나기를 기다리는 상태이므로 잠시 뒤 다시 실행한다.
  - 실패 원인 로그 확인:
    ```bash
    sh ops/we.sh logs deploy
    sh ops/we.sh logs build
    sh ops/we.sh logs server
    ```
  - 앱 서버 데몬을 내려 되돌리려면:
    ```bash
    sh ops/we.sh install-daemons --remove server
    ```

---

### 4-1단계 · 푸시 자동 배포 켜기 (`install-daemons autodeploy`, 약 5분)

`com.ssamwrite.autodeploy`(wesvc, 1분 주기)를 등록한다. 매 회차는 아래 순서로 보고 하나라도 아니면 **기다리기만** 한다(실패로 세지 않음): 일시정지 파일 없음 → 평일 08:00~16:00 KST 아님 → 첫 배포 끝남 → 다른 배포 없음 → 실시간 연결 0 → GitHub `main`이 운영 커밋과 다르고 그 후손임 → GitHub 시험 `verify` 성공. 통과하면 `deploy.sh --git <sha>`가 4단계와 같은 6단계 배포를 한다. 4단계의 `we.sh deploy`가 서비스 계정용 `resource-guard` 사본을 `/Users/wesvc/writeessay-server/bin/`에 넣어 두며, 자동 배포 빌드도 그 사본으로 메모리 여유를 확인한다(사본이 없으면 빌드를 미루고 기다린다).

```bash
# 1) 등록 전에 일시정지해 두고, 무엇을 할지 먼저 본다
sh ops/we.sh autodeploy pause
sh ops/we.sh install-daemons autodeploy
sh ops/we.sh autodeploy dry-run

# 2) 이상 없으면 켠다
sh ops/we.sh autodeploy resume
sh ops/we.sh autodeploy status
```

- **확인**: `dry-run`이 `최신 상태(...) — 배포할 것 없음`(첫 배포 커밋 = GitHub main) 또는 배포 예정 커밋 목록을 보여 주고, `status`의 `운영 SHA`가 4단계에서 배포한 커밋이다. 이후 `logs/autodeploy.log`와 `state/autodeploy-status`(`sh ops/we.sh autodeploy status`)로 상태를 본다.
- **저장소를 비공개로 바꿀 때**: 익명 읽기가 막히므로 읽기 전용 배포 키를 만든다. 비밀 키는 화면에 나오지 않고, 공개 키와 등록 명령만 나온다.
  ```bash
  sh ops/we.sh setup-deploy-key
  # 출력된 공개 키 파일로(읽기 전용, 쓰기 권한 없음):
  gh repo deploy-key add <공개키파일> -R djqanrudgns12/writingguidance -t macmini-wesvc
  ```
  비공개 저장소에서는 GitHub 시험 결과 조회도 익명으로 안 되므로, 그때는 `WE_AUTODEPLOY_REQUIRE_CI` 처리 방식을 다시 정한다(ADR-058).
- **되돌리기**: `sh ops/we.sh install-daemons --remove autodeploy`(수동 `we.sh deploy`는 그대로 쓸 수 있다).

---

### 5단계 · 전용 Cloudflare 터널 생성과 기동 (`tunnel-create` · `install-daemons tunnel`, 약 10분)

소유자 격리 보관소(`~/.writeessay-admin/cloudflared`)를 사용해 Cloudflare에 로그인하고, 전용 터널 `writeessay`와 원본 호스트 `origin-write.ssamuniverse.com` DNS CNAME을 만든 뒤 자격 증명과 `config.yml`(`^/internal/` 404 차단 포함)을 `wesvc`에 넘겨 터널 데몬(`127.0.0.1:20242`)을 띄운다.

```bash
# 1) 브라우저가 열리면 Cloudflare에서 ssamuniverse.com 존을 골라 Authorize 클릭
sh ops/we.sh tunnel-create

# 2) 전용 터널 launchd 시스템 데몬 등록 및 기동
sh ops/we.sh install-daemons tunnel
```

- **확인**:
  ```bash
  curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:20242/ready
  curl -fsS -o /dev/null -w '%{http_code}\n' https://origin-write.ssamuniverse.com/api/health
  curl -sS -o /dev/null -w '%{http_code}\n' https://origin-write.ssamuniverse.com/internal/health
  ```
  순서대로 `200`(로컬 터널 준비 완료), `200`(7단계 잠금 전 원본 응답), `404`(`cloudflared`가 `/internal/*` 외부 접근을 차단)가 출력되어야 한다(처음 DNS 전파에 1~2분 걸릴 수 있음).
- **막히면 / 되돌리기**:
  - 터널 로그 확인: `sh ops/we.sh logs tunnel`
  - 외부 연결만 즉시 차단: `sh ops/we.sh public off` (다시 열기: `sh ops/we.sh public on`)
  - 터널 데몬 제거: `sh ops/we.sh install-daemons --remove tunnel`

---

### 6단계 · CloudFront 앞단 나머지 설정과 공개 DNS 연결 (`origin-secret` · `aws/setup-ops.sh`, 약 20분)

세 번째 무료 요금제 배포 `E3TFCRGRU1HG1Q`(`d2gtrsnqpjb6in.cloudfront.net`), us-east-1 ACM 인증서(`c7d36515-8ea8-42c4-a2af-673387eaef14`), 대체 도메인 `write.ssamuniverse.com`, 기본 캐시 동작(`CachingDisabled` + `AllViewerExceptHostHeader`)은 이미 만들어져 있다(`docs/PLAN.md` §15.6-1). 여기서는 남은 CloudFront·WAF 항목과 감시 자원을 CLI로 반영하고 공개 CNAME을 연다.

```bash
# 1) 64자 원본 잠금 비밀값 생성 및 클립보드 복사 (화면에 값 미출력)
sh ops/we.sh origin-secret

# 2) AWS 로그인 후 --dry-run(기본값)으로 변경 예정 내역 먼저 검증
aws login --profile we
sh ops/aws/setup-ops.sh <알림받을_이메일> E3TFCRGRU1HG1Q --dry-run

# 3) 출력 내역을 확인한 뒤 --apply로 실제 반영
#    (we-viewer-request 함수, x-we-origin-auth 머리, HTTP/2+3, IPv6, /assets/* · /art/* 캐시,
#     WAF CommonRuleSet 4개 예외 + IP당 5분 20,000건 한도, SNS·IAM·CloudWatch 알람 일괄 구성)
sh ops/aws/setup-ops.sh <알림받을_이메일> E3TFCRGRU1HG1Q --apply
```

이어서 **Cloudflare 대시보드 → `ssamuniverse.com` → DNS → Records**에서 공개 주소 레코드를 추가한다:

- Type: `CNAME`
- Name: `write`
- Target: `d2gtrsnqpjb6in.cloudfront.net`
- Proxy status: **DNS only (회색 구름, 프록시 끔)** — 주황 구름을 켜면 서울 CloudFront 거점을 거치지 않으므로 반드시 회색 구름으로 둔다.

- **확인**:
  ```bash
  aws cloudfront get-distribution --profile we --id E3TFCRGRU1HG1Q --query 'Distribution.Status' --output text
  curl -fsSI https://write.ssamuniverse.com/api/health | grep -iE '^(HTTP/|x-amz-cf-pop:)'
  ```
  배포 상태가 `Deployed`가 되고, 두 번째 명령에서 `HTTP/2 200`과 `x-amz-cf-pop: ICN...`(서울 거점)이 보여야 한다.
- **막히면 / 되돌리기**:
  - Free 요금제 제약 등으로 특정 단계가 거절되면 즉시 멈추고 오류 메시지를 확인한다(다른 서비스 배포 `E1VKUXOJAO8KBE`·`E3DFFMH3173961`은 절대 수정하지 않는다). 콘솔에서 수동으로 맞춘 항목은 `--skip-cloudfront` 또는 `--skip-waf` 옵션으로 건너뛸 수 있다.
  - 외부 공개를 잠시 미루려면 Cloudflare DNS에서 `write` CNAME 레코드만 삭제하면 된다.

---

### 7단계 · 뒷문 잠그기 (Cloudflare WAF 원본 잠금 · 캐시 우회 · 설정 점검, 약 10분)

CloudFront를 거치지 않고 `origin-write.ssamuniverse.com`으로 직접 들어오는 요청을 차단해 CloudFront WAF·속도 제한 우회를 막는다.

```bash
# 64자 원본 잠금 비밀값을 다시 클립보드에 복사
sh ops/we.sh origin-secret
```

**Cloudflare 대시보드 → `ssamuniverse.com`**에서 아래 네 항목을 적용·확인한다:

1. **Security → WAF → Custom rules → Create rule**
   - Rule name: `we-origin-lock`
   - `Edit expression`을 눌러 아래 식을 넣고 `<클립보드_붙여넣기>` 자리에 방금 복사한 64자 값을 붙여넣는다:
     ```text
     (http.host eq "origin-write.ssamuniverse.com" and not any(http.request.headers["x-we-origin-auth"][*] eq "<클립보드_붙여넣기>"))
     ```
   - Action: **Block** → **Deploy**
2. **Caching → Cache Rules → Create rule**
   - Rule name: `we-origin-no-cache`
   - 조건: Hostname equals `origin-write.ssamuniverse.com`
   - 동작: **Bypass cache** → **Deploy**
3. **Network**: `WebSockets`가 **On**인지 확인한다.
4. **Security → Bots / SSL/TLS / DNS**: `Bot Fight Mode` **Off**, 최소 TLS **1.2**, `Always Use HTTPS` **On**, `DNSSEC` 활성 상태를 확인한다.

- **확인**:
  ```bash
  sh ops/we.sh healthcheck
  ```
  아래 네 줄이 **모두 `[OK]`**로 찍혀야 한다:
  - `[OK]   ① 로컬 /internal/health ...`
  - `[OK]   ② 공개 /api/health (HTTP 200, pop=ICN...)`
  - `[OK]   ③ 공개 웹소켓 업그레이드 (wss://write.ssamuniverse.com/ws -> HTTP 101)`
  - `[OK]   ④ 원본 직접 접근 차단 (https://origin-write.ssamuniverse.com/api/health -> HTTP 403)`
- **막히면 / 되돌리기**:
  - `④`가 `200`이면 `we-origin-lock` 규칙의 호스트 이름이나 표현식 배포 상태를 확인한다.
  - `②`와 `④`가 둘 다 `403`이면 CloudFront 원본 머리(`x-we-origin-auth`)와 Cloudflare WAF 식에 들어간 비밀값이 서로 어긋난 것이다. `sh ops/we.sh origin-secret`으로 클립보드에 다시 복사해 WAF 식의 값을 고치고, 필요 시 `sh ops/aws/setup-ops.sh <알림받을_이메일> E3TFCRGRU1HG1Q --apply --skip-waf`로 CloudFront 머리 값을 다시 맞춘다. 긴급히 잠금만 풀어야 하면 Cloudflare WAF에서 `we-origin-lock` 규칙 스위치만 잠시 끈다.

---

### 8단계 · 감시 알람 확인과 5분 하트비트 데몬 등록 (`install-daemons watch`, 약 15분)

6단계의 `setup-ops.sh --apply`가 발송한 SNS 구독 확인 메일을 승인하고, 5분마다 ①~④가 모두 통과할 때만 `Writeessay/EndToEndOK=1` 지표를 올리는 `com.ssamwrite.watch` 데몬을 등록한 뒤 관리용 AWS 로그인 세션을 닫는다.

```bash
# 1) 메일함에서 'AWS Notification - Subscription Confirmation' 메일의 Confirm subscription 링크 클릭

# 2) 하트비트 1회 수동 실행(오류 없이 끝나야 함)
sh ops/we.sh heartbeat

# 3) 5분 주기 하트비트 launchd 시스템 데몬 등록
sh ops/we.sh install-daemons watch

# 4) CloudWatch 알람 2개 상태 확인 후 관리용 AWS 로그아웃
aws cloudwatch describe-alarms --profile we --region us-east-1 \
  --alarm-names we-heartbeat-missing we-cloudfront-5xx \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
aws logout --profile we
```

- **확인**:
  ```bash
  sh ops/we.sh status
  ```
  모든 경로 점검이 `[OK]`이고, 맨 아래 `CloudWatch 자격 : 있음`, `SNS 알림 주제 : 있음`이 표시되며 5~10분 뒤 `we-heartbeat-missing` 상태가 `OK`가 되어야 한다.
- **막히면 / 되돌리기**:
  - 하트비트 로그 확인: `sh ops/we.sh logs watch`
  - 점검 중 경보 발송을 멈추고 하트비트 데몬만 내리려면:
    ```bash
    sh ops/we.sh install-daemons --remove watch
    ```

---

### 9단계 · 출시 전 운영 관문 (주말·밤 수업 시간 밖, 약 2시간)

평일 08:00~16:00 KST 밖(주말·밤)에 계획 재부팅 복구 시간 측정(P5-7), 21+1명·30+1명 부하 시험(P5-6, 한가할 때 및 아바타 빌드 중), 학교망·LTE 리허설(P6)을 차례로 통과한다.

```bash
# 1) 재부팅 전 현재 상태와 다른 작업 유무 확인 (진행 중인 빌드·수업이 없을 때만 실행)
sh ops/we.sh status

# 2) rollingthunder 공통 계획 재부팅 스크립트로 재부팅 시작 후 복구 시각 측정
sudo sh /Users/bodyking/Desktop/Architecture/rollingthunder/ops/macmini/scripts/planned-restart.sh

# 3) 맥 앞에서 FileVault 잠금 해제 직후(데스크톱 로그인 없이) 자동 복구 여부 확인
sh ops/we.sh status
```

- **확인**: FileVault 해제 뒤 수동 명령 없이 `com.ssamwrite.server`·`com.ssamwrite.tunnel`·`com.ssamwrite.watch`가 자동 기동되어 `sh ops/we.sh status`의 ①~④가 모두 `[OK]`로 돌아오고, 부하 시험 및 학교망·LTE 연결 점검 기준(`docs/PLAN.md` §10.6, §10.8)을 통과한다.
- **막히면 / 되돌리기**:
  - 재부팅 후 외부 접속이 안 되면 맥미니 화면이 FileVault 암호 입력 대기 상태인지 먼저 확인한다(U-20).
  - FileVault 해제 뒤에도 글방만 응답하지 않으면 `sh ops/we.sh status`, `sh ops/we.sh logs server`, `sh ops/we.sh logs tunnel`로 멈춘 지점을 확인하고, 새 릴리스 문제라면 `sh ops/we.sh rollback`으로 직전 릴리스로 복귀한다.

---

## 2부 · 수업 중 사고 대응과 되돌리기

> **수업 중 30초 응급 원칙 (휴대폰 빠른 확인)**
> 1. **학생 안심 먼저**: 서버나 인터넷이 끊겨도 이미 열려 있는 학생 태블릿에서는 글자마다 기기(IndexedDB)에 자동 저장된다(`여기에만 저장` 노랑 배지). **창을 닫거나 새로고침하지 말고 그대로 계속 쓰게** 안내한다.
> 2. **원인 1줄 진단**: 맥미니 터미널(`/Users/bodyking/Desktop/Architecture/writeessay`)에서 `sh ops/we.sh status` 한 줄로 **① 맥 안 서버(4460) → 전용 터널(20242) → ②③ 공개 경로(CloudFront·wss) → ④ 원본 잠금(403)** 중 어디가 끊겼는지 먼저 본다.
> 3. **가장 빠른 복구**: 직전 배포 뒤 생긴 문제면 `sh ops/we.sh rollback`(수업 시간에도 실행 가능), 공격 의심이면 `sh ops/we.sh public off`, 끝내 수업 안에 복구가 안 되면 학생들에게 **`··· > 텍스트 파일로 저장` 또는 `글 복사`**로 기기에 갈무리하게 한다.

---

### 2.1 평소 배포 (수업 시간 밖 전용 · 평일 08:00~16:00 KST 금지)

**평소에는 푸시가 곧 배포다(ADR-058).** `main`에 푸시하면 GitHub 시험 `verify`(설치·운영 빌드·`npm run check`·단위 시험·운영 규칙 시험)가 돌고, 통과하면 맥미니가 다음 1분 회차에 배포한다. 수업 시간에 푸시하면 16:00 뒤, 수업방에 연결이 남아 있으면 연결이 끝난 뒤 배포한다. 결과는 SNS 메일(`[글방] deploy OK/FAILED <sha>`)과 `sh ops/we.sh autodeploy status`로 본다.

| 상황 | 자동 배포가 하는 일 | 사람이 할 일 |
|---|---|---|
| `verify` 실패·취소 | 그 커밋은 배포하지 않고 알림 | 고친 커밋을 푸시 |
| 배포 실패 1회 | 다음 회차에 한 번 더 | 없음 |
| 같은 커밋 2회 실패 | 멈추고 알림(운영은 이전 판 유지) | 고친 커밋 푸시 또는 `sh ops/we.sh autodeploy retry` |
| 강제 푸시·되감기(운영 커밋의 후손 아님) | 거부하고 알림 | 의도한 것이면 아래 수동 배포 |
| 사람이 `rollback` 실행 | 자동으로 일시정지 | 고친 커밋 푸시 뒤 `sh ops/we.sh autodeploy resume` |
| 잠깐 멈추고 싶을 때 | — | `sh ops/we.sh autodeploy pause` / `resume` |

아래 수동 배포(`we.sh deploy`)는 첫 배포, 비상, 강제 푸시 뒤에만 쓴다.

평일(월~금) **08:00~16:00 KST**(08:00~15:59)에는 배포할 수 없다. `ops/we.sh`와 `ops/scripts/deploy.sh`가 모두 한국 시각을 확인해 강제 우회 옵션 없이 거부하며, 실시간 웹소켓 연결(`connections > 0`)이 1개라도 남아 있어도 배포를 멈춘다.

#### 1) 배포 전 사전 검사

소유자 계정(`bodyking`)에서 로컬 정적·단위 검사를 통과하고, 운영 서버에 열린 실시간 연결이 `0`개인지 확인한다(교사 본인의 대시보드 탭이 열려 있어도 연결로 잡히므로 닫는다).

```bash
cd /Users/bodyking/Desktop/Architecture/writeessay

# 1) 배포할 로컬 커밋 해시 확인 (미커밋 변경은 git bundle에 포함되지 않음)
git rev-parse --short HEAD

# 2) 코드 정적 검사 및 시험 실행
npm run check
/Users/bodyking/.local/bin/resource-guard run --profile test -- npm run test -- --maxWorkers=1

# 3) 운영 서버 현재 상태 및 활성 연결 수(conn=0) 확인
sh ops/we.sh status
```

- **확인**: `sh ops/we.sh status`에서 `현재 시간대 : 허용 시간`이고, `① 로컬 /internal/health`의 `conn=0`이며 ①~④가 모두 `[OK]`여야 한다.

#### 2) 배포 실행 (`we.sh deploy`)

평소 배포에는 `--init`을 붙이지 않는다(`--init`은 첫 배포 1회 전용이며, 평소에는 운영 DB 파일이 실수로 없을 때 빈 DB를 새로 만들지 않고 즉시 멈추도록 보호한다). 인자를 생략하면 `HEAD`를 배포하며, 브랜치·태그 이름 또는 커밋 해시(짧은 SHA도 유일하게 해석되면 허용)를 직접 넘길 수 있다. 커밋 해시에는 번들 생성용 임시 참조(`refs/we-deploy/*`)를 만들고 정상 종료·실패·중단 시 회수한다. 소유자 작업 브랜치와 `HEAD`는 바꾸지 않는다.

```bash
sh ops/we.sh deploy
# 특정 커밋을 지정할 때: sh ops/we.sh deploy <커밋_SHA>
```

`we.sh deploy`는 내부에서 `resource-guard run --profile build`로 감싸 아래 6단계를 순서대로 수행한다:

1. **`1/6` 번들 추출**: 로컬 커밋을 `git bundle`로 묶어 `/Users/wesvc/writeessay-server/releases/<12자sha>`에 푼다.
2. **`2/6` 의존성·빌드**: `.npmrc`의 `min-release-age=7` 이상 설정을 확인한 뒤 `npm ci`와 `npm run build`를 실행한다.
3. **`3/6` 사전 호환 검사**: 운영 DB를 읽기 전용으로 대조해 기존 마이그레이션 변조·누락과 파괴적 SQL(`DROP`·`RENAME`·`TRUNCATE`)을 차단하고, 빈 임시 SQLite에 `이전 스키마 → 새 스키마`를 입힌 뒤 **새 릴리스와 직전 릴리스가 모두 정상 기동·응답·종료(`SIGTERM`)하는지** 검증한다.
4. **`4/6` 운영 DB 마이그레이션**: `data/geulbang.sqlite`에 `PRAGMA quick_check`를 돌리고 대기 중인 마이그레이션을 파일당 트랜잭션으로 적용한다.
5. **`5/6` 링크 전환·재시작**: 직전 릴리스 경로를 `state/previous-release`에 기록하고 `app` 심볼릭 링크를 교체한 뒤 운영 서버(`4460`)에 `SIGTERM`을 보낸다. 서버는 최대 25초(`ExitTimeOut 30`) 안에 열린 문서 저장과 WAL 체크포인트를 마치고 내려가며, `launchd`가 5초 뒤 새 릴리스를 띄운다(약 10~20초 끊김, 기기는 자동 재연결).
6. **`6/6` 상태 확인·정리**: 최대 60초(2초 간격 30회) 동안 새 릴리스 식별자(`--expect-release releases/<sha>`) 일치까지 포함해 `healthcheck`를 기다린다. 통과하면 현재·직전 릴리스를 보호하면서 최근 5개(`WE_RELEASES_KEEP=5`)만 남기고 정리한 뒤 `[Writeessay] deploy OK <sha>` 알림 메일을 보낸다.

#### 3) 배포 후 확인

```bash
sh ops/we.sh status
```

- **확인**: `현재 릴리스`가 새 `releases/<12자sha>`로 바뀌었고, 전용 터널(`HTTP 200`)과 `healthcheck` ①~④가 모두 `[OK]`여야 한다.

#### 4) 실패 시 자동 되돌림 여부

| 멈춘 단계 | 운영 서버 · DB 변화 | 자동 되돌림 여부 및 후속 조치 |
|---|---|---|
| 금지창 · 연결 남음 · 잠금 경합(`exit 75`) | 변화 없음 | 배포 시작 전 거부. 수업 종료 또는 다른 작업 종료 뒤 재실행한다 |
| `1/6`~`3/6` (번들 · 빌드 · 사전 호환 검사) | 변화 없음 (기존 서버 무중단 유지) | **자동 되돌림 불필요** — 아무것도 바뀌지 않고 멈춘다. `sh ops/we.sh logs build`, `sh ops/we.sh logs deploy`로 원인을 확인한다 |
| `4/6` (운영 DB 마이그레이션 실패) | 실패한 파일 트랜잭션 롤백, `app` 링크 유지 | `app` 링크를 바꾸지 않고 중단한다. `sh ops/we.sh logs deploy` 확인 |
| `6/6` (재시작 뒤 60초 내 `healthcheck` 실패) | **4단계 마이그레이션은 적용된 상태**, 앱 링크만 복귀 | **자동 되돌림 실행**: `rollback.sh --from-deploy`를 자동 호출해 직전 릴리스로 `app` 링크를 복구하고 서버를 재시작한 뒤 `[Writeessay] deploy FAILED <sha> (rolled back)` 메일을 보낸다 |

**순서와 한계**: 운영 DB 마이그레이션(`4/6`) → 링크 전환·재시작(`5/6`) → 상태 확인(`6/6`) 순서다. 상태 확인 실패로 앱이 돌아가도 **성공한 마이그레이션과 그 뒤의 DB 기록은 그대로 남는다**. 파일별 트랜잭션이므로 뒤 파일이 실패해도 먼저 성공한 파일까지 취소되지 않는다. `3/6`에서 더하기 전용 SQL과 **새 스키마에서 직전 릴리스 기동**을 먼저 검사해 호환되지 않는 배포를 막는다. `we:allow-destructive`는 파괴적 SQL 문장 차단만 우회하며, 직전 릴리스 기동 검사까지 생략하지 않는다. 다만 빈 임시 DB를 쓰므로 실제 행에 따른 실패·데이터 손실·옛 화면의 모든 동작까지 보장하지 않는다. 이 주석을 일반 배포 해결책으로 쓰지 않는다. 첫 배포는 이전 릴리스가 없어 자동 복귀도 할 수 없다. 이번 보강에서 이 실행 순서는 바꾸지 않았다.

**마이그레이션 실패 전달**: `4/6`은 마이그레이션 출력을 파일로 받은 뒤 종료값을 따로 보고, 실패하면 `app` 링크를 바꾸지 않고 멈춘다(2026-11-12 보강, 이전의 `| tee` 파이프는 실패를 숨길 수 있었다).

---

### 2.2 되돌리기 (`rollback` — 수업 중에도 실행 가능)

#### 1) 언제 실행하는가

- 배포 직후 화면 오류, 실시간 반영 먹통, API `5xx` 등 회귀 버그를 발견했을 때
- **수업 중** 새 릴리스 문제로 장애가 났을 때 (`rollback.sh`에는 평일 08:00~16:00 금지창 제한이 없으므로 수업 중 복구에 바로 쓸 수 있다)

#### 2) 실행 명령

```bash
cd /Users/bodyking/Desktop/Architecture/writeessay

# 기본: 직전 릴리스(state/previous-release)로 즉시 복귀
sh ops/we.sh rollback
```

직전 릴리스보다 한 단계 더 앞선 특정 릴리스(최근 5개 보관분 안)로 돌아가야 할 때는 먼저 보관 목록을 확인한 뒤 12자 SHA를 지정한다:

```bash
# 서버 볼륨 공간과 보관 중인 릴리스 폴더 목록 확인
sh ops/we.sh status

# 특정 릴리스로 지정 복귀 (.we-build-ok 표시가 있는 릴리스만 허용)
sh ops/we.sh rollback <12자_릴리스_SHA>
```

#### 3) 확인

```bash
sh ops/we.sh status
sh ops/we.sh logs server
```

- **확인**: `되돌리기 완료 및 상태 확인 통과: releases/<sha>` 문구가 출력되고, `sh ops/we.sh status`의 `현재 릴리스`와 ①~④가 모두 `[OK]`여야 한다(재시작 10~20초 동안 학생 화면은 잠시 `여기에만 저장`이 되었다가 자동으로 다시 합쳐진다).

#### 4) 스키마가 바뀐 릴리스일 때 주의 (`docs/PLAN.md` §15.4)

- **운영 SQLite DB(`data/geulbang.sqlite`)는 절대 되돌리지 않는다**: 무백업 원칙과 수업 중 새로 쓰인 글 보호를 위해 `rollback`은 앱 코드(`app` 심볼릭 링크)만 이전으로 돌리고 DB 파일은 그대로 둔다.
- **이전 릴리스가 새 스키마 위에서 뜨는 원리**:
  1. 모든 마이그레이션은 **더하기만**(새 표 추가, 기본값 있는 새 열 추가) 하고 열 삭제·이름 바꾸기를 금지한다.
  2. `deploy` 3단계 사전 검사가 이미 **"새 스키마가 적용된 DB에서 직전 릴리스가 정상 시작·응답·종료하는지"** 기계로 검증한 뒤에만 배포를 통과시킨다.
  3. 되돌린 뒤 시작된 이전 릴리스 서버는 `schema_migrations`에 더 높은 판 번호가 있으면 `schema_ahead`(`이 릴리스보다 새 마이그레이션이 적용됨`) 경고 로그만 한 줄 남기고 정상 동작한다.
- **꼭 기억할 주의점 3가지**:
  1. 새 릴리스 전용 표·열에 기록된 값은 되돌린 동안 옛 릴리스 화면에서는 보이지 않는다(DB 파일 안에는 남음).
  2. 배포 사전 검사는 **직전 릴리스 1개**와의 호환만 자동 보장한다. 스키마 변경이 여러 번 겹친 뒤 2단계 이상 옛 릴리스로 지정 되돌리기(`we.sh rollback <옛SHA>`)를 할 때는 스키마 호환 여부를 먼저 확인해야 한다.
  3. `we:allow-destructive` 주석은 SQL 문장 차단만 우회하고 직전 릴리스 기동 검사는 그대로 실행한다. 그래도 빈 임시 DB 검사로 실제 데이터의 호환·보존까지 보장되지는 않는다(2.1절). 되돌리기 뒤 실제 동작에 문제가 있으면 DB를 옛 파일로 덮지 말고, 새 마이그레이션으로 앞으로 고친다.

---

### 2.3 수업 중 사고 대응 표

수업 중 문제가 생기면 **학생들이 화면을 닫거나 새로고침하지 않게 먼저 말로 안내**한 뒤, 아래 표에서 증상에 맞는 칸을 찾아 조치한다.

| 사고 유형 | 증상 (학생이 보는 것 · 교사가 보는 것) | 먼저 볼 것 (명령 · 화면) | 조치 | 학생에게 할 말 |
|---|---|---|---|---|
| **접속 안 됨 ①**<br>앱 서버(`4460`) 꺼짐·멈춤 | · **쓰던 학생**: 노랑 배지 `여기에만 저장`(기기에만 저장), 상단 띠 *"선생님 화면과 연결이 잠시 끊겼어요. 글은 이 기기에 저장되고 있어요."*<br>· **새 입장·교사**: 연결 실패 또는 `502`/`504` | `sh ops/we.sh status`<br>(`① 로컬 /internal/health`가 `[FAIL]`)<br>`sh ops/we.sh logs server` | · 직전 배포 뒤면: `sh ops/we.sh rollback`<br>· 그 외 멈춤이면 `sh ops/we.sh restart`(상태 확인 포함) 또는 데몬 미등록 시 `sh ops/we.sh install-daemons server` | *"창을 닫거나 새로고침하지 말고 지금 칸에 그대로 계속 쓰세요. 글은 태블릿에 저장되고 있어서 연결이 돌아오면 선생님 화면에 저절로 합쳐집니다."* |
| **접속 안 됨 ②**<br>전용 터널 끊김 · `public off` | · **쓰던 학생**: `여기에만 저장` 유지<br>· **새 입장·교사**: 외부 접속 불가(`502`/`503`/`530`) | `sh ops/we.sh status`<br>(`① 로컬`은 `[OK]`인데 `전용 터널`이 `[FAIL]` 또는 `공개 연결 : 꺼짐`)<br>`sh ops/we.sh logs tunnel` | · 스위치가 꺼져 있으면: `sh ops/we.sh public on`<br>· 터널만 굳었으면: `sh ops/we.sh public off && sh ops/we.sh public on`<br>· 맥미니 인터넷 회선 단절이면 공유기 점검, 복구 전까지 기기 저장으로 수업 후 `.txt` 저장 안내 | *"선생님 컴퓨터와 연결만 잠깐 쉬고 있어요. 창을 닫지 말고 끝까지 써 주세요. 다 쓴 친구는 오른쪽 위 점 세 개(`···`)에서 '텍스트 파일로 저장'도 눌러 두세요."* |
| **접속 안 됨 ③**<br>CloudFront · Cloudflare 앞단 문제 | · **새 입장·교사**: `403`/`5xx` 화면 또는 *"오늘은 잠시 쉬어요. 글은 여기에 저장돼요."*(`E_QUOTA`)<br>· **쓰던 학생**: `여기에만 저장` | `sh ops/we.sh status`<br>(`① 로컬`·`전용 터널 200`은 `[OK]`인데 `②`·`③`·`④` 중 `[FAIL]`) | · `②`와 `④`가 둘 다 `403`이면 원본 잠금 비밀값 불일치 → `sh ops/we.sh origin-secret`으로 복사해 Cloudflare WAF `we-origin-lock` 식 수정(급하면 수업 동안만 규칙 일시 끔)<br>· WAF 공격 대응 모드가 켜져 학교 IP가 막혔으면 `aws login --profile we && sh ops/we.sh emergency off`<br>· 외부 클라우드 자체 장애면 기기 저장으로 진행 | *"이미 열려 있는 친구들은 새로고침하지 말고 그대로 계속 쓰세요. 아직 못 들어온 친구들은 종이나 메모 앱에 먼저 적고 있으면 연결되는 대로 옮길게요."* |
| **저장이 `"여기에만 저장"`(기기에만)으로 머묾**<br>(학교망 웹소켓 차단 등) | · **학생**: 페이지는 열렸는데 배지가 계속 노랑 `여기에만 저장`(또는 `보내는 중`), *"인터넷이 끊겼어요. 기기에 저장하고 있어요."*<br>· **교사**: 타일이 `오프라인`(회색 구름)·`0자`, 수업 준비 `연결 점검`에서 `실시간 연결` 실패 | · 교사 수업 준비 화면 `연결 점검`<br>· 맥미니: `sh ops/we.sh healthcheck` (`③ 공개 wss` 확인) | · 맥미니 `③`은 `[OK]`인데 교실만 안 되면 **학교 와이파이가 `wss://`를 차단**한 것 → 당장 수업은 학생 기기 저장 + 끝날 때 `··· > 텍스트 파일로 저장(.txt)`으로 걷고, 교사는 휴대폰 LTE 핫스팟 사용. 수업 후 정보 담당 교사에게 `write.ssamuniverse.com` 허용 요청<br>· 맥미니 `①`이 `persistFailures`로 `[FAIL]`이면 아래 디스크 부족 조치 수행 | *"교실 와이파이가 선생님 화면으로 보내는 길을 막고 있어요. 글은 여러분 태블릿에 글자마다 저장되니 끝까지 쓰고, 마지막에 점 세 개(`···`)에서 '텍스트 파일로 저장'을 눌러 제출할게요."* |
| **한 학생만 안 됨**<br>(개별 기기 · 사생활 보호 · 이어 쓰기 · 제출 잠금) | · **교사**: 다른 학생들은 `쓰는 중`인데 한 명만 `오프라인`이거나 상단에 `이어 쓰기 요청` 띠 표시<br>· **해당 학생**: ⓐ 연결 끊김 ⓑ *"이 화면에서는 글을 저장할 수 없어요"*(`E_STORAGE_BLOCKED`) ⓒ *"선생님이 괜찮다고 하면 열려요"* ⓓ *"제출한 글이에요..."*(`E_DOC_LOCKED`) | 서버 명령 불필요.<br>교사 대시보드 상단 띠와 해당 학생 태블릿 화면 확인 | · **ⓐ 개별 와이파이**: 창은 닫지 말고 그 태블릿 와이파이만 껐다 켬(필요 시 `··· > 글 복사` 후 새로고침)<br>· **ⓑ 저장 불가**: Safari 개인정보 보호 / Chrome 시크릿 모드를 끄고 일반 창으로 재입장<br>· **ⓒ 기기 변경·저장소 초기화**: 교사 대시보드 상단 띠에서 `허용`(여러 명이면 `모두 허용`) 클릭. 잘못 허용 시 서랍 `··· > 기기 연결 끊기`<br>· **ⓓ 제출 후 수정**: 교사가 학생 타일 클릭 → 서랍 `다시 쓰게 하기` | · (와이파이) *"창은 닫지 말고 태블릿 와이파이만 한 번 껐다 켜 볼까?"*<br>· (승인·재개) *"선생님 화면에서 지금 바로 열어 줄게. 잠깐만 기다려 줘!"* |
| **AI 단추(글벗) 실패 · 한도** | · **학생**: 글벗 버튼 클릭 시 ⓐ *"오늘은 글벗이 쉬어요. 글은 계속 쓸 수 있어요."*(`E_AI_LIMIT`) ⓑ *"잠깐 뒤에 다시 눌러 주세요"* / *"조금 오래 걸려요..."*(`E_AI_PROVIDER`·`TIMEOUT`) ⓒ *"이 부분은 글벗이 돕기 어려워요..."*(`E_AI_REFUSED`)<br>· **교사**: `연결 점검`의 `AI 응답` 실패 또는 `오늘 AI 사용` 한도 도달 | · 교사 `연결 점검` 하단 `오늘 AI 사용` 수치(학생 60 · 방 1,500 · 전체 3,000회, KST 0시 초기화)<br>· `sh ops/we.sh logs server` | · **하루 한도·월 지출 한도(20달러) 도달 또는 제공사 장애**: 글쓰기·저장에는 영향 없음. 학생 혼란을 줄이려면 대시보드 `··· > 수업방 설정`에서 `글벗 버튼` 스위치를 끄고 교사 직접 지도·동료 첨삭으로 진행(콘솔 한도·API 키 교체는 2.6절)<br>· **안전 거절(`E_AI_REFUSED`)**: 민감 표현 거절이므로 교사 서랍에서 직접 지도 | *"글벗이 지금 잠깐 쉬고 있어요. 내가 쓴 글은 안전하니 먼저 내 힘으로 끝까지 써 보고, 다듬고 싶은 문장은 선생님께 손들고 물어봐 주세요."* |
| **맥미니 재부팅 · 정전**<br>(FileVault 잠금 대기) | · **교사**: 글방·쌤유니버스·rollingthunder **세 서비스 경보 메일이 동시 수신**, 외부 접속 전면 중단<br>· **쓰던 학생**: `여기에만 저장`으로 계속 입력 가능 | · 맥미니 전원·공유기 상태<br>· 맥미니 모니터가 **FileVault 암호 입력 화면**에 멈춰 있는지 확인(U-20) | · 맥미니 앞에서 전원을 켜고 **FileVault 디스크 암호 입력**(데스크톱 로그인 전이라도 `server`·`tunnel`·`watch` 데몬 자동 기동) → 1분 뒤 `sh ops/we.sh status` 확인<br>· 원격이라 당장 암호를 못 치면 학생들은 태블릿에서 끝까지 쓰고 `··· > 텍스트 파일로 저장(.txt)`으로 보관(다음 시간 서버 복구 후 같은 QR로 열면 자동 병합) | *"선생님 서버가 잠깐 꺼졌지만 여러분 태블릿 안에서는 글방이 그대로 돌아가요. 끝까지 쓴 다음 점 세 개(`···`)에서 '텍스트 파일로 저장'으로 꼭 저장해 두세요."* |
| **디스크 부족**<br>(`persistFailures > 0`) | · **교사**: 하트비트 경보 수신, `sh ops/we.sh status`에서 `① 로컬 /internal/health`가 `HTTP 503` 또는 `persistFailures`로 `[FAIL]`, `logs server`에 `SQLITE_FULL` | `sh ops/we.sh status`(서버 볼륨 공간·릴리스 목록)<br>폴더별 용량은 수동 조회: `sudo -u wesvc -H du -sh /Users/wesvc/writeessay-server` | · **운영 DB(`data/geulbang.sqlite*`)와 타 서비스 데이터는 절대 삭제 금지**<br>· `sh ops/we.sh heartbeat`(7일 넘은 배포·빌드 로그 정리) 실행 후 **[도구 없음 — 수동 절차]** 미사용 번들·오래된 릴리스 폴더(현재·직전 제외)·재생성 가능 캐시만 정리(아래 코드 블록 참고)<br>· 공간 확보 후 최대 30초 뒤 자동 재저장(`STORE_RETRY_INTERVAL_MS`) 확인: `sh ops/we.sh status` | *"선생님이 저장 공간을 정리하고 있어요. 1분만 창을 닫지 말고 그대로 쓰면서 기다려 주세요."* |
| **의심스러운 대량 요청**<br>(WAF · `emergency.sh` · `public off`) | · **교사**: `we-cloudfront-5xx` 경보 메일, 전체 응답 지연, `E_RATE_LIMITED` / `E_QUOTA` 급증, `logs server`에 대량 요청 기록 | `sh ops/we.sh status`<br>`sh ops/we.sh logs server`<br>`aws login --profile we && sh ops/we.sh emergency status` | · **1단계(수업 유지 + 해외 차단·한도 축소)**: `sh ops/we.sh emergency on` (한국 `KR` 외 차단 + IP당 5분 20,000→3,000건, 엣지 반영 약 1분)<br>· **2단계(국내 공격·맥미니 보호 시급)**: `sh ops/we.sh public off`로 외부 터널 즉시 차단(로컬 서버·DB 유지)<br>· 종료 후 반드시 `sh ops/we.sh emergency off` · `sh ops/we.sh public on` · `aws logout --profile we` 복귀 | · (1단계) *"연결을 더 튼튼하게 바꾸고 있어요. 1분 뒤면 괜찮아지니 그대로 써 주세요."*<br>· (2단계) *"안전하게 쓰려고 인터넷 통로를 잠시 닫았어요. 끝까지 쓰고 '텍스트 파일로 저장'으로 갈무리해 주세요."* |

#### 수업 중 자주 쓰는 응급 명령 모음 (복사 실행용)

```bash
cd /Users/bodyking/Desktop/Architecture/writeessay

# A. 앱 서버(4460)만 안전하게 재시작 (릴리스·DB·터널 그대로, 수업 중 가능)
#    (wesvc의 글방 Node 프로세스에만 SIGTERM -> 열린 글 저장 후 launchd가 다시 띄움 -> 상태 확인까지 자동, 이웃 서비스 무영향)
sh ops/we.sh restart

# B. 전용 터널만 재기동 (외부 연결 스위치 껐다 켜기)
sh ops/we.sh public off
sh ops/we.sh public on
sh ops/we.sh status

# C. CloudFront WAF 공격 대응 모드 켜기 / 평시 복귀
aws login --profile we
sh ops/we.sh emergency status
sh ops/we.sh emergency on --dry-run
sh ops/we.sh emergency on
# 공격 종료 뒤 평시 복귀 (IP당 5분 20,000건 복원 + 국가 차단 해제)
sh ops/we.sh emergency off
aws logout --profile we

# D. 서버 볼륨 공간·릴리스는 status로 확인, 삭제할 임시 파일 선택은 수동 절차
sh ops/we.sh status
sudo -u wesvc -H du -sh /Users/wesvc/writeessay-server
sh ops/we.sh heartbeat
sudo -u wesvc -H rm -f /Users/wesvc/writeessay-server/bundles/incoming.bundle
```

---

### 2.4 백업·복구 원칙과 절차 (있는 스크립트 기준)

#### 1) 서버 무백업 원칙 (`PRD.md` F-24 · `docs/PLAN.md` §15.1, §15.4)

- 학생 글과 별명을 **30일 뒤 흔적 없이 자동 파기한다**는 약속을 지키기 위해 서버 DB 백업 스크립트(`backup*.sh`), S3 백업 버킷, 배포 전 SQLite 복사본은 **의도적으로 두지 않는다**.
- `sh ops/we.sh setup-host`가 `/Users/wesvc/writeessay-server` 전체를 macOS Time Machine 백업에서 제외(`[Excluded]`)하며, SQLite는 `PRAGMA secure_delete = ON`과 만료 삭제 뒤 `wal_checkpoint(TRUNCATE)`로 삭제된 데이터를 덮어쓴다.
- 따라서 **수업 결과물 보관은 교사와 학생 기기에서 직접 내려받기로만 수행**한다:
  - **교사**: 매 차시 종료 시 및 삭제 3일 전 알림 띠 표시 시 대시보드 상단 `내려받기` → `모든 글`(또는 `제출한 글만`)로 `{수업명}_{학급명}_{YYYYMMDD}.zip`을 저장한다.
  - **학생**: 기기 브라우저 저장소(IndexedDB)에 자동 보관되며, 쓰기 화면 `··· > 텍스트 파일로 저장(.txt)`으로 개별 보관할 수 있다.

#### 2) 상황별 복구 절차

- **앱 코드·빌드 이상 복구 (스크립트 지원)**:
  - `sh ops/we.sh rollback`으로 직전 검증된 릴리스로 즉시 복구한다(운영 DB 유지).
- **맥미니 교체·초기화 후 서버 환경 재구성 (스크립트 지원)**:
  - 학생 데이터는 복원하지 않으며, 1부의 1~8단계 스크립트(`setup-host` → `init-secrets`·`save-secret` → `deploy --init` → `install-daemons server` → `tunnel-create`·`install-daemons tunnel` → `origin-secret`·`aws/setup-ops.sh --apply` → `install-daemons watch`)를 순서대로 실행해 빈 서버 환경을 복구한다.
- **정전·디스크 오류로 `geulbang.sqlite` 손상 시 (`quick_check` 실패로 서버 기동 거부)**:
  - **진단은 `db-check`**, 데이터 파기·재초기화는 **`[도구 없음 — 수동 절차]`**다. 다음 명령은 운영 DB를 `sqlite3 -readonly`와 `PRAGMA query_only = ON`으로 열어 `integrity_check`와 `quick_check` 결과만 출력하며 DB를 생성·수정·복구하지 않는다:
    ```bash
    sh ops/we.sh db-check
    ```
    두 결과가 모두 `ok`이고 종료 코드가 `0`이어야 정상이다. 결과가 다르거나 실행이 실패하면 종료 코드 `1`이며 다음 수동 절차로 넘긴다. 검사 도중 데이터가 바뀌는 영향을 피하려면 점검 창에서 아래와 같이 서버를 내리고 다시 진단한다.
  - **재초기화는 운영자 승인 뒤 수업 시간 밖에서만** 한다. 실행 전 교사·학생 기기의 내려받기 가능 여부를 확인하고, 기존 수업방·글·링크를 복원할 백업이 없다는 점을 안내한다. 각 단계가 실패하면 다음 단계로 넘어가지 않는다:
    1. 외부 유입과 서버 데몬을 먼저 멈추고 읽기 전용 진단과 로그를 확인한다:
       ```bash
       sh ops/we.sh public off
       sh ops/we.sh install-daemons --remove server
       sh ops/we.sh db-check
       sh ops/we.sh logs server
       ```
    2. 디스크 여유 공간·권한 문제부터 해결한다. DB를 복사·내보내기·`.recover`로 우회 백업하지 않는다. 복구 불가로 판단하고 **파기를 승인한 경우에만**, `wesvc`로 `/Users/wesvc/writeessay-server/data/geulbang.sqlite`와 그 `-wal`·`-shm` 파일 **세 개만** 수동 파기한다. 서버가 살아 있는 상태에서 WAL 파일을 먼저 지우거나 다른 `data/` 파일까지 지우지 않는다. 이 삭제를 감싸는 자동 명령은 제공하지 않는다.
    3. `sh ops/we.sh deploy --init`으로 검증된 현재 커밋에서 빈 운영 DB를 만들고 `sh ops/we.sh db-check`의 두 `ok`를 확인한다. 평소 장애 대응에 `--init`을 쓰면 안 된다.
    4. `sh ops/we.sh install-daemons server` → `sh ops/we.sh healthcheck --local-only` → `sh ops/we.sh public on` → `sh ops/we.sh status` 순서로 다시 연다. 새 수업방에서 학생들은 각자 태블릿에 남아 있는 글을 복사해 옮긴다. 옛 수업방 링크로는 새 DB에 글이 복원되지 않는다.

---

### 2.5 운영 로그 위치와 조회 방법

모든 운영 로그는 `/Users/wesvc/writeessay-server/logs/`(권한 `600`, `wesvc` 소유) 아래에 쌓이며, 글 본문·별명·IP 원문·토큰·비밀값은 기록하지 않는다. `/etc/newsyslog.d/writeessay.conf`가 **날마다(24시간) 및 10MB 도달 시 회전해 최대 7개**까지 보관하고, `heartbeat.sh`가 7일 지난 일회성 `deploy-*.log`·`build-*.log`를 지운다.

| 대상 | 서버 내부 파일 경로 | 조회 명령 (`bodyking` 계정) |
|---|---|---|
| 앱 서버 (`4460`) | `/Users/wesvc/writeessay-server/logs/server.log` | `sh ops/we.sh logs server` (생략 시 기본값) |
| 전용 터널 (`20242`) | `/Users/wesvc/writeessay-server/logs/tunnel.log` | `sh ops/we.sh logs tunnel` |
| 5분 하트비트 감시 | `/Users/wesvc/writeessay-server/logs/watch.log` | `sh ops/we.sh logs watch` |
| 최근 배포·사전검사 | `/Users/wesvc/writeessay-server/logs/deploy-<12자sha>.log` | `sh ops/we.sh logs deploy` |
| 최근 빌드 (`npm ci`·`build`) | `/Users/wesvc/writeessay-server/logs/build-<12자sha>.log` | `sh ops/we.sh logs build` |

```bash
# 기본 60줄 대신 최근 200줄 보기 (we.sh가 LINES_TO_SHOW 환경 변수를 읽음)
LINES_TO_SHOW=200 sh ops/we.sh logs server

# 실시간 로그 추적 (종료: Ctrl+C, 같은 이름의 로그 회전도 계속 추적)
sh ops/we.sh logs --follow
sh ops/we.sh logs tunnel -f
```

---

### 2.6 비밀값 교체 순서 (값은 절대 적지 않음)

비밀값은 `/Users/wesvc/writeessay-server/secrets/app.env`(권한 `600`, `wesvc` 소유)와 소유자 전용 `~/.writeessay-admin/`(권한 `700`)에만 두며, 명령줄 인자·채팅·문서·커밋에 값을 직접 적지 않는다. 서버는 시작할 때 비밀값을 한 번 읽으므로 `app.env`를 바꾼 뒤에는 반드시 **앱 서버 재시작**이 필요하다(수업 시간 밖 권장).

#### 1) 운영용 LLM API 키 (`ANTHROPIC_API_KEY`) — 언제든 교체 가능

1. Anthropic 콘솔에서 새 운영 전용 API 키를 발급하고 월 지출 한도(20달러)를 확인한다(기존 키는 아직 삭제하지 않음).
2. 새 키를 숨김 입력으로 저장한다:
   ```bash
   sh ops/we.sh save-secret llm-api-key
   ```
3. 앱 서버만 다시 시작해 새 키를 읽게 한다(수업 중에도 가능, 상태 확인까지 자동):
   ```bash
   sh ops/we.sh restart
   ```
4. 교사 수업 준비 화면의 `연결 점검`에서 `AI 응답: 좋아요`를 확인한 뒤, Anthropic 콘솔에서 **이전 API 키를 폐기**한다. (개발·평가용 `.local/dev.env` 키는 별도 키이므로 따로 관리한다.)

#### 2) 선생님 시작 코드 (`TEACHER_START_CODE`, 숫자 8자리) — 언제든 교체 가능

1. 새 8자리 숫자를 숨김 입력으로 저장한다:
   ```bash
   sh ops/we.sh save-secret teacher-start-code
   ```
2. 위 1)의 3단계 명령으로 앱 서버를 재시작하고 `sh ops/we.sh status`를 확인한다.
3. **영향**: 이미 만들어진 수업방의 학생 입장·선생님 링크·PIN 입장에는 영향이 없다. 교사 기기에 기억된 옛 시작 코드는 **다음에 새 수업방을 열 때** 거절(`E_START_CODE_INVALID`)되므로 새 코드나 새 등록 링크(`/t/register#<새코드>`)로 다시 등록한다.

#### 3) CloudFront ↔ Cloudflare 원본 잠금 비밀값 (`x-we-origin-auth`) — `origin-secret --rotate`, 수업 시간 밖 전용

인자 없는 `origin-secret`은 현재 값을 클립보드에 복사하고, `--rotate`는 새 64자 값을 만든 뒤 이전 값을 `~/.writeessay-admin/cloudfront-origin-secret.prev`(권한 `600`)에 보존한다. `.prev`가 이미 있으면 진행 중인 회전을 덮지 않고 거부한다. CloudFront 전파가 끝날 때까지 Cloudflare에서 **이전·새 값 둘 다 허용**하는 순서를 지킨다.

1. 아래 명령으로 새 값을 생성·복사한다(값은 화면에 출력되지 않음):
   ```bash
   sh ops/we.sh origin-secret --rotate
   ```
2. **Cloudflare → `ssamuniverse.com` → WAF → Custom rules → `we-origin-lock`**의 기존 식에서 호스트 조건과 Block 동작은 유지하고, 머리 값 검사를 잠시 다음처럼 이전 값 또는 새 값과 일치하면 통과하도록 고쳐 **Deploy**한다. 기존 식에 있는 이전 값은 그대로 두고 클립보드의 새 값을 추가한다. 실제 값은 터미널·문서에 넣지 않는다:
   ```text
   (http.host eq "origin-write.ssamuniverse.com" and not (any(http.request.headers["x-we-origin-auth"][*] eq "<이전값>") or any(http.request.headers["x-we-origin-auth"][*] eq "<새값>")))
   ```
   이전 값을 다시 복사해야 하면 `tr -d '\n' < ~/.writeessay-admin/cloudfront-origin-secret.prev | pbcopy`, 새 값은 `sh ops/we.sh origin-secret`으로 복사한다. 회전 명령을 다시 실행하지 않는다.
3. 양쪽 값 허용 후 `sh ops/we.sh healthcheck`로 현재 경로가 정상임을 확인한다. 이어서 CloudFront 원본 머리를 새 값으로 갱신하고 전파 완료까지 기다린다(`setup-ops.sh`는 현재 값 파일을 자동으로 읽음):
   ```bash
   aws login --profile we
   sh ops/aws/setup-ops.sh <알림받을_이메일> E3TFCRGRU1HG1Q --apply --skip-waf
   aws cloudfront wait distribution-deployed --profile we --id E3TFCRGRU1HG1Q
   ```
4. `Deployed` 대기가 성공하면 Cloudflare 식을 1부 7단계 형태로 줄여 **새 값 하나만** 남긴다. `sh ops/we.sh healthcheck`에서 ①~④가 모두 `[OK]`인지 확인한다. 특히 공개 응답 `200`·공개 웹소켓 `101`·원본 직접 접근 `403`을 함께 확인한다.
5. 성공 확인 후에만 이전 값 파일을 수동 파기하고 클립보드를 비운 뒤 AWS에서 로그아웃한다:
   ```bash
   rm -f ~/.writeessay-admin/cloudfront-origin-secret.prev
   printf '' | pbcopy
   aws logout --profile we
   ```

**중단 시**: `.prev`는 남겨 두고 인자 없는 `origin-secret`으로 같은 새 값을 다시 복사해 이어간다. CloudFront 갱신이 끝나기 전에 Cloudflare에서 이전 값을 빼거나 규칙 전체를 끄지 않는다. 새 파일 승격 전에 생성이 실패했을 가능성은 운영자가 파일 상태만 비노출로 확인한다. 이전 값으로 돌아가야 하면 Cloudflare의 양쪽 값 허용을 유지한 채 `.prev`를 현재 파일에 복구(권한 `600`) → CloudFront 갱신·전파 대기 → WAF 이전 값 하나로 축소 순서로 수동 처리한다.

#### 4) 내부 대칭키 4종 — `rotate-key`, 조건부 교체

교체 전 영향(`docs/PLAN.md` §13.2)을 확인한다:

- `ID_HMAC_KEY`: IP·기기 속도 제한 칸이 초기화된다.
- `PIN_HMAC_KEY` · `PIN_ENC_KEY`: **만료 전 수업방이 0개일 때만** 허용한다. 닫힌 방도 만료 전에는 PIN으로 들어갈 수 있으므로 포함한다. 방을 닫거나 실시간 연결 수만 `0`으로 만드는 것으로는 충분하지 않다.
- `PERSONAL_HMAC_KEY`(v1.1): 기존 개인 모드 글을 다시 열 수 없게 되므로 보관 중인 개인 모드 참가자가 `0`명일 때만 허용한다.

`rotate-key`는 키 이름을 네 종류로 제한하고, PIN·개인 모드 키는 DB를 `sqlite3 -readonly`와 `PRAGMA query_only = ON`으로 조회한다. DB 없음·손상·조회 실패·보호 대상 존재 시 **키를 바꾸기 전에 거부**한다. `ID_HMAC_KEY`는 DB 조건 없이 교체한다. 교체할 항목만 `init-secrets`와 같은 무작위 32바이트 base64로 생성해 `app.env`(권한 `600`)에 원자적으로 기록하며, 배포·되돌리기·재시작과 같은 잠금을 유지한 채 `restart`를 이어 실행한다. 값·이전 값은 출력하지 않는다.

DB 조회는 그 순간의 상태다. 점검 창에 새 수업방이 생기지 않도록 **PIN·개인 모드 키 교체는 수업 시간 밖에 외부 연결을 닫고 로컬 교사 화면도 닫은 채** 실행한다. 점검 중 새 방을 만드는 다른 로컬 요청이 없어야 한다. 서버 데몬과 현재 릴리스 기록이 없으면 교체하지 않는다.

```bash
sh ops/we.sh public off
# 필요한 키 이름 하나만 지정한다. PIN 키 둘은 각각 같은 방 존재 검사를 거친다.
sh ops/we.sh rotate-key ID_HMAC_KEY
# sh ops/we.sh rotate-key PIN_HMAC_KEY
# sh ops/we.sh rotate-key PIN_ENC_KEY
# sh ops/we.sh rotate-key PERSONAL_HMAC_KEY
# 재시작·로컬 상태 확인 성공 뒤 다시 연다(점검 전부터 꺼져 있었다면 켜지 않음).
sh ops/we.sh public on
sh ops/we.sh status
```

교체 완료 문구 뒤 재시작·상태 확인이 실패하면 새 값이 이미 저장된 상태다. **재회전하지 말고** 로그를 확인하고 `sh ops/we.sh restart`로 반영·확인을 마친다.

#### 5) AWS 감시용 IAM 자격 증명 (`aws-macmini-credentials`) — `[도구 없음 — 수동 절차]`, 수업 시간 밖

`setup-ops.sh`는 자격 증명 파일이 있으면 기존 키를 유지한다. **기존 파일부터 지우지 않는다.** [AWS IAM 키 관리 절차](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-keys-admin-managed.html)에 따라 새 키 발급 → 로컬 교체·검증 → 이전 키 비활성화·검증 → 이전 키 삭제 순서로 진행한다. 아래는 운영자가 한 단계씩 실행하는 수동 절차이며, 실패하면 다음 단계로 넘어가지 않는다. `set -x`·`aws --debug`·`tee`는 사용하지 않는다.

1. `aws login --profile we` 후 `we-macmini`의 키 목록을 확인한다:
   ```bash
   aws iam list-access-keys --profile we --user-name we-macmini --output table
   ```
   사용자당 키는 활성·비활성 합쳐 최대 2개다. 이미 두 개라면 현재 서비스가 쓰는 키를 건드리지 말고, `aws iam get-access-key-last-used --profile we --access-key-id <사용하지_않는_키_ID>`와 사용처를 확인해 폐기 가능한 키만 `aws iam delete-access-key --profile we --user-name we-macmini --access-key-id <사용하지_않는_키_ID>`로 정리한다. 사용 여부가 불명확하면 여기서 중단한다. 현재 파일의 키 **ID만** 확인하려면 아래 명령을 쓰며 secret 값은 출력하지 않는다:
   ```bash
   (cd / && sudo -u wesvc -H awk '$1 == "aws_access_key_id" { print $3 }' /Users/wesvc/writeessay-server/secrets/aws-macmini-credentials)
   ```
2. 새 키 응답은 화면 대신 소유자 보호 폴더(디렉터리 `700`, 파일 `600`)에 저장한다. [`create-access-key`](https://docs.aws.amazon.com/cli/latest/reference/iam/create-access-key.html)는 secret을 발급 시 한 번만 반환하므로 응답을 화면에 흘리거나 다시 조회하려 하지 않는다:
   ```bash
   mkdir -p ~/.writeessay-admin
   chmod 700 ~/.writeessay-admin
   we_rotation_dir="$(mktemp -d "$HOME/.writeessay-admin/iam-rotate.XXXXXX")"
   (umask 077; aws iam create-access-key --profile we --user-name we-macmini --output json > "$we_rotation_dir/new-key.json")
   ```
3. 새 JSON을 표준 입력으로 `wesvc`에 전달해 자격 증명을 교체한다. 기존 파일은 같은 `secrets/` 아래 `.prev`로 잠시 보존한다. `.prev`나 `.next`가 이미 있으면 중단하며 기존 회전 상태를 먼저 확인한다:
   ```bash
   (cd / && sudo -u wesvc -H python3 -c '
   import json, os, pathlib
   import sys
   k = json.load(sys.stdin)["AccessKey"]
   if not all(isinstance(k.get(n), str) and k[n] for n in ("AccessKeyId", "SecretAccessKey")):
       raise SystemExit("새 키 응답 형식 실패")
   f = pathlib.Path("/Users/wesvc/writeessay-server/secrets/aws-macmini-credentials")
   prev, tmp = pathlib.Path(str(f) + ".prev"), pathlib.Path(str(f) + ".next")
   if prev.exists() or tmp.exists() or not f.is_file():
       raise SystemExit("기존 회전 파일 또는 원본 파일 상태 확인 필요")
   os.umask(0o077)
   with prev.open("xb") as out:
       out.write(f.read_bytes())
   with tmp.open("x") as out:
       out.write("[default]\naws_access_key_id = %s\naws_secret_access_key = %s\n" % (k["AccessKeyId"], k["SecretAccessKey"]))
   os.chmod(prev, 0o600)
   os.chmod(tmp, 0o600)
   tmp.replace(f)
   ') < "$we_rotation_dir/new-key.json"
   ```
4. 새 파일로 인증되는지 확인한 뒤 하트비트를 실행하고 감시 로그의 전송 결과를 확인한다. 앱 재시작은 필요 없다(감시 실행마다 파일을 다시 읽음):
   ```bash
   (cd / && sudo -u wesvc -H env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_DEFAULT_PROFILE AWS_PROFILE=default AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/Users/wesvc/writeessay-server/secrets/aws-macmini-credentials aws sts get-caller-identity --query Arn --output text)
   sh ops/we.sh heartbeat
   sh ops/we.sh logs watch
   ```
   ARN이 대상 계정의 `user/we-macmini`인지, CloudWatch `Writeessay/EndToEndOK`가 갱신되는지 확인한다. `heartbeat`의 종료 코드만으로 AWS 전송 성공을 판단하지 않는다. 실패하면 이전 키가 아직 활성인 동안 `.prev`를 현재 파일로 복구하고 새 키 ID만 비활성화·삭제한다.
5. 검증 후 **이전 키 ID**만 비활성화한다([`update-access-key`](https://docs.aws.amazon.com/cli/latest/reference/iam/update-access-key.html)). 하트비트를 한 번 더 실행해 지표 전송이 계속되는지 확인하고 다음 감시 주기까지 관찰한다:
   ```bash
   aws iam update-access-key --profile we --user-name we-macmini --access-key-id <이전_키_ID> --status Inactive
   sh ops/we.sh heartbeat
   sh ops/we.sh logs watch
   ```
   문제가 있으면 `--status Active`로 이전 키를 다시 활성화하고 `.prev`를 복구한다. 정상일 때만 `aws iam delete-access-key --profile we --user-name we-macmini --access-key-id <이전_키_ID>`로 이전 키를 삭제한다. 마지막에 `.prev`와 새 키 원문 JSON을 파기하고 로그아웃한다:
   ```bash
   (cd / && sudo -u wesvc -H rm -f /Users/wesvc/writeessay-server/secrets/aws-macmini-credentials.prev)
   rm -f "$we_rotation_dir/new-key.json"
   rmdir "$we_rotation_dir"
   unset we_rotation_dir
   aws logout --profile we
   ```

#### 6) 전용 Cloudflare 터널 자격 증명 (`cloudflared/<TUNNEL_ID>.json`) — `[도구 없음 — 수동 절차]`, 수업 시간 밖

현재는 **로컬 관리 터널의 JSON**을 쓴다. `tunnel-create`를 다시 실행하는 것만으로는 기존 자격 증명이 회전하지 않는다. 기존 터널을 지우고 같은 이름으로 새 터널을 만드는 점검 창 절차를 쓴다. 기존 터널 삭제는 되돌릴 수 없고 새 UUID와 DNS 갱신이 필요하다. [Cloudflare CLI 명령](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/)과 [터널 DNS 안내](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)에 따라 다음 순서로 진행한다. 계정 인증서 `cert.pem`까지 유출된 경우는 별도 계정 권한 회수가 필요하며 JSON 교체만으로 끝내지 않는다.

1. 학생 글을 기기에 보관하고 새 접속이 없는 수업 시간 밖인지 확인한 뒤 외부 연결과 **터널 데몬만** 내린다(앱 서버·DB는 유지):
   ```bash
   sh ops/we.sh public off
   sh ops/we.sh install-daemons --remove tunnel
   ```
2. 소유자 전용 인증서 경로를 명시해 전용 터널 `writeessay`의 UUID를 확인한다. 기본 `~/.cloudflared`나 다른 서비스의 인증서는 쓰지 않는다:
   ```bash
   we_cf_cert="$HOME/.writeessay-admin/cloudflared/.cloudflared/cert.pem"
   cloudflared tunnel --origincert "$we_cf_cert" list --output json
   cloudflared tunnel --origincert "$we_cf_cert" info writeessay
   ```
   목록에서 `name`이 `writeessay`이고 서비스 `config.yml`의 UUID와 같은 항목만 고른다. 아래 `<이전_터널_UUID>`는 이 UUID로 바꾼다. 잔여 연결이 없으면 바로 삭제하고, 데몬을 내렸는데 연결이 남았다는 오류가 날 때만 `cleanup`을 사용한다:
   ```bash
   # 잔여 연결 때문에 삭제가 거부된 경우에만:
   # cloudflared tunnel --origincert "$we_cf_cert" cleanup <이전_터널_UUID>
   cloudflared tunnel --origincert "$we_cf_cert" delete <이전_터널_UUID>
   ```
   다른 UUID를 지우거나 `delete -f`로 우회하지 않는다. 실패하면 다음 단계로 가지 않는다.
3. 삭제 성공 후 `sh ops/we.sh tunnel-create`로 같은 이름의 새 터널과 자격 증명 JSON을 만든다. `cloudflared tunnel create`와 `cloudflared tunnel route dns`는 이 스크립트가 호출한다. **기존 DNS 레코드는 터널 삭제와 독립적**이므로 DNS 중복 경고가 나면 Cloudflare DNS에서 `origin-write` CNAME 하나의 Target을 **새 UUID의 `<새_UUID>.cfargotunnel.com`**으로 바꾸고 Proxy를 켠다. 공개 `write` CNAME(`d2gtrsnqpjb6in.cloudfront.net`, DNS only)은 바꾸지 않는다. 경고가 없더라도 새 Target인지 확인한다.
4. 새 `config.yml`의 UUID·credentials-file 경로와 `/internal/*` 404 규칙 검증 성공을 확인한 뒤 터널을 다시 연다:
   ```bash
   sh ops/we.sh install-daemons tunnel
   sh ops/we.sh public on
   sh ops/we.sh healthcheck
   sh ops/we.sh status
   ```
   `public on`은 DNS가 새 터널을 가리키는 것을 확인한 뒤에만 실행한다. ①~④ 확인 성공 후 이전 UUID에 해당하는 소유자 `~/.writeessay-admin/cloudflared/.cloudflared/<이전_UUID>.json`과 서비스 `/Users/wesvc/writeessay-server/cloudflared/<이전_UUID>.json` 두 파일만 수동 파기한다. 새 JSON·`config.yml`·`cert.pem`은 남긴다. 실패하면 외부 연결을 닫고 새 터널·DNS·규칙을 고친다(삭제한 옛 터널로는 복귀할 수 없음).

---

### 2.7 고쳐야 할 것 (P5-8b 해결 내역과 남은 경계)

실제 스크립트와 대조한 보강 내역이다. 도구로 해결한 본문은 새 명령으로 교체했고, IAM·터널 회전과 DB 파기는 수동 절차로 남겼다. 파일 수정·문법 검사만 완료했으며 운영 실행 검증은 아직 하지 않았다.

1. ~~앱 서버 단독 재시작 명령 없음~~ → `ops/scripts/restart.sh`와 `sh ops/we.sh restart`(배포 잠금 공유, 상태 확인·실패 알림 포함).
2. ~~원본 잠금 비밀값 회전 옵션 없음~~ → `ops/we.sh`의 `origin-secret --rotate`(이전 값 `.prev` 보존, 중복 회전 거부, 도움말에 Cloudflare → CloudFront → Cloudflare 순서).
3. ~~내부 대칭키 회전 도구 없음~~ → `ops/scripts/rotate-key.sh`와 `we.sh rotate-key`(읽기 전용 방·개인 자료 검사, 이름 제한, 비노출 원자적 교체 후 같은 잠금에서 `restart`).
4. ~~IAM·터널 자격 증명 회전 절차 불명확~~ → 2.6절에 실제 명령을 포함한 수동 절차를 명시했다. 회전 플래그는 추가하지 않았다.
5. ~~진단·대응 하위 명령 일원화 부족~~ → `we.sh emergency`, `status`의 서버 볼륨 `df -h`·`releases/` 목록, `logs --follow`/`-f`로 보강했다.
6. ~~`we.sh deploy`에 커밋 해시 직접 지정 불가~~ → 임시 Git 참조로 SHA 번들 생성 후 회수(브랜치·HEAD 유지).
7. ~~SQLite 읽기 전용 무결성 진단·재초기화 절차 부족~~ → `ops/scripts/db-check.sh`와 `we.sh db-check`(`integrity_check` + `quick_check`) 및 2.4절 수동 파기·재초기화 절차. 자동 복구·파기 명령은 추가하지 않았다.
8. ~~마이그레이션·상태 확인 순서와 자동 되돌림 위험 설명 부족~~ → 2.1·2.2절에 운영 DB 선적용·앱만 복귀·직전 릴리스 사전 기동 검사·빈 DB 검사의 한계를 명시했다. `deploy.sh` 순서는 유지했다.

**남은 코드 보강**: `deploy.sh` 운영 마이그레이션의 `| tee` 실패 전달 문제는 2.1절에 별도로 적었으며 이번 범위에서 수정하지 않았다. 배포 로그의 자동 되돌림 알림만으로 DB나 이전 앱의 복구 완료를 단정하지 말고 `status`·`db-check` 결과를 확인해야 한다.
