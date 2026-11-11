import { ko } from '@geulbang/core/copy';
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryCodeSheet } from './EntryCodeSheet.tsx';
import { GenreView, type GenreViewProps } from './GenreView.tsx';
import { HomeView } from './HomeView.tsx';
import { NicknameView } from './NicknameView.tsx';
import { ResumeWaitView } from './ResumeWaitView.tsx';
import { RoomCardView } from './RoomCardView.tsx';
import type { AiChipView, ResultPanelView } from './write/types.ts';
import { WriteView, type WriteViewProps } from './write/WriteView.tsx';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

const NOW = Date.UTC(2026, 10, 11, 3, 0, 0);
const noop = () => {};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

/** 채운 주요 버튼(PRD 3장 1번: 화면마다 하나). */
function primaryButtons(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('button[data-variant="primary"]')];
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text));
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('S0 홈', () => {
  const room = { roomId: 'r1', className: 'A', roomTitle: 'B', nickname: 'C', lastUsedAt: NOW - 120_000 };

  it('이어 쓰기 카드가 없으면 `글 쓰러 가기`가 유일한 주요 버튼이다', () => {
    render(
      <HomeView
        now={NOW}
        onStartWrite={noop}
        onResume={noop}
        onOpenRecent={noop}
        onTeacher={noop}
        onPrivacy={noop}
      />,
    );
    const primaries = primaryButtons();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain(ko.student.homeStartWrite);
    expect(buttonByText(ko.student.homeTeacherPrompt)).toBeTruthy();
    expect(buttonByText(ko.common.privacyPolicy)).toBeTruthy();
  });

  it('카드가 있으면 카드의 `이어 쓰기`가 주요 버튼이 되고 `글 쓰러 가기`는 보조로 바뀐다', () => {
    const onResume = vi.fn();
    render(
      <HomeView
        now={NOW}
        resume={room}
        recentRooms={[{ ...room, roomId: 'r2' }]}
        onStartWrite={noop}
        onResume={onResume}
        onOpenRecent={noop}
        onTeacher={noop}
        onPrivacy={noop}
      />,
    );
    const primaries = primaryButtons();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain(ko.student.homeResumeAction);
    expect(buttonByText(ko.student.homeStartWrite).dataset['variant']).toBe('secondary');
    click(primaries[0] as HTMLButtonElement);
    expect(onResume).toHaveBeenCalledWith('r1');
    expect(host.textContent).toContain(ko.student.homeRecentRoomsHeading);
  });
});

