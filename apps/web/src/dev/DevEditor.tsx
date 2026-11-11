import { koDev } from '@geulbang/core/copy/dev';
import '../adapters/editor/mirror.css';
import { DOC_KEYS } from '@geulbang/core';
import { defaultConfig } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import type { ErrorCode } from '@geulbang/core/errors';
import type { Credential } from '@geulbang/core/protocol';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { mountEditor, type MountedEditor } from '../adapters/editor/editor.ts';
import { openLocalStore } from '../adapters/local/localDocStore.ts';
import { socketUrlFor } from '../adapters/realtime/socket.ts';
import { bindKeyboardOffset } from '../adapters/viewport/keyboardOffset.ts';
import type { LocalStorePort } from '../ports/localStore.ts';
import type { ConnectionState, SaveState } from '../ports/realtime.ts';
import { Icon, type IconName } from '../ui/icons/Icon.tsx';
import styles from './DevEditor.module.css';
import {
  buildRoleSwitchSearch,
  clearDevSecret,
  consumeDevSecret,
  getOrCreateDevDeviceId,
  getSessionStorageSafe,
  loadCheckedChecklist,
  parseDevEditorParams,
  saveCheckedChecklist,
  saveDevSecret,
  type DevEditorParams,
} from './devCredentials.ts';
import { computeAlignmentHighlights } from './devHighlights.ts';
import { openDevPrimaryConnection, type DevPrimaryConnection } from './devRealtime.ts';
import {
  BOT_DELAY_OPTIONS,
  createTeacherBot,
  type BotDelayMs,
  type BotScenario,
  type TeacherBot,
} from './teacherBot.ts';

export interface DevEditorProps {
  readonly socketUrl?: string | undefined;
  readonly openStore?: (() => Promise<LocalStorePort>) | undefined;
}

const DEFAULT_FONT_SIZE = defaultConfig.FONT_SIZES[1] ?? defaultConfig.FONT_SIZES[0] ?? 18;
const LARGE_DELETE_HIDE_MS = 6000;

/** 단추를 눌러도 입력칸의 초점과 한글 조합이 끊기지 않게 막는다. */
function preventFocusSteal(e: ReactMouseEvent<HTMLButtonElement>): void {
  e.preventDefault();
}

function saveBadgeInfo(state: SaveState): {
  icon: IconName;
  label: string;
  toneClass: string;
} {
  switch (state) {
    case 'saved':
      return { icon: 'saved', label: koDev.saveSaved, toneClass: styles.badgeSaved ?? '' };
    case 'sending':
      return { icon: 'sending', label: koDev.saveSending, toneClass: styles.badgeSending ?? '' };
    case 'locked':
      return { icon: 'locked', label: koDev.saveLocked, toneClass: styles.badgeLocked ?? '' };
    case 'local':
      return { icon: 'localOnly', label: koDev.saveLocal, toneClass: styles.badgeLocal ?? '' };
  }
}

function connectionBadgeInfo(state: ConnectionState): {
  icon: IconName;
  label: string;
  offlineTone: boolean;
} {
  switch (state) {
    case 'online':
      return { icon: 'check', label: koDev.connOnline, offlineTone: false };
    case 'connecting':
      return { icon: 'sending', label: koDev.connConnecting, offlineTone: false };
    case 'offline':
      return { icon: 'offline', label: koDev.connOffline, offlineTone: true };
    case 'server-down':
      return { icon: 'offline', label: koDev.connServerDown, offlineTone: true };
    case 'closed':
      return { icon: 'close', label: koDev.connClosed, offlineTone: true };
  }
}

