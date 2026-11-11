# P3-11 디자인 독립 판정

검토자 Codex · 2026-11-11

## 판정

**제공된 캡처 기준 U-18 승인 보류. 상 1건, 중 5건, 하 1건.**

360px 교사 대시보드의 별명 식별, 학생 화면의 알림 겹침, 결과 시트 높이, 터치 영역, 그림 중복을 먼저 고쳐야 한다.

## 검토 범위

- 기준은 PRD 7.1~7.3, 8장 전체, 16.7이다. 화면 동작과 연결되는 F-06·F-08·F-17도 대조했다.
- 학생 캡처 30장 중 18장을 전체 또는 필요한 영역으로 확인했다. `entry-360.png`, `write-360.png`, `panels-360.png`, `common-360.png`의 상태별 견본과 `only-*` 단독 캡처를 함께 봤다. 768·1024·1280px 표본도 대조했다.
- 교사 캡처 117장 중 25장을 확인했다. T0 홈, T1 만들기, T2 준비·연결 점검, T3 대시보드·서랍, T4 서랍 견본, T5 PIN, 등록 상태, 알림·타이머, 설정·내려받기·삭제·기기 시트, 두 종류 QR을 포함했다. 360·768·1024·1280px를 고루 봤다.
- 부품 견본은 `dev-ui-360.png`, `dev-ui-768.png`, `dev-ui-1024.png`를 확인했다. 그림은 `.local/art/P3-8b/board.png`의 기준 캐릭터·그림 2~7번·흰색/크림 바탕·48px 비교를 확인했다.
- 캡처 확대는 PNG를 메모리에서 잘라 읽었다. 크기 판정에는 CSS의 가상 요소로 확장한 터치 영역도 고려했다.
- 검토 도중 `StudentTile.module.css`와 `CodeInput`에 다른 작업의 변경이 생겼다. 아래에 수정 상태를 기록했으며, 수정 후 캡처를 통한 재판정이 남아 있다.

## 발견

### 1. 360px 대시보드에서 여러 학생의 별명이 같게 줄어든다

- **심각도 상**
- **화면 ID** T3
- **캡처** [t3-30-360.png](../../.local/screens/P3-9t/t3-30-360.png), [t3-8-360.png](../../.local/screens/P3-9t/t3-8-360.png)
- **문제** 30명 견본에서 서로 다른 학생들이 `Ha...`, `Na...`로 반복 표시된다. 8명 견본에서도 `G...`, `Ha...`, `So...`처럼 식별에 필요한 글자가 대부분 사라진다. 상태 배지가 별명과 같은 줄을 차지해 별명 폭을 밀어낸다. 교사는 글을 열기 전에 학생을 구분해야 하므로 수업 중 대상 선택을 방해한다. PRD F-17, 7.3, 8.4의 정돈된 출석부·정보 밀도 기준에 어긋난다.
- **코드 근거** 최초 대조 때 `apps/web/src/ui/screens/teacher/StudentTiles.module.css`의 최소 148px 격자와 `apps/web/src/ui/components/StudentTile.module.css`의 별명·배지 가로 배치, 한 줄 말줄임을 확인했다.
- **수정 상태** 마감 대조에서 `StudentTile.module.css`에 `compact` 및 `@container (max-width: 184px)`로 배지를 다음 줄로 내리는 변경을 확인했다. 파일 수정 시각은 18:12:15였고, 해당 캡처는 이 변경을 반영한 증거가 필요하다. 이번 판정에서 수정 후 화면 재확인은 미실행이다.
- **고치는 방향** 좁은 타일에서는 별명에 독립된 줄을 주고 상태를 다음 줄로 옮긴다. 허용 길이의 한글 별명과 앞부분이 같은 별명 여러 개로 식별 가능 여부를 확인한다. 서랍이 열린 900px 전후의 타일 폭에도 같은 기준을 적용한다.

### 2. 학생 알림이 제목·타이머·도움 질문을 덮는다