describe('입장 코드 시트', () => {
  it('키패드로 여섯째 숫자를 누르면 바로 확인을 부른다', () => {
    const onCodeChange = vi.fn();
    const onComplete = vi.fn();
    render(
      <EntryCodeSheet
        open
        inline
        onOpenChange={noop}
        code="12345"
        onCodeChange={onCodeChange}
        onComplete={onComplete}
      />,
    );
    click(host.querySelector('button[data-digit="6"]') as Element);
    expect(onCodeChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('오류 문구를 알림으로 보이고, 개인 모드가 꺼져 있으면 `혼자 쓸래요`가 없다', () => {
    render(
      <EntryCodeSheet
        open
        inline
        onOpenChange={noop}
        code="123456"
        onCodeChange={noop}
        onComplete={noop}
        status="error"
        errorMessage={ko.errors.E_ROOM_NOT_FOUND}
      />,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(ko.errors.E_ROOM_NOT_FOUND);
    expect(host.textContent).not.toContain(ko.student.homeSoloAction);
  });
});

describe('S1 수업 카드 + 동의', () => {
  it('체크하기 전에는 `시작하기`가 꺼져 있고, 학교명은 줄 때만 보인다', () => {
    render(
      <RoomCardView
        className="A"
        roomTitle="B"
        schoolName={null}
        expiresAt={NOW}
        agreed={false}
        onAgreedChange={noop}
        onStart={noop}
        onLearnMore={noop}
      />,
    );
    const primaries = primaryButtons();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain(ko.student.consentStartAction);
    expect(primaries[0]?.disabled).toBe(true);
    expect(host.querySelector('h1')?.textContent).toBe('A');
    expect(host.textContent).toContain(ko.student.consentItemPrivacy);
  });
});

describe('S3 별명', () => {
  it('중복이면 보조 버튼 둘이 생기고 `다른 별명 쓸래요`는 칸을 비운다', () => {
    const onChange = vi.fn();
    render(<NicknameView nickname="X" onNicknameChange={onChange} onNext={noop} taken onClaimMine={noop} />);
    expect(primaryButtons()).toHaveLength(1);
    expect(buttonByText(ko.student.nicknameMineAction).dataset['variant']).toBe('secondary');
    click(buttonByText(ko.student.nicknameChangeAction));
    expect(onChange).toHaveBeenCalledWith('');
    expect(host.textContent).toContain(ko.student.nicknameHint);
  });

  it('한글 조합을 끝내는 Enter로는 다음으로 넘어가지 않는다', () => {
    const onNext = vi.fn();
    render(<NicknameView nickname="X" onNicknameChange={noop} onNext={onNext} />);
    const input = host.querySelector('input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }));
    });
    expect(onNext).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('S4 글 종류', () => {
  const base: GenreViewProps = {
    enabledGenres: ['story', 'poem', 'lyrics', 'news', 'essay', 'other'],
    selectedGenre: null,
    selectedSubtype: null,
    selectedPurpose: null,
    purposeCustom: '',
    onSelectGenre: noop,
    onSelectSubtype: noop,
    onSelectPurpose: noop,
    onPurposeCustomChange: noop,
    onStart: noop,
  };

  it('타일마다 하위 종류 글씨가 보이고, 바로 쓰기 타일은 누르자마자 시작한다', () => {
    const onStart = vi.fn();
    render(<GenreView {...base} onStart={onStart} />);
    expect(host.querySelectorAll('[data-testid="genre-tile-subtitle"]')).toHaveLength(6);
    expect(primaryButtons()).toHaveLength(0);
    click(buttonByText(ko.student.genrePoemLabel));
    expect(onStart).toHaveBeenCalledWith({ genre: 'poem', subtype: 'children-poem' });
  });

  it('펼침 타일은 같은 화면에 하위 칩과 `쓰기 시작` 하나를 보인다', () => {
    render(<GenreView {...base} selectedGenre="story" />);
    expect(host.querySelector('[data-expand="subtypes"]')).not.toBeNull();
    const primaries = primaryButtons();
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain(ko.student.genreStartAction);
  });

  it('`기타 문구`만 켜져 있으면 타일 없이 용도 카드만, `직접 입력`은 글자가 있어야 시작한다', () => {
    render(<GenreView {...base} enabledGenres={['other']} selectedPurpose="custom" />);
    expect(host.querySelectorAll('[data-testid="genre-tile-subtitle"]')).toHaveLength(0);
    expect(host.querySelector('[data-expand="purposes"]')).not.toBeNull();
    expect(primaryButtons()[0]?.disabled).toBe(true);
  });
});

describe('S6 이어 쓰기 기다림', () => {
  it('기다리는 동안 주요 버튼이 없고 `취소`는 보조다', () => {
    render(<ResumeWaitView status="waiting" onCancel={noop} onChooseOther={noop} />);
    expect(primaryButtons()).toHaveLength(0);
    expect(buttonByText(ko.common.cancel).dataset['variant']).toBe('secondary');
  });
});

describe('S5 쓰기', () => {
  const chips = (state: AiChipView['state']): AiChipView[] =>
    (['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'] as const).map(button => ({ button, state }));

  function props(over: Partial<WriteViewProps> = {}): WriteViewProps {
    return {
      layout: 'wide',
      sheetsInline: true,
      now: NOW,
      bodyRef: createRef<HTMLTextAreaElement>(),
      titleRef: createRef<HTMLInputElement>(),
      mirrorRef: createRef<HTMLDivElement>(),
      genre: 'news',
      subtype: 'newspaper',
      fontSize: 18,
      saveState: 'saved',
      submission: 'none',
      canUndo: true,
      canRedo: false,
      onUndo: noop,
      onRedo: noop,
      helpOpen: false,
      onHelpOpenChange: noop,
      helpQuestions: [
        { id: 'news_when', prompt: 'q1' },
        { id: 'news_where', prompt: 'q2' },
      ],
      helpIndex: 0,
      onHelpIndexChange: noop,
      structureButtons: [],
      onStructure: noop,
      aiChips: chips('idle'),
      onAiChip: noop,
      onPanelClose: noop,
      onPanelRefresh: noop,
      onSpellItem: noop,
      onCopyPolish: noop,
      onBack: noop,
      onCopyDoc: noop,
      onSaveTxt: noop,
      fontSizeOpen: false,
      onFontSizeOpenChange: noop,
      onFontSizeChange: noop,
      rewindOpen: false,
      onRewindOpenChange: noop,
      onRewindSelect: noop,
      onRewindRestore: noop,
      submitOpen: false,
      onSubmitOpenChange: noop,
      onSubmitConfirm: noop,
      ...over,
    };
  }

  it('입력칸은 비제어: 값·readOnly를 주지 않고 ref로만 넘기며, aria 이름이 있다', () => {
    const bodyRef = createRef<HTMLTextAreaElement>();
    const titleRef = createRef<HTMLInputElement>();
    render(<WriteView {...props({ bodyRef, titleRef })} />);
    const body = bodyRef.current as HTMLTextAreaElement;
    const title = titleRef.current as HTMLInputElement;
    expect(body.tagName).toBe('TEXTAREA');
    expect(body.getAttribute('aria-label')).toBe(ko.student.bodyAriaLabel);
    expect(body.hasAttribute('readonly')).toBe(false);
    expect(body.value).toBe('');
    expect(body.getAttribute('spellcheck')).toBe('false');
    expect(body.getAttribute('autocorrect')).toBe('off');
    expect(title.getAttribute('aria-label')).toBe(ko.student.titlePlaceholder);
    expect(title.hasAttribute('value')).toBe(false);
  });

  it('`제출`이 유일한 주요 버튼이고, 제출하면 사라지고 저장 상태가 `제출 완료`가 된다', () => {
    render(<WriteView {...props()} />);
    expect(primaryButtons().map(b => b.textContent)).toEqual([ko.student.submitButton]);
    render(<WriteView {...props({ submission: 'submitted' })} />);
    expect(primaryButtons()).toHaveLength(0);
    expect(host.querySelector('[data-save-state="locked"]')).not.toBeNull();
  });

  it('배치가 바뀌고 결과 패널이 열려도 본문·제목 입력칸 노드는 그대로다(옮기기 금지)', () => {
    const bodyRef = createRef<HTMLTextAreaElement>();
    const titleRef = createRef<HTMLInputElement>();
    const panel: ResultPanelView = { button: 'FEEDBACK', status: 'loading' };
    render(<WriteView {...props({ bodyRef, titleRef })} />);
    const body = bodyRef.current;
    const title = titleRef.current;
    render(<WriteView {...props({ bodyRef, titleRef, panel })} />);
    expect(host.querySelector('aside[data-result="FEEDBACK"]')).not.toBeNull();
    render(
      <WriteView {...props({ bodyRef, titleRef, panel, layout: 'narrow', offline: true, holding: true })} />,
    );
    expect(host.querySelector('aside[data-result]')).toBeNull();
    expect(host.querySelector('[data-sheet-inline] [data-result="FEEDBACK"]')).not.toBeNull();
    expect(bodyRef.current).toBe(body);
    expect(titleRef.current).toBe(title);
    expect(body?.isConnected).toBe(true);
  });

  it('보이는 칩이 모두 최소 글자 미만이면 칩 줄 대신 "조금 더 써 볼까요?", 숨긴 칩은 그리지 않는다', () => {
    render(<WriteView {...props({ aiChips: chips('guide') })} />);
    expect(host.querySelector('[data-ai-bar="guide"]')?.textContent).toContain(ko.student.aiMoreCharsGuide);
    expect(host.querySelectorAll('[data-ai-button]')).toHaveLength(0);
    render(
      <WriteView
        {...props({
          aiChips: [
            { button: 'SPELL', state: 'idle' },
            { button: 'POLISH', state: 'hidden' },
          ],
        })}
      />,
    );
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-ai-button]')].map(el => el.dataset['aiButton']),
    ).toEqual(['SPELL']);
  });

  it('맞춤법: 위치를 못 찾은 항목은 누를 수 없고, 찾은 항목은 눌러 알린다(자동 고치기 버튼 없음)', () => {
    const onSpellItem = vi.fn();
    const panel: ResultPanelView = {
      button: 'SPELL',
      status: 'ready',
      receivedAt: NOW,
      content: {
        kind: 'SPELL',
        items: [
          { id: 'a', original: 'x', suggestion: 'y', reason: 'r', kind: 'spelling', locatable: true },
          { id: 'b', original: 'p', suggestion: 'q', reason: 'r', kind: 'spacing', locatable: false },
        ],
      },
    };
    render(<WriteView {...props({ panel, onSpellItem })} />);
    const aside = host.querySelector('aside[data-result="SPELL"]') as HTMLElement;
    const listButtons = aside.querySelectorAll('li > button');
    expect(listButtons).toHaveLength(1);
    expect(aside.querySelector('li > [aria-disabled="true"]')?.textContent).toContain(
      ko.student.aiSpellUnlocatedHint,
    );
    click(listButtons[0] as Element);
    expect(onSpellItem).toHaveBeenCalledWith('a');
  });

  it('메모 칸 ref는 질문마다 한 번만 붙고, 다시 그려도 떼었다 붙이지 않는다', () => {
    const memoRef = vi.fn();
    render(<WriteView {...props({ helpOpen: true, memoRef })} />);
    expect(memoRef).toHaveBeenCalledTimes(1);
    expect(memoRef.mock.calls[0]?.[0]).toBe('news_when');
    render(<WriteView {...props({ helpOpen: true, memoRef, saveState: 'sending' })} />);
    expect(memoRef).toHaveBeenCalledTimes(1);
    render(<WriteView {...props({ helpOpen: true, memoRef, helpIndex: 1 })} />);
    expect(memoRef.mock.calls.map(call => [call[0], call[1] === null])).toEqual([
      ['news_when', false],
      ['news_when', true],
      ['news_where', false],
    ]);
  });

  it('닫힌 수업방은 읽기 띠를 보이고 제출·되돌리기를 막는다', () => {
    render(<WriteView {...props({ roomClosed: true })} />);
    expect(host.textContent).toContain(ko.student.closedBanner);
    expect(primaryButtons()).toHaveLength(0);
    const undo = host.querySelector<HTMLButtonElement>(`button[aria-label="${ko.common.undo}"]`);
    expect(undo?.disabled).toBe(true);
  });
});
