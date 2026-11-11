# 실시간 부하 시험 도구 (`tools/load/`)

PLAN §10.6 및 P5-6 기준에 따라 Node 클라이언트(`@hocuspocus/provider` + `ws` + `yjs`)로 학생 N명과 교사 1명의 실시간 글쓰기·서랍 열람·타일 요약 흐름을 재현하고 지연 시간과 서버 자원을 측정합니다.

## 1. 동작 방식

1. **준비**:
   - REST `POST /api/rooms`로 수업방을 만듭니다(교사 링크 토큰은 기기에서 생성해 해시만 전달).
   - 교사가 `room:{roomId}` 채널에 연결하고 `hello`를 받습니다.
   - 학생 N명이 각각 `POST /api/rooms/{roomId}/join`으로 입장(기기 토큰 생성)한 뒤, 기기마다 웹소켓 1개를 열어 `room:{roomId}` 연결 → `doc.create` 명령 → `doc:{docId}` 연결 및 동기화를 마칩니다.
2. **시뮬레이션**:
   - **학생**: 초당 한글 2~3음절을 본문(`body`)에 연속 입력(3~5초)한 뒤 임의로 3~10초 쉬는 과정을 반복합니다.
   - **교사**: 30초마다 다른 학생의 글 서랍(`doc:{docId}`)을 번갈아 열고, 서랍이 열린 동안 가끔(약 10초 간격, 학생이 멈춘 상태 우선) 한글 한 글자를 덧붙입니다.
3. **표식과 측정**:
   - 글 본문(`body`)에는 표식 문자를 넣지 않고 **순수 가상 한글**만 넣습니다.
   - 입력 시각 매칭용 일련번호(`sSeq`, `tSeq`)는 본문 편집과 같은 Yjs 트랜잭션 안의 `meta` 맵(`doc.getMap('meta')`)과 awareness(`loadProbe`)에 기록해 도착 시각을 잽니다.
   - 타일(`summary.batch`) 반영 지연은 각 입력 시점의 목표 글자 수(`countChars`)가 교사 `room:*` 채널의 `summary.batch`에 도달하는 시각으로 잽니다.

---

## 2. 쓰는 법

```bash
node --conditions=@geulbang/source tools/load/run.ts [옵션]
```

### 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--url <주소>` | `http://127.0.0.1:4461` | 대상 서버 주소 (`--self`가 아닐 때 사용) |
| `--students <수>` | `21` | 동시 접속 학생 수 (교사 1명은 별도 추가) |
| `--minutes <분>` | `40` | 부하 시험 실행 시간(분) |
| `--start-code <코드>` | `LOAD_START_CODE` 환경 변수 | 수업방 생성용 선생님 시작 코드 (`--self`면 기본 `12345678`) |
| `--server-pid <PID>` | `--self`일 때 `process.pid` | 10초마다 `ps`로 CPU·메모리(RSS)를 측정할 서버 프로세스 PID |
| `--self` | `false` | 같은 프로세스에서 시험 서버(`startServer`, 포트 0, `AI_PROVIDER=fake`)를 띄워 정식 흐름으로 실행 |
| `-h`, `--help` | - | 도움말 출력 |

### 짧은 자체 확인 (1분, 학생 3명)

포트 4460·4461·4462를 건드리지 않고 같은 프로세스 안에서 포트 0으로 시험 서버를 띄워 확인합니다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile test -- \
  node --conditions=@geulbang/source tools/load/run.ts --self --students 3 --minutes 1
