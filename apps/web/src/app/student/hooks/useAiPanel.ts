import { countChars, type AiButton, type GenreSelection } from '@geulbang/core';
import type { ErrorCode } from '@geulbang/core/errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiChipRow, type AiChipView as AiChipModel } from '../../../application/aiChip.ts';
import type { AppDeps } from '../../../application/deps.ts';
import {
  activityFor,
  aiResultNotices,
  aiResultSafetyNotices,
  aiTextHash,
  createAiRequester,
  locateSpellItems,
  spellHighlightTone,
  type AiDocInput,
  type LocatedSpellItem,
  type PolishHandle,
} from '../../../application/requestAi.ts';
import type { AiResultNotice } from '../../../ports/api.ts';
import type { EditorBinding } from '../../../ports/editor.ts';
import type { AiResultRecord, AiResultRecordOf } from '../../../ports/localStore.ts';
import type { ConnectionState } from '../../../ports/realtime.ts';
import {
  spellKindFromLabel,
  type AiChipView,
  type AiChipViewState,
  type ResultNoticeView,
  type ResultPanelView,
} from '../../../ui/screens/student/write/types.ts';
import { errorCodeOf } from '../errorCode.ts';
import { useObservable } from './useObservable.ts';

/**
 * 글벗 버튼(PRD F-08·F-26·6장, PLAN §8.6): 칩 상태 기계(`aiChipRow`) → 칩 줄, 결과 패널 4종(한 번에 하나).
 * - 패널을 누르면 저장된 결과가 있으면 바로 보이고, 없으면 요청한다. `다시 받기`는 새로 요청한다.
 * - 맞춤법 항목: 지금 글에서 다시 찾은 자리를 `binding.select`(반영 문이 연 뒤 선택)하고 거울 층에 형광을 남긴다.
 *   글이 바뀌어 그 자리를 더 찾지 못하면(고쳤으면) 형광을 지운다.
 * - 다듬은 글: 스트림 조각을 패널에 이어 붙이고, 패널을 닫거나 다른 버튼으로 바꾸면 `abort()`.
 * - 쓰던 글에는 어떤 경우에도 손대지 않는다(PRD 6.5).
 */
const STATE_OF: Readonly<Record<AiChipModel['state'], AiChipViewState>> = {
  hidden: 'hidden',
  pending: 'loading',
  offline: 'offline',
  tooShort: 'guide',
  limit: 'limit',
  cooldown: 'cooldown',
  stale: 'stale',
  fresh: 'fresh',
  ready: 'idle',
};

const NOTICE_VIEW: Readonly<Record<AiResultNotice, ResultNoticeView>> = {
  PII_IN_TEXT: 'personalInfo',
  PROFANITY_IN_TEXT: 'kindWords',
};

type Records = Partial<{ [B in AiButton]: AiResultRecordOf<B> }>;

type Open =
  | { readonly button: AiButton; readonly phase: 'loading' | 'record' | 'limit' }
  | { readonly button: AiButton; readonly phase: 'error'; readonly code: ErrorCode }
  | { readonly button: 'POLISH'; readonly phase: 'stream'; readonly text: string };

export interface AiPanel {
  readonly chips: readonly AiChipView[];
  readonly panel: ResultPanelView | null;
  onChip(button: AiButton): void;
  onClose(): void;
  onRefresh(): void;
  onSpellItem(itemId: string): void;
  /** 패널에 보이는 다듬은 글(`복사`) */
  readonly polishText: string | null;
}

export interface AiPanelArgs {
  readonly deps: AppDeps;
  readonly roomId: string;
  readonly docId: string;
  readonly binding: EditorBinding | null;
  readonly genre: GenreSelection;
  readonly enabledButtons: readonly AiButton[];
  readonly connection: ConnectionState;
  readonly now: number;
  /** 입력이 멈춘 뒤의 본문(글자 수·해시·맞춤법 자리) */
  readonly body: string;
  /** 요청할 때 보낼 것(지금 문서에서 바로 읽는다) */
  readonly input: () => Omit<AiDocInput, 'roomId' | 'docId' | 'genre'>;
  /** 다듬은 글이 중간에 끊겼을 때 받은 데까지 보이면서 알릴 한 줄 */
  readonly onStreamError: (code: ErrorCode) => void;
}

