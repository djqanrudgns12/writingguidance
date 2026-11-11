# P5-5a v0 독립 코드 검토

검토자: Codex. 기준: AGENTS.md, PRD §9.3·§12.4·§13, PLAN §2.3·§4·§6.3·§7.4.

애플리케이션 소스와 설치된 Hocuspocus·Yjs 소스를 읽어 검토했다. 아래 재현 시나리오는 **정적 추적으로 도출한 회귀 시험 절차이며 이번 세션에서 실행한 결과가 아니다.** 서버·core 시험은 자원 보호가 실행을 거부했다. 코드 수정 없이 이 보고서만 추가했다. Git 명령·개발 서버 실행·배포·비밀값 파일 접근은 하지 않았다.

## 1. [상] PIN 전역 감속 대기 뒤 잠금을 다시 확인하지 않아 병렬 추측이 한도를 우회한다

- 위치: `apps/server/src/application/enterWithPin.ts:59`–`67` (최초 잠금 검사는 같은 파일의 `assertPinNotLocked` 호출).
- 문제: `assertPinNotLocked`로 기기·IP 잠금을 확인한 다음 `await deps.sleep(delayMs)`로 제어권을 넘긴다. 깨어난 뒤에는 잠금 검사를 다시 하지 않고 PIN을 조회하며, 맞으면 세션을 발급한다. 전역 감속이 켜졌을 때 여러 요청이 실패 카운터가 증가하기 전에 모두 검사 지점을 통과한다. 나중 요청의 PIN이 맞으면 앞 요청들이 이미 잠금 한도를 채웠어도 인증에 성공한다. 실패 응답 쪽에서 `recordPinFailure`가 던져도 이미 수행한 PIN 조회나 성공 경로를 막지 못한다.
- 재현: 전역 실패 칸을 감속 기준 초과 상태로 만들고, 아직 잠기지 않은 동일 기기·IP에서 서로 다른 commandId·세션 해시로 PIN 후보를 동시에 보낸다. 먼저 깨어나는 요청들로 실패 한도를 채우고 뒤 요청 중 하나에 유효 PIN을 둔다. 뒤 요청도 `teacher_sessions`를 만들 수 있다. PRD F-20의 잠금 중 맞는 PIN도 차단한다는 정책을 어긴다.
- 고치는 방향: 지연 뒤 실제 조회 직전에 최신 시각으로 잠금을 다시 확인하고, 조회·실패 기록 사이에는 비동기 간격을 두지 않는다. 지연 중인 병렬 요청과 창 경계 변경을 포함한 회귀 시험이 필요하다.

## 2. [상] Yjs meta 검증이 이벤트 규약보다 느슨해 학생 한 명이 교사 hello를 무효화할 수 있다

- 위치: `apps/server/src/realtime/precheck.ts:101`–`105`. 관련: `apps/server/src/realtime/roomState.ts`의 `refreshDirty`, `apps/server/src/realtime/roomChannel.ts`의 `metaOf`·`buildHello`, `packages/core/src/protocol/room.ts`의 `subtypeId`·`decodeRoomMessage`.
- 문제: meta는 값이 객체인지, 문자열이 제목 길이를 넘는지만 확인한다. 허용 키와 각 값의 의미를 검사하지 않는다. 예를 들어 `meta.set('subtype', '!')`는 통과하지만 수신 규약의 `subtypeId` 정규식에는 맞지 않는다. 서버는 이 문자열을 요약과 hello에 그대로 넣고, 기기는 배열 전체·hello 전체 파싱에 실패해 조용히 버린다. 학생이 수정할 수 있는 자기 문서 값 하나가 교사의 방 재접속을 막는 경로다. 임의 meta 키 수·키 길이·전체 크기도 제한하지 않아 프레임 한도 내 업데이트를 누적하는 방식의 문서 팽창이 가능하다.
- 재현: 정상 학생으로 자기 문서를 연 뒤 subtype을 `!`로 수정한다. 요약 묶음이 갱신된 뒤 교사가 방 채널에 다시 접속하면 `hello.summaries`에 이 값이 포함되고 `decodeRoomMessage`가 null을 반환한다. 학생 자신의 `hello.docs`도 같은 문제를 가진다. 저장 뒤에는 재시작해도 잘못된 subtype이 남는다.
- 고치는 방향: PLAN §4.2의 meta 키만 허용하고 subtype·mood·tempo·cutCount 등 각 값의 타입·범위·카탈로그를 서버 적용 전에 검사한다. 키 수·총량도 제한한다. 이미 저장된 잘못된 값이 방 전체 이벤트를 무효화하지 않도록 처리 방침도 필요하다.

## 3. [상] 두 기기가 빈 메모를 처음 입력하면 한쪽 메모 전체가 사라진다

