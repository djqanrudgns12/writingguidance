import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { privacyBlocks } from './privacyContent.tsx';

describe('처리방침 본문(PRD 13.2)', () => {
  it('원본 문서에서 제목·표를 그리고 내부용 사실 확인 표는 뺀다', () => {
    const html = renderToStaticMarkup(<div>{privacyBlocks()}</div>);
    expect(html).toContain('<h2>1. 누가 운영하나요?</h2>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('사실 확인 표');
    expect(html).not.toContain('**');
    expect(html).not.toContain('`');
  });

  it('목록·굵게·인용을 바꾼다', () => {
    const html = renderToStaticMarkup(
      <div>{privacyBlocks('# 제목\n\n## 가\n\n> 인용 **굵게**\n\n1. 하나\n   - 안쪽\n')}</div>,
    );
    expect(html).toContain('<p>인용 <strong>굵게</strong></p>');
    expect(html).toContain('<ol>');
    expect(html).not.toContain('제목');
  });
});