- **심각도 중**
- **화면 ID** S5, `write-overlays`
- **캡처** [write-360.png](../../.local/screens/P3-9s/write-360.png)의 `S5 write / hold pill + teacher notice + restore toast + urgent timer`
- **문제** 노란 교사 알림이 제목과 타이머 아래쪽을 덮고, 이어지는 라벤더 안내가 `도움 질문` 버튼을 가린다. 상태 안내와 누르는 곳이 같은 자리에 겹쳐 버튼을 알아보고 누르기 어렵다. PRD 7.3의 겹침 없는 반응형, 8.1의 또렷한 조작, 8.4의 누를 곳 구분에 어긋난다.
- **코드 근거** `apps/web/src/ui/screens/student/write/WriteView.module.css` 315~330행에서 알림 묶음을 상단 80px에 고정하고 자식의 포인터 입력을 켠다. 좁은 배치의 두 줄 상단 바와 안내 높이를 반영한 위치 조정이 없다. `WriteView.tsx` 516~518행에서 두 안내를 함께 그린다.
- **고치는 방향** 상단 바 높이를 반영한 전용 안내 자리를 마련하고, 안내가 둘일 때도 제목·타이머·도움 질문의 표시와 터치를 확보한다. 한글 반영 문이 닫힌 동안 입력칸의 값·선택·초점·`readOnly`를 유지하는 계약을 지키면서 배치 층에서 처리한다.

### 3. 긴 AI 결과가 화면 높이의 85%를 차지한다

- **심각도 중**
- **화면 ID** S5 결과 시트, 맞춤법·다듬은 글
- **캡처** [only-panel-spell-360.png](../../.local/screens/P3-9s/only-panel-spell-360.png), [only-panel-polish-done-360.png](../../.local/screens/P3-9s/only-panel-polish-done-360.png)
- **문제** 긴 결과 시트가 상단 제목 바로 아래까지 올라와 원래 글의 쓰기 영역을 가린다. PRD F-06은 900px 미만 결과 패널을 화면 높이 60%의 바텀시트로 정한다. 현재는 내용 길이에 따라 높이가 커져 학생이 자기 글과 결과를 함께 살피기 어렵다. PRD 7.3의 좁은 화면 결과 패널 기준과 연결된다.
- **코드 근거** `apps/web/src/ui/components/Sheet.module.css` 68~77행은 `min-height: 60dvh`, `max-height: 85dvh`로 되어 있다. 해당 단독 캡처의 크기는 각각 360×780px다.
- **고치는 방향** AI 결과용 시트에 60% 높이를 명시하고 결과 본문을 내부 스크롤로 처리한다. 머리·닫기·다시 받기·복사 조작의 자리를 확보한다. 입장 코드와 제출 확인 등 다른 시트의 높이 요구도 함께 확인해 적용 범위를 정한다.

### 4. 교사 PIN의 축소가 실제 입력 영역 높이도 줄인다

- **심각도 중**
- **화면 ID** T1, T5
- **캡처** [t1-first-360.png](../../.local/screens/P3-9t/t1-first-360.png), [t5-error-360.png](../../.local/screens/P3-9t/t5-error-360.png)
- **문제** PIN·시작 코드의 여덟 칸을 가로로 넣기 위해 입력칸 전체에 `zoom`을 적용한다. 360px에서 기본 칸 높이 50px에 0.74가 적용되면 입력 묶음 높이는 37px가 된다. 투명한 실제 입력칸도 그 묶음에 맞춰 줄어든다. PRD 7.3의 터치 영역 최소 48×48px에 못 미친다.
- **코드 근거** `apps/web/src/ui/screens/teacher/CodeKeypadField.module.css` 57~65행의 `zoom: 0.74`·`0.66`, `apps/web/src/ui/components/CodeInput.module.css`의 입력칸 `inset: 0; height: 100%`, `@media (max-width: 380px)`의 기본 칸 높이 50px. 수치는 CSS로 계산했으며 실제 터치 판정은 미실행이다.
- **수정 상태** 검토 도중 공통 `CodeInput`에 작은 칸 변형이 추가되었다. 마감 대조의 `CodeKeypadField.tsx`는 기본 크기를 사용하고 CSS의 `zoom`도 적용 중이다. 작은 칸을 연결할 때도 실제 입력 대상 높이를 확인해야 한다.
- **고치는 방향** 숫자 칸의 시각 크기와 실제 입력 초점 영역을 분리해 입력 대상 높이를 48px 이상 확보한다. 가로 폭을 줄일 때 세로 터치 영역까지 함께 축소되지 않게 한다.