- 위치: `apps/web/src/adapters/editor/editor.ts:142`–`148`. 관련: `apps/server/src/realtime/commands/docCommands.ts`의 `initialDocState`.
- 문제: 메모가 없으면 기기마다 별도의 `new Y.Text()`를 만들어 동일한 `Y.Map` 키에 넣는다. 두 기기의 최초 입력이 겹치면 글자 단위 병합이 아니라 **서로 다른 Y.Text 객체를 같은 map 키에 대입한 충돌**이 된다. Yjs는 하나의 map 값만 남기므로 다른 쪽 텍스트가 접근 가능한 문서에서 사라진다. 서버 초기 상태에는 공유 메모 객체가 없다. 기존 `review.test.ts`의 새 기기 시험은 입력 전 서버 메모가 도착하는 경우여서 이 경쟁을 검증하지 않는다.
- 재현: 같은 글을 두 기기에 동기화하되 `memo.q1`은 없는 상태로 둔다. 서로의 새 업데이트가 도착하기 전에 A는 q1에 `가`, B는 q1에 `나`를 입력한다. 양쪽 업데이트를 합치면 두 글자가 합쳐지는 대신 한쪽 메모 값만 남는다. 원격 메모가 netDoc에 도착했지만 반영 문 때문에 viewDoc에는 아직 없을 때도 같은 구조의 문제가 생긴다.
- 근거: 설치된 `node_modules/yjs/src/structs/Item.js`의 map 통합 경로는 한 키의 승자 값을 `_map.set`하고 패자 항목을 삭제한다. 같은 객체 내부의 텍스트 삽입 충돌과 다르다.
- 고치는 방향: 문서 생성 시 공통 메모 Y.Text를 서버에서 한 번 만들고 모든 기기가 그 동일 객체를 편집하게 하거나, 동시 최초 생성에도 내용이 보존되는 모델로 바꾼다. 새 기기의 초기 상태를 받기 전 입력 처리도 함께 정해야 한다. PLAN §4.2 변경이 필요하면 Claude가 문서와 함께 결정해야 한다.

## 4. [상] IndexedDB 쓰기 실패를 삼켜 저장되지 않은 글을 기기에 저장한 것처럼 처리한다

- 위치: `apps/web/src/adapters/realtime/docProvider.ts:44`–`57`, `:170`. 관련: `apps/web/src/app/providers.tsx:27`, `apps/web/src/application/submitDoc.ts:13`.
- 문제: `appendUpdate`·`compact` 오류를 `.catch(report)`로 삼킨다. 기본 report는 아무것도 하지 않으며 실제 앱 생성부도 onError를 주입하지 않는다. 따라서 쓰기 실패 뒤에도 `flushLocal()`은 성공한다. 저장 상태에는 기기 저장 실패가 반영되지 않고, 실패한 업데이트를 재시도할 버퍼도 없다. 열기에는 성공했으나 이후 용량 초과·트랜잭션 중단이 난 경우를 잡지 못한다.
- 재현: IndexedDB를 정상으로 연 뒤 오프라인에서 본문을 입력하고 해당 `appendUpdate`만 `QuotaExceededError`로 실패시킨다. 기기는 계속 `local` 상태를 내보내고 `flushLocal()`도 resolve한다. 제출 대기열 쓰기가 별도로 성공하면 본문이 없는 제출만 남을 수도 있다. 탭을 닫고 다시 열면 실패한 편집이 없다. Yjs 후속 증분은 이전 업데이트를 자동으로 다시 포함하지 않으므로 이후 저장 성공만으로도 회복을 보장할 수 없다.
- 고치는 방향: 쓰기 직렬화는 유지하되 마지막 실패와 미기록 업데이트를 보존한다. `flushLocal`이 기록 완료 여부를 정확히 돌려주고, 화면에는 기존 `E_STORAGE_BLOCKED` 경로로 알려야 한다. 실패를 해소하지 못하면 제출 성공 흐름으로 넘어가지 않게 한다.

## 5. [상] 상태 벡터만으로 삭제 변경의 저장·제출 완료를 증명할 수 없다

