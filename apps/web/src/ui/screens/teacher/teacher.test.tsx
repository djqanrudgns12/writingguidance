import { GENRE_IDS, MS_PER_MINUTE, MS_PER_SECOND } from '@geulbang/core';
import { ko } from '@geulbang/core/copy';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardView } from './Dashboard.tsx';
import { CreateRoomView, type CreateRoomValues } from './CreateRoom.tsx';
import { ExpiryBand, ResumeRequestsBand } from './DashboardBands.tsx';
import { formatAgo } from './format.ts';
import { NoticePanelView } from './NoticePanel.tsx';
import { PinEntryView } from './PinEntry.tsx';
import { QrSvg } from './qr/QrSvg.tsx';
import { RoomPrepView } from './RoomPrep.tsx';
import { StudentDrawerView } from './StudentDrawer.tsx';
import { TeacherHomeView } from './TeacherHome.tsx';
import { sortTilesByNickname, type StudentTileModel } from './tiles.ts';
import { initialTimerDraft, timerDraftToCommand } from './timerDraft.ts';

(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

const NOW = Date.UTC(2026, 10, 11, 1, 40, 0);
const noop = () => undefined;

function primaryButtons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('button[data-variant="primary"]')];
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text));
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function tile(i: number, patch: Partial<StudentTileModel> = {}): StudentTileModel {
  return {
    participantId: `p-${i}`,
    docId: `d-${i}`,
    nickname: `n${String(i).padStart(2, '0')}`,
    status: 'writing',
    genreLabel: ko.student.genreNewsLabel,
    chars: i * 10,
    lastInputAt: NOW - 12 * MS_PER_SECOND,
    submittedAt: null,
    ...patch,
  };
}

