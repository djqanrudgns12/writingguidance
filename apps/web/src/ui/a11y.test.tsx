import { MS_PER_MINUTE, MS_PER_SECOND } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chip } from './components/Chip.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { SaveState } from './components/SaveState.tsx';
import { StatusBadge } from './components/StatusBadge.tsx';
import { NicknameView } from './screens/student/NicknameView.tsx';
import { ResumeWaitView } from './screens/student/ResumeWaitView.tsx';
import { AiChipBar } from './screens/student/write/AiChipBar.tsx';
import { RewindSheet as StudentRewindSheet } from './screens/student/write/RewindSheet.tsx';
import type { AiChipView, ResultPanelView, SpellItemView } from './screens/student/write/types.ts';
import { WriteView, type WriteViewProps } from './screens/student/write/WriteView.tsx';
import { CodeKeypadField } from './screens/teacher/CodeKeypadField.tsx';
import { ConnectionCheckView } from './screens/teacher/ConnectionCheck.tsx';
import { DashboardView, type DashboardViewProps } from './screens/teacher/Dashboard.tsx';
import { ResumeRequestsBand } from './screens/teacher/DashboardBands.tsx';
import { DevicesPanelView } from './screens/teacher/DevicesSheet.tsx';
import { PinEntryView } from './screens/teacher/PinEntry.tsx';
import { QrFullscreenView } from './screens/teacher/QrFullscreen.tsx';
import { RewindPanelView } from './screens/teacher/RewindSheet.tsx';
import { StudentDrawerView } from './screens/teacher/StudentDrawer.tsx';
import type { StudentTileModel } from './screens/teacher/tiles.ts';

/**
 * P5-1 접근성 점검(docs/reviews/P5-1_a11y_review.md) 발견 항목별 회귀 시험.
 * 화면은 편집기 입력칸(제목 input·본문 textarea)의 값·선택·초점을 건드리지 않는다는 규칙(PLAN §6.3)도 함께 본다.
 */

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

const NOW = Date.UTC(2026, 10, 11, 1, 40, 0);
const noop = () => undefined;

/**
 * CSS 원문 읽기. 시험 환경은 CSS를 처리하지 않아 `?raw` 가져오기가 빈 글이 되므로 Node 내장 `fs`로 읽는다
 * (웹 tsconfig에는 Node 타입이 없어 필요한 모양만 적어 둔다).
 */
interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
}
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): FsLike } }
).process.getBuiltinModule('node:fs');
// jsdom의 URL은 Node `fs`가 받지 않아 경로 글자로 바꾼다.
const UI_DIR = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '').replace(/[^/]*$/, ''));

const cssModules: Record<string, string> = Object.fromEntries(
  ['components/', 'screens/'].flatMap(dir =>
    fs
      .readdirSync(`${UI_DIR}${dir}`, { recursive: true })
      .filter(name => name.endsWith('.css'))
      .map(name => {
        const rel = `${dir}${name.split('\\').join('/')}`;
        return [`./${rel}`, fs.readFileSync(`${UI_DIR}${rel}`, 'utf8')] as const;
      }),
  ),
);
const tokensCss = fs.readFileSync(`${UI_DIR}tokens.css`, 'utf8');

function css(path: string): string {
  const text = cssModules[path];
  if (text === undefined) throw new Error(`css missing: ${path}`);
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** `selector { ... }` 덩어리들의 본문(같은 선택자가 여러 번이면 모두). 미디어 쿼리 안도 포함한다. */
function ruleBodies(source: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[},\\s])${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g');
  return [...source.matchAll(re)].map(m => m[1] ?? '');
}

/** `@media (prefers-reduced-motion: reduce) { ... }` 안쪽 글. */
function reducedMotionBlocks(source: string): string {
  const out: string[] = [];
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  for (const m of source.matchAll(re)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') depth -= 1;
      i += 1;
    }
    out.push(source.slice(start, i - 1));
  }
  return out.join('\n');
}