- 위치: `apps/web/src/adapters/realtime/saveState.ts:27`–`32`, `apps/web/src/adapters/realtime/docProvider.ts:85`–`93`, `apps/server/src/realtime/commands/docCommands.ts:83`–`86`. 제출 경쟁 경로: `apps/web/src/adapters/realtime/session.ts:91`–`92`.
- 문제: Yjs 상태 벡터는 클라이언트별 struct clock을 나타내며 삭제 집합을 포함하지 않는다. 기존 글자만 지운 경우 삭제 전후 벡터가 같다. 따라서 이전 `doc.persisted` 벡터도 최신 삭제를 덮는 것으로 판정하여, 새 삭제가 DB에 저장되기 전 서버 수신 ACK만으로 `saved`가 된다. 서버 제출 검사도 같은 한계가 있다.
- 재현 A: `가나다`의 DB 저장 완료 알림을 받은 뒤 `나`만 지운다. 업데이트 수신 ACK로 unsyncedChanges가 0이 되면 저장 debounce가 끝나기 전에도 기존 persistedVector와 비교해 `saved`가 나온다. 그 사이 서버가 비정상 종료하면 삭제는 DB에 없다.
- 재현 B: 이미 저장된 글에서 오프라인으로 삭제만 하고 제출을 대기열에 넣은 뒤 세션을 다시 연다. room hello가 왔지만 해당 글 제공자가 아직 `openDocs`에 없으면 `waitDocSynced`는 즉시 성공한다. 서버는 같은 상태 벡터만 보고 이전 본문을 SUBMITTED로 저장하고 대기열은 지워진다. 뒤늦게 연결된 제공자의 삭제 업데이트는 제출 잠금 때문에 받아들여지지 않는다. 삽입이 포함된 편집이라면 이 경로가 `E_SYNC_PENDING`으로 남지만 삭제만 있는 경우에는 잘못 성공한다.
- 근거: 설치된 `node_modules/yjs/src/utils/StructStore.js`의 `getStateVector`는 마지막 struct 끝 clock만 읽는다. `node_modules/yjs/src/structs/Item.js`의 `delete`는 deleteSet에 삭제를 기록하고 기존 항목을 표시한다.
- 고치는 방향: 삭제 집합까지 포함하는 저장 확인 계약 또는 모든 변경을 나타내는 서버 저장 revision/ack를 설계한다. 대기열 복구 시에는 대상 글의 기기 사본과 제공자를 실제로 열고 동기화한 뒤 제출해야 한다. 상태 벡터만으로 완료를 증명한다는 PLAN의 가정 자체도 Claude가 수정해야 한다.

## 6. [상] 만료 기기 사본 정리가 호출되지 않고, 이어 쓰기 사본에는 만료 정보도 없다

- 위치: `apps/web/src/app/providers.tsx:21`–`24`, `apps/web/src/adapters/local/localDocStore.ts:134`–`137`, `:162`–`169`, `apps/web/src/application/openWriting.ts:74`·`:85`–`86`.
- 문제: 앱 코드 전체에서 `localStore.purgeExpired`와 `memory.purgeExpired`의 실제 호출부가 없다. 목록 조회가 만료 항목을 화면에서 숨길 뿐 저장된 글·AI 결과·토큰을 삭제하지 않는다. 또한 setDocMeta는 새 글 생성에서만 호출한다. 다른 기기로 기존 글을 열거나 교사가 글을 받아 저장하면 상태 행이 없거나 compact가 `expiresAt:null`로 만들고, purgeExpired를 나중에 연결해도 이 사본은 건너뛴다. PRD F-24·§13.2의 앱 재실행 시 기기 사본 삭제 조건이 충족되지 않는다.
- 재현: 방의 expiresAt 이전에 기기에서 글을 저장한 뒤 expiresAt 이후 앱을 다시 연다. IndexedDB의 doc_state/doc_updates/ai_results와 kv 기억이 정리되지 않는다. 새 기기로 기존 글을 열어 업데이트를 저장·compact한 경우는 직접 purgeExpired를 호출해도 expiresAt이 null이라 남는다.
- 고치는 방향: 앱 시작/복귀 시 만료 정리를 실제로 호출하고, 모든 글 열기 경로에서 roomId·expiresAt을 기록한다. 초기 몇 개 업데이트만 있어 state 행이 아직 없는 사본도 정리 대상으로 식별되어야 한다. 방 삭제·만료 이벤트 및 outbox·기기 기억과의 정리 경계도 통합 담당이 연결해야 한다.

## 7. [중] 문서가 닫혀도 waitSynced가 끝나지 않아 수업방 대기열 전체를 막는다

- 위치: `apps/web/src/adapters/realtime/docProvider.ts:77`–`83`, `:171`–`177`; `apps/web/src/adapters/realtime/outbox.ts:69`, `:88`–`102`.
- 문제: waitSynced의 대기자는 동기화 성공 때만 resolve한다. 문서 close·인증 거부·영구 거절 때는 취소하거나 reject하지 않는다. outbox는 이 promise를 기다리는 동안 running을 유지하므로 다시 flush해도 같은 미완료 작업으로 돌아간다. 대상 제공자를 나중에 새로 열어도 이전 제공자에 등록된 waiter는 새 제공자를 따라가지 않는다.
- 재현: 동기화가 끝나지 않은 글 A의 제출을 큐에 넣고 방 채널은 유지한 채 A 제공자를 닫는다. 이후 B의 제출을 넣거나 A를 다시 열어도 outbox의 첫 실행은 예전 A의 waiter에서 멈춰 뒤 명령까지 보내지 못한다. 서버가 A 업데이트를 영구 거부한 상태에서도 같은 대기 문제가 있다.
- 고치는 방향: waitSynced에 취소·종료·실패 처리를 추가하고 outbox가 이를 받아 running을 해제하도록 한다. 현재 await가 try 밖에 있으므로 단순히 reject만 추가하는 것으로는 부족하다. 일시 중단은 기록을 보존하고 새 제공자에 다시 연결해 재시도해야 한다.

