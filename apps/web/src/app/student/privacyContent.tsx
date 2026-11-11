import type { ReactNode } from 'react';
import source from '../../../../../docs/privacy-policy.md?raw';

/**
 * 처리방침 본문(PRD 13.2). 문서 원본 `docs/privacy-policy.md` 하나를 그대로 보여 준다(화면 문구를 두 벌 두지 않으려고).
 * 맨 끝의 "사실 확인 표"는 통합 담당이 근거를 맞춰 보는 내부 자료라 화면에서 뺀다. 첫 줄 제목은 화면 제목이 대신한다.
 * 쓰는 마크다운은 제목(##·###)·문단·목록·표·굵게·인용 정도라 작은 변환기로 충분하다(새 의존성 없이).
 */
const INTERNAL_SECTION = /^## \d+\. 사실 확인 표/m;

function inline(text: string, key: string): ReactNode[] {
  // `코드`는 따옴표 없이 글자만, **굵게**는 strong
  const clean = text.replace(/`([^`]+)`/g, '$1');
  const parts = clean.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong> : p,
  );
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(c => c.trim());

export function privacyBlocks(markdown: string = source): ReactNode[] {
  const cut = markdown.search(INTERNAL_SECTION);
  const body = (cut >= 0 ? markdown.slice(0, cut) : markdown).replace(/^# .*\n/, '');
  const lines = body.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `b${n++}`;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const t = line.trim();
    if (t === '' || t === '---') {
      i++;
      continue;
    }
    if (t.startsWith('### ')) {
      const k = key();
      out.push(<h3 key={k}>{inline(t.slice(4), k)}</h3>);
      i++;
      continue;
    }
    if (t.startsWith('## ')) {
      const k = key();
      out.push(<h2 key={k}>{inline(t.slice(3), k)}</h2>);
      i++;
      continue;
    }
    if (t.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const row = cells(lines[i] ?? '');
        if (!row.every(c => /^:?-{3,}:?$/.test(c))) rows.push(row);
        i++;
      }
      const [head, ...rest] = rows;
      const k = key();
      out.push(
        <table key={k}>
          {head ? (
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, `${k}h${j}`)}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rest.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, j) => (
                  <td key={j}>
                    {c.split('<br>').map((part, pi) => (
                      <span key={pi} style={{ display: 'block' }}>
                        {inline(part, `${k}${ri}${j}${pi}`)}
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const listItem = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && listItem.test(lines[i] ?? '')) {
        const m = (lines[i] ?? '').match(listItem);
        items.push({ depth: Math.min(2, Math.floor((m?.[1]?.length ?? 0) / 2)), text: m?.[2] ?? '' });
        i++;
      }
      const k = key();
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={k}>
          {items.map((it, j) => (
            <li key={j} style={{ marginInlineStart: `calc(var(--sp-4) * ${it.depth})` }}>
              {inline(it.text, `${k}${j}`)}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    // 문단(인용 표시 `>`는 떼고 같은 문단으로)
    const para: string[] = [];
    while (i < lines.length) {
      const l = (lines[i] ?? '').trim();
      if (l === '' || l.startsWith('#') || l.startsWith('|') || listItem.test(lines[i] ?? '') || l === '---')
        break;
      para.push(l.replace(/^>\s?/, ''));
      i++;
    }
    const k = key();
    out.push(<p key={k}>{inline(para.join(' '), k)}</p>);
  }
  return out;
}