export function useAiPanel(args: AiPanelArgs): AiPanel {
  const { deps, roomId, docId, binding, genre, enabledButtons, connection, now, body } = args;
  const requester = useMemo(() => createAiRequester(deps), [deps]);
  const activity = useObservable(requester.activity, requester.activity.get());
  const [records, setRecords] = useState<Records>({});
  const [open, setOpen] = useState<Open | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [activeSpell, setActiveSpell] = useState<number | null>(null);
  const polish = useRef<PolishHandle | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const latest = useRef(args);
  latest.current = args;

  const putRecord = useCallback((record: AiResultRecord) => {
    setRecords(prev => ({ ...prev, [record.button]: record }));
  }, []);

  useEffect(() => {
    let alive = true;
    void requester.results(docId).then(list => {
      if (!alive) return;
      const next: Records = {};
      for (const r of list) (next as Record<string, AiResultRecord>)[r.button] = r;
      setRecords(prev => ({ ...next, ...prev }));
    });
    return () => {
      alive = false;
      polish.current?.abort();
      polish.current = null;
    };
  }, [requester, docId]);

  // "글이 바뀌었어요" 비교용 해시: 입력이 멈춘 뒤의 본문으로만 센다(50,000자 글에서 칠 때마다 세지 않게).
  useEffect(() => {
    let alive = true;
    void aiTextHash(deps, body).then(h => alive && setHash(h));
    return () => {
      alive = false;
    };
  }, [deps, body]);

  const row = aiChipRow(
    {
      enabledButtons,
      connection,
      genre,
      chars: countChars(body),
      now,
      currentTextHash: hash,
      limitHitAt: activityFor(activity, { roomId, docId }, 'SPELL').limitHitAt,
      perButton: b => {
        const a = activityFor(activity, { roomId, docId }, b);
        return { lastRequestAt: a.lastRequestAt, pending: a.pending, record: records[b] ?? null };
      },
    },
    deps.config,
  );
  const chipOf = (b: AiButton) => row.chips.find(c => c.button === b);

  const spellRecord = records.SPELL;
  const located = useMemo<LocatedSpellItem[]>(
    () => (spellRecord ? locateSpellItems(spellRecord, body) : []),
    [spellRecord, body],
  );

  // 고친 곳(더 찾지 못하는 항목)은 형광을 지운다. 글이 바뀌면 자리를 다시 맞춘다.
  // 형광은 거울 층에만 그려 입력칸 값·선택·초점을 건드리지 않는다. 권장해요는 옅은 색(등급별 세기).
  useEffect(() => {
    if (!binding || activeSpell === null) return;
    const item = located[activeSpell];
    const range = item?.range;
    if (!item || !range) {
      binding.highlight([]);
      setActiveSpell(null);
      return;
    }
    binding.highlight([
      { field: 'body', start: range.start, end: range.end, tone: spellHighlightTone(item.severity) },
    ]);
  }, [binding, located, activeSpell]);

  const stopPolish = () => {
    polish.current?.abort();
    polish.current = null;
  };

  const request = useCallback(
    (button: AiButton) => {
      const a = latest.current;
      const input: AiDocInput = { roomId: a.roomId, docId: a.docId, genre: a.genre, ...a.input() };
      if (button === 'POLISH') {
        polish.current?.abort();
        setOpen({ button, phase: 'loading' });
        const still = () => openRef.current?.button === 'POLISH';
        polish.current = requester.polish(input, {
          onText: text => still() && setOpen({ button: 'POLISH', phase: 'stream', text }),
          onReset: () => still() && setOpen({ button: 'POLISH', phase: 'loading' }),
          onDone: record => {
            putRecord(record);
            if (still()) setOpen({ button: 'POLISH', phase: 'record' });
          },
          onError: (error, partial) => {
            if (!still()) return;
            if (error.code === 'E_AI_LIMIT') setOpen({ button, phase: 'limit' });
            else if (partial) {
              // 받은 데까지는 보이고(PLAN §8.6) 끊긴 까닭을 한 줄로 알린다.
              setOpen({ button: 'POLISH', phase: 'stream', text: partial });
              latest.current.onStreamError(error.code);
            } else setOpen({ button, phase: 'error', code: error.code });
          },
        });
        return;
      }
      setOpen({ button, phase: 'loading' });
      requester.structured(input, button).then(
        outcome => {
          putRecord(outcome.record as AiResultRecord);
          if (openRef.current?.button === button) setOpen({ button, phase: 'record' });
        },
        (error: unknown) => {
          if (openRef.current?.button !== button) return;
          const code = errorCodeOf(error);
          setOpen(code === 'E_AI_LIMIT' ? { button, phase: 'limit' } : { button, phase: 'error', code });
        },
      );
    },
    [putRecord, requester],
  );

  const onChip = (button: AiButton) => {
    if (open?.button === button) {
      onClose();
      return;
    }
    const chip = chipOf(button);
    if (!chip || chip.state === 'hidden') return;
    if (open?.button === 'POLISH') stopPolish();
    if (chip.state === 'pending') setOpen({ button, phase: 'loading' });
    else if (records[button]) setOpen({ button, phase: 'record' });
    else if (chip.state === 'limit') setOpen({ button, phase: 'limit' });
    else if (chip.canRequest) request(button);
  };

  const onClose = () => {
    stopPolish();
    setOpen(null);
  };

  const onRefresh = () => {
    if (!open) return;
    if (chipOf(open.button)?.canRequest) request(open.button);
  };

  const onSpellItem = (itemId: string) => {
    const index = Number(itemId.slice('spell-'.length));
    const item = located[index];
    const range = item?.range;
    if (!binding || !item || !range) return;
    setActiveSpell(index);
    binding.highlight([
      { field: 'body', start: range.start, end: range.end, tone: spellHighlightTone(item.severity) },
    ]);
    // 선택은 반영 문이 열린 뒤에만 한다(`binding.select`가 기다린다, PLAN §6.3).
    void binding.select({ field: 'body', start: range.start, end: range.end });
  };

  const chips: AiChipView[] = row.chips.map(c => ({
    button: c.button,
    state: STATE_OF[c.state],
    ...(c.state === 'cooldown' ? { cooldownSeconds: c.cooldownLeftSec } : {}),
  }));

  const panel = open ? panelView(open, records, chipOf(open.button), located, activeSpell) : null;
  const polishText =
    open?.button === 'POLISH'
      ? open.phase === 'stream'
        ? open.text
        : (records.POLISH?.result.text ?? null)
      : null;

  return { chips, panel, onChip, onClose, onRefresh, onSpellItem, polishText };
}

