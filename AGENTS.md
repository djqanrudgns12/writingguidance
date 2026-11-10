# 쌤유 글방 작업 지침 (모든 에이전트 공용)

> Claude·Codex·Antigravity와 Claude 서브에이전트가 이 저장소에서 일할 때 먼저 읽는다. 사용자에게 보이는 출력은 한국어로 쓴다(코드 식별자·명령·경로·고유 명칭은 원문).

## 0. 무엇을 기준으로 하나

| 문서 | 맡는 것 |
|---|---|
| `PRD.md` | **무엇을**: 화면·동작·문구·설정값(12.3)·오류 코드(12.4)·완료 기준(16장). 원본이다 |
| `docs/PLAN.md` | **어떻게**: 구조·모듈·스키마·알고리즘·시험·위임. §11이 지금 phase와 작업 ID |
| `docs/decisions.md` | **왜**: ADR. 특히 036~051 |
| `docs/USER_DECISIONS.md` | 사용자만 정할 수 있는 것 |
| `docs/briefs/<작업 ID>.md` | 맡은 작업의 범위·완료 기준 |

- 우선순위: 사용자의 최신 지시 > PRD > PLAN > decisions. PRD와 PLAN이 어긋나면 PRD가 맞다.
- PRD·PLAN·decisions는 Claude(통합 담당)만 고친다. 어긋남을 찾으면 고치지 말고 보고한다.
- `[고정]`은 바꾸지 않는다. `[추천]`을 더 나은 방법으로 바꾸고 싶으면 이유를 보고한다(ADR은 Claude가 쓴다).

## 1. 역할과 파일 소유

- **Claude**: 통합 담당. 편집기 바인딩·한글 반영 문, 실시간 서버 훅·권한, 프로토콜, AI 흐름, 결합, 문서.
- **Codex**: 시험, 보안·속도 제한·내려받기, 평가·부하 도구, 운영 스크립트, 그림 생성·후처리, 독립 코드 검토.
- **Antigravity**: 부품·화면 배치, 정적 검사 도구, 평가 글 초안, 문구·프롬프트 두 번째 의견, 처리방침 초안.
- 파일 소유는 PLAN §12.2가 기준이다. **맡은 파일 밖은 고치지 않는다.** 밖을 고쳐야 하면 보고에 "고쳐야 할 것"으로 적는다.
- 같은 파일을 두 에이전트가 동시에 고치지 않는다.

## 2. 하지 않는 것

- git commit·push·브랜치 바꾸기·원격 설정. 사용자가 요청할 때 Claude만 한다.
- 배포, `launchd`·터널·`sudo` 실행, 맥미니에서 돌고 있는 서비스 끄기·재시작.
- 비밀값 읽기·쓰기(`.env*`, `secrets/`). API 키를 코드·시험·기록·보고에 넣기.
- 실제 학생 글·이름 쓰기. 시험·평가 데이터는 가상 글만 쓴다.
- 유료 서비스·SDK 추가(LLM API만 예외), 새 결제.
- 다른 저장소 고치기(`../classlearning` 쌤유니버스, rollingthunder 등은 읽기만).
- 평일 08:00~16:00(한국 시각)에 운영 배포·재부팅.
- 아바타 빌드·렌더링을 새로 시작하기.
- 새 의존성 넣기. 필요하면 보고한다(Claude가 ADR-051 규칙으로 넣는다).

## 3. 코드 규칙

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. `any` 금지(바깥 값은 `unknown` + zod).
- 층(PLAN §2.5): `domain`(순수 함수, 외부 패키지 금지) / `application` / `ports` / `adapters` / `ui`. `ui/`는 `adapters/`를 가져오지 않는다.
- **바뀔 수 있는 수치는 `packages/core/src/config.ts`(PRD 12.3)에서만** 온다. 코드·SQL에 숫자를 박지 않는다.
- 오류 코드는 `packages/core/src/errors.ts`(PRD 12.4)에만 있다. 새 코드가 필요하면 보고한다.
- **화면 문구는 `packages/core/src/copy/ko.ts`에만** 쓴다. 화면 파일에 한국어 문자열을 직접 쓰지 않는다. 학생 문구에는 기술 용어(서버, 동기화, 브라우저, 버전, 오류 코드, 에러)를 쓰지 않는다.
- 바깥 입력(HTTP·웹소켓·기기 저장·AI 응답)은 zod로 검증한다. API 봉투는 `{data, requestId}` / `{error:{code,message,retryable,fields}}`. DB는 snake_case·UUID·대문자 상태값.
- 디자인: 색·그림자·모서리·간격·글꼴은 `apps/web/src/ui/tokens.css`의 토큰만 쓴다. 금지: 이모지, 기본 `<select>`, `backdrop-filter`, 그라데이션(공책 줄 제외), 순검정, PRD 8.10 금지 목록 전부. 아이콘은 `<Icon name="…">`만 쓴다.
- 편집기 입력칸(`textarea`·`input`)은 **반영 문이 닫혀 있는 동안** 값·선택·초점·`readOnly`를 건드리지 않는다(PLAN §6.3, PRD 9.3).
- 파일 하나에 책임 하나. 식별자는 영어, 주석은 한국어로 "왜"를 쓴다.

## 4. 검사와 맥미니 자원

- 명령: `npm run check`(형식·타입·검사 도구), `npm run test`, `npm run test:server`, `npm run e2e`, `npm run verify`(넓은 검사).
- 무거운 실행(시험 전체·e2e·빌드)은 `resource-guard`로 감싸고 한 번에 하나만 돌린다. 백그라운드로 떼어 내지 않는다.

```bash
/Users/bodyking/.local/bin/resource-guard run --profile test -- npm run test -- --maxWorkers=1
```

```bash
/Users/bodyking/.local/bin/resource-guard run --profile test -- npx playwright test --workers=1
```

```bash
/Users/bodyking/.local/bin/resource-guard run --profile build -- npm run build
```

- 반환값 75는 자원 대기다(실패가 아님). 바로 다시 돌리지 않고 다른 가벼운 일을 하거나 `--wait-seconds 600`을 쓴다. `RESOURCE_GUARD_ACTIVE=1` 안에서는 겹쳐 부르지 않는다.
- 작업 중에는 바뀐 범위만 검사한다. 넓은 검사는 phase 끝에 Claude가 한 번 돌린다.
- 같은 실패가 세 번이면 고치기를 멈추고 시도·가설·증거를 보고한다.
- 통과시키려고 기대값을 바꾸거나 단언을 약하게 하지 않는다. 일회용 검증 스크립트를 만들지 않는다.

## 5. 포트와 폴더

- 개발 서버 4461, 개발 웹(Vite) 4462. 운영 4460과 터널 메트릭 20242는 건드리지 않는다.
- 개발 DB와 임시 파일은 `.local/`(git 제외). 시안·검토 그림도 `.local/art/`에 두고, 승인된 그림만 `apps/web/src/ui/art/`에 넣는다.

## 6. 보고 형식

- 한국어로 쓴다.
- 바꾼 파일 목록, 돌린 명령과 실제 출력 마지막 20줄, 남은 문제, 확인하지 못한 것. 돌리지 않은 검사는 "미실행"이라고 쓴다.
- 수치·해시·ID는 실제 출력에서 옮긴 것만 쓴다.
