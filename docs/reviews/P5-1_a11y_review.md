# P5-1 접근성 점검 보고서

점검 범위: `apps/web/src/ui/components/**`, `apps/web/src/ui/screens/**`, `apps/web/src/app/{student,teacher}/**`, `apps/web/src/ui/tokens.css`, `apps/web/src/ui/base.css`
기준 문서: `AGENTS.md` §3, `PRD.md` §8·§16.5·§16.7, `docs/PLAN.md` §6.3·§9

> **반영 문 규칙(PLAN §6.3, PRD 9.3) 준수 원칙**: 아래 모든 수정 방향은 편집기 입력칸(`textarea`, 제목 `input`, 메모 `textarea`)의 값·선택·초점·`readOnly`를 직접 건드리지 않는 범위에서만 제안한다.

---

## 1. 발견 목록 (심각도순)

### [상-1] 교사 대시보드 학생 글 서랍(`StudentDrawer`)의 키보드 초점 이동·복귀 및 좁은 화면 모달 격리 누락

- **심각도**: 상
- **파일:줄**:
  - `apps/web/src/ui/screens/teacher/Dashboard.tsx:198-208`
  - `apps/web/src/ui/screens/teacher/Dashboard.module.css:121-127`
  - `apps/web/src/ui/screens/teacher/StudentDrawer.tsx:88-102`
  - `apps/web/src/app/teacher/DashboardRoute.tsx:168-182, 355-370`
- **무엇이 문제인가**:
  1. **열 때 초점 미이동**: `StudentTilesGrid`에서 앞쪽 학생 타일을 `Enter`/`Space`로 눌러 서랍을 열어도 초점이 그 타일에 남는다. 서랍 슬롯(`.drawerSlot`, `Dashboard.tsx:208`)은 타일 그리드 뒤쪽에 렌더링되므로, 키보드 사용자는 서랍의 닫기·되돌리기·복사 단추에 닿기 위해 나머지 학생 타일(최대 29개)을 전부 `Tab`으로 지나가야 한다.
  2. **좁은 화면(< 900px) 모달 초점 가두기 및 `Escape` 닫기 누락**: `Dashboard.module.css:122-127`에서 `@media (max-width: 899px)`일 때 `.drawerSlot`은 `position: fixed; inset: 0; z-index: 30`으로 화면 전체를 덮는 모달 레이어가 되지만, `role="dialog"`·`aria-modal="true"`·초점 가두기(focus trap)·`Escape` 닫기가 없다. 그 결과 전체 화면 서랍 뒤로 가려진 대시보드 머리말·타일들로 `Tab` 초점이 빠져나간다.
  3. **닫을 때 초점 유실**: 서랍의 닫기(`×`) 단추(`StudentDrawer.tsx:99`)를 누르면 `<aside>`가 언마운트되면서 초점이 원래 열었던 `StudentTile` 단추로 돌아가지 않고 `document.body`로 사라진다.
- **WCAG 기준 번호**: 2.1.1 (Keyboard), 2.4.3 (Focus Order), 4.1.2 (Name, Role, Value)
- **고치는 방향**:
  - 반영 문 규칙(PLAN §6.3)상 서랍 안의 제목 `input`·본문 `textarea`에는 코드로 `focus()`를 호출하지 않는다. 대신 서랍이 열릴 때 **서랍 닫기 단추(`closeRef`) 또는 서랍 컨테이너(`<aside tabIndex={-1}>`)**로 초점을 옮기고, 닫힐 때 해당 학생 타일 단추(`data-participant-id` 등으로 참조)로 초점을 돌려준다.
  - 900px 미만에서는 `Escape` 키로 닫히게 하고, 뒤쪽 `.board` 영역에 `inert` 속성을 부여해 초점이 배경으로 새지 않게 막는다.

```tsx
// StudentDrawer.tsx (초점 진입: 편집기 입력칸이 아닌 닫기 단추로 이동)
const closeRef = useRef<HTMLButtonElement>(null);
useEffect(() => {
  closeRef.current?.focus();
}, []);

// Dashboard.tsx (좁은 화면에서 서랍이 열렸을 때 뒤쪽 보드 비활성화 및 닫을 때 타일 복귀)
<div className={styles.board} inert={Boolean(drawer && isCompact) || undefined}>
  ...
</div>
```

---

### [상-2] `SaveState`의 상시 `aria-live="polite"`로 인한 타이핑 중 반복 음성 공해

- **심각도**: 상
- **파일:줄**:
  - `apps/web/src/ui/components/SaveState.tsx:38`
  - `apps/web/src/adapters/realtime/saveState.ts:20-25`
  - `apps/web/src/ui/screens/student/write/WriteView.tsx:278-285`