### 5. 제목 입력칸과 메뉴 항목의 48px 터치 영역이 빠져 있다

- **심각도 중**
- **화면 ID** S5 제목·글 종류 메뉴·더 보기 메뉴, 공통 Dropdown·Menu
- **캡처** [only-write-news-360.png](../../.local/screens/P3-9s/only-write-news-360.png), [dev-ui-360.png](../../.local/screens/P3-7/dev-ui-360.png)의 Dropdown·Menu 부품 구역
- **문제** S5 제목 입력칸의 최소 높이가 44px다. 공통 Dropdown·Menu의 목록 항목도 최소 높이 44px이며 터치 영역을 늘리는 규칙이 없다. 짧은 한 줄 항목에서 PRD 7.3의 48px 최소치에 못 미친다. 메뉴 목록이 열린 캡처와 실제 히트 테스트는 미제공·미실행이므로 목록 부분은 코드 근거 판정이다.
- **코드 근거** `apps/web/src/ui/screens/student/write/WriteView.module.css` 73~85행, `apps/web/src/ui/components/Dropdown.module.css` 124~135행, `apps/web/src/ui/components/Menu.module.css` 73~85행.
- **고치는 방향** 실제 입력칸·목록 항목 높이를 48px 이상으로 맞추거나 독립된 확장 영역을 둔다. 인접한 메뉴 항목의 확장 영역이 겹치지 않도록 간격도 확인한다.

### 6. 기다림·한도 결과 패널에 글벗이 두 번 나온다

- **심각도 중**
- **화면 ID** S5, `panel-loading`, `panel-limit`
- **캡처** [panels-360.png](../../.local/screens/P3-9s/panels-360.png), [panels-1280.png](../../.local/screens/P3-9s/panels-1280.png)의 해당 상태
- **문제** 결과 패널 머리에 기본 얼굴이 있고 본문에 책 읽는 글벗 또는 쉬는 글벗이 다시 나온다. 같은 화면에 별도 캐릭터 그림이 두 장이다. PRD 8.1·8.10의 화면당 그림 최대 한 장을 적용하면 위반이다. 이 판정에는 작은 머리 얼굴도 그림으로 포함했다.
- **코드 근거** `apps/web/src/ui/screens/student/write/ResultPanel.tsx` 68행의 머리 그림, 88행의 `showGulbeot`, 107~120행의 본문 그림이 함께 렌더링된다.
- **고치는 방향** 기다림·한도 상태의 읽는/쉬는 글벗을 패널 머리의 한 자리로 모은다. PRD F-08의 패널 머리 글벗과 8.10의 한 장 제한을 함께 충족하게 한다.

### 7. 읽기 전용 AI 메모 카드에 눌리는 카드와 같은 그림자가 있다

- **심각도 하**
- **화면 ID** S5, `panel-feedback`, `panel-direction`
- **캡처** [panels-360.png](../../.local/screens/P3-9s/panels-360.png)의 글벗 한마디·다음 방향, [dev-ui-360.png](../../.local/screens/P3-7/dev-ui-360.png)의 MemoCard
- **문제** 읽고 참고하는 메모 카드마다 아래쪽 종이 그림자가 있다. PRD 8.4는 읽기 전용 카드를 그림자 없는 옅은 선으로 표현해 누르는 곳과 구분하도록 정한다. 결과 목록 안에서 카드가 눌리는지 시각적으로 판단하기 어려워진다.
- **코드 근거** `apps/web/src/ui/components/MemoCard.tsx`는 `article`로 그리며, `MemoCard.module.css` 10행에서 모든 카드에 `--shadow-soft`를 적용한다.
- **고치는 방향** 읽기 전용 메모의 그림자를 제거하고 옅은 선으로 구분한다. 누를 수 있는 맞춤법 항목에는 조작 표시를 둔다.

## 남은 확인

