import { koDev } from '@geulbang/core/copy/dev';
import { ko } from '@geulbang/core/copy';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLazyFrames } from '../art/frames/home.ts';
import { loadLazyArt } from '../art/home.ts';
import {
  Banner,
  Button,
  Checkbox,
  Chip,
  CodeInput,
  Dialog,
  Dropdown,
  EmptyState,
  GenreTile,
  Gulbeot,
  HoldPill,
  IconButton,
  Keypad,
  MemoCard,
  MemoField,
  Menu,
  NotebookField,
  NoticeDrop,
  Panel,
  PaperCard,
  Popover,
  SaveState,
  Sheet,
  Skeleton,
  Slider,
  Stamp,
  StatusBadge,
  StudentTile,
  Switch,
  TextButton,
  TextField,
  TimerPill,
  Toast,
} from './index.ts';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

describe('UI 1차 부품 (P2-10)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it('Button: 눌림·비활성·로딩(aria-busy)과 3초 늦게 켜짐이 동작한다', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    act(() => {
      root.render(
        <div>
          <Button id="btn-normal" onClick={onClick}>
            확인
          </Button>
          <Button id="btn-loading" loading onClick={onClick}>
            보내는 중
          </Button>
          <Button id="btn-delayed" variant="danger" delaySeconds={3} onClick={onClick}>
            지금 삭제
          </Button>
        </div>,
      );
    });

    const normalBtn = host.querySelector('#btn-normal') as HTMLButtonElement;
    const loadingBtn = host.querySelector('#btn-loading') as HTMLButtonElement;
    const delayedBtn = host.querySelector('#btn-delayed') as HTMLButtonElement;

    expect(normalBtn.disabled).toBe(false);
    act(() => {
      normalBtn.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    expect(loadingBtn.disabled).toBe(true);
    expect(loadingBtn.getAttribute('aria-busy')).toBe('true');
    act(() => {
      loadingBtn.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    // 3초 늦게 켜짐 단추: 처음에는 비활성이며 남은 초가 표시된다.
    expect(delayedBtn.disabled).toBe(true);
    expect(delayedBtn.getAttribute('data-countdown')).toBe('3');
    act(() => {
      delayedBtn.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(delayedBtn.disabled).toBe(true);
    expect(delayedBtn.getAttribute('data-countdown')).toBe('1');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(delayedBtn.disabled).toBe(false);
    expect(delayedBtn.getAttribute('data-countdown')).toBeNull();

    act(() => {
      delayedBtn.click();
    });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('TextButton과 Chip: 선택 상태(aria-pressed, 체크 아이콘)와 AI 칩 상태를 표현한다', () => {
    const onTextClick = vi.fn();

    act(() => {
      root.render(
        <div>
          <TextButton id="txt-btn" onClick={onTextClick}>
            선생님이세요?
          </TextButton>
          <Chip id="chip-selected" selected count={21}>
            전체
          </Chip>
          <Chip id="chip-cooldown" aiState="cooldown" cooldownSeconds={8}>
            맞춤법
          </Chip>
          <Chip id="chip-guide" aiState="guide">
            글벗 한마디
          </Chip>
          <Chip id="chip-offline" aiState="offline">
            다듬은 글
          </Chip>
        </div>,
      );
    });

    const txtBtn = host.querySelector('#txt-btn') as HTMLButtonElement;
    act(() => {
      txtBtn.click();
    });
    expect(onTextClick).toHaveBeenCalledTimes(1);

    const selectedChip = host.querySelector('#chip-selected') as HTMLButtonElement;
    expect(selectedChip.getAttribute('aria-pressed')).toBe('true');
    expect(selectedChip.querySelector('svg')).not.toBeNull();
    expect(selectedChip.textContent).toContain('21');

    const cooldownChip = host.querySelector('#chip-cooldown') as HTMLButtonElement;
    expect(cooldownChip.disabled).toBe(true);
    expect(cooldownChip.textContent).toContain(`8${ko.student.aiCooldownSuffix}`);

    const guideChip = host.querySelector('#chip-guide') as HTMLButtonElement;
    expect(guideChip.disabled).toBe(false);
    expect(guideChip.textContent).toContain(ko.student.aiMoreCharsGuide);

    const offlineChip = host.querySelector('#chip-offline') as HTMLButtonElement;
    expect(offlineChip.disabled).toBe(true);
    expect(offlineChip.textContent).toContain(ko.student.aiOfflineGuide);
  });

  it('TextField와 MemoField: ref로 비제어 접근이 가능하고 오류·도움말 aria 속성을 연결한다', () => {
    const inputRef = createRef<HTMLInputElement>();
    const memoRef = createRef<HTMLTextAreaElement>();

    act(() => {
      root.render(
        <div>
          <TextField
            ref={inputRef}
            defaultValue="하늘고래"
            label={ko.student.nicknameLabel}
            hint={ko.student.nicknameHint}
            error="이미 있는 별명이에요."
          />
          <MemoField
            ref={memoRef}
            defaultValue="아침 운동장"
            label="도움 질문 1"
            question="언제 어디서 일어나나요?"
          />
        </div>,
      );
    });

    expect(inputRef.current).toBeInstanceOf(HTMLInputElement);
    expect(inputRef.current?.value).toBe('하늘고래');
    expect(inputRef.current?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('이미 있는 별명이에요.');

    expect(memoRef.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(memoRef.current?.value).toBe('아침 운동장');
  });

  it('PaperCard·Panel·Banner·Toast·HoldPill·TimerPill·SaveState·StatusBadge가 올바른 접근성 속성과 문구를 그린다', () => {
    const onClosePanel = vi.fn();
    const onToastAction = vi.fn();
    const onTimerClick = vi.fn();

    act(() => {
      root.render(
        <div>
          <PaperCard id="card-ro" readOnly headerIcon="book" headerLabel="메모" title="질문">
            내용
          </PaperCard>
          <Panel id="panel-main" icon="book" badgeText="글벗 한마디" title="잘한 점" onClose={onClosePanel}>
            본문
          </Panel>
          <Banner id="banner-offline" kind="offline" />
          <Toast
            id="toast-warn"
            tone="warning"
            message={ko.student.largeDeleteToast}
            actionLabel={ko.student.restoreAction}
            onAction={onToastAction}
          />
          <HoldPill id="hold-pill" />
          <TimerPill id="timer-pill" remainingSeconds={492} onClick={onTimerClick} />
          <SaveState id="save-saved" state="saved" />
          <StatusBadge id="status-flow" status="writing-flow" />
        </div>,
      );
    });

    expect(host.querySelector('#card-ro')?.getAttribute('data-readonly')).toBe('true');

    const closeBtn = host.querySelector('#panel-main button[aria-label="닫기"]') as HTMLButtonElement;
    act(() => {
      closeBtn.click();
    });
    expect(onClosePanel).toHaveBeenCalledTimes(1);

    expect(host.querySelector('#banner-offline')?.textContent).toContain(ko.student.offlineBanner);

    const toastActionBtn = host.querySelector('#toast-warn button') as HTMLButtonElement;
    act(() => {
      toastActionBtn.click();
    });
    expect(onToastAction).toHaveBeenCalledTimes(1);

    const holdPill = host.querySelector('#hold-pill');
    expect(holdPill?.getAttribute('aria-live')).toBe('polite');
    expect(holdPill?.textContent).toContain(ko.student.holdNotice);

    const timerPill = host.querySelector('#timer-pill') as HTMLButtonElement;
    expect(timerPill.textContent).toContain('08:12');
    expect(timerPill.textContent).toContain(ko.common.timerRunning);
    act(() => {
      timerPill.click();
    });
    expect(onTimerClick).toHaveBeenCalledTimes(1);

    expect(host.querySelector('#save-saved')?.textContent).toContain(ko.common.saveSaved);
    expect(host.querySelector('#status-flow')?.getAttribute('data-status')).toBe('writing-flow');
  });

  it('Keypad·CodeInput·Skeleton·EmptyState가 입력·자리표시·빈 화면 동작을 수행한다', () => {
    vi.useFakeTimers();
    const onDigit = vi.fn();
    const onBackspace = vi.fn();
    const onCodeChange = vi.fn();
    const onCodeComplete = vi.fn();
    const onEmptyAction = vi.fn();

    act(() => {
      root.render(
        <div>
          <Keypad onDigit={onDigit} onBackspace={onBackspace} />
          <CodeInput id="code-6" value="12345" onChange={onCodeChange} onComplete={onCodeComplete} />
          <CodeInput id="pin-masked" value="123" length={6} masked />
          <Skeleton id="skel-delayed" delayMs={1000} />
          <EmptyState
            id="empty-state"
            title={ko.teacher.emptyRoomTitle}
            actionLabel={ko.teacher.emptyRoomAction}
            onAction={onEmptyAction}
          >
            <span data-testid="custom-art">그림</span>
          </EmptyState>
        </div>,
      );
    });

    const key7 = host.querySelector('[data-digit="7"]') as HTMLButtonElement;
    const keyBack = host.querySelector('[data-action="backspace"]') as HTMLButtonElement;
    act(() => {
      key7.click();
      keyBack.click();
    });
    expect(onDigit).toHaveBeenCalledWith('7');
    expect(onBackspace).toHaveBeenCalledTimes(1);

    // CodeInput 물리 키보드로 마지막 6번째 자리 입력 시 onComplete 호출
    const codeInput = host.querySelector('#code-6') as HTMLInputElement;
    act(() => {
      codeInput.dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true }));
    });
    expect(onCodeChange).toHaveBeenCalledWith('123456');
    expect(onCodeComplete).toHaveBeenCalledWith('123456');

    // masked PIN 점 확인
    expect(host.querySelectorAll('[data-testid="code-pin-dot"]').length).toBe(3);

    // Skeleton 1초 뒤 안내 문구 표시
    const skel = host.querySelector('#skel-delayed');
    expect(skel?.textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(skel?.textContent).toContain(ko.common.loading);

    // EmptyState 그림 자리와 행동 단추
    expect(host.querySelector('[data-testid="custom-art"]')?.textContent).toBe('그림');
    const emptyBtn = host.querySelector('#empty-state button') as HTMLButtonElement;
    act(() => {
      emptyBtn.click();
    });
    expect(onEmptyAction).toHaveBeenCalledTimes(1);
  });

  it('Gulbeot·Stamp·EmptyState(artName)·PaperCard(handDrawnFrame): 그림 규칙(48px 미만 기본 얼굴, srcset, lazy/priority)과 도장·손그림 테두리를 그린다', async () => {
    act(() => {
      root.render(
        <div>
          <Gulbeot id="gb-24" size={24} mood="reading" />
          <Gulbeot id="gb-32" size={32} name="gulbeot-thinking" />
          <Gulbeot id="gb-96" size={96} mood="reading" priority alt="읽는 글벗" />
          <Stamp id="stamp-main" text={ko.student.submitStampText} size="md" />
          <EmptyState id="empty-art" artName="empty-desks" title={ko.teacher.emptyRoomTitle} />
          <PaperCard id="card-framed" handDrawnFrame="md" title={koDev.galleryCardTitle}>
            내용
          </PaperCard>
        </div>,
      );
    });

    const gb24 = host.querySelector('#gb-24') as HTMLImageElement;
    const gb32 = host.querySelector('#gb-32') as HTMLImageElement;
    const gb96 = host.querySelector('#gb-96') as HTMLImageElement;

    // 48px 미만은 표정/이름과 무관하게 기본 얼굴만 쓴다(첫 묶음 정적 그림).
    expect(gb24.getAttribute('data-art')).toBe('gulbeot-face');
    expect(gb24.getAttribute('loading')).toBe('lazy');
    expect(gb24.getAttribute('srcset')).toContain('1x');
    expect(gb24.getAttribute('srcset')).toContain('2x');

    expect(gb32.getAttribute('data-art')).toBe('gulbeot-face');

    // 96px 이상은 지정한 표정을 쓰고 priority면 eager로 불러오며, 동적 주소를 받기 전에도 치수를 유지한다.
    expect(gb96.getAttribute('data-art')).toBe('gulbeot-reading');
    expect(gb96.getAttribute('loading')).toBe('eager');
    expect(gb96.getAttribute('alt')).toBe('읽는 글벗');
    expect(gb96.getAttribute('width')).toBe('96');
    expect(gb96.getAttribute('height')).toBe('96');

    const stamp = host.querySelector('#stamp-main') as HTMLElement;
    expect(stamp.getAttribute('role')).toBe('status');
    expect(stamp.getAttribute('data-animated')).toBe('true');
    expect(stamp.querySelector('[data-testid="stamp-text"]')?.textContent).toBe(ko.student.submitStampText);

    const emptyArtImg = host.querySelector('#empty-art img[data-art="empty-desks"]');
    expect(emptyArtImg).not.toBeNull();
    expect(emptyArtImg?.getAttribute('width')).toBe('180');
    expect(emptyArtImg?.getAttribute('height')).toBe('86');

    await act(async () => {
      await Promise.all([loadLazyArt(), loadLazyFrames()]);
    });

    expect(gb96.getAttribute('srcset')).toContain('1x');
    expect(gb96.getAttribute('srcset')).toContain('2x');
    expect(emptyArtImg?.getAttribute('srcset')).toContain('1x');
    expect(emptyArtImg?.getAttribute('srcset')).toContain('2x');

    const framedCard = host.querySelector('#card-framed');
    expect(framedCard?.getAttribute('data-hand-drawn')).toBe('home-card-md');
  });

  it('GenreTile·StudentTile·MemoCard·NoticeDrop: 하위 종류 노출, 상태 띠·고정폭 숫자, 꼬리 없는 메모 카드를 그린다', () => {
    const onGenreClick = vi.fn();
    const onStudentClick = vi.fn();
    const onDismissNotice = vi.fn();

    act(() => {
      root.render(
        <div>
          <GenreTile
            id="genre-story"
            label={ko.student.genreStoryLabel}
            subtitle={ko.student.genreStorySubtitle}
            selected
            onClick={onGenreClick}
          />
          <StudentTile
            id="student-writing"
            nickname="하늘고래"
            status="writing"
            genreLabel={ko.student.genreNewsLabel}
            charCount={312}
            timeText="12초 전"
            selected
            onClick={onStudentClick}
          />
          <MemoCard
            id="memo-praise"
            tone="praise"
            heading={ko.student.aiFeedbackPraiseHeading}
            badge={ko.common.gulbeotAiBadge}
          >
            문장이 자연스러워요.
          </MemoCard>
          <NoticeDrop id="notice-drop" message={ko.teacher.noticePreset5Min} onDismiss={onDismissNotice} />
        </div>,
      );
    });

    const genreTile = host.querySelector('#genre-story') as HTMLButtonElement;
    expect(genreTile.getAttribute('aria-pressed')).toBe('true');
    expect(genreTile.querySelector('[data-testid="genre-tile-subtitle"]')?.textContent).toBe(
      ko.student.genreStorySubtitle,
    );
    expect(genreTile.querySelector('[data-testid="genre-tile-check"]')).not.toBeNull();
    act(() => {
      genreTile.click();
    });
    expect(onGenreClick).toHaveBeenCalledTimes(1);

    const studentTile = host.querySelector('#student-writing') as HTMLButtonElement;
    expect(studentTile.getAttribute('data-status')).toBe('writing');
    expect(studentTile.querySelector('[data-testid="student-tile-chars"]')?.textContent).toBe('312자');
    expect(studentTile.querySelector('[data-testid="student-tile-time"]')?.textContent).toBe('12초 전');
    act(() => {
      studentTile.click();
    });
    expect(onStudentClick).toHaveBeenCalledTimes(1);

    const memoCard = host.querySelector('#memo-praise');
    expect(memoCard?.getAttribute('data-tone')).toBe('praise');
    expect(memoCard?.textContent).toContain(ko.student.aiFeedbackPraiseHeading);

    const noticeBtn = host.querySelector('#notice-drop button') as HTMLButtonElement;
    act(() => {
      noticeBtn.click();
    });
    expect(onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it('Switch·Checkbox·Slider·Dropdown·Menu·Popover·Dialog·Sheet(끌어 닫기): Base UI 부품들이 동작하고 기본 select를 쓰지 않는다', () => {
    const onSwitchChange = vi.fn();
    const onCheckboxChange = vi.fn();
    const onSheetOpenChange = vi.fn();

    act(() => {
      root.render(
        <div>
          <Switch
            id="sw-school"
            checked={false}
            onCheckedChange={onSwitchChange}
            label={ko.teacher.showSchoolSwitch}
          />
          <Checkbox
            id="cb-agree"
            size="lg"
            checked={false}
            onCheckedChange={onCheckboxChange}
            label={ko.student.consentAgreeCheck}
          />
          <Slider value={40} min={0} max={100} label={ko.common.rewindSliderLabel} valueText="3분 전" />
          <Dropdown
            ariaLabel={ko.student.genreNewsLabel}
            value="newspaper"
            options={[
              { value: 'newspaper', label: ko.student.subtypeNewspaper },
              { value: 'extra', label: ko.student.subtypeExtraNews },
            ]}
          />
          <Menu
            triggerLabel={ko.common.moreMenu}
            items={[{ id: 'copy', label: ko.common.copyDoc, icon: 'copy' }]}
          />
          <Popover triggerLabel={ko.teacher.noticeButton} title={ko.teacher.noticeSendTab}>
            알림 내용
          </Popover>
          <Dialog open title={ko.teacher.deleteRoomConfirmTitle}>
            대화상자 본문
          </Dialog>
          <Sheet
            open
            mode="bottom"
            dragCloseThresholdPx={60}
            onOpenChange={onSheetOpenChange}
            title={ko.student.submitConfirmTitle}
          >
            시트 본문
          </Sheet>
        </div>,
      );
    });

    // 기본 <select> 금지 확인
    expect(document.querySelector('select')).toBeNull();

    // Switch 클릭
    const switchEl = host.querySelector('[role="switch"]') as HTMLElement;
    act(() => {
      switchEl.click();
    });
    expect(onSwitchChange).toHaveBeenCalledWith(true);

    // Checkbox 클릭
    const checkboxEl = host.querySelector('[role="checkbox"]') as HTMLElement;
    act(() => {
      checkboxEl.click();
    });
    expect(onCheckboxChange).toHaveBeenCalledWith(true);

    // Slider 손잡이와 값 표시
    expect(host.querySelector('[data-testid="slider-thumb"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="slider-value-text"]')?.textContent).toBe('3분 전');

    // Sheet 아래로 끌어 닫기 동작 확인
    const dragHandle = document.querySelector('[data-testid="sheet-drag-handle"]') as HTMLElement;
    expect(dragHandle).not.toBeNull();
    act(() => {
      dragHandle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, bubbles: true }));
      dragHandle.dispatchEvent(new PointerEvent('pointermove', { clientY: 190, bubbles: true }));
      dragHandle.dispatchEvent(new PointerEvent('pointerup', { clientY: 190, bubbles: true }));
    });
    expect(onSheetOpenChange).toHaveBeenCalledWith(false);
  });

  it('P3-7b: CodeInput(size="sm", inputMode="none", 6~8 가변 PIN 점, invalid 테두리)·TimerPill(asButton 메뉴 트리거)·NotebookField(비제어 ref, 거울 층, 글자 크기 16·18·21·24)가 동작한다', () => {
    const onComplete = vi.fn();
    const onPause = vi.fn();
    const bodyRef = createRef<HTMLTextAreaElement>();
    const mirrorRef = createRef<HTMLDivElement>();

    const renderPin = (pinValue: string, fontSize: 16 | 18 | 21 | 24 = 18) => {
      act(() => {
        root.render(
          <div>
            <CodeInput
              id="pin-var"
              value={pinValue}
              minLength={6}
              maxLength={8}
              size="sm"
              inputMode="none"
              masked
              invalid
              onComplete={onComplete}
            />
            <Menu
              items={[{ id: 'pause', label: ko.teacher.timerPauseAction, icon: 'pause', onSelect: onPause }]}
              trigger={<TimerPill id="timer-trigger" asButton remainingSeconds={180} />}
            />
            <NotebookField
              ref={bodyRef}
              mirrorRef={mirrorRef}
              fontSize={fontSize}
              mirrorTestId="custom-mirror"
            />
          </div>,
        );
      });
    };

    renderPin('1234', 18);
    const pinInput = host.querySelector('#pin-var') as HTMLInputElement;
    expect(pinInput.getAttribute('inputMode')).toBe('none');
    expect(pinInput.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelectorAll('[data-slot-index]').length).toBe(6);
    expect(host.querySelectorAll('[data-testid="code-pin-dot"]').length).toBe(4);
    expect(host.querySelector('[data-slot-index="0"]')?.getAttribute('data-size')).toBe('sm');
    expect(host.querySelector('[data-slot-index="0"]')?.getAttribute('data-error')).toBe('true');

    // 7자리 입력 시 칸과 점이 7개로 늘어난다.
    renderPin('1234567', 18);
    expect(host.querySelectorAll('[data-slot-index]').length).toBe(7);
    expect(host.querySelectorAll('[data-testid="code-pin-dot"]').length).toBe(7);

    // 8자리 입력 시 칸과 점이 8개로 늘어난다.
    renderPin('12345678', 18);
    expect(host.querySelectorAll('[data-slot-index]').length).toBe(8);
    expect(host.querySelectorAll('[data-testid="code-pin-dot"]').length).toBe(8);

    // TimerPill이 onClick 없이도 asButton으로 단추가 되어 Menu 트리거로 동작한다.
    const timerTrigger = host.querySelector('#timer-trigger') as HTMLButtonElement;
    expect(timerTrigger.tagName).toBe('BUTTON');

    // NotebookField: 비제어 textarea ref, 거울 층 div ref, 공책 줄 클래스를 갖추고 다시 그려도 값·선택을 건드리지 않는다.
    const textarea = bodyRef.current;
    const mirror = mirrorRef.current;
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(mirror).toBeInstanceOf(HTMLDivElement);
    expect(mirror?.getAttribute('data-testid')).toBe('custom-mirror');
    expect(mirror?.hasAttribute('data-mirror')).toBe(true);
    expect(textarea?.classList.contains('gb-notebook-lines')).toBe(true);
    expect(host.querySelector('[data-notebook-field]')?.getAttribute('data-font-size')).toBe('18');

    if (!textarea) throw new Error('textarea ref missing');
    textarea.value = '어댑터가 직접 넣은 한글 문장';
    textarea.setSelectionRange(2, 6);

    renderPin('12345678', 24);

    expect(bodyRef.current).toBe(textarea);
    expect(textarea.value).toBe('어댑터가 직접 넣은 한글 문장');
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(6);
    expect(textarea.readOnly).toBe(false);
    expect(host.querySelector('[data-notebook-field]')?.getAttribute('data-font-size')).toBe('24');
  });

  it('P3-7c: Sheet(height="result", modal=false, headerIcon 알약 없음)·MemoCard(interactive)·Chip(fresh vs selected 분리, aiButton)·IconButton(48px, 필수 label)·GenreTile(genre 아이콘)이 동작한다', () => {
    const onSheetOpenChange = vi.fn();
    const onIconBtn = vi.fn();
    const textareaRef = createRef<HTMLTextAreaElement>();

    act(() => {
      root.render(
        <div>
          <textarea ref={textareaRef} defaultValue="맞춤법 선택 유지 확인" />
          <IconButton id="icon-btn" icon="undo" label={ko.common.undo} onClick={onIconBtn} />
          <Chip id="chip-choice" selected>
            이야기
          </Chip>
          <Chip id="chip-fresh" aiButton="FEEDBACK" aiState="fresh">
            {ko.student.aiFeedbackLabel}
          </Chip>
          <MemoCard id="memo-ro" heading="읽기 전용">
            기본 메모
          </MemoCard>
          <MemoCard id="memo-int" interactive heading="눌리는 메모">
            대화형 메모
          </MemoCard>
          <GenreTile
            id="genre-poem"
            genre="poem"
            label={ko.student.genrePoemLabel}
            subtitle={ko.student.genrePoemSubtitle}
          />
          <Sheet
            open
            mode="bottom"
            height="result"
            modal={false}
            headerIcon="submit"
            onOpenChange={onSheetOpenChange}
            title={ko.student.submitConfirmTitle}
          >
            <button
              id="spell-item-btn"
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                textareaRef.current?.focus();
                textareaRef.current?.setSelectionRange(0, 3);
              }}
            >
              맞춤법 항목
            </button>
          </Sheet>
        </div>,
      );
    });

    // IconButton: 필수 label이 aria-label로 들어가고 내부 svg는 aria-hidden이다.
    const iconBtn = host.querySelector('#icon-btn') as HTMLButtonElement;
    expect(iconBtn.getAttribute('aria-label')).toBe(ko.common.undo);
    expect(iconBtn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      iconBtn.click();
    });
    expect(onIconBtn).toHaveBeenCalledTimes(1);

    // Chip: selected는 data-selected="true"이고 freshDot이 없으며, aiState="fresh"(미선택)는 data-selected="false" + freshDot으로 구분된다.
    const choiceChip = host.querySelector('#chip-choice') as HTMLButtonElement;
    const freshChip = host.querySelector('#chip-fresh') as HTMLButtonElement;
    expect(choiceChip.getAttribute('data-selected')).toBe('true');
    expect(choiceChip.querySelector('[data-testid="chip-fresh-dot"]')).toBeNull();
    expect(freshChip.getAttribute('data-selected')).toBe('false');
    expect(freshChip.getAttribute('data-ai-state')).toBe('fresh');
    expect(freshChip.querySelector('[data-testid="chip-fresh-dot"]')).not.toBeNull();

    // MemoCard: 기본은 data-interactive="false", interactive 변형은 "true"
    expect(host.querySelector('#memo-ro')?.getAttribute('data-interactive')).toBe('false');
    expect(host.querySelector('#memo-int')?.getAttribute('data-interactive')).toBe('true');

    // GenreTile: genre="poem"이면 genrePoem 아이콘이 연결된다.
    expect(host.querySelector('#genre-poem [data-icon]')?.getAttribute('data-icon')).toBe('genrePoem');

    // Sheet: height="result", modal="false", badgeText 없이 headerIcon만 주면 빈 알약 대신 titleIcon으로 그린다.
    const popup = document.querySelector('[data-height="result"]') as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.getAttribute('data-modal')).toBe('false');
    expect(popup.querySelector('[data-testid="sheet-header-icon"]')).not.toBeNull();

    // 비모달 시트에서 맞춤법 항목을 눌러 textarea 선택을 바꿔도 시트가 닫히지 않는다.
    const spellBtn = document.querySelector('#spell-item-btn') as HTMLButtonElement;
    act(() => {
      spellBtn.click();
    });
    expect(textareaRef.current?.selectionStart).toBe(0);
    expect(textareaRef.current?.selectionEnd).toBe(3);
    expect(onSheetOpenChange).not.toHaveBeenCalledWith(false);
  });
});