- **무엇이 문제인가**:
  - `computeSaveState`(`saveState.ts:20-25`)는 학생이 글자를 입력해 `unsynced > 0`이거나 서버 저장 확인 전이면 `'sending'`(`보내는 중`)을 반환하고, 서버 확인 직후 `'saved'`(`저장됨`)로 돌아온다.
  - 그런데 `SaveState.tsx:38`이 `<span role="status" aria-live="polite" className={...}>`로 고정되어 있어, 학생이 글을 쓰는 내내 몇 초마다 스크린 리더가 `"보내는 중"`, `"저장됨"`을 끝없이 끼어들며 읽는다.
- **WCAG 기준 번호**: 4.1.3 (Status Messages)
- **고치는 방향**:
  - 일상적인 `'sending' ↔ 'saved'` 왕복은 라이브 알림에서 제외(`aria-live="off"`)하고, 연결이 끊겨 `'local'`(`여기에만 저장`)로 바뀔 때나 `'pending'`(`제출 대기`)·`'submitted'`(`제출 완료`)처럼 학생이 인지해야 하는 전환만 읽히도록 조건부로 설정한다.

```tsx
// apps/web/src/ui/components/SaveState.tsx
const announce = state === 'local' || state === 'locked';
return (
  <span
    role="status"
    aria-live={announce ? 'polite' : 'off'}
    className={[styles.save, styles[state], className].filter(Boolean).join(' ')}
  >
    <Icon name={ICON_MAP[state]} size={16} />
    <span>{ko.student[LABEL_KEY[state]]}</span>
  </span>
);
```

---

### [중-1] 좁은 화면 AI 칩(`AiChipBar`)의 `aria-label` 덮어쓰기 및 상태 정보(`stale`·`cooldown`·`fresh`) 누락

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/screens/student/write/AiChipBar.tsx:29-37, 92-106`
  - `apps/web/src/ui/components/Chip.tsx:127-143`
  - `apps/web/src/ui/components/Chip.module.css:58-80`
- **무엇이 문제인가**:
  1. **쿨다운·한도 상태 누락**: 900px 미만(`short === true`)에서 `AiChipBar.tsx:98`이 `aria-label={short ? label.full : undefined}`를 넘긴다. 버튼에 `aria-label`이 지정되면 자식 텍스트(`statusText`)가 접근성 이름 계산에서 무시되므로, 쿨다운 중 화면에 표시되는 `"7초"`나 `"오늘 다 썼어요"`가 스크린 리더에서는 완전히 사라지고 `"맞춤법"`으로만 읽힌다.
  2. **`stale` 상태의 색 단독 의존 및 무음 처리**: 900px 미만에서 `chipStatusText`(`AiChipBar.tsx:35`)는 `stale`·`guide`·`offline`의 보조 문구를 `''`로 비운다. 특히 `stale`(`글이 바뀌었어요`) 상태는 `.ai_stale`(`Chip.module.css:77-80`)이 배경만 `--surface`(`#FFFFFF`)에서 `--bg`(`#FFF8EF`, 명도 대비 **1.05:1**)로 바꿀 뿐 아이콘도 테두리도 같아, 시각적으로도 구분할 수 없고 스크린 리더에도 전달되지 않는다.
  3. **`fresh` 점(`freshDot`) 정보 누락**: `Chip.tsx:140`의 `<span className={styles.freshDot} aria-hidden="true" />`는 시각적으로만 새 결과가 도착했음을 표시하고 접근성 이름에는 반영되지 않는다.
- **WCAG 기준 번호**: 1.4.1 (Use of Color), 1.4.11 (Non-text Contrast), 4.1.2 (Name, Role, Value)
- **고치는 방향**:
  - `AiChipBar`에서 전체 상태 문구(`fullStatusText`)를 구해 `aria-label`에 함께 합쳐 넘기고, `.ai_stale`에는 점선 테두리(`border-style: dashed`) 등 비색상 단서를 추가한다.

```tsx
// apps/web/src/ui/screens/student/write/AiChipBar.tsx
const fullStatus = chipStatusText(chip, false);
const ariaLabel = fullStatus ? `${label.full}, ${fullStatus}` : label.full;

<Chip
  key={chip.button}
  variant="ai"
  aiState={chip.state}
  icon={CHIP_ICONS[chip.button]}
  statusText={statusText || undefined}
  disabled={disabled}
  aria-label={ariaLabel}
  aria-expanded={activeButton === chip.button}
  onClick={() => onChipClick(chip.button)}
>
  {short ? label.short : label.full}
</Chip>
```

---