function tokenColor(name: string): string {
  const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m?.[1]) throw new Error(`token missing: --${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 보조기기가 읽는 글자(aria-hidden 가지는 뺀다). */
function spokenText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
    else if (node instanceof Element && node.getAttribute('aria-hidden') !== 'true') out += spokenText(node);
  }
  return out;
}

function stubMatchMedia(matches: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

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

function buttonByText(text: string, scope: ParentNode = host): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find(b => b.textContent?.includes(text));
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function keydown(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

// ── 교사 대시보드·서랍 ─────────────────────────────────────────────

function tile(i: number): StudentTileModel {
  return {
    participantId: `p-${i}`,
    docId: `d-${i}`,
    nickname: `n${String(i).padStart(2, '0')}`,
    status: 'writing',
    genreLabel: ko.student.genreNewsLabel,
    chars: i * 10,
    lastInputAt: NOW - 12 * MS_PER_SECOND,
    submittedAt: null,
  };
}

const TILES = [tile(1), tile(2), tile(3)];

const dashboardBase: DashboardViewProps = {
  roomTitle: 'room',
  className: 'class',
  roomStatus: 'ACTIVE',
  nowMs: NOW,
  tiles: TILES,
  connectedCount: 3,
  submittedCount: 0,
  filter: 'all',
  onFilterChange: noop,
  onSelectTile: noop,
  timer: { status: 'IDLE', remainingSec: null },
  onTimerPause: noop,
  onTimerResume: noop,
  onTimerCancel: noop,
  noticeOpen: false,
  onNoticeOpenChange: noop,
  noticePanel: null,
  onOpenQr: noop,
  onOpenExport: noop,
  onOpenPrep: noop,
  onOpenSettings: noop,
  onCloseRoom: noop,
  onReopenRoom: noop,
  onDeleteRoom: noop,
};

function drawer(onClose: () => void = noop, refs = { title: createRef<HTMLInputElement>() }) {
  return (
    <StudentDrawerView
      nickname="n01"
      status="writing"
      genreLabel=""
      docStatus="DRAFT"
      titleRef={refs.title}
      bodyRef={createRef<HTMLTextAreaElement>()}
      mirrorRef={createRef<HTMLDivElement>()}
      onUndo={noop}
      onRedo={noop}
      onOpenRewind={noop}
      onReopenDoc={noop}
      onCopyDoc={noop}
      onOpenDevices={noop}
      onClose={onClose}
      memos={[]}
    />
  );
}

function tileButton(participantId: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(`button[data-participant-id="${participantId}"]`);
  if (!el) throw new Error(`tile missing: ${participantId}`);
  return el;
}

describe('[상-1] 학생 글 서랍 초점 이동·복귀·좁은 화면 모달', () => {
  it('열면 닫기 단추로 초점이 가고(입력칸은 아님), 닫으면 연 타일로 돌아온다', () => {
    render(<DashboardView {...dashboardBase} />);
    act(() => tileButton('p-1').focus());
    expect(document.activeElement).toBe(tileButton('p-1'));

    const title = createRef<HTMLInputElement>();
    render(
      <DashboardView
        {...dashboardBase}
        selectedParticipantId="p-1"
        drawerLabel="n01"
        drawer={drawer(noop, { title })}
      />,
    );
    const close = host.querySelector<HTMLButtonElement>(
      `[data-doc-status] button[aria-label="${ko.common.close}"]`,
    );
    expect(document.activeElement).toBe(close);
    expect(document.activeElement).not.toBe(title.current);
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');

    // 닫기 단추가 사라지면 초점이 body로 떨어진다 → 대시보드가 연 타일로 돌려준다.
    render(<DashboardView {...dashboardBase} selectedParticipantId={null} />);
    expect(document.activeElement).toBe(tileButton('p-1'));
  });

  it('닫을 때 교사가 이미 다른 곳에 초점을 두었으면 빼앗지 않는다', () => {
    render(<DashboardView {...dashboardBase} selectedParticipantId="p-1" drawer={drawer()} />);
    act(() => tileButton('p-2').focus());
    render(<DashboardView {...dashboardBase} selectedParticipantId={null} />);
    expect(document.activeElement).toBe(tileButton('p-2'));
  });

  it('900px 미만: 서랍 자리는 이름 있는 모달 대화상자, 뒤 보드는 inert, Escape로 닫힌다(조합 중 Escape는 무시)', () => {
    const onClose = vi.fn();
    render(
      <DashboardView
        {...dashboardBase}
        selectedParticipantId="p-1"
        drawerLabel="n01"
        drawer={drawer(onClose)}
      />,
    );
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('n01');
    expect(host.querySelector('main')?.hasAttribute('inert')).toBe(true);

    const close = dialog?.querySelector(`button[aria-label="${ko.common.close}"]`);
    if (!close) throw new Error('close missing');
    keydown(close, 'Escape', { isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    keydown(close, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('900px 이상: 옆 칸이라 모달·inert가 아니다', () => {
    const restore = stubMatchMedia(true);
    try {
      const onClose = vi.fn();
      render(<DashboardView {...dashboardBase} selectedParticipantId="p-1" drawer={drawer(onClose)} />);
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(host.querySelector('main')?.hasAttribute('inert')).toBe(false);
      const close = host.querySelector(`[data-doc-status] button[aria-label="${ko.common.close}"]`);
      if (!close) throw new Error('close missing');
      keydown(close, 'Escape');
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

// ── 저장 상태 알림 ─────────────────────────────────────────────

describe('[상-2] 저장 상태는 알릴 전환만 읽는다', () => {
  function liveText(): string {
    const lives = host.querySelectorAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]');
    return [...lives].map(el => el.textContent ?? '').join('|');
  }

  it('저장됨·보내는 중 왕복은 라이브 영역에 넣지 않고, 여기에만 저장·제출 완료·제출하는 중은 알린다', () => {
    render(<SaveState state="saved" />);
    const badge = host.querySelector('[data-save-state]');
    expect(badge?.getAttribute('role')).toBeNull();
    expect(badge?.hasAttribute('aria-live')).toBe(false);
    expect(liveText()).toBe('');
    render(<SaveState state="sending" />);
    expect(liveText()).toBe('');
    expect(host.textContent).toContain(ko.common.saveSending);
    render(<SaveState state="saved" />);
    expect(liveText()).toBe('');

    render(<SaveState state="local" />);
    expect(liveText()).toBe(ko.common.saveLocal);
    render(<SaveState state="locked" />);
    expect(liveText()).toBe(ko.common.saveLocked);
    render(<SaveState state="sending" label={ko.student.submitPendingStatus} announce />);
    expect(liveText()).toBe(ko.student.submitPendingStatus);
  });
});

// ── AI 칩 ─────────────────────────────────────────────

describe('[중-1] 좁은 화면 AI 칩 이름에 상태가 들어간다', () => {
  it('쿨다운 초와 `글이 바뀌었어요`가 읽기 이름에 남는다', () => {
    const chips: AiChipView[] = [
      { button: 'SPELL', state: 'cooldown', cooldownSeconds: 7 },
      { button: 'FEEDBACK', state: 'stale' },
      { button: 'DIRECTION', state: 'idle' },
    ];
    render(<AiChipBar chips={chips} layout="narrow" onChip={noop} />);
    const spell = host.querySelector('[data-ai-button="SPELL"]');
    const feedback = host.querySelector('[data-ai-button="FEEDBACK"]');
    const direction = host.querySelector('[data-ai-button="DIRECTION"]');
    expect(spell?.getAttribute('aria-label')).toContain(ko.student.aiSpellLabel);
    expect(spell?.getAttribute('aria-label')).toContain(`7${ko.student.aiCooldownSuffix}`);
    expect(feedback?.getAttribute('aria-label')).toContain(ko.student.aiFeedbackLabel);
    expect(feedback?.getAttribute('aria-label')).toContain(ko.student.aiStaleBadge);
    expect(direction?.getAttribute('aria-label')).toBe(ko.student.aiDirectionLabel);
  });

  it('`stale` 칩은 색 말고 점선 테두리로도 구분된다', () => {
    const body = ruleBodies(css('./components/Chip.module.css'), '.ai_stale').join('\n');
    expect(body).toMatch(/border-style:\s*dashed/);
  });
});

describe('[중-2] aria-pressed는 켜기형 칩에만', () => {
  it('selected를 주지 않은 칩은 aria-pressed가 없고, 펼침 칩(aria-expanded)도 없다', () => {
    render(
      <div>
        <Chip id="plain">a</Chip>
        <Chip id="toggle" selected={false}>
          b
        </Chip>
        <Chip id="disclosure" selected aria-expanded>
          c
        </Chip>
      </div>,
    );
    expect(host.querySelector('#plain')?.hasAttribute('aria-pressed')).toBe(false);
    expect(host.querySelector('#toggle')?.getAttribute('aria-pressed')).toBe('false');
    const disclosure = host.querySelector('#disclosure');
    expect(disclosure?.hasAttribute('aria-pressed')).toBe(false);
    expect(disclosure?.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure?.getAttribute('data-selected')).toBe('true');
  });

  it('쓰기 화면: AI 칩·구조 칩은 aria-pressed가 없고 도움 질문 칩은 aria-expanded만', () => {
    render(
      <WriteView
        {...writeProps({ structureButtons: ['chorus'], panel: { button: 'SPELL', status: 'loading' } })}
      />,
    );
    for (const el of host.querySelectorAll('[data-ai-button], [data-structure]')) {
      expect(el.hasAttribute('aria-pressed')).toBe(false);
    }
    const help = buttonByText(ko.student.helpQuestionsButton);
    expect(help.hasAttribute('aria-pressed')).toBe(false);
    expect(help.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-ai-button="SPELL"]')?.getAttribute('aria-expanded')).toBe('true');
  });
});

// ── 결과 패널 초점 ─────────────────────────────────────────────

function writeProps(over: Partial<WriteViewProps> = {}): WriteViewProps {
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
    helpQuestions: [{ id: 'news_when', prompt: 'q1' }],
    helpIndex: 0,
    onHelpIndexChange: noop,
    structureButtons: [],
    onStructure: noop,
    aiChips: (['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'] as const).map(button => ({
      button,
      state: 'idle',
    })),
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

describe('[중-3] 결과 패널 열기·닫기 초점', () => {
  const panel: ResultPanelView = { button: 'SPELL', status: 'loading' };
  const chip = () => host.querySelector<HTMLButtonElement>('[data-ai-button="SPELL"]');

  it('옆 패널: 칩으로 열면 패널로, 패널을 닫으면 그 칩으로 초점이 돌아온다', () => {
    render(<WriteView {...writeProps()} />);
    act(() => chip()?.focus());
    render(<WriteView {...writeProps({ panel })} />);
    expect(document.activeElement).toBe(host.querySelector('aside[data-result="SPELL"]'));

    render(<WriteView {...writeProps({ panel: null })} />);
    expect(document.activeElement).toBe(chip());
  });

  it('좁은 화면 시트도 닫으면 칩으로 돌아온다', () => {
    render(<WriteView {...writeProps({ layout: 'narrow' })} />);
    act(() => chip()?.focus());
    render(<WriteView {...writeProps({ layout: 'narrow', panel })} />);
    const close = host.querySelector<HTMLButtonElement>(
      `[data-sheet-inline] button[aria-label="${ko.common.close}"]`,
    );
    act(() => close?.focus());
    render(<WriteView {...writeProps({ layout: 'narrow', panel: null })} />);
    expect(document.activeElement).toBe(chip());
  });

  it('쓰기 칸에 초점이 있으면 열 때도 닫을 때도 초점을 옮기지 않는다', () => {
    const bodyRef = createRef<HTMLTextAreaElement>();
    render(<WriteView {...writeProps({ bodyRef })} />);
    act(() => bodyRef.current?.focus());
    render(<WriteView {...writeProps({ bodyRef, panel })} />);
    expect(document.activeElement).toBe(bodyRef.current);
    render(<WriteView {...writeProps({ bodyRef, panel: null })} />);
    expect(document.activeElement).toBe(bodyRef.current);
  });
});

// ── CSS: 키보드 하이라이트·대비·움직임 ─────────────────────────────

describe('[중-4] 목록 키보드 하이라이트는 잉크 테두리', () => {
  it.each(['./components/Dropdown.module.css', './components/Menu.module.css'])('%s', path => {
    const body = ruleBodies(css(path), '.item[data-highlighted]').join('\n');
    expect(body).toMatch(/outline:\s*var\(--stroke-focus\)\s+solid\s+var\(--ink\)/);
    expect(body).not.toMatch(/outline:\s*none/);
  });
});

describe('[중-5] 채색 바탕 위 보조 글자는 잉크', () => {
  it('선택된 칩의 보조 글자는 --ink(버터 위 --ink-sub 3.90:1 미달)', () => {
    const body = ruleBodies(css('./components/Chip.module.css'), '.selected .statusText').join('\n');
    expect(body).toMatch(/color:\s*var\(--ink\)/);
    expect(contrast(tokenColor('ink'), tokenColor('butter'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('[중-6] PIN·코드 칸 이름·오류 연결과 작은 칸 높이', () => {
  it('보이는 이름은 label로, 오류·안내는 aria-describedby·aria-invalid로 입력칸에 이어진다', () => {
    render(<CodeKeypadField label="L" value="" length={6} onChange={noop} error="E" />);
    const input = host.querySelector('input');
    if (!input) throw new Error('input missing');
    const label = host.querySelector('label');
    expect(label?.htmlFor).toBe(input.id);
    expect(label?.textContent).toBe('L');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map(id => document.getElementById(id)?.textContent);
    expect(described).toContain('E');
    expect(host.querySelector('[data-error="true"]')).not.toBeNull();

    render(<CodeKeypadField label="L" value="" length={6} onChange={noop} hint="H" />);
    const input2 = host.querySelector('input');
    const ids = (input2?.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map(id => document.getElementById(id)?.textContent)).toContain('H');
    expect(input2?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('작은 칸(slotSm)은 어떤 폭에서도 44px보다 낮아지지 않는다', () => {
    const source = css('./components/CodeInput.module.css');
    for (const body of ruleBodies(source, '.slotSm')) {
      const h = body.match(/(?:^|;|\s)height:\s*(\d+)px/);
      if (h?.[1]) expect(Number(h[1])).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('[중-7] 연결 점검 항목 상태가 읽힌다', () => {
  it('확인 중·좋아요 상태 이름이 아이콘 이름으로 붙는다', () => {
    render(<ConnectionCheckView check={{ realtime: 'running', ai: 'ok', storage: 'fail' }} onRun={noop} />);
    const items = [...host.querySelectorAll('li[data-state]')];
    expect(items[0]?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
      ko.teacher.checkItemRunning,
    );
    expect(items[1]?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(ko.teacher.checkItemOk);
    expect(items[2]?.textContent).toContain(ko.teacher.checkStorageFail);
  });
});

describe('[중-8] 쓰는 중(30~180초)은 읽기로도 구분되고 멈춤 띠는 대비 3:1', () => {
  it('writing-flow 배지는 보조기기에 다른 이름으로 읽힌다', () => {
    render(
      <div>
        <StatusBadge id="w" status="writing" />
        <StatusBadge id="f" status="writing-flow" />
      </div>,
    );
    const writing = host.querySelector('#w');
    const flow = host.querySelector('#f');
    if (!writing || !flow) throw new Error('badge missing');
    expect(spokenText(writing)).toBe(ko.teacher.statusWriting);
    expect(spokenText(flow)).toBe(ko.teacher.statusWritingFlow);
    // 눈에 보이는 글자는 PRD F-17대로 둘 다 `쓰는 중`
    expect(flow.querySelector('span[aria-hidden="true"]')?.textContent).toBe(ko.teacher.statusWriting);
  });

  it('멈춤 띠 색은 흰 타일 위 3:1 이상', () => {
    const body = ruleBodies(css('./components/StudentTile.module.css'), '.stripe_idle').join('\n');
    const token = body.match(/border-left-color:\s*var\(--([a-z-]+)\)/)?.[1];
    if (!token) throw new Error('stripe color missing');
    expect(contrast(tokenColor(token), tokenColor('surface'))).toBeGreaterThanOrEqual(3);
  });
});

describe('[중-9] 반복 단추 이름이 줄마다 다르다', () => {
  it('이어 쓰기 요청: 허용·거절 이름에 별명이 들어간다', () => {
    render(
      <ResumeRequestsBand
        requests={[
          { requestId: 'r1', nickname: 'haneul' },
          { requestId: 'r2', nickname: 'badaa' },
        ]}
        onDecide={noop}
        onApproveAll={noop}
      />,
    );
    const names = [...host.querySelectorAll('li button')].map(b => b.getAttribute('aria-label'));
    expect(names).toEqual([
      `haneul ${ko.teacher.resumeApproveAction}`,
      `haneul ${ko.teacher.resumeRejectAction}`,
      `badaa ${ko.teacher.resumeApproveAction}`,
      `badaa ${ko.teacher.resumeRejectAction}`,
    ]);
  });

  it('기기 끊기: 단추 이름에 기기 번호가 들어가고 허용 시각이 설명으로 이어진다', () => {
    render(
      <DevicesPanelView
        devices={[
          { deviceRowId: 'a', approvedAt: NOW - MS_PER_MINUTE, lastSeenAt: null },
          { deviceRowId: 'b', approvedAt: NOW, lastSeenAt: NOW },
        ]}
        onRevoke={noop}
        nowMs={NOW}
      />,
    );
    const buttons = [...host.querySelectorAll('li button')];
    const names = buttons.map(b => b.getAttribute('aria-label') ?? '');
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain(`${ko.teacher.deviceNumberPrefix} 1`);
    expect(names[0]).toContain(ko.teacher.disconnectDeviceShortAction);
    expect(names[1]).toContain(`${ko.teacher.deviceNumberPrefix} 2`);
    const description = (buttons[0]?.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map(id => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(description).toContain(ko.teacher.deviceApprovedAtLabel);
  });
});

describe('[하-1] QR 전체 화면 초점 가두기·복귀', () => {
  function qr(onClose: () => void = noop) {
    return (
      <QrFullscreenView
        roomTitle="r"
        className="c"
        entryCode="482913"
        entryUrl="https://example.test/482913"
        shortUrl="example.test/482913"
        onClose={onClose}
      />
    );
  }

  it('Tab은 닫기 단추에 머물고, 닫히면 연 단추로 초점이 돌아간다', () => {
    const page = (open: boolean) => (
      <>
        <button type="button" id="opener">
          o
        </button>
        {open ? qr() : null}
      </>
    );
    render(page(false));
    const opener = host.querySelector<HTMLButtonElement>('#opener');
    act(() => opener?.focus());
    render(page(true));
    const close = host.querySelector<HTMLButtonElement>(
      `[role="dialog"] button[aria-label="${ko.common.close}"]`,
    );
    if (!close) throw new Error('close missing');
    expect(document.activeElement).toBe(close);
    const tab = keydown(close, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    keydown(close, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(close);

    render(page(false));
    expect(document.activeElement).toBe(opener);
  });

  it('연 곳이 글 입력칸이면 닫을 때 그 칸으로 초점을 돌리지 않는다', () => {
    const page = (open: boolean) => (
      <>
        <textarea id="editor" />
        {open ? qr() : null}
      </>
    );
    render(page(false));
    const editor = host.querySelector<HTMLTextAreaElement>('#editor');
    act(() => editor?.focus());
    render(page(true));
    render(page(false));
    expect(document.activeElement).not.toBe(editor);
  });
});

describe('[하-2] 되감기 미리 보기는 이름 있는 영역이고 키보드로 넘길 수 있다', () => {
  it('학생 시트', () => {
    render(
      <StudentRewindSheet
        open
        onOpenChange={noop}
        inline
        now={NOW}
        fontSize={18}
        onSelect={noop}
        onRestore={noop}
        view={{
          status: 'ready',
          selectedIndex: 0,
          snapshots: [{ id: 's1', at: NOW - MS_PER_MINUTE, reason: 'AUTO', title: 't', body: 'b' }],
        }}
      />,
    );
    const preview = host.querySelector(`[aria-label="${ko.common.rewindPreviewLabel}"]`);
    expect(preview?.tagName).toBe('SECTION');
    expect(preview?.getAttribute('tabindex')).toBe('0');
  });

  it('교사 서랍', () => {
    render(
      <RewindPanelView
        items={[{ id: 's1', at: NOW, reason: 'AUTO' }]}
        index={0}
        onIndexChange={noop}
        preview={{ title: 't', body: 'b' }}
        onRestore={noop}
        nowMs={NOW}
      />,
    );
    const preview = host.querySelector('article');
    expect(preview?.getAttribute('aria-label')).toBe(ko.common.rewindPreviewLabel);
    expect(preview?.getAttribute('tabindex')).toBe('0');
  });
});

describe('[하-3] 라이브 영역 안에 단추를 두지 않는다', () => {
  it('별명 중복 카드', () => {
    render(<NicknameView nickname="a" onNicknameChange={noop} onNext={noop} taken onClaimMine={noop} />);
    const live = host.querySelector('[role="status"]');
    expect(live?.textContent).toContain(ko.student.nicknameTakenGuide);
    expect(live?.querySelector('button')).toBeNull();
    expect(buttonByText(ko.student.nicknameMineAction)).toBeTruthy();
  });

  it('이어 쓰기 기다림', () => {
    render(<ResumeWaitView status="waiting" longWait onCancel={noop} onChooseOther={noop} />);
    const live = host.querySelector('[role="status"]');
    expect(live?.textContent).toContain(ko.student.resumeWaitTitle);
    expect(live?.textContent).toContain(ko.student.resumeWaitLongHint);
    expect(live?.querySelector('button')).toBeNull();
  });

  it('EmptyState liveText는 글만 감싼다', () => {
    render(<EmptyState title="t" description="d" actionLabel="a" onAction={noop} liveText />);
    const live = host.querySelector('[role="status"]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe('td');
  });
});

describe('[하-4] 화면 제목과 main 영역', () => {
  it('별명 화면에 h1이 있다', () => {
    render(<NicknameView nickname="" onNicknameChange={noop} onNext={noop} />);
    expect(host.querySelector('main h1')?.textContent).toBeTruthy();
  });

  it('쓰기 화면에 main과 h1이 하나씩 있고, 입력칸은 main 안에 그대로 있다', () => {
    const bodyRef = createRef<HTMLTextAreaElement>();
    render(<WriteView {...writeProps({ bodyRef })} />);
    expect(host.querySelectorAll('main')).toHaveLength(1);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('main h1')?.textContent).toBeTruthy();
    expect(host.querySelector('main')?.contains(bodyRef.current)).toBe(true);
  });
});

describe('[하-5] 움직임 줄이기에서는 누를 때 내려앉지 않는다', () => {
  const files = Object.keys(cssModules).filter(p => p.endsWith('.css'));

  it.each(files)('%s', path => {
    const source = css(path);
    const reduced = reducedMotionBlocks(source);
    const activeRules = [...source.matchAll(/([^{}]*:active[^{}]*)\{([^}]*)\}/g)].filter(m =>
      /transform:\s*translate/.test(m[2] ?? ''),
    );
    for (const m of activeRules) {
      const selector = (m[1] ?? '').trim().split(',').at(-1)?.trim() ?? '';
      expect(reduced, `${path} ${selector}`).toContain(selector);
      const body = ruleBodies(reduced, selector).join('\n');
      expect(body, `${path} ${selector}`).toMatch(/transform:\s*none/);
    }
  });
});

describe('교사 PIN 잠김 안내(문구 검토)', () => {
  it('잠긴 동안 `n분 뒤에 다시 입력해 주세요.`를 보이고 E_PIN_LOCKED 문구는 쓰지 않는다', () => {
    render(
      <PinEntryView
        value=""
        onChange={noop}
        onSubmit={noop}
        nowMs={NOW}
        lockedUntil={NOW + 3 * MS_PER_MINUTE}
      />,
    );
    expect(host.textContent).toContain(`3${ko.teacher.pinLockedRemainingSuffix}`);
    expect(host.textContent).not.toContain(ko.errors.E_PIN_LOCKED);
  });
});

describe('대비표: 눌림 단추 글자·입력칸 경계 토큰', () => {
  it('눌림(hover·active) 주 단추·위험 단추 글자는 4.5:1 이상 토큰을 쓴다', () => {
    const button = css('./components/Button.module.css');
    const primary = ruleBodies(button, '.primary:active:not(:disabled)').join('\n');
    const danger = ruleBodies(button, '.danger:active:not(:disabled)').join('\n');
    const primaryInk = primary.match(/(?:^|;|\s)color:\s*var\(--([a-z-]+)\)/)?.[1];
    const dangerInk = danger.match(/(?:^|;|\s)color:\s*var\(--([a-z-]+)\)/)?.[1];
    if (!primaryInk || !dangerInk) throw new Error('pressed ink missing');
    expect(contrast(tokenColor(primaryInk), tokenColor('primary-pressed'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenColor(dangerInk), tokenColor('rose-pressed'))).toBeGreaterThanOrEqual(4.5);
  });

  it('제목 입력칸 경계선은 바탕 위 3:1 이상', () => {
    const write = ruleBodies(css('./screens/student/write/WriteView.module.css'), '.title').join('\n');
    const drawerTitle = ruleBodies(css('./screens/teacher/StudentDrawer.module.css'), '.title').join('\n');
    for (const body of [write, drawerTitle]) {
      const token = body.match(
        /border(?:-bottom)?:\s*var\(--stroke-thin\)\s+solid\s+var\(--([a-z-]+)\)/,
      )?.[1];
      if (!token) throw new Error('border token missing');
      expect(contrast(tokenColor(token), tokenColor('bg'))).toBeGreaterThanOrEqual(3);
      expect(contrast(tokenColor(token), tokenColor('surface'))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('맞춤법 등급은 색만이 아니라 글자·모양으로도 구분되고 읽기 이름에 들어간다(docs/ai-harness.md 5절)', () => {
  const item = (id: string, severity: SpellItemView['severity']): SpellItemView => ({
    id,
    original: `o-${id}`,
    suggestion: `s-${id}`,
    reason: `r-${id}`,
    kind: 'spelling',
    severity,
    locatable: true,
  });
  const panel: ResultPanelView = {
    button: 'SPELL',
    status: 'ready',
    receivedAt: NOW,
    content: { kind: 'SPELL', items: [item('f', 'fix'), item('s', 'suggest'), item('k', 'keep')] },
  };
  const panelCss = () => css('./screens/student/write/ResultPanel.module.css');
  const mirrorCss = () =>
    fs.readFileSync(`${UI_DIR}../adapters/editor/mirror.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('항목 단추의 읽기 이름이 등급 글자로 시작한다(고쳐요는 보이지 않는 글자로)', () => {
    render(<WriteView {...writeProps({ panel })} />);
    const name = (id: string) =>
      spokenText(buttonByText(`o-${id}`, host.querySelector('aside[data-result="SPELL"]') ?? host)).trim();
    expect(name('f').startsWith(ko.student.aiSpellSeverityFix)).toBe(true);
    expect(name('s').startsWith(ko.student.aiSpellSeveritySuggest)).toBe(true);
    expect(name('k').startsWith(ko.student.aiSpellSeverityKeep)).toBe(true);
    const hidden = host.querySelector('[data-severity-group="fix"] .visually-hidden');
    expect(hidden?.textContent).toBe(ko.student.aiSpellSeverityFix);
  });

  it('그대로 둬도 돼요 묶음은 접힌 details라 키보드로 펼칠 수 있고, 펼쳐도 쓰기 칸 초점·선택·값은 그대로다', () => {
    const bodyRef = createRef<HTMLTextAreaElement>();
    render(<WriteView {...writeProps({ bodyRef })} />);
    const body = bodyRef.current as HTMLTextAreaElement;
    body.value = 'abc def';
    act(() => body.focus());
    body.setSelectionRange(2, 5);
    render(<WriteView {...writeProps({ bodyRef, panel })} />);
    const details = host.querySelector<HTMLDetailsElement>('details[data-severity-group="keep"]');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')).not.toBeNull();
    act(() => {
      if (details) details.open = true;
    });
    expect(document.activeElement).toBe(body);
    expect([body.value, body.selectionStart, body.selectionEnd, body.readOnly]).toEqual([
      'abc def',
      2,
      5,
      false,
    ]);
  });

  it('권장해요는 점선 테두리·글자 표시, 쓰기 칸 형광은 옅은 색 + 점선 밑줄(색맹이어도 구분)', () => {
    expect(ruleBodies(panelCss(), '.spellItemSuggest').join('\n')).toMatch(/border-style:\s*dashed/);
    expect(ruleBodies(panelCss(), '.severityBadge').join('\n')).toMatch(/dashed/);
    const soft = ruleBodies(
      mirrorCss(),
      "[data-mirror] [data-mirror-mark='highlight'][data-mirror-tone='soft']",
    ).join('\n');
    expect(soft).toMatch(/background:\s*var\(--butter-soft\)/);
    expect(soft).toMatch(/text-decoration-style:\s*dotted/);
    expect(soft).toMatch(/text-decoration-color:\s*var\(--butter-ink\)/);
  });

  it('대비: 옅은 버터 위 글자 4.5:1, 점선 3:1, 눌린 고쳐요(버터) 위 보조 글자는 잉크', () => {
    const soft = tokenColor('butter-soft');
    expect(contrast(tokenColor('ink'), soft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenColor('ink-sub'), soft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenColor('butter-ink'), soft)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokenColor('butter-ink'), tokenColor('surface'))).toBeGreaterThanOrEqual(3);
    expect(contrast(tokenColor('butter-ink'), tokenColor('bg'))).toBeGreaterThanOrEqual(3);
    expect(ruleBodies(panelCss(), '.spellItemActive .reason').join('\n')).toMatch(/color:\s*var\(--ink\)/);
  });
});