const dashboardBase = {
  roomTitle: 'room',
  className: 'class',
  roomStatus: 'ACTIVE' as const,
  nowMs: NOW,
  connectedCount: 0,
  submittedCount: 0,
  filter: 'all' as const,
  onFilterChange: noop,
  onSelectTile: noop,
  timer: { status: 'IDLE' as const, remainingSec: null },
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

describe('교사 화면 배치 (P3-9t)', () => {
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

  it('T0: 주요 단추는 새 수업방 만들기 하나, 최근 수업방을 누르면 그 방 ID를 넘긴다', () => {
    const onOpenRoom = vi.fn();
    act(() => {
      root.render(
        <TeacherHomeView
          recentRooms={[{ roomId: 'r1', displayName: 'room one', expiresAt: NOW }]}
          onCreateRoom={noop}
          onOpenRoom={onOpenRoom}
          onEnterWithPin={noop}
        />,
      );
    });
    expect(primaryButtons(host).map(b => b.textContent)).toEqual([ko.teacher.createNewRoomAction]);
    act(() => buttonByText(host, 'room one').click());
    expect(onOpenRoom).toHaveBeenCalledWith('r1');
  });

  it('T0: 최근 수업방이 없으면 빈 안내를 보인다', () => {
    act(() => {
      root.render(
        <TeacherHomeView recentRooms={[]} onCreateRoom={noop} onOpenRoom={noop} onEnterWithPin={noop} />,
      );
    });
    expect(host.textContent).toContain(ko.teacher.recentRoomsEmpty);
  });

  it('T1: 시작 코드 칸은 필요할 때만 맨 위에 붙고, 숫자판은 고른 칸에 숫자를 더한다', () => {
    const onChange = vi.fn();
    const values: CreateRoomValues = {
      startCode: '12',
      className: '',
      title: '',
      schoolName: '',
      showSchool: false,
      genres: GENRE_IDS,
      aiButtons: [],
      pin: '',
      pinConfirm: '',
    };
    const render = (needsStartCode: boolean) =>
      act(() => {
        root.render(
          <CreateRoomView
            needsStartCode={needsStartCode}
            values={values}
            onChange={onChange}
            activeCodeField="startCode"
            onActiveCodeFieldChange={noop}
            errors={{ pinConfirm: ko.teacher.pinMismatchError }}
            onSubmit={noop}
          />,
        );
      });
    render(true);
    expect(host.textContent).toContain(ko.teacher.startCodeHint);
    expect(primaryButtons(host)).toHaveLength(1);
    expect([...host.querySelectorAll('[role="alert"]')].map(n => n.textContent)).toContain(
      ko.teacher.pinMismatchError,
    );
    const seven = host.querySelector<HTMLButtonElement>('button[data-digit="7"]');
    act(() => seven?.click());
    expect(onChange).toHaveBeenCalledWith({ startCode: '127' });

    render(false);
    expect(host.textContent).not.toContain(ko.teacher.startCodeHint);
  });

  it('T2: PIN은 가려 보이고, 연결 점검 실패 항목에 쉬운 말 안내가 붙는다', () => {
    act(() => {
      root.render(
        <RoomPrepView
          className="c"
          roomTitle="t"
          entryCode="482913"
          entryUrl="https://example.test/482913"
          shortUrl="example.test/482913"
          expiresAt={NOW}
          pin={{ state: 'hidden' }}
          onTogglePin={noop}
          check={{ realtime: 'fail', ai: 'ok', storage: 'ok', realtimeHost: 'example.test' }}
          onRunCheck={noop}
          onOpenQrLarge={noop}
          onCopyTeacherLink={noop}
          onOpenTeacherLinkQr={noop}
          onGoDashboard={noop}
        />,
      );
    });
    expect(primaryButtons(host).map(b => b.textContent)).toEqual([ko.teacher.goDashboardAction]);
    expect(host.querySelector('[data-testid="prep-pin-mask"]')?.getAttribute('aria-label')).toBe(
      ko.teacher.pinHiddenMaskLabel,
    );
    expect(host.textContent).toContain(ko.teacher.checkRealtimeFail);
    expect(host.textContent).not.toContain(ko.teacher.checkAiFail);
    expect(host.querySelector('[data-testid="check-all-good"]')).toBeNull();
  });

  it('T3: 학생 0명이면 빈 교실 안내와 QR 단추, 30명이면 타일 30장이고 채운 주요 단추는 없다', () => {
    const onOpenQr = vi.fn();
    act(() => {
      root.render(<DashboardView {...dashboardBase} tiles={[]} onOpenQr={onOpenQr} />);
    });
    expect(host.textContent).toContain(ko.teacher.emptyRoomTitle);
    act(() => buttonByText(host, ko.teacher.emptyRoomAction).click());
    expect(onOpenQr).toHaveBeenCalled();

    const tiles = sortTilesByNickname(Array.from({ length: 30 }, (_, i) => tile(29 - i)));
    act(() => {
      root.render(<DashboardView {...dashboardBase} tiles={tiles} connectedCount={30} />);
    });
    const tileButtons = host.querySelectorAll('button[data-status]');
    expect(tileButtons).toHaveLength(30);
    expect(tileButtons[0]?.textContent).toContain('n00');
    expect(primaryButtons(host)).toHaveLength(0);
    expect(host.textContent).toContain('30/30');
  });

  it('T4: 서랍은 입력칸 값을 건드리지 않는다(다시 그려도 어댑터가 넣은 글이 그대로)', () => {
    const titleRef = createRef<HTMLInputElement>();
    const bodyRef = createRef<HTMLTextAreaElement>();
    const mirrorRef = createRef<HTMLDivElement>();
    const render = (docStatus: 'DRAFT' | 'SUBMITTED') =>
      act(() => {
        root.render(
          <StudentDrawerView
            nickname="n01"
            status={docStatus === 'SUBMITTED' ? 'submitted' : 'writing'}
            genreLabel=""
            docStatus={docStatus}
            titleRef={titleRef}
            bodyRef={bodyRef}
            mirrorRef={mirrorRef}
            onUndo={noop}
            onRedo={noop}
            onOpenRewind={noop}
            onReopenDoc={noop}
            onCopyDoc={noop}
            onOpenDevices={noop}
            onClose={noop}
            memos={[]}
          />,
        );
      });
    render('DRAFT');
    expect(bodyRef.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(mirrorRef.current).toBeInstanceOf(HTMLDivElement);
    expect(primaryButtons(host)).toHaveLength(0);
    const body = bodyRef.current;
    if (!body || !titleRef.current) throw new Error('refs missing');
    body.value = 'adapter text';
    body.setSelectionRange(3, 5);
    titleRef.current.value = 'adapter title';

    render('SUBMITTED');
    expect(bodyRef.current).toBe(body);
    expect(body.value).toBe('adapter text');
    expect(body.selectionStart).toBe(3);
    expect(titleRef.current.value).toBe('adapter title');
    expect(body.readOnly).toBe(false);
    expect(primaryButtons(host).map(b => b.textContent)).toEqual([ko.teacher.reopenDocAction]);
  });

  it('T5: 6자리 전에는 들어가기가 꺼져 있고, 잠기면 숫자판도 막힌다', () => {
    const render = (value: string, lockedUntil: number | null) =>
      act(() => {
        root.render(
          <PinEntryView
            value={value}
            onChange={noop}
            onSubmit={noop}
            nowMs={NOW}
            lockedUntil={lockedUntil}
          />,
        );
      });
    render('12345', null);
    expect(buttonByText(host, ko.teacher.pinEnterAction).disabled).toBe(true);
    render('123456', null);
    expect(buttonByText(host, ko.teacher.pinEnterAction).disabled).toBe(false);
    render('', NOW + 3 * MS_PER_MINUTE);
    expect(host.textContent).toContain(`3${ko.teacher.pinLockedRemainingSuffix}`);
    expect(host.querySelector<HTMLButtonElement>('button[data-digit="1"]')?.disabled).toBe(true);
  });

  it('알림: 문구 칩은 바로 보내고, 5분 타이머에서는 `5분 전` 알림이 꺼진다', () => {
    const onSend = vi.fn();
    act(() => {
      root.render(
        <NoticePanelView
          draft=""
          onDraftChange={noop}
          onSend={onSend}
          sound={false}
          onSoundChange={noop}
          timer={{ status: 'IDLE', remainingSec: null }}
          timerDraft={{ ...initialTimerDraft(), preset: 5 }}
          onTimerDraftChange={noop}
          onTimerStart={noop}
          onTimerPause={noop}
          onTimerResume={noop}
          onTimerCancel={noop}
        />,
      );
    });
    act(() => buttonByText(host, ko.teacher.noticePresetSubmit).click());
    expect(onSend).toHaveBeenCalledWith(ko.teacher.noticePresetSubmit);
    const fiveMin = [...host.querySelectorAll('label')].find(
      l => l.textContent === ko.teacher.timerAlert5Min,
    );
    expect(fiveMin?.querySelector('[data-disabled]')).not.toBeNull();
    expect(timerDraftToCommand({ ...initialTimerDraft(), preset: 5 })).toEqual({
      durationSec: 300,
      alerts: [1],
      endText: ko.teacher.timerEndDefaultText,
    });
  });

  it('QR: 주소를 잉크 한 색 경로로 그린다', () => {
    act(() => {
      root.render(<QrSvg value="https://example.test/482913" label="qr" />);
    });
    const svg = host.querySelector('svg[data-testid="teacher-qr-svg"]');
    expect(svg?.getAttribute('aria-label')).toBe('qr');
    expect(svg?.querySelector('path')?.getAttribute('d')?.length ?? 0).toBeGreaterThan(100);
  });

  it('formatAgo: 방금·초·분 단위', () => {
    expect(formatAgo(NOW, NOW)).toBe(ko.common.timeJustNow);
    expect(formatAgo(NOW - 12 * MS_PER_SECOND, NOW)).toBe(`12${ko.common.timeSecondsAgoSuffix}`);
    expect(formatAgo(NOW - 4 * MS_PER_MINUTE, NOW)).toBe(`4${ko.common.timeMinutesAgoSuffix}`);
  });

  it('T3 띠(P5-4 시각 검토 2번): 좁은 화면 요청 띠는 `요청 N건` 한 줄로 접혔다가 `보기`로 펼친다', () => {
    const onDecide = vi.fn();
    const onApproveAll = vi.fn();
    const requests = [
      { requestId: 'r1', nickname: 'haneul' },
      { requestId: 'r2', nickname: 'badaa' },
      { requestId: 'r3', nickname: 'byeol' },
    ];
    act(() => {
      root.render(
        <ResumeRequestsBand
          collapsible
          requests={requests}
          onDecide={onDecide}
          onApproveAll={onApproveAll}
        />,
      );
    });
    const summary = `${ko.teacher.resumeSummaryLabel} 3${ko.teacher.resumeSummaryCountSuffix}`;
    expect(host.textContent).toContain(summary);
    expect(host.querySelectorAll('li')).toHaveLength(0);
    expect(host.textContent).not.toContain(ko.teacher.resumeApproveAllAction);
    const toggle = buttonByText(host, ko.teacher.resumeExpandAction);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe(ko.teacher.resumeCollapseAction);
    const list = host.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls') ?? '')}`);
    expect(list?.querySelectorAll('li')).toHaveLength(3);
    act(() => buttonByText(host, ko.teacher.resumeApproveAllAction).click());
    expect(onApproveAll).toHaveBeenCalledTimes(1);
    const reject = host.querySelector<HTMLButtonElement>(
      `button[aria-label="badaa ${ko.teacher.resumeRejectAction}"]`,
    );
    act(() => reject?.click());
    expect(onDecide).toHaveBeenCalledWith('r2', false);

    // 접지 않는 배치(넓은 화면)는 원래대로 줄마다 [허용][거절]이 바로 보인다.
    act(() => {
      root.render(
        <ResumeRequestsBand
          collapsible={false}
          requests={requests}
          onDecide={onDecide}
          onApproveAll={onApproveAll}
        />,
      );
    });
    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(host.textContent).toContain(ko.teacher.resumeBannerLabel);
  });

  it('T3 띠: 미디어 쿼리를 모르는 곳에서는 접지 않고 삭제 안내도 긴 문구 그대로다', () => {
    act(() => {
      root.render(
        <>
          <ResumeRequestsBand
            requests={[{ requestId: 'r1', nickname: 'haneul' }]}
            onDecide={noop}
            onApproveAll={noop}
          />
          <ExpiryBand expiresAt={NOW} onDownload={noop} />
        </>,
      );
    });
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.textContent).toContain(ko.teacher.expiryWarningSuffix);
  });
});