### [중-2] `Chip` 부품의 무조건적인 `aria-pressed` 부여로 인한 버튼 의미 충돌

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/components/Chip.tsx:121, 131`
  - `apps/web/src/ui/screens/student/write/AiChipBar.tsx:99`
  - `apps/web/src/ui/screens/student/write/WriteView.tsx:430-453`
  - `apps/web/src/ui/screens/teacher/NoticePanel.tsx:93-97`
- **무엇이 문제인가**:
  - `Chip.tsx:121, 131`에서 `selected = false` 기본값 때문에 모든 `<Chip>`에 `aria-pressed={false}`가 붙는다.
  - **AI 칩(`AiChipBar.tsx:99`)**: `selected`를 넘기지 않고 `aria-expanded={activeButton === chip.button}`만 넘기므로, 결과 패널이 열려 있을 때 `aria-pressed="false" aria-expanded="true"`("눌리지 않음, 펼쳐짐")라는 모순된 상태가 된다.
  - **도움 질문 열기 칩(`WriteView.tsx:431`)**: `selected={helpOpen}`과 `aria-expanded={helpOpen}`이 동시에 붙어 토글 상태가 중복 낭독된다.
  - **구조 삽입 단추(`WriteView.tsx:443`) 및 자주 쓰는 알림 문구 칩(`NoticePanel.tsx:94`)**: 누르는 즉시 본문에 머리말을 넣거나 알림을 바로 전송하는 단발성 실행 단추인데 `aria-pressed="false"`가 붙어 토글 단추("선택 안 됨")로 잘못 읽힌다.
- **WCAG 기준 번호**: 4.1.2 (Name, Role, Value)
- **고치는 방향**:
  - `Chip.tsx`에서 `selected`의 기본값을 없애고, 호출부가 `selected`를 명시했을 때만 `aria-pressed={selected}`를 렌더링한다.

```tsx
// apps/web/src/ui/components/Chip.tsx
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    variant = 'filter',
    selected,
    aiState = 'idle',
    ...
  },
  ref,
) {
  ...
  return (
    <button
      ref={ref}
      type="button"
      disabled={ isDisabled }
      aria-pressed={selected}
      className={classes}
      {...rest}
    >
```

---

### [중-3] 학생 글벗 결과 패널(`ResultPanel`)의 열기·닫기 초점 미관리

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/components/Sheet.tsx:160-161`
  - `apps/web/src/ui/screens/student/write/ResultPanel.tsx:69-107`
  - `apps/web/src/ui/screens/student/write/WriteView.tsx:460-482`
- **무엇이 문제인가**:
  1. 바텀시트 형태(`placement === 'sheet'`)일 때 `ResultPanel`은 `<Sheet modal={false}>`를 쓰는데, `Sheet.tsx:160-161`이 `initialFocus={modal ? undefined : false}`, `finalFocus={modal ? undefined : false}`로 초점 이동과 복귀를 모두 끈다.
  2. 옆 패널 형태(`placement === 'side'`, `<Panel>`)도 열릴 때와 닫힐 때 초점을 관리하지 않는다.
  3. 그 결과 키보드 사용자가 하단 AI 칩을 눌러 결과 패널을 열어도 초점이 패널 안으로 가지 않으며, 특히 패널 안의 닫기(`×`) 단추를 눌러 패널을 닫으면 초점이 자신을 열었던 **AI 칩 단추**로 돌아가지 않고 `document.body`로 유실된다.
- **WCAG 기준 번호**: 2.4.3 (Focus Order)
- **고치는 방향**:
  - 쓰기 칸(`textarea`·`input`)의 초점은 절대 건드리지 않되, 사용자가 AI 칩을 눌러 패널을 열고 패널의 닫기(`×`) 단추나 `Escape`로 닫을 때는 해당 AI 칩 단추로 초점이 돌아가도록 관리한다(또는 `Sheet`에 `finalFocus` 대상 ref를 넘길 수 있게 한다).

---

### [중-4] `Dropdown` 및 `Menu` 항목의 키보드 하이라이트(`data-highlighted`) 초점 대비 미달

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/components/Dropdown.module.css:138-141`
  - `apps/web/src/ui/components/Menu.module.css:88-91`
- **무엇이 문제인가**:
  - `Dropdown.module.css:138-141`: `.item[data-highlighted] { background: var(--bg); outline: none; }`로 선언되어 있다. 팝업 바탕 `--surface`(`#FFFFFF`)와 `--bg`(`#FFF8EF`)의 명도 대비는 **1.05:1**이며 `outline: none`으로 테두리까지 제거해, 키보드 화살표 키로 드롭다운 항목을 이동할 때 현재 초점 위치를 시각적으로 식별할 수 없다.
  - `Menu.module.css:88-91`: `.item[data-highlighted] { background: var(--butter); outline: none; }` 역시 테두리 없이 배경(`#F7D98B` vs `#FFFFFF`, 대비 **1.38:1**)만 바뀌어 비텍스트 대비 기준(3:1)과 PRD 8.4의 보이는 초점 규칙(`--ink` 2px + `--butter` 띠)에 미달한다.
- **WCAG 기준 번호**: 2.4.7 (Focus Visible), 1.4.11 (Non-text Contrast)
- **고치는 방향**:
  - `data-highlighted` 상태에 `--ink` 2px 안쪽 테두리(`outline`)와 `--butter` 배경을 함께 적용한다.

```css
/* Dropdown.module.css & Menu.module.css */
.item[data-highlighted] {
  background: var(--butter);
  outline: 2px solid var(--ink);
  outline-offset: -2px;
}
```

---

### [중-5] 선택/활성 상태의 `Chip`·`TimerPill` 내부 보조 글자(`--ink-sub`) 명도 대비 미달

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/components/Chip.module.css:35-39, 62-66, 100-104`
  - `apps/web/src/ui/components/TimerPill.tsx:38-45`
  - `apps/web/src/ui/components/TimerPill.module.css:34-43, 51-54`
- **무엇이 문제인가**:
  1. `Chip.module.css:100-104`의 `.status`는 `color: var(--ink-sub)`(`#7A6759`, 14px)로 고정되어 있다. 칩이 `.selected`(배경 `--butter` `#F7D98B`)일 때 대비는 **3.90:1**, `.ai_fresh`(배경 `--sage` `#A9C9A4`)일 때 대비는 **2.96:1**로 본문 대비 기준(4.5:1)에 미달한다.
  2. `TimerPill.tsx:38-45`에서 타이머가 남은 시간 5분 이하(`.warn`, 배경 `--butter`) 또는 10초 이하(`.urgent`, 배경 `--rose` `#EE9A8E`)인 상태로 일시정지되면 `.paused`(`color: var(--ink-sub)`, 14px)가 함께 렌더된다. 이때 `--butter` 위 `--ink-sub`는 **3.90:1**, `--rose` 위 `--ink-sub`는 **2.47:1**로 기준(4.5:1)에 크게 미달한다.
- **WCAG 기준 번호**: 1.4.3 (Contrast Minimum)
- **고치는 방향**:
  - 채색 배경(`.selected`, `.ai_fresh`, `.warn`, `.urgent`) 위에서는 내부 보조 글자(`.status`, `.paused`)도 `color: var(--ink)`를 쓰도록 상속하거나 덮어쓴다(`--butter` 위 `--ink`는 7.77:1, `--sage` 위 `--ink`는 5.90:1, `--rose` 위 `--ink`는 4.92:1).

```css
/* Chip.module.css */
.selected .status,
.ai_fresh .status {
  color: var(--ink);
}

/* TimerPill.module.css */
.warn .paused,
.urgent .paused {
  color: var(--ink);
}
```

---

### [중-6] `CodeKeypadField`의 레이블·오류·안내 문구가 `<input>`과 연결되지 않음 + `CodeInput` 작은 칸(`slotSm`) 42px 미달

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/screens/teacher/CodeKeypadField.tsx:63-88`
  - `apps/web/src/ui/components/CodeInput.tsx:50-56, 152-168`
  - `apps/web/src/ui/components/CodeInput.module.css:64-68, 130-134, 152-156`
- **무엇이 문제인가**:
  1. `CodeKeypadField.tsx:64-87`은 `error`와 `hint`를 `CodeInput`의 `errorMessage`·`invalid` prop으로 넘기지 않고 바깥 `<p className={styles.error}>`, `<p className={styles.hint}>`로 따로 그린다. 그 결과 오류가 나도 실제 `<input>`에는 `aria-invalid="true"`와 `aria-describedby`가 연결되지 않으며, 숫자 칸의 오류 테두리(`.slotError`)도 표시되지 않는다. 또한 보이는 제목 `<span className={styles.label}>`이 `<label htmlFor>`가 아니라서 눌러도 입력칸으로 초점이 가지 않는다.
  2. `CodeInput.module.css:130-134, 152-156`에서 `size="sm"`(`.slotSm`)은 380px 이하 화면/340px 이하 컨테이너에서 `height: 42px`로 줄어들어 교사 최소 기준(44px)과 학생 최소 기준(48px)에 미달한다(`CodeKeypadField.module.css:47-50`에서 임시 보정 중).
- **WCAG 기준 번호**: 1.3.1 (Info and Relationships), 3.3.1 (Error Identification), 2.5.8 (Target Size Minimum)
- **고치는 방향**:
  - `CodeKeypadField`가 `invalid={Boolean(error)}`와 `errorMessage={error}`를 `CodeInput`에 전달하거나 `aria-describedby`로 직접 연결하고, `CodeInput.module.css`의 `.slotSm` 최소 높이를 `44px` 이상으로 유지한다.

---

### [중-7] 교사 연결 점검(`ConnectionCheckView`)에서 항목별 상태(`pending`·`running`·`ok`)가 스크린 리더에 전달되지 않음

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/screens/teacher/ConnectionCheck.tsx:84-106`
- **무엇이 문제인가**:
  - 각 점검 항목(`실시간 연결`, `글벗(AI)`, `기기 저장`)의 상태를 나타내는 `<Icon name={ICON_BY_STATE[state]} size={20} />`에 `label` prop을 주지 않아 `aria-hidden="true"`로 숨겨진다.
  - 실패(`fail`)일 때만 실패 안내 문구가 붙고, `pending`(대기)·`running`(확인 중)·`ok`(통과)일 때는 `<li>` 안에 항목 이름만 남아 스크린 리더 사용자는 어떤 항목이 진행 중이고 어떤 항목이 통과했는지 알 수 없다.
- **WCAG 기준 번호**: 1.1.1 (Non-text Content), 1.3.1 (Info and Relationships), 1.4.1 (Use of Color)
- **고치는 방향**:
  - 상태 아이콘에 상태 이름을 `label`로 넘기거나 항목 안에 상태 텍스트를 함께 제공한다.

---

### [중-8] 교사 학생 상태(`writing` vs `writing-flow`)의 스크린 리더 구분 불가 및 멈춤(`idle`) 상태 띠 대비 미달

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/components/StatusBadge.tsx:30-51`
  - `apps/web/src/ui/components/StatusBadge.module.css:16-25, 47-54`
  - `apps/web/src/ui/components/StudentTile.module.css:24-31`
- **무엇이 문제인가**:
  1. `writing`(최근 30초 입력)과 `writing-flow`(30~180초 입력)는 문구가 둘 다 `쓰는 중`(`ko.teacher.statusWriting`)이고 아이콘도 둘 다 `write`다. 시각적으로는 배지 바탕색과 16px 아이콘 내부 20% 반투명 면(`.icon-tone`) 유무로만 구별하며, 스크린 리더에서는 두 상태의 접근성 이름이 100% 같아 전혀 구분할 수 없다.
  2. `StudentTile.module.css:29-31`에서 멈춤(`.stripe_idle`) 상태의 왼쪽 4px 띠 색 `--butter`(`#F7D98B`)는 타일 바탕 `--surface`(`#FFFFFF`) 대비 **1.38:1**로 비텍스트 대비 기준(3:1)에 미달한다.
- **WCAG 기준 번호**: 1.4.1 (Use of Color), 1.4.11 (Non-text Contrast), 4.1.2 (Name, Role, Value)
- **고치는 방향**:
  - `writing-flow` 배지 또는 타일에 보조 설명(예: 마지막 입력 경과 시간과 결합하거나 구분 가능한 보조 레이블)을 제공하고, `.stripe_idle`은 `--butter` 대신 테두리나 더 진한 황토/호박 계열 또는 패턴을 함께 사용한다.

---

### [중-9] 이어 쓰기 요청(`ResumeRequestsBand`)과 기기 목록(`DevicesPanelView`)의 반복 단추 이름 미구분

- **심각도**: 중
- **파일:줄**:
  - `apps/web/src/ui/screens/teacher/DashboardBands.tsx:48-63`
  - `apps/web/src/ui/screens/teacher/DevicesSheet.tsx:38-62`
- **무엇이 문제인가**:
  1. `ResumeRequestsBand`: 여러 학생이 동시에 이어 쓰기를 요청했을 때 각 줄의 `<Button>` 접근성 이름이 학생 별명 없이 `"허용"`, `"거절"`로만 반복된다.
  2. `DevicesPanelView`: 기기 번호 배지(`<span className={styles.index} aria-hidden="true">{i + 1}</span>`, `DevicesSheet.tsx:40`)가 숨겨져 있고, 각 줄의 `<Button>` 이름은 모두 `"기기 연결 끊기"`로만 반복되어 스크린 리더 단추 목록에서 어느 기기를 끊는지 알 수 없다.
- **WCAG 기준 번호**: 2.4.6 (Headings and Labels), 4.1.2 (Name, Role, Value)
- **고치는 방향**:
  - `ResumeRequestsBand`의 허용·거절 단추에 `aria-label={`${req.nickname} ${ko.teacher.approveAction}`}`을 부여하고, `DevicesPanelView`의 기기 번호 배지에서 `aria-hidden`을 제거한 뒤 단추를 해당 기기 정보(`id`)와 `aria-describedby`로 연결한다.

---

### [하-1] `QrFullscreenView` 전체 화면 대화상자의 초점 가두기(Focus Trap) 및 닫을 때 초점 복귀 누락

- **심각도**: 하
- **파일:줄**:
  - `apps/web/src/ui/screens/teacher/QrFullscreen.tsx:33-53`
- **무엇이 문제인가**:
  - `<div role="dialog" aria-modal="true">`로 모달 대화상자를 직접 구성했으나 Base UI `Dialog`를 쓰지 않아, `Tab`을 누르면 뒤쪽 `RoomPrep`·`Dashboard` 화면의 단추들로 초점이 빠져나간다. 또한 닫기 단추나 `Escape`로 닫을 때 원래 열었던 `QR 크게 띄우기` 단추로 초점을 되돌리지 않는다.
- **WCAG 기준 번호**: 2.4.3 (Focus Order)
- **고치는 방향**:
  - 열릴 때 `document.activeElement`를 기억했다가 언마운트 시 복원하고, 대화상자 안 유일한 대화형 요소인 닫기 단추에서 `Tab` 키를 가로채거나 Base UI `Dialog.Root`로 감싼다.

---

### [하-2] 시간 되감기(`RewindSheet`) 미리보기 영역의 `div[aria-label]` 무시 및 키보드 스크롤 불가

- **심각도**: 하
- **파일:줄**:
  - `apps/web/src/ui/screens/student/write/RewindSheet.tsx:88-96`
  - `apps/web/src/ui/screens/student/write/RewindSheet.module.css:8-11`
  - `apps/web/src/ui/screens/teacher/RewindSheet.tsx:78-87`
  - `apps/web/src/ui/screens/teacher/RewindSheet.module.css:19-26`
- **무엇이 문제인가**:
  1. 학생용 `RewindSheet.tsx:88`의 `<PaperCard readOnly aria-label={ko.common.rewindPreviewLabel}>`는 기본 태그가 역할 없는 `<div>`여서 `aria-label`이 보조기기에 무시될 수 있다(교사용 `RewindSheet.tsx:78`은 `as="section"`을 사용함).
  2. 학생·교사 양쪽 미리보기 영역(`.preview`) 모두 `max-height: 40dvh`(교사 `36dvh`), `overflow-y: auto`인 스크롤 컨테이너인데 `tabIndex={0}`이 없어 키보드 화살표·`PageDown`으로 긴 지난 글을 스크롤할 수 없다.
- **WCAG 기준 번호**: 2.1.1 (Keyboard), 4.1.2 (Name, Role, Value)
- **고치는 방향**:
  - 학생용 `RewindSheet`의 `PaperCard`에도 `as="section"`을 지정하고, 양쪽 미리보기 컨테이너에 `tabIndex={0}`을 부여한다(읽기 전용 미리보기 카드이므로 편집기 반영 문 규칙에 저촉되지 않는다).

---

### [하-3] `role="status"` 라이브 영역 안에 대화형 `<button>` 포함 (`NicknameView`, `ResumeWaitView`)

- **심각도**: 하
- **파일:줄**:
  - `apps/web/src/ui/screens/student/NicknameView.tsx:73-85`
  - `apps/web/src/ui/screens/student/ResumeWaitView.tsx:40-52`
- **무엇이 문제인가**:
  - 별명 중복 안내 카드(`NicknameView.tsx:73`)와 이어 쓰기 대기 카드(`ResumeWaitView.tsx:40`)에서 `<button>`(`내 글이에요`, `다른 별명 쓸래요`, `취소`)까지 감싸는 부모 `<PaperCard>` 전체에 `role="status" aria-live="polite"`를 부여했다. 라이브 영역 안에 대화형 요소를 넣으면 상태 알림 시 버튼 이름까지 한꺼번에 읽히고 자식 요소의 역할 탐색이 방해받는다.
- **WCAG 기준 번호**: 4.1.2 (Name, Role, Value), 4.1.3 (Status Messages)
- **고치는 방향**:
  - `role="status" aria-live="polite"`는 안내 문구(`<p>`)를 감싸는 요소에만 두고, 행동 단추(`<div className={styles.actions}>`)는 그 밖에 배치한다.

---

### [하-4] 학생 별명 화면(`NicknameView`)과 쓰기 화면(`WriteView`)의 `<h1>` 및 `<main>` 랜드마크 누락

- **심각도**: 하
- **파일:줄**:
  - `apps/web/src/ui/screens/student/NicknameView.tsx:50-54`
  - `apps/web/src/ui/screens/student/write/WriteView.tsx:354-365`
- **무엇이 문제인가**:
  - `NicknameView`는 `<main>` 안에 `<p className={styles.room}>`과 `<label>`만 있고 화면 수준 `<h1>` 제목이 없다.
  - `WriteView`는 `<header>`만 있고 본문 영역이 `<div className={styles.main}>`으로 되어 있어 `<main>` 랜드마크와 `<h1>` 제목이 모두 없다.
- **WCAG 기준 번호**: 1.3.1 (Info and Relationships), 2.4.1 (Bypass Blocks), 2.4.6 (Headings and Labels)
- **고치는 방향**:
  - `WriteView.tsx:365`의 `<div className={styles.main}>`을 `<main className={styles.main}>`으로 바꾸고, 화면 디자인을 해치지 않도록 시각 숨김(`sr-only`) `<h1>` 또는 레이블 연결을 보강한다.

---

### [하-5] `prefers-reduced-motion: reduce`에서 단추·칩·타일의 `:active` 물리 이동(`translateY`) 미제거

- **심각도**: 하
- **파일:줄**:
  - `apps/web/src/ui/components/Button.module.css:20-22`
  - `apps/web/src/ui/components/Chip.module.css:24-26`
  - `apps/web/src/ui/components/GenreTile.module.css:25-27`
  - `apps/web/src/ui/components/StudentTile.module.css:19-21`
  - `apps/web/src/ui/components/Keypad.module.css:26-29`
- **무엇이 문제인가**:
  - `tokens.css:78-84`에서 `@media (prefers-reduced-motion: reduce)`일 때 `--dur-fast`·`--dur`·`--dur-slow`를 `0ms`로 줄이고 `NoticeDrop`·`Stamp`는 `transform: none`을 선언했으나, `Button`·`Chip`·`GenreTile`·`StudentTile`·`Keypad`의 `:active { transform: translateY(1~2px) }` 이동은 그대로 남아 누를 때마다 요소가 순간 이동한다.
- **WCAG 기준 번호**: 2.3.3 (Animation from Interactions)
- **고치는 방향**:
  - `base.css` 또는 각 부품 CSS의 `@media (prefers-reduced-motion: reduce)`에서 `:active` 시 `transform: none`을 적용한다.

---

## 2. `tokens.css` 색상 대비 계산표 (WCAG 2.1 상대 휘도 기준)

### 2.1 토큰별 상대 휘도($L$)

| 토큰 | HEX | RGB | 상대 휘도 ($L$) |
| --- | --- | --- | --- |
| `--surface` | `#FFFFFF` | `255, 255, 255` | `1.0000` |
| `--bg` | `#FFF8EF` | `255, 248, 239` | `0.9463` |
| `--paper-line` | `#F1E4D3` | `241, 228, 211` | `0.7889` |
| `--line` | `#EADBC8` | `234, 219, 200` | `0.7232` |
| `--butter` | `#F7D98B` | `247, 217, 139` | `0.7126` |
| `--sky` | `#A8CBE6` | `168, 203, 230` | `0.5675` |
| `--sage` | `#A9C9A4` | `169, 201, 164` | `0.5289` |
| `--primary` | `#F2A07B` | `242, 160, 123` | `0.4545` |
| `--rose` | `#EE9A8E` | `238, 154, 142` | `0.4324` |
| `--primary-pressed` | `#E88F66` | `232, 143, 102` | `0.3776` |
| `--rose-pressed` | `#E28679` | `226, 134, 121` | `0.3460` |
| `--teacher` | `#9C8ADE` | `156, 138, 222` | `0.3052` |
| `--sage-ink` | `#4E7A48` | `78, 122, 72` | `0.1601` |
| `--ink-sub` | `#7A6759` | `122, 103, 89` | `0.1456` |
| `--rose-ink` | `#A8443A` | `168, 68, 58` | `0.1277` |
| `--sky-ink` | `#2F6690` | `47, 102, 144` | `0.1212` |
| `--teacher-ink` | `#5B4AA8` | `91, 74, 168` | `0.0995` |
| `--primary-ink` | `#6B331D` | `107, 51, 29` | `0.0558` |
| `--ink` | `#4A3B32` | `74, 59, 50` | `0.0481` |

### 2.2 글자·배경 및 비텍스트 짝 대비율 표

| 전경 (글자·아이콘·경계) | 배경 | 대비율 | 기준 | 판정 | 쓰이는 곳 |
| --- | --- | --- | --- | --- | --- |
| `--ink` (`#4A3B32`) | `--surface` (`#FFFFFF`) | **10.70 : 1** | 4.5 : 1 | 통과 | 종이·카드·시트·입력칸 본문 |
| `--ink` (`#4A3B32`) | `--bg` (`#FFF8EF`) | **10.15 : 1** | 4.5 : 1 | 통과 | 화면 기본 본문·제목 |
| `--ink` (`#4A3B32`) | `--butter` (`#F7D98B`) | **7.77 : 1** | 4.5 : 1 | 통과 | 선택된 칩, `NoticeDrop`, `HoldPill`, 5분 이하 타이머 |
| `--ink` (`#4A3B32`) | `--sky` (`#A8CBE6`) | **6.29 : 1** | 4.5 : 1 | 통과 | 하늘 강조 배지·맞춤법 파랑 형광 |
| `--ink` (`#4A3B32`) | `--sage` (`#A9C9A4`) | **5.90 : 1** | 4.5 : 1 | 통과 | `fresh` AI 칩, 제출 완료 배지 |
| `--ink` (`#4A3B32`) | `--rose` (`#EE9A8E`) | **4.92 : 1** | 4.5 : 1 | 통과 | 위험 단추(`Button danger`), 10초 이하 타이머 |
| `--ink` (`#4A3B32`) | `--rose-pressed` (`#E28679`) | **4.03 : 1** | 4.5 : 1 (일반) / 3 : 1 (큰 글자) | **16px 단추 미달** | `.danger:active` 눌림 상태 (`Button.module.css:49`) |
| `--primary-ink` (`#6B331D`) | `--primary` (`#F2A07B`) | **4.77 : 1** | 4.5 : 1 | 통과 | 주 행동 단추(`Button primary`), `Switch` 켜짐 |
| `--primary-ink` (`#6B331D`) | `--primary-pressed` (`#E88F66`) | **4.04 : 1** | 4.5 : 1 (일반) / 3 : 1 (큰 글자) | **16px 단추 미달** | `.primary:active` 눌림 상태 (`Button.module.css:35`, `lg` 18px 굵은 글자는 3:1 통과) |
| `--ink-sub` (`#7A6759`) | `--surface` (`#FFFFFF`) | **5.37 : 1** | 4.5 : 1 | 통과 | 카드·시트 안 보조 설명, 자리표시자, 글자 수 |
| `--ink-sub` (`#7A6759`) | `--bg` (`#FFF8EF`) | **5.09 : 1** | 4.5 : 1 | 통과 | 화면 바탕 위 보조 설명 |
| `--ink-sub` (`#7A6759`) | `--butter` (`#F7D98B`) | **3.90 : 1** | 4.5 : 1 | **미달** ([중-5]) | 선택된 `Chip` 내부 `.status`, `.warn` 상태의 `TimerPill` `.paused` |
| `--ink-sub` (`#7A6759`) | `--sage` (`#A9C9A4`) | **2.96 : 1** | 4.5 : 1 | **미달** ([중-5]) | `.ai_fresh` 상태 `Chip` 내부 `.status` |
| `--ink-sub` (`#7A6759`) | `--rose` (`#EE9A8E`) | **2.47 : 1** | 4.5 : 1 | **미달** ([중-5]) | `.urgent` 상태 `TimerPill` 내부 `.paused` |
| `--sage-ink` (`#4E7A48`) | `--surface` / `--bg` | **5.00 : 1** / **4.74 : 1** | 4.5 : 1 | 통과 | 저장됨·초록 상태 글자 및 아이콘 |
| `--sage-ink` (`#4E7A48`) | `sage 42% + surface` (`#DBE8D9`) | **3.95 : 1** | 3.0 : 1 (아이콘) | 통과 | `StatusBadge` `.writing` 아이콘, `ConnectionCheck` `ok` 아이콘 |
| `--sky-ink` (`#2F6690`) | `--surface` / `--bg` | **6.13 : 1** / **5.82 : 1** | 4.5 : 1 | 통과 | 맞춤법·정보 상태 글자 및 아이콘 |
| `--rose-ink` (`#A8443A`) | `--surface` / `--bg` | **5.91 : 1** / **5.61 : 1** | 4.5 : 1 | 통과 | 입력칸 오류 문구(`TextField`, `CodeInput`), 위험 안내 |
| `--rose-ink` (`#A8443A`) | `rose 38% + surface` (`#F9D9D4`) | **4.46 : 1** | 3.0 : 1 (아이콘) | 통과 | `Banner` `.danger` 아이콘, `StatusBadge` `.disconnected` 아이콘 |
| `--teacher-ink` (`#5B4AA8`) | `--surface` / `--bg` | **7.02 : 1** / **6.66 : 1** | 4.5 : 1 | 통과 | 교사 배지·강조 문구 |
| `--line` (`#EADBC8`) | `--surface` / `--bg` | **1.36 : 1** / **1.29 : 1** | 3.0 : 1 (비텍스트) | **미달** | 기본 입력칸·단추·체크박스·스위치 외곽선 |
| `--butter` (`#F7D98B`) | `--surface` (`#FFFFFF`) | **1.38 : 1** | 3.0 : 1 (비텍스트) | **미달** ([중-4], [중-8]) | `StudentTile` `.stripe_idle` 왼쪽 띠, `Menu` 하이라이트 배경 |
| `--bg` (`#FFF8EF`) | `--surface` (`#FFFFFF`) | **1.05 : 1** | 3.0 : 1 (비텍스트) | **미달** ([중-1], [중-4]) | `Dropdown` `.item[data-highlighted]` 배경, `Chip` `.ai_stale` 배경 |