function panelView(
  open: Open,
  records: Records,
  chip: (AiChipModel & { readonly button: AiButton }) | undefined,
  located: readonly LocatedSpellItem[],
  activeSpell: number | null,
): ResultPanelView {
  const button = open.button;
  if (open.phase === 'loading') return { button, status: 'loading' };
  if (open.phase === 'limit') return { button, status: 'limit' };
  if (open.phase === 'error') {
    // 예약까지 한 실패(시간 초과 등)는 쿨다운이 걸려 `다시 받기`에 남은 초를 보인다.
    return {
      button,
      status: 'error',
      errorCode: open.code,
      ...(chip && chip.cooldownLeftSec > 0 ? { refreshCooldownSeconds: chip.cooldownLeftSec } : {}),
    };
  }
  if (open.phase === 'stream') {
    return { button, status: 'ready', content: { kind: 'POLISH', text: open.text, done: false } };
  }
  const record = records[button];
  if (!record) return { button, status: 'loading' };
  const common = {
    button,
    status: 'ready' as const,
    receivedAt: record.receivedAt,
    stale: chip?.result === 'stale',
    tailOnly: aiResultNotices(record).includes('aiLongInputTailNotice'),
    notices: aiResultSafetyNotices(record).map(n => NOTICE_VIEW[n]),
    ...(chip && chip.cooldownLeftSec > 0 ? { refreshCooldownSeconds: chip.cooldownLeftSec } : {}),
  };
  switch (record.button) {
    case 'SPELL':
      return {
        ...common,
        content: {
          kind: 'SPELL',
          activeItemId: activeSpell === null ? null : `spell-${activeSpell}`,
          items: located.map((item, i) => ({
            id: `spell-${i}`,
            original: item.original,
            suggestion: item.suggestion,
            reason: item.reason,
            kind: spellKindFromLabel(item.kind),
            severity: item.severity,
            ruleLabel: item.rule?.label,
            locatable: item.range !== null,
          })),
        },
      };
    case 'FEEDBACK':
      return { ...common, content: { kind: 'FEEDBACK', result: record.result } };
    case 'DIRECTION':
      return { ...common, content: { kind: 'DIRECTION', ideas: record.result.ideas } };
    case 'POLISH':
      return {
        ...common,
        content: {
          kind: 'POLISH',
          text: record.result.text,
          done: true,
          lengthWarning: record.result.lengthWarning,
          truncated: record.result.stop === 'limit',
        },
      };
  }
}
