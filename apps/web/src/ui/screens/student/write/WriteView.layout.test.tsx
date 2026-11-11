import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ko } from '@geulbang/core/copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_BUTTON_LABEL } from './AiChipBar.tsx';
import { isWriteCompact } from './layout.ts';
import type { AiChipView, ResultPanelView, WriteLayout } from './types.ts';
import { WriteView, type WriteViewProps } from './WriteView.tsx';
import styles from './WriteView.module.css';

/**
 * PRD 16.5: 360px 쓰기 화면 상단 바 넘침(검토 결함 5). 원인은 창이 좁아진 직후 `data-layout`이 아직 wide인
 * 한 장면이다(배치는 미디어 쿼리 알림 뒤 다시 그릴 때 바뀐다). 그 사이에도 넘치지 않도록 상단 바 격자와 칸의 약속을 본다.
 * 시험 환경은 배치를 계산하지 않으므로 그린 상단 바의 칸과 CSS 원문(격자 자리·줄 수 있는 칸·자르기)을 맞춰 본다.
 */

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string;
}
const fs = (
  globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): FsLike } }
).process.getBuiltinModule('node:fs');
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '').replace(/[^/]*$/, ''));
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SOURCE = stripComments(fs.readFileSync(`${HERE}WriteView.module.css`, 'utf8'));
const TOAST_SOURCE = stripComments(fs.readFileSync(`${HERE}../../../components/Toast.module.css`, 'utf8'));

/** `selector { ... }` 본문(같은 선택자가 여러 번이면 이어 붙임) */
function rule(selector: string, source: string = SOURCE): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'g');
  return [...source.matchAll(re)].map(m => m[1] ?? '').join('\n');
}