- **900px 경계 시각 검수 미실행.** 제공된 세 캡처 폴더에 900px 파일이 없다. S5의 배치 전환과 T3 서랍 전환은 코드에서 읽었다. 900px 전후에서 결과 패널·타이머를 함께 켠 S5와 서랍을 연 T3의 시각 판정이 남아 있다.
- **실기기 터치·가상 키보드·끌어 닫기·초점·움직임 확인 미실행.** 정적 캡처와 CSS로 확인 가능한 범위까지 판정했다.
- **전체 교사 캡처 전수 검토 미실행.** 이번 표본은 25장이다. 학생·교사의 개발 견본 틀과 단독 화면을 대조했으며, 견본 한 장 안의 여러 상태를 실제 단일 화면으로 합산하지 않았다.
- **자동 검사·시험·타입 검사·빌드·e2e 미실행.** 이번 작업은 제공된 자료의 독립 시각 검토다.

## 실행 기록

이번 작업에서 작성한 파일은 `docs/reviews/P3-11_design_review.md`다.

읽기 명령으로 `rg --files --hidden`, `rg -n`, `cat`, `sed -n`, `nl -ba`를 사용해 기준 문서·캡처 목록·관련 코드를 확인했다. PNG 헤더 조회와 크기 계산에 사용한 `python3` 명령의 전체 출력은 아래와 같다.

```text
.local/screens/P3-9s/only-panel-spell-360.png size= (360, 780)
.local/screens/P3-9s/only-panel-polish-done-360.png size= (360, 780)
.local/screens/P3-9t/t5-error-360.png size= (360, 780)
50px * 0.74 = 37.0 px
.local/screens/P3-9s png= 30 900px= 0
.local/screens/P3-9t png= 117 900px= 0
.local/screens/P3-7 png= 3 900px= 0
```

판정 근거 행을 읽은 명령 묶음의 마지막 명령은 다음과 같다.

```bash
nl -ba apps/web/src/ui/components/Menu.module.css | sed -n '69,91p'
```

그 출력의 마지막 20줄은 다음과 같다.

```text
    72
    73  .item {
    74    display: flex;
    75    align-items: center;
    76    gap: var(--sp-2);
    77    min-height: 44px;
    78    padding: var(--sp-2) var(--sp-3);
    79    border-radius: var(--r-sm);
    80    color: var(--ink);
    81    font-size: var(--fs-body);
    82    font-weight: var(--fw-title);
    83    line-height: 1.3;
    84    cursor: pointer;
    85    user-select: none;
    86  }
    87
    88  .item[data-highlighted] {
    89    background: var(--butter);
    90    outline: none;
    91  }
```

문서의 근거 링크를 읽기 전용으로 검사한 출력은 다음과 같다. 이후 수정은 본문과 수정 상태 설명에 한정했으며 링크 검사 결과를 재사용했다.

```text
보고서 docs/reviews/P3-11_design_review.md
발견 7
심각도 {'상': 1, '중': 5, '하': 1}
근거 링크 13
누락 링크 []
마지막 절 U-18 사용자 승인 전 꼭 고칠 것
```

## U-18 사용자 승인 전 꼭 고칠 것

- [ ] 발견 1의 학생 별명 식별 수정 결과를 새 캡처로 확인한다. 앞부분이 같은 별명 여러 개를 포함해 360px와 서랍을 연 폭에서 확인한다.
- [ ] 발견 2의 상단 알림 겹침을 해소한다. 교사 알림·반영 대기·타이머가 함께 있을 때 제목과 도움 질문의 표시·터치를 확인한다.
- [ ] 발견 3의 AI 결과 시트를 60% 높이에 맞춘다. 긴 맞춤법 목록과 다듬은 글의 내부 스크롤·하단 조작을 확인한다.
- [ ] 발견 4·5의 PIN·제목·메뉴 항목에 실제 48px 터치 영역을 확보한다.
- [ ] 발견 6의 기다림·한도 패널 그림을 화면당 한 장으로 모은다.
- [ ] 발견 7의 읽기 전용 메모 카드 그림자를 제거한다.
- [ ] 수정된 상태의 360px 단독 캡처와 900px 전후 캡처로 남은 시각 판정을 마친다.
