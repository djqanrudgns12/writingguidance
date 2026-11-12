/**
 * 거울 층(PLAN §6.4). 입력칸 **뒤**에 같은 크기·같은 글자 배치의 `div`를 두고, 글자는 투명하게 그리되
 * 형광 범위와 원격 커서 자리만 `span`으로 감싼다. 입력칸 배경은 투명이라 뒤의 표시가 보인다.
 * 입력칸 값·선택·초점은 건드리지 않는다(반영 문 규칙 밖에서도 언제든 다시 그려도 된다).
 */
export interface MirrorDecorations {
  /** `tone: 'soft'`는 `data-mirror-tone="soft"`로 그린다(옅은 색 + 점선 밑줄). 겹치면 먼저 연 형광의 세기를 따른다. */
  readonly highlights: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly tone?: 'strong' | 'soft' | undefined;
  }>;
  readonly carets: ReadonlyArray<{ readonly at: number; readonly kind: 'teacher' | 'student' }>;
}

/** 입력칸에서 그대로 따라 할 계산 스타일 */
const COPIED = [
  'boxSizing',
  'width',
  'height',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariantNumeric',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontKerning',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textIndent',
  'textTransform',
  'tabSize',
  'wordBreak',
  'lineBreak',
] as const;

export interface Mirror {
  render(text: string, decorations: MirrorDecorations): void;
  /** 크기·글자 크기·글꼴이 바뀌면 다시 맞춘다. */
  sync(): void;
  destroy(): void;
}

export function createMirror(field: HTMLTextAreaElement | HTMLInputElement, host: HTMLElement): Mirror {
  const doc = field.ownerDocument;
  host.setAttribute('aria-hidden', 'true');
  host.dataset['mirror'] = '';
  const content = doc.createElement('div');
  content.dataset['mirrorContent'] = '';
  host.replaceChildren(content);

  let alive = true;
  let lastText = '';
  let lastDecorations: MirrorDecorations = { highlights: [], carets: [] };

  const applyScroll = () => {
    content.style.transform = `translate3d(${-field.scrollLeft}px, ${-field.scrollTop}px, 0)`;
  };

  const sync = () => {
    if (!alive) return;
    const cs = doc.defaultView?.getComputedStyle(field);
    if (!cs) return;
    for (const prop of COPIED) host.style[prop] = cs[prop];
    const webkitSizeAdjust = cs.getPropertyValue('-webkit-text-size-adjust');
    if (webkitSizeAdjust) host.style.setProperty('-webkit-text-size-adjust', webkitSizeAdjust);
    const sizeAdjust = cs.getPropertyValue('text-size-adjust');
    if (sizeAdjust) host.style.setProperty('text-size-adjust', sizeAdjust);

    // 비오버레이 스크롤바가 차지하는 폭·높이만큼 안쪽 여백을 보정해 줄바꿈 폭을 맞춘다.
    const scrollbarWidth = Math.max(0, field.offsetWidth - field.clientLeft * 2 - field.clientWidth);
    if (scrollbarWidth > 0) {
      host.style.paddingRight = `${(Number.parseFloat(cs.paddingRight) || 0) + scrollbarWidth}px`;
    }
    const scrollbarHeight = Math.max(0, field.offsetHeight - field.clientTop * 2 - field.clientHeight);
    if (scrollbarHeight > 0) {
      host.style.paddingBottom = `${(Number.parseFloat(cs.paddingBottom) || 0) + scrollbarHeight}px`;
    }

    host.style.borderStyle = 'solid';
    host.style.borderColor = 'transparent';
    host.style.whiteSpace = field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
    host.style.overflowWrap = 'break-word';
    host.style.overflow = 'hidden';
    host.style.color = 'transparent';
    host.style.pointerEvents = 'none';
    applyScroll();
  };

  const onScroll = () => applyScroll();
  field.addEventListener('scroll', onScroll);
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => sync());
  resize?.observe(field);

  const fontSet = doc.fonts;
  const onFontLoad = () => sync();
  fontSet?.addEventListener?.('loadingdone', onFontLoad);
  void fontSet?.ready?.then(() => {
    if (alive) sync();
  });

  const render = (text: string, decorations: MirrorDecorations) => {
    lastText = text;
    lastDecorations = decorations;
    type Mark = {
      at: number;
      open?: boolean;
      close?: boolean;
      soft?: boolean;
      caret?: 'teacher' | 'student';
    };
    const marks: Mark[] = [];
    for (const h of decorations.highlights) {
      const s = clamp(h.start, text.length);
      const e = clamp(h.end, text.length);
      if (e > s) marks.push({ at: s, open: true, soft: h.tone === 'soft' }, { at: e, close: true });
    }
    for (const c of decorations.carets) marks.push({ at: clamp(c.at, text.length), caret: c.kind });
    marks.sort((a, b) => a.at - b.at || Number(Boolean(b.close)) - Number(Boolean(a.close)));

    const frag = doc.createDocumentFragment();
    let cursor = 0;
    let depth = 0;
    let current: HTMLElement | DocumentFragment = frag;
    const pushText = (end: number) => {
      if (end > cursor) current.appendChild(doc.createTextNode(text.slice(cursor, end)));
      cursor = Math.max(cursor, end);
    };
    for (const m of marks) {
      pushText(m.at);
      if (m.close && depth > 0) {
        depth--;
        if (depth === 0) current = frag;
      }
      if (m.open) {
        if (depth === 0) {
          const span = doc.createElement('span');
          span.dataset['mirrorMark'] = 'highlight';
          if (m.soft) span.dataset['mirrorTone'] = 'soft';
          frag.appendChild(span);
          current = span;
        }
        depth++;
      }
      if (m.caret) {
        const caret = doc.createElement('span');
        caret.dataset['mirrorCaret'] = m.caret;
        current.appendChild(caret);
      }
    }
    pushText(text.length);
    // 마지막 줄바꿈 뒤 빈 줄의 높이를 맞추려고 폭 없는 글자를 하나 더한다.
    frag.appendChild(doc.createTextNode('\u200B'));
    content.replaceChildren(frag);
    applyScroll();
  };

  sync();
  return {
    render,
    sync() {
      sync();
      render(lastText, lastDecorations);
    },
    destroy() {
      alive = false;
      field.removeEventListener('scroll', onScroll);
      fontSet?.removeEventListener?.('loadingdone', onFontLoad);
      resize?.disconnect();
      host.replaceChildren();
    },
  };
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n));
}