/** `/dev/editor`: 실기기 한글 조합 보호·거울 층·교사 봇 관문 시험 화면(PLAN §11.5 P2-4). */
export function DevEditor(props: DevEditorProps = {}) {
  const storage = getSessionStorageSafe();

  const [secret, setSecret] = useState<string | null>(() =>
    consumeDevSecret(window.location, window.history, storage),
  );
  const [secretDraft, setSecretDraft] = useState('');
  const [params, setParams] = useState<DevEditorParams>(() => parseDevEditorParams(window.location.search));
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [highlightOn, setHighlightOn] = useState(false);

  const [connState, setConnState] = useState<ConnectionState>('closed');
  const [manualOffline, setManualOffline] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('local');
  const [failure, setFailure] = useState<ErrorCode | null>(null);
  const [rejected, setRejected] = useState<ErrorCode | null>(null);
  const [volatileStore, setVolatileStore] = useState(false);
  const [holdingRemote, setHoldingRemote] = useState(false);
  const [largeDeleteVisible, setLargeDeleteVisible] = useState(false);

  const [botState, setBotState] = useState<ConnectionState>('closed');
  const [botDelayMs, setBotDelayMs] = useState<BotDelayMs>(0);
  const [botContinuous, setBotContinuous] = useState(false);
  const [botPending, setBotPending] = useState(0);
  const [botLastAction, setBotLastAction] = useState('');

  const [checkedItems, setCheckedItems] = useState<ReadonlySet<number>>(() => loadCheckedChecklist(storage));

  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  const editorRef = useRef<MountedEditor | null>(null);
  const primaryRef = useRef<DevPrimaryConnection | null>(null);
  const botRef = useRef<TeacherBot | null>(null);
  const highlightOnRef = useRef(highlightOn);
  highlightOnRef.current = highlightOn;
  const startedAtRef = useRef<string>(new Date().toISOString());

  // 1. 화면 키보드 높이에 맞춰 --kb-offset 갱신
  useEffect(() => bindKeyboardOffset(), []);

  // 2. 주소창 해시에 새 #dev=... 가 들어오거나 뒤로 가기 시 반영
  useEffect(() => {
    const onHashChange = () => {
      const next = consumeDevSecret(window.location, window.history, getSessionStorageSafe());
      setSecret(next);
    };
    const onPopState = () => {
      setParams(parseDevEditorParams(window.location.search));
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // 3. 글자 크기가 바뀔 때마다 거울 층 치수·줄바꿈 다시 맞춤
  useEffect(() => {
    editorRef.current?.syncLayout();
  }, [fontSize]);

  // 4. 형광 켜기·끄기 전환
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!highlightOn) {
      ed.highlight([]);
      return;
    }
    const text = ed.viewDoc.getText(DOC_KEYS.body).toString();
    ed.highlight(computeAlignmentHighlights(text));
  }, [highlightOn]);

  // 5. 실시간 주 세션 + 편집기 바인딩 + 교사 봇 연결
  useEffect(() => {
    setFailure(null);
    setRejected(null);
    setHoldingRemote(false);
    setLargeDeleteVisible(false);
    setBotLastAction('');
    setBotContinuous(false);
    setBotPending(0);

    if (!params.validDocId || !secret) {
      setConnState('closed');
      setBotState('closed');
      setManualOffline(false);
      setSaveState('local');
      return;
    }

    const bodyEl = bodyRef.current;
    const titleEl = titleRef.current;
    const mirrorEl = mirrorRef.current;
    if (!bodyEl) return;

    let cancelled = false;
    let largeDeleteTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanups: Array<() => void> = [];
    const sessionStore = getSessionStorageSafe();
    const mainDeviceId = getOrCreateDevDeviceId(sessionStore, 'main');
    const botDeviceId = getOrCreateDevDeviceId(sessionStore, 'bot');
    const wsUrl = props.socketUrl ?? socketUrlFor(window.location);
    const loadStore = props.openStore ?? openLocalStore;
    startedAtRef.current = new Date().toISOString();

    void (async () => {
      const localStore = await loadStore();
      if (cancelled) return;
      setVolatileStore(localStore.volatile);

      const mainCred = (): Credential => ({
        v: 1,
        kind: 'dev',
        token: secret,
        deviceId: mainDeviceId,
        role: params.role,
      });

      const primary = await openDevPrimaryConnection({
        url: wsUrl,
        config: defaultConfig,
        localStore,
        credential: mainCred,
        docId: params.docId,
      });
      if (cancelled) {
        primary.close();
        return;
      }
      primaryRef.current = primary;

      setConnState(primary.state.get());
      setManualOffline(primary.manuallyDisconnected.get());
      setSaveState(primary.doc.saveState.get());
      setFailure(primary.doc.failure.get());
      setRejected(primary.doc.rejected.get());

      cleanups.push(primary.state.subscribe(setConnState));
      cleanups.push(primary.manuallyDisconnected.subscribe(setManualOffline));
      cleanups.push(primary.doc.saveState.subscribe(setSaveState));
      cleanups.push(primary.doc.failure.subscribe(setFailure));
      cleanups.push(primary.doc.rejected.subscribe(setRejected));

      const mounted = mountEditor(
        {
          body: bodyEl,
          ...(titleEl ? { title: titleEl } : {}),
          ...(mirrorEl ? { mirror: mirrorEl } : {}),
        },
        primary.doc,
        {
          role: params.role,
          readOnly: primary.doc.locked.get(),
          undoGroupMs: defaultConfig.UNDO_GROUP_MS.normal,
          diagnosticsEnabled: true,
        },
        { config: defaultConfig },
      );
      editorRef.current = mounted;
      mounted.syncLayout();

      cleanups.push(primary.doc.locked.subscribe(locked => mounted.setReadOnly(locked)));
      cleanups.push(mounted.onHoldChange(setHoldingRemote));
      cleanups.push(
        mounted.onLargeDelete(() => {
          setLargeDeleteVisible(true);
          if (largeDeleteTimer) clearTimeout(largeDeleteTimer);
          largeDeleteTimer = setTimeout(() => setLargeDeleteVisible(false), LARGE_DELETE_HIDE_MS);
        }),
      );

      const syncHighlightsIfOn = () => {
        if (!highlightOnRef.current) return;
        const currentText = mounted.viewDoc.getText(DOC_KEYS.body).toString();
        mounted.highlight(computeAlignmentHighlights(currentText));
      };
      mounted.viewDoc.on('update', syncHighlightsIfOn);
      cleanups.push(() => mounted.viewDoc.off('update', syncHighlightsIfOn));
      syncHighlightsIfOn();

      const botCred = (): Credential => ({
        v: 1,
        kind: 'dev',
        token: secret,
        deviceId: botDeviceId,
        role: 'teacher',
      });

      const bot = await createTeacherBot({
        url: wsUrl,
        config: defaultConfig,
        docId: params.docId,
        credential: botCred,
        getStudentClientId: () => primary.doc.awareness?.clientID ?? null,
      });
      if (cancelled) {
        bot.close();
        return;
      }
      botRef.current = bot;
      bot.setDelayMs(botDelayMs);

      setBotState(bot.state.get());
      setBotContinuous(bot.continuous.get());
      setBotPending(bot.pendingCount.get());
      setBotLastAction(bot.lastAction.get());

      cleanups.push(bot.state.subscribe(setBotState));
      cleanups.push(bot.delayMs.subscribe(setBotDelayMs));
      cleanups.push(bot.continuous.subscribe(setBotContinuous));
      cleanups.push(bot.pendingCount.subscribe(setBotPending));
      cleanups.push(bot.lastAction.subscribe(setBotLastAction));
    })();

    return () => {
      cancelled = true;
      if (largeDeleteTimer) clearTimeout(largeDeleteTimer);
      for (const off of cleanups.splice(0)) off();
      botRef.current?.close();
      botRef.current = null;
      editorRef.current?.destroy();
      editorRef.current = null;
      primaryRef.current?.close();
      primaryRef.current = null;
    };
    // botDelayMs는 별도 핸들러로 갱신하므로 재연결 의존성에 넣지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret, params.docId, params.validDocId, params.role, props.socketUrl, props.openStore]);

  const handleApplySecret = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const saved = saveDevSecret(secretDraft, getSessionStorageSafe());
    setSecretDraft('');
    setSecret(saved);
  };

  const handleClearSecret = () => {
    clearDevSecret(getSessionStorageSafe());
    setSecretDraft('');
    setSecret(null);
  };

  const handleToggleRole = () => {
    const nextRole = params.role === 'student' ? 'teacher' : 'student';
    const nextSearch = buildRoleSwitchSearch(window.location.search, nextRole);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${nextSearch}`);
    setParams(parseDevEditorParams(nextSearch));
  };

  const handleInsertLongSample = () => {
    const ed = editorRef.current;
    if (!ed) return;
    void ed.applyAppEdit(viewDoc => {
      const title = viewDoc.getText(DOC_KEYS.title);
      const body = viewDoc.getText(DOC_KEYS.body);
      if (title.length === 0) {
        title.insert(0, koDev.longSampleTitle);
      }
      if (body.length > 0) {
        body.delete(0, body.length);
      }
      body.insert(0, koDev.longSampleBody);
    });
  };

  const handleClearDoc = () => {
    const ed = editorRef.current;
    if (!ed) return;
    void ed.applyAppEdit(viewDoc => {
      const title = viewDoc.getText(DOC_KEYS.title);
      const body = viewDoc.getText(DOC_KEYS.body);
      if (title.length > 0) title.delete(0, title.length);
      if (body.length > 0) body.delete(0, body.length);
    });
  };

  const handleToggleConnection = () => {
    const primary = primaryRef.current;
    if (!primary) return;
    if (manualOffline) primary.reconnect();
    else primary.disconnect();
  };

  const handleSelectBotDelay = (ms: BotDelayMs) => {
    setBotDelayMs(ms);
    botRef.current?.setDelayMs(ms);
  };

  const handleTriggerBot = (scenario: BotScenario) => {
    botRef.current?.trigger(scenario);
  };

  const handleToggleBotContinuous = () => {
    botRef.current?.toggleContinuous();
  };

  const handleDownloadDiagnostics = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const vv = window.visualViewport;
    const json = ed.diagnostics.export({
      userAgent: navigator.userAgent,
      viewport: {
        width: Math.round(vv?.width ?? window.innerWidth),
        height: Math.round(vv?.height ?? window.innerHeight),
        layoutWidth: window.innerWidth,
        layoutHeight: window.innerHeight,
        offsetTop: Math.round(vv?.offsetTop ?? 0),
        pixelRatio: window.devicePixelRatio || 1,
      },
      doc: params.docId,
      role: params.role,
      startedAt: startedAtRef.current,
    });
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ime-trace-${params.docId}-${params.role}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleToggleChecklist = (idx: number) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      saveCheckedChecklist(getSessionStorageSafe(), next);
      return next;
    });
  };

  const handleResetChecklist = () => {
    const empty = new Set<number>();
    saveCheckedChecklist(getSessionStorageSafe(), empty);
    setCheckedItems(empty);
  };

  const saveBadge = saveBadgeInfo(saveState);
  const connBadge = connectionBadgeInfo(connState);
  const botConnBadge = connectionBadgeInfo(botState);
  const authRejected = failure === 'E_AUTH';
  const showAuthCard = !params.validDocId || !secret || authRejected || failure !== null;
  const ready = Boolean(params.validDocId && secret && !failure);

  const editorStyle = {
    '--dev-font-size': `${fontSize}px`,
  } as CSSProperties;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.heading}>{koDev.editorHeading}</h1>
          <span className={styles.metaPill} data-testid="dev-doc-badge">
            <Icon name="book" size={16} />
            {koDev.docBadgePrefix}: <code>{params.docId}</code>
          </span>
          <span className={styles.metaPill} data-testid="dev-role-badge">
            <Icon name="student" size={16} />
            {koDev.roleLabel}: {params.role === 'teacher' ? koDev.roleTeacher : koDev.roleStudent}
          </span>
        </div>

        <div className={styles.headerActions}>
          <button type="button" className={styles.button} onClick={handleToggleRole}>
            <Icon name="students" size={20} />
            {params.role === 'student' ? koDev.switchToTeacher : koDev.switchToStudent}
          </button>
          <button
            type="button"
            className={`${styles.button} ${manualOffline ? styles.buttonPrimary : ''}`}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={handleToggleConnection}
            data-testid="dev-connection-toggle"
          >
            <Icon name={manualOffline ? 'saved' : 'offline'} size={20} />
            {manualOffline ? koDev.reconnectButton : koDev.disconnectButton}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={handleDownloadDiagnostics}
            data-testid="dev-download-trace"
          >
            <Icon name="download" size={20} />
            {koDev.downloadTraceButton}
          </button>
        </div>
      </header>

      {showAuthCard ? (
        <section className={styles.alertCard} role="alert" data-testid="dev-auth-alert">
          <h2 className={styles.alertTitle}>
            {!params.validDocId
              ? koDev.invalidDocTitle
              : !secret
                ? koDev.authMissingTitle
                : authRejected
                  ? koDev.authRejectedTitle
                  : ko.errors[failure ?? 'E_AUTH']}
          </h2>
          <p className={styles.alertBody}>
            {!params.validDocId
              ? koDev.invalidDocGuide
              : !secret
                ? koDev.authMissingGuide
                : authRejected
                  ? koDev.authRejectedGuide
                  : `${failure ?? ''}`}
          </p>
          {params.validDocId ? (
            <form className={styles.secretForm} onSubmit={handleApplySecret}>
              <input
                type="password"
                className={styles.secretInput}
                value={secretDraft}
                onChange={e => setSecretDraft(e.target.value)}
                placeholder={koDev.secretInputPlaceholder}
                autoComplete="off"
                data-testid="dev-secret-input"
              />
              <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`}>
                <Icon name="check" size={20} />
                {koDev.secretApplyButton}
              </button>
              {secret ? (
                <button type="button" className={styles.button} onClick={handleClearSecret}>
                  <Icon name="close" size={20} />
                  {koDev.secretClearButton}
                </button>
              ) : null}
            </form>
          ) : null}
        </section>
      ) : null}

      {volatileStore ? <div className={styles.infoBanner}>{koDev.volatileNotice}</div> : null}

      {rejected ? (
        <div className={styles.infoBanner} role="status">
          <span>
            {koDev.rejectedNoticePrefix} {ko.errors[rejected] || rejected}
          </span>
        </div>
      ) : null}

      {largeDeleteVisible ? (
        <div className={styles.infoBanner} role="status">
          <span>{koDev.largeDeleteNotice}</span>
          <button
            type="button"
            className={styles.button}
            onMouseDown={preventFocusSteal}
            onClick={() => {
              editorRef.current?.undo();
              setLargeDeleteVisible(false);
            }}
          >
            <Icon name="undo" size={20} />
            {koDev.undoButton}
          </button>
        </div>
      ) : null}

      {/* 교사 봇 제어판 */}
      <section className={styles.panel} aria-labelledby="dev-bot-heading">
        <div className={styles.botHeader}>
          <div className={styles.botTitleWrap}>
            <h2 id="dev-bot-heading" className={styles.botTitle}>
              {koDev.botSectionTitle}
            </h2>
            <span
              className={`${styles.statusBadge} ${botConnBadge.offlineTone ? styles.badgeOffline : styles.badgeSaved}`}
              data-testid="dev-bot-status"
            >
              <Icon name={botConnBadge.icon} size={16} />
              {koDev.botStatusLabel}: {botConnBadge.label}
            </span>
            {botPending > 0 ? (
              <span className={`${styles.statusBadge} ${styles.badgeSending}`}>
                <Icon name="timer" size={16} />
                {koDev.botPendingPrefix}: {botPending}
              </span>
            ) : null}
          </div>

          <div className={styles.controlGroup}>
            <span className={styles.groupLabel}>{koDev.botDelayLabel}</span>
            {BOT_DELAY_OPTIONS.map(ms => (
              <button
                key={ms}
                type="button"
                className={`${styles.button} ${botDelayMs === ms ? styles.buttonActive : ''}`}
                aria-pressed={botDelayMs === ms}
                onMouseDown={preventFocusSteal}
                onClick={() => handleSelectBotDelay(ms)}
                data-testid={`dev-bot-delay-${ms}`}
              >
                {`${ms}ms`}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.botGrid}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonTeacher}`}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={() => handleTriggerBot('before-caret')}
            data-testid="dev-bot-1"
          >
            {koDev.botScenarioBeforeCaret}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonTeacher}`}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={() => handleTriggerBot('after-caret')}
            data-testid="dev-bot-2"
          >
            {koDev.botScenarioAfterCaret}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonTeacher}`}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={() => handleTriggerBot('inside-word')}
            data-testid="dev-bot-3"
          >
            {koDev.botScenarioInsideWord}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonTeacher}`}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={() => handleTriggerBot('same-paragraph')}
            data-testid="dev-bot-4"
          >
            {koDev.botScenarioSameParagraph}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonDanger}`}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={() => handleTriggerBot('delete-across-caret')}
            data-testid="dev-bot-5"
          >
            {koDev.botScenarioDeleteAcross}
          </button>
          <button
            type="button"
            className={`${styles.button} ${botContinuous ? styles.buttonTeacherActive : styles.buttonTeacher}`}
            aria-pressed={botContinuous}
            disabled={!ready}
            onMouseDown={preventFocusSteal}
            onClick={handleToggleBotContinuous}
            data-testid="dev-bot-6"
          >
            <Icon name="clock" size={20} />
            {botContinuous ? koDev.botScenarioContinuousOn : koDev.botScenarioContinuousOff}
          </button>
        </div>

        {botLastAction ? (
          <p className={styles.botStatusText} data-testid="dev-bot-last-action">
            {koDev.botLastActionPrefix} {botLastAction}
          </p>
        ) : null}
      </section>

      {/* 글자 크기 · 긴 글 · 형광 도구 줄 + 비제어 편집기 */}
      <section className={styles.editorCard} style={editorStyle}>
        <div className={styles.toolbarRow}>
          <div className={styles.controlGroup}>
            <span className={styles.groupLabel}>{koDev.fontSizeLabel}</span>
            {defaultConfig.FONT_SIZES.map(size => (
              <button
                key={size}
                type="button"
                className={`${styles.button} ${fontSize === size ? styles.buttonActive : ''}`}
                aria-pressed={fontSize === size}
                onMouseDown={preventFocusSteal}
                onClick={() => setFontSize(size)}
                data-testid={`dev-font-${size}`}
              >
                {`${size}`}
              </button>
            ))}
          </div>

          <div className={styles.controlGroup}>
            <button
              type="button"
              className={styles.button}
              disabled={!ready}
              onClick={handleInsertLongSample}
              data-testid="dev-insert-long"
            >
              <Icon name="write" size={20} />
              {koDev.longSampleButton}
            </button>
            <button
              type="button"
              className={`${styles.button} ${highlightOn ? styles.buttonActive : ''}`}
              aria-pressed={highlightOn}
              disabled={!ready}
              onMouseDown={preventFocusSteal}
              onClick={() => setHighlightOn(v => !v)}
              data-testid="dev-toggle-highlight"
            >
              <Icon name="check" size={20} />
              {highlightOn ? koDev.highlightOffButton : koDev.highlightOnButton}
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={!ready}
              onClick={handleClearDoc}
              data-testid="dev-clear-doc"
            >
              <Icon name="close" size={20} />
              {koDev.clearDocButton}
            </button>
          </div>
        </div>

        <input
          ref={titleRef}
          type="text"
          className={styles.titleInput}
          placeholder={koDev.titlePlaceholder}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          data-testid="dev-title-input"
        />

        <div className={styles.bodyStage}>
          <div ref={mirrorRef} data-testid="dev-mirror-host" />
          <textarea
            ref={bodyRef}
            className={styles.bodyInput}
            placeholder={koDev.bodyPlaceholder}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            data-testid="dev-body-input"
          />
        </div>
      </section>

      {/* PRD 9.3 · 16.3 실기기 시나리오 체크리스트 (기본 접힘) */}
      <details className={styles.checklist} data-testid="dev-checklist">
        <summary className={styles.checklistSummary}>
          <span>
            {koDev.checklistSummary} ({checkedItems.size}/{koDev.checklistItems.length})
          </span>
        </summary>
        <div className={styles.checklistContent}>
          {koDev.checklistItems.map((item, idx) => {
            const done = checkedItems.has(idx);
            return (
              <label key={item} className={styles.checklistItem}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={done}
                  onChange={() => handleToggleChecklist(idx)}
                />
                <span className={done ? styles.checklistTextDone : undefined}>{item}</span>
              </label>
            );
          })}
          <div>
            <button type="button" className={styles.button} onClick={handleResetChecklist}>
              {koDev.checklistReset}
            </button>
          </div>
        </div>
      </details>

      {/* 화면 키보드 위 하단 고정 바 (bottom: var(--kb-offset)) */}
      <footer className={styles.bottomBar} data-testid="dev-bottom-bar">
        <div className={styles.bottomBarInner}>
          <div className={styles.statusCluster}>
            <span className={`${styles.statusBadge} ${saveBadge.toneClass}`} data-testid="dev-save-state">
              <Icon name={saveBadge.icon} size={20} />
              {saveBadge.label}
            </span>
            <span
              className={`${styles.statusBadge} ${connBadge.offlineTone ? styles.badgeOffline : styles.badgeSaved}`}
              data-testid="dev-conn-state"
            >
              <Icon name={connBadge.icon} size={16} />
              {connBadge.label}
            </span>
            {holdingRemote ? (
              <span className={styles.holdPill} role="status" data-testid="dev-hold-notice">
                <Icon name="notice" size={16} />
                {koDev.holdNotice}
              </span>
            ) : null}
          </div>

          <div className={styles.historyCluster}>
            <button
              type="button"
              className={styles.button}
              disabled={!ready}
              onMouseDown={preventFocusSteal}
              onClick={() => editorRef.current?.undo()}
              data-testid="dev-undo"
            >
              <Icon name="undo" size={20} />
              {koDev.undoButton}
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={!ready}
              onMouseDown={preventFocusSteal}
              onClick={() => editorRef.current?.redo()}
              data-testid="dev-redo"
            >
              <Icon name="redo" size={20} />
              {koDev.redoButton}
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