```

---

## 3. 맥미니에서 두 번 돌리는 법 (PLAN §10.6)

부하 시험 본 실행(40분)은 맥미니에서 **① 한가할 때**와 **② 아바타 빌드가 이미 돌고 있을 때** 두 조건으로 각각 `21명 + 교사 1명`, `30명 + 교사 1명`을 측정합니다.

> **주의**:
> - 부하 시험을 위해 아바타 빌드를 새로 시작하거나 진행 중인 작업을 종료·재시작하지 않습니다(사용자 일정에 맞춰 관찰만 수행).
> - 실행 전 `/Users/bodyking/.local/bin/resource-guard status --profile avatar`로 현재 자원 상태를 먼저 확인합니다.
> - 대상 서버의 PID(`pgrep -f` 또는 `launchctl list`로 확인한 서버 PID)를 `--server-pid`에 넘겨 서버 단독 CPU·메모리를 측정합니다.

### ① 맥미니가 한가할 때

1. 자원 상태와 대상 서버 PID를 확인합니다.
   ```bash
   /Users/bodyking/.local/bin/resource-guard status --profile avatar
   ```
2. 학생 21명 + 교사 1명 (40분):
   ```bash
   LOAD_START_CODE="<시작코드>" \
     node --conditions=@geulbang/source tools/load/run.ts \
     --url http://127.0.0.1:4460 \
     --students 21 \
     --minutes 40 \
     --server-pid <서버PID>
   ```
3. 학생 30명 + 교사 1명 (40분):
   ```bash
   LOAD_START_CODE="<시작코드>" \
     node --conditions=@geulbang/source tools/load/run.ts \
     --url http://127.0.0.1:4460 \
     --students 30 \
     --minutes 40 \
     --server-pid <서버PID>
   ```

### ② 아바타 빌드가 이미 돌고 있을 때

사용자의 아바타 빌드 작업이 이미 실행 중인 시간대에 맞춰(새로 아바타 빌드를 띄우지 않음), 위와 동일한 명령으로 `21명 + 1명`·`30명 + 1명`을 실행해 배경 고부하 상태에서도 서랍·타일 지연과 끊김 기준을 만족하는지 확인합니다.

---

## 4. 결과 읽는 법

실행이 끝나면 표준 출력에 마크다운 표가 출력되고, `.local/load/<시각>.json` 파일이 저장됩니다.

### 통과 기준 (PASS / FAIL)

| 항목 | 측정 지표 | 통과 기준 (PLAN §10.6) |
| --- | --- | --- |
| 학생 입력 → 교사 서랍 도착 | `metrics.studentToDrawer.p95Ms` | **p95 ≤ 1,000 ms** (1초 이하) |
| 학생 입력 → 교사 타일(`summary.batch`) | `metrics.studentToTile.p95Ms` | **p95 ≤ 3,000 ms** (3초 이하) |
| 교사 입력 → 학생 도착 | `metrics.teacherToStudent.p95Ms` | **p95 ≤ 1,000 ms** (1초 이하) |
| 끊김 / 재연결 수 | `metrics.disconnects`, `metrics.reconnects` | **끊김 = 0, 재연결 = 0** |
| 서버 CPU (`ps` 10초 간격) | `metrics.serverCpuAvgPct` | **평균 ≤ 5%** (`--server-pid` 지정 시) |
| 서버 메모리 RSS (`ps` 10초 간격) | `metrics.serverMemMaxMb` | **최대 ≤ 300 MB** (`--server-pid` 지정 시) |

### JSON 결과 파일 구조 (`.local/load/<시각>.json`)

- `startedAt`, `finishedAt`: 시험 시작·종료 시각(ISO 8601)
- `options`: 실행에 사용한 옵션(`url`, `students`, `minutes`, `self`, `serverPid`)
- `thresholds`: 적용된 통과 기준 수치
- `metrics`:
  - `studentToDrawer`, `studentToTile`, `teacherToStudent`: 각각 `{ count, p50Ms, p95Ms, avgMs, maxMs }`
  - `disconnects`, `reconnects`: 시험 중 발생한 비정상 소켓 끊김·재연결 횟수
  - `serverCpuAvgPct`, `serverCpuMaxPct`, `serverMemAvgMb`, `serverMemMaxMb`, `psSampleCount`: `ps` 측정 요약
- `checks`: 각 기준별 `PASS` / `FAIL` / `SKIP`
- `overall`: 전체 통과 여부 (`PASS` 또는 `FAIL`, `FAIL`이면 종료 코드 `1`)
- `psSamples`: 10초마다 기록된 `{ at, cpuPct, rssMb }` 배열