function declaration(body: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`).exec(body);
  return m?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

/** 격자 칸 목록: `minmax(0, auto)`처럼 괄호 안 쉼표는 나누지 않는다. */
function tracks(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function areaRows(value: string): string[][] {
  return [...value.matchAll(/'([^']*)'/g)].map(m => (m[1] ?? '').trim().split(/\s+/));
}

const topBar = (layout: WriteLayout) => rule(`.write[data-layout='${layout}'] .topBar`);

/** 붙은 이름 → CSS 원문의 이름(시험 환경이 붙이는 해시를 되돌린다. `styles`는 열거되지 않아 원문 이름으로 찾는다) */
const classKeyOf = new Map(
  [...new Set([...SOURCE.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => m[1] ?? ''))].map(
    key => [(styles as Record<string, string>)[key], key] as const,
  ),
);

const noop = () => {};
const chips: AiChipView[] = (['SPELL', 'FEEDBACK', 'DIRECTION', 'POLISH'] as const).map(button => ({
  button,
  state: 'idle',
}));

function props(over: Partial<WriteViewProps>): WriteViewProps {
  return {
    sheetsInline: true,
    now: Date.UTC(2026, 10, 12, 1, 0, 0),
    bodyRef: createRef<HTMLTextAreaElement>(),
    titleRef: createRef<HTMLInputElement>(),
    mirrorRef: createRef<HTMLDivElement>(),
    genre: 'poem',
    subtype: null,
    onSubtypeChange: noop,
    fontSize: 18,
    saveState: 'sending',
    submission: 'none',
    canUndo: true,
    canRedo: false,
    onUndo: noop,
    onRedo: noop,
    helpOpen: false,
    onHelpOpenChange: noop,
    helpQuestions: [],
    helpIndex: 0,
    onHelpIndexChange: noop,
    structureButtons: [],
    onStructure: noop,
    aiChips: chips,
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

/** 그린 상단 바의 바로 아래 칸들(모듈 이름) */
function headerCells(layout: WriteLayout): string[] {
  act(() =>
    root.render(
      <WriteView
        {...props({
          layout,
          timer: { remainingSeconds: 300, paused: false },
          notice: 'n',
          holding: true,
        })}
      />,
    ),
  );
  const header = host.querySelector('header');
  expect(header).not.toBeNull();
  return [...header!.children].map(el => {
    const key = [...el.classList].map(c => classKeyOf.get(c)).find(k => k !== undefined);
    expect(key, el.outerHTML.slice(0, 80)).toBeDefined();
    return key!;
  });
}

describe('S5 상단 바 배치(PRD 16.5)', () => {
  it.each<WriteLayout>(['wide', 'narrow'])(
    '%s: 상단 바의 모든 칸이 그 배치의 격자 자리에 들어간다(자리 없는 칸이 줄 끝에 붙지 않는다)',
    layout => {
      const areas = new Set(areaRows(declaration(topBar(layout), 'grid-template-areas') ?? '').flat());
      expect(areas.size).toBeGreaterThan(0);
      for (const cell of headerCells(layout)) {
        const body = rule(`.${cell}`) + rule(`.write[data-layout='${layout}'] .${cell}`);
        const area = declaration(body, 'grid-area');
        const column = declaration(body, 'grid-column');
        // 자리 이름이 있거나(그 배치 격자에 있어야 함) 줄 전체를 차지한다.
        if (area !== null) expect(areas, `${layout} .${cell} → ${area}`).toContain(area);
        else expect(column, `${layout} .${cell}`).toBe('1 / -1');
      }
    },
  );

  it('wide: 내용 폭이 바뀌는 칸(글 종류·저장 상태)은 0까지 줄 수 있어 좁아진 직후 한 장면에도 `···`이 밀리지 않는다', () => {
    const body = topBar('wide');
    const rows = areaRows(declaration(body, 'grid-template-areas') ?? '');
    const cols = tracks(declaration(body, 'grid-template-columns') ?? '');
    const row = rows[0] ?? [];
    expect(cols).toHaveLength(row.length);
    const track = (area: string) => cols[row.indexOf(area)];
    expect(track('genre')).toMatch(/^minmax\(0,/);
    expect(track('title')).toMatch(/^minmax\(0,/);
    expect(track('tools')).toMatch(/^minmax\(0,/);
    // 줄어든 저장 상태 칸은 가로로만 잘라 옆 칸·화면 밖으로 나가지 않는다.
    expect(declaration(rule('.tools'), 'min-width')).toBe('0');
    expect(declaration(rule('.tools'), 'overflow-x')).toBe('clip');
  });

  it('narrow: 글 종류 칸은 0까지 줄고 칩은 칸보다 넓어지지 않는다(긴 이름은 말줄임)', () => {
    const body = topBar('narrow');
    const row = areaRows(declaration(body, 'grid-template-areas') ?? '')[0] ?? [];
    const cols = tracks(declaration(body, 'grid-template-columns') ?? '');
    expect(cols[row.indexOf('genre')]).toMatch(/^minmax\(0,/);
    expect(declaration(rule('.genre'), 'min-width')).toBe('0');
    expect(declaration(rule('.genre > *'), 'max-width')).toBe('100%');
    expect(declaration(rule('.genreStatic'), 'text-overflow')).toBe('ellipsis');
  });

  it('쓰기 칸: 거울 층이 옛 폭을 다시 맞추기 전 한 장면에도 화면 밖으로 나가지 않게 가로로 자른다', () => {
    expect(declaration(rule('.paper .stage'), 'overflow-x')).toBe('clip');
  });
});

const spellPanel: ResultPanelView = {
  button: 'SPELL',
  status: 'ready',
  receivedAt: Date.UTC(2026, 10, 12, 0, 57, 0),
  content: { kind: 'SPELL', items: [] },
};

function renderWrite(over: Partial<WriteViewProps>): HTMLElement {
  act(() => root.render(<WriteView {...props(over)} />));
  const screen = host.querySelector<HTMLElement>('[data-screen="S5"]');
  expect(screen).not.toBeNull();
  return screen!;
}

const chipTexts = () =>
  [...host.querySelectorAll<HTMLButtonElement>('[data-ai-button]')].map(
    chip => chip.querySelector('span')?.textContent ?? '',
  );

describe('S5 옆 패널이 쓰기 칸을 좁힐 때(P5-4 시각 검토 1번)', () => {
  it('좁은 쓰기 칸 배치는 넓은 배치 + 옆 패널 열림 + 넉넉하지 않은 창일 때만이다', () => {
    expect(isWriteCompact('wide', true, false)).toBe(true);
    expect(isWriteCompact('wide', true, true)).toBe(false);
    expect(isWriteCompact('wide', false, false)).toBe(false);
    expect(isWriteCompact('narrow', true, false)).toBe(false);
    expect(isWriteCompact('narrow', false, false)).toBe(false);
  });

  it('상단 바가 두 줄로 나뉘고 제목 칸이 둘째 줄 전체를 쓴다(모든 칸이 그 격자 자리에 들어간다)', () => {
    const compactBar = rule(`.write[data-layout='wide'][data-compact='true'] .topBar`);
    const rows = areaRows(declaration(compactBar, 'grid-template-areas') ?? '');
    const cols = tracks(declaration(compactBar, 'grid-template-columns') ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain('title');
    expect(new Set(rows[1])).toEqual(new Set(['title']));
    for (const row of rows) expect(row).toHaveLength(cols.length);

    // 시험 환경은 창 폭을 모르므로(넉넉하지 않음으로 본다) 넓은 배치 + 옆 패널이면 좁은 쓰기 칸 배치다.
    const screen = renderWrite({ layout: 'wide', panel: spellPanel, timer: { remainingSeconds: 300 } });
    expect(screen.getAttribute('data-panel')).toBe('open');
    expect(screen.getAttribute('data-compact')).toBe('true');
    const areas = new Set(rows.flat());
    for (const el of host.querySelector('header')!.children) {
      const key = [...el.classList].map(c => classKeyOf.get(c)).find(k => k !== undefined);
      expect(key).toBeDefined();
      const body = rule(`.${key!}`) + rule(`.write[data-layout='wide'] .${key!}`);
      const area = declaration(body, 'grid-area');
      if (area !== null) expect(areas, `.${key!} → ${area}`).toContain(area);
      else expect(declaration(body, 'grid-column')).toBe('1 / -1');
    }
  });

  it('AI 칩은 짧은 이름으로 한 줄을 지키고, 패널을 닫으면 긴 이름·한 줄 상단 바로 돌아간다', () => {
    renderWrite({ layout: 'wide', panel: spellPanel });
    expect(chipTexts()).toEqual(chips.map(c => AI_BUTTON_LABEL[c.button].short));
    // 읽기 이름은 화면 글자가 줄어도 긴 이름 그대로다(P5-1 [중-1]).
    const names = [...host.querySelectorAll('[data-ai-button]')].map(c => c.getAttribute('aria-label'));
    expect(names).toEqual(chips.map(c => AI_BUTTON_LABEL[c.button].full));

    const screen = renderWrite({ layout: 'wide', panel: null });
    expect(screen.getAttribute('data-compact')).toBe('false');
    expect(chipTexts()).toEqual(chips.map(c => AI_BUTTON_LABEL[c.button].full));
  });
});

describe('S5 닫힌 수업방·도장·토스트(P5-4 시각 검토 4·6·7번)', () => {
  it('닫힌 수업방: AI 칩과 결과 패널 `다시 받기`가 막혀 눌러도 요청하지 않는다', () => {
    const onAiChip = vi.fn();
    const onPanelRefresh = vi.fn();
    renderWrite({ layout: 'wide', roomClosed: true, panel: spellPanel, onAiChip, onPanelRefresh });
    const aiChips = [...host.querySelectorAll<HTMLButtonElement>('[data-ai-button]')];
    expect(aiChips).toHaveLength(4);
    for (const chip of aiChips) {
      expect(chip.disabled).toBe(true);
      act(() => chip.click());
    }
    const refresh = [...host.querySelectorAll<HTMLButtonElement>('aside button')].find(b =>
      b.textContent?.includes(ko.student.aiRefreshAction),
    );
    expect(refresh?.disabled).toBe(true);
    act(() => refresh?.click());
    expect(onAiChip).not.toHaveBeenCalled();
    expect(onPanelRefresh).not.toHaveBeenCalled();

    renderWrite({ layout: 'wide', roomClosed: false, panel: spellPanel, onAiChip });
    for (const chip of host.querySelectorAll<HTMLButtonElement>('[data-ai-button]')) {
      expect(chip.disabled).toBe(false);
    }
  });

  it('제출 도장은 쓰기 칸 밖 화면 가운데 막 위에 뜬다(글 위에 그림이 겹치지 않게)', () => {
    renderWrite({ layout: 'narrow', submission: 'submitted', stampVisible: true });
    const overlay = host.querySelector('[data-stamp-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay!.closest('section')).toBeNull();
    expect(overlay!.textContent).toContain(ko.student.submitStampText);
    const body = rule('.stampOverlay');
    expect(declaration(body, 'position')).toBe('fixed');
    expect(declaration(body, 'inset')).toBe('0');
    expect(declaration(body, 'pointer-events')).toBe('none');
    expect(declaration(rule('.stampOverlay::before'), 'background')).toBe('var(--bg)');
  });

  it('토스트는 글·행동 단추·닫기를 한 줄에 두고, 떠 있는 동안 글 끝을 그 위로 올릴 자리를 둔다', () => {
    expect(declaration(rule('.toast', TOAST_SOURCE), 'flex-wrap')).toBe('nowrap');
    expect(declaration(rule('.actionButton', TOAST_SOURCE), 'flex-shrink')).toBe('0');
    expect(declaration(rule('.dismissButton', TOAST_SOURCE), 'flex-shrink')).toBe('0');
    expect(declaration(rule('.lead', TOAST_SOURCE), 'min-width')).toBe('0');
    expect(declaration(rule('.main'), 'padding')).toContain('var(--toast-room)');
    expect(declaration(rule(".write[data-toast='open']"), '--toast-room')).not.toBeNull();

    const screen = renderWrite({ layout: 'narrow', toast: { kind: 'restore' }, onRestoreDeleted: noop });
    expect(screen.getAttribute('data-toast')).toBe('open');
  });
});

describe('S5 결과 패널 기다림·한도(P5-4 시각 검토 3번, PRD 7.2)', () => {
  it.each<WriteLayout>(['wide', 'narrow'])(
    '%s: 기다림은 종이 카드 자리표시를 그리고 빈 바닥 띠를 남기지 않는다',
    layout => {
      renderWrite({ layout, panel: { button: 'FEEDBACK', status: 'loading' } });
      const panel = host.querySelector('[data-status="loading"]');
      expect(panel).not.toBeNull();
      const placeholder = host.querySelector('[data-placeholder]');
      expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
      expect(placeholder?.children.length).toBeGreaterThanOrEqual(3);
      expect(host.textContent).toContain(ko.student.aiReadingStatus);
      // 바닥(받은 시각·다시 받기)이 없는 상태는 바닥 자리째 없다.
      expect(host.querySelectorAll('footer')).toHaveLength(1); // 하단 바(dock)만
    },
  );

  it('한도: 안내와 다음 안내 두 줄을 카드에 담고 바닥 띠는 없다', () => {
    renderWrite({ layout: 'wide', panel: { button: 'SPELL', status: 'limit' } });
    const side = host.querySelector('aside');
    expect(side?.textContent).toContain(ko.student.aiDailyLimitGuide);
    expect(side?.textContent).toContain(ko.student.aiDailyLimitNextHint);
    expect(side?.querySelector('footer')).toBeNull();
  });
});