## 8. [중] 수업방 채널은 일시적인 서버 인증 훅 실패를 영구 E_AUTH로 바꾼다

- 위치: `apps/web/src/adapters/realtime/roomChannel.ts:114`–`119` 및 `:123`–`126`.
- 문제: 알 수 없는 authenticationFailed.reason을 모두 E_AUTH로 변환하고 provider를 detach한다. 서버의 일반 예외는 Hocuspocus가 `permission-denied`로 전달하므로 일시 DB 오류 등도 무효 토큰처럼 처리되어 자동 복구되지 않는다. 소켓이 살아 있는 상태에서 room 문서 연결만 닫히는 경우에도 connecting으로만 바꾸고 attach를 다시 하지 않는다. stale 타이머는 ready일 때만 재접속하므로 이 상태를 회복시키지 못한다. 같은 저장소의 docProvider에는 이 두 상황에 대응하는 reattachSoon 경로가 있다.
- 재현: 유효 토큰으로 room 인증 중 repos 조회를 한 번만 일반 Error로 실패시킨 뒤 복구한다. 서버가 permission-denied를 보내면 기기는 failed/E_AUTH로 고정되고 제공자가 떨어진다. 또는 소켓을 유지한 채 서버에서 room 문서 연결만 닫으면 hello가 재발급되지 않은 채 connecting에 남는다.
- 근거: 설치된 `node_modules/@hocuspocus/server/src/ClientConnection.ts`의 인증 catch는 `error.reason ?? 'permission-denied'`를 보낸다. PLAN §4.7 대응 4는 이 경우 소켓에 제공자를 다시 붙이도록 명시한다.
- 고치는 방향: docProvider처럼 명시적인 우리 오류 코드와 내부 실패를 구분하고, 내부 실패·문서 단위 close는 제한된 재인증으로 복구한다. 실제 E_AUTH·E_FORBIDDEN 등만 영구 거부로 처리한다.

## 남은 검증과 수정 범위

- 위 8건은 정적 코드 경로에서 확인한 결함이다. 통합 재현 결과·실기기 결과로 간주하면 안 된다.
- 수정 대상은 Claude 소유 서버·프로토콜·편집기·앱 결합 파일이다. 이 검토에서 고치지 않았다. 특히 3번과 5번은 프로토콜/문서 모델 결정이 먼저 필요하다.
- 서버·core 시험: **미실행**(자원 입장 거부). 웹 단위·통합·e2e·브라우저·실제 IME·프록시 환경 확인: **미실행**. 기존 시험 통과 결과 **재사용 없음**.
- 권한·PIN·속도 제한·로그·규약·기기 저장·반영 문 소스와 주요 호출부를 확인했으나, 이 보고서는 보안 무결함 보증이나 v0 출시 승인서가 아니다.

## 실행 명령과 실제 출력

읽기 명령은 `pwd`, `rg`/`rg --files`, `cat`, `sed -n`, `nl -ba`로 기준 문서, 지정 소스, 관련 시험, 설치된 라이브러리 구현을 조회했다. 메모리 레지스트리에서 `writeessay|글방` 검색 결과는 없었다. 한 조회에서 `apps/web/src/composition*`가 zsh에 매칭되지 않아 `no matches found`가 났으며, 실제 범위인 `apps/web/src`로 바꿔 조회했다. 검증 실행은 아래 한 번뿐이다.

```sh
/Users/bodyking/.local/bin/resource-guard status --profile avatar
```

실제 출력 마지막 20줄:

```text
        "종류": "아바타 제작 작업"
      },
      {
        "pid": 42538,
        "종류": "빌드·시험 작업"
      },
      {
        "pid": 42556,
        "종류": "빌드·시험 작업"
      }
    ]
  },
  "판단": {
    "allowed": false,
    "workers": 0,
    "reasons": [
      "기존 고부하 작업이 실행 중"
    ]
  }
}
```

```sh
/Users/bodyking/.local/bin/resource-guard run --profile test -- npx vitest run --project server --project core --maxWorkers=1
```

종료값 `75`. 출력은 한 줄뿐이며 시험 프로세스는 실행되지 않았다.

```text
새 작업 보류: 기존 고부하 작업이 실행 중. 기존 작업은 그대로 유지합니다.
```
