import { koDev } from '@geulbang/core/copy/dev';
import { defaultConfig } from '@geulbang/core/config';
import { ko } from '@geulbang/core/copy';
import { useRef, useState } from 'react';
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
  type NotebookFontSize,
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
} from '../ui/components/index.ts';
import { Icon } from '../ui/icons/Icon.tsx';
import { iconPaths, type IconName } from '../ui/icons/icons.generated.tsx';
import styles from './DevGallery.module.css';

/**
 * `/dev/ui`: 토큰·아이콘 및 전체 부품 견본(시각 검수와 화면 캡처용, PLAN §9.2, P2-10 + P3-7).
 */
const colors = [
  '--bg',
  '--surface',
  '--paper-line',
  '--line',
  '--ink',
  '--ink-sub',
  '--primary',
  '--primary-pressed',
  '--primary-ink',
  '--butter',
  '--sage',
  '--sky',
  '--rose',
  '--rose-pressed',
  '--teacher',
  '--sage-ink',
  '--sky-ink',
  '--rose-ink',
  '--teacher-ink',
] as const;
const shadows = ['--shadow-press', '--shadow-soft', '--shadow-paper', '--focus-ring'] as const;
const radii = ['--r-sm', '--r-card', '--r-sheet', '--r-pill'] as const;
const strokes = ['--stroke-thin', '--stroke', '--stroke-focus'] as const;
const sizes = ['--fs-small', '--fs-body', '--fs-lead', '--fs-title', '--fs-display', '--fs-write'] as const;

export function DevGallery() {
  const [selectedGenreChip, setSelectedGenreChip] = useState<'story' | 'poem' | 'essay'>('story');
  const [selectedGenreTile, setSelectedGenreTile] = useState<
    'story' | 'poem' | 'lyrics' | 'news' | 'essay' | 'other'
  >('story');
  const [selectedStudent, setSelectedStudent] = useState<string>('s1');
  const [entryCode, setEntryCode] = useState('4829');
  const [pinCode, setPinCode] = useState('135790');
  const [delayedResetKey, setDelayedResetKey] = useState(0);
  const [showSchool, setShowSchool] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [consentAgreed, setConsentAgreed] = useState(true);
  const [alert5Min, setAlert5Min] = useState(true);
  const [alert1Min, setAlert1Min] = useState(true);
  const [rewindStep, setRewindStep] = useState(70);
  const [newsSubtype, setNewsSubtype] = useState<'newspaper' | 'extra' | 'broadcast'>('newspaper');
  const [fontSizeOption, setFontSizeOption] = useState<'16' | '18' | '21' | '24'>('18');
  const [responsiveSheetOpen, setResponsiveSheetOpen] = useState(false);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [sideSheetOpen, setSideSheetOpen] = useState(false);

  const uncontrolledInputRef = useRef<HTMLInputElement | null>(null);
  const uncontrolledMemoRef = useRef<HTMLTextAreaElement | null>(null);
  const uncontrolledNotebookRef = useRef<HTMLTextAreaElement | null>(null);
  const notebookMirrorRef = useRef<HTMLDivElement | null>(null);
  const notebookFontSize = Number(fontSizeOption) as NotebookFontSize;

  const handleKeypadDigit = (digit: string) => {
    setEntryCode(prev => (prev.length < defaultConfig.ENTRY_CODE_LENGTH ? prev + digit : prev));
  };

  const handleKeypadBackspace = () => {
    setEntryCode(prev => prev.slice(0, -1));
  };

  const handleKeypadClear = () => {
    setEntryCode('');
  };

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>tokens</h1>

      <section className={styles.section}>
        <h2 className={styles.label}>color</h2>
        <div className={styles.grid}>
          {colors.map(name => (
            <figure key={name} className={styles.swatch}>
              <span className={styles.chip} style={{ background: `var(${name})` }} />
              <figcaption className={styles.caption}>{name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.label}>shadow · radius · stroke</h2>
        <div className={styles.grid}>
          {shadows.map(name => (
            <figure key={name} className={styles.swatch}>
              <span className={styles.card} style={{ boxShadow: `var(${name})` }} />
              <figcaption className={styles.caption}>{name}</figcaption>
            </figure>
          ))}
          {radii.map(name => (
            <figure key={name} className={styles.swatch}>
              <span className={styles.card} style={{ borderRadius: `var(${name})` }} />
              <figcaption className={styles.caption}>{name}</figcaption>
            </figure>
          ))}
          {strokes.map(name => (
            <figure key={name} className={styles.swatch}>
              <span className={styles.card} style={{ borderWidth: `var(${name})` }} />
              <figcaption className={styles.caption}>{name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.label}>type</h2>
        {sizes.map(name => (
          <p key={name} className={styles.sample} style={{ fontSize: `var(${name})` }}>
            <code className={styles.caption}>{name}</code> {koDev.typeSample}
          </p>
        ))}
      </section>

      <section className={styles.section}>
        <h2 className={styles.label}>icon (duotone)</h2>
        <div className={styles.grid}>
          {(Object.keys(iconPaths) as IconName[]).map(name => (
            <figure key={name} className={styles.swatch}>
              <Icon name={name} size={32} />
              <figcaption className={styles.caption}>{name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <h1 className={styles.heading}>{koDev.galleryComponentsHeading}</h1>

      <section className={styles.section} data-testid="gallery-buttons">
        <h2 className={styles.label}>button · text-button</h2>
        <div className={styles.rowWrap}>
          <Button variant="primary" size="lg" icon="write">
            {koDev.galleryButtonPrimaryLg}
          </Button>
          <Button variant="primary" size="md" icon="submit">
            {koDev.galleryButtonPrimaryMd}
          </Button>
          <Button variant="secondary" size="md">
            {koDev.galleryButtonSecondary}
          </Button>
          <Button variant="ghost" size="md">
            {koDev.galleryButtonGhost}
          </Button>
          <Button variant="danger" size="md">
            {koDev.galleryButtonDanger}
          </Button>
          <Button variant="primary" size="md" loading>
            {koDev.galleryButtonLoading}
          </Button>
          <Button
            key={delayedResetKey}
            variant="danger"
            size="md"
            delaySeconds={3}
            onClick={() => setDelayedResetKey(prev => prev + 1)}
          >
            {koDev.galleryButtonDelayed}
          </Button>
          <Button variant="secondary" size="md" disabled>
            {koDev.galleryButtonDisabled}
          </Button>
        </div>
        <div className={styles.rowWrap}>
          <IconButton icon="back" label={ko.common.back} variant="ghost" />
          <IconButton icon="undo" label={ko.common.undo} />
          <IconButton icon="redo" label={ko.common.redo} />
          <IconButton icon="more" label={ko.common.moreMenu} />
          <IconButton icon="delete" label={ko.teacher.deleteRoomNowAction} variant="danger" />
          <TextButton tone="ink" icon="students">
            {koDev.galleryTextButtonTeacher}
          </TextButton>
          <TextButton tone="sub" underline>
            {koDev.galleryTextButtonPrivacy}
          </TextButton>
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-chips">
        <h2 className={styles.label}>chip (choice · filter · ai states)</h2>
        <div className={styles.rowWrap}>
          <Chip selected={selectedGenreChip === 'story'} onClick={() => setSelectedGenreChip('story')}>
            {koDev.galleryChipStory}
          </Chip>
          <Chip selected={selectedGenreChip === 'poem'} onClick={() => setSelectedGenreChip('poem')}>
            {koDev.galleryChipPoem}
          </Chip>
          <Chip selected={selectedGenreChip === 'essay'} onClick={() => setSelectedGenreChip('essay')}>
            {koDev.galleryChipEssay}
          </Chip>
          <Chip selected count={21}>
            {koDev.galleryChipFilterAll}
          </Chip>
          <Chip count={12} icon="write">
            {ko.teacher.statusWriting}
          </Chip>
        </div>
        <div className={styles.rowWrap}>
          <Chip aiButton="SPELL" aiState="idle">
            {koDev.galleryChipAiSpell}
          </Chip>
          <Chip aiButton="FEEDBACK" aiState="fresh">
            {koDev.galleryChipAiFeedback}
          </Chip>
          <Chip aiButton="DIRECTION" aiState="stale">
            {koDev.galleryChipAiDirection}
          </Chip>
          <Chip aiButton="POLISH" aiState="loading">
            {koDev.galleryChipAiPolish}
          </Chip>
          <Chip aiButton="SPELL" aiState="cooldown" cooldownSeconds={8}>
            {koDev.galleryChipAiSpell}
          </Chip>
          <Chip aiButton="FEEDBACK" aiState="guide">
            {koDev.galleryChipAiFeedback}
          </Chip>
          <Chip aiButton="POLISH" aiState="offline">
            {koDev.galleryChipAiPolish}
          </Chip>
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-cards-panels">
        <h2 className={styles.label}>
          paper-card (hand-drawn frame · interactive · read-only) · panel · memo-card
        </h2>
        <div className={styles.twoColGrid}>
          <PaperCard
            handDrawnFrame="md"
            headerIcon="write"
            headerLabel={koDev.galleryCardChip}
            title={koDev.galleryCardTitle}
            headerAction={
              <Button variant="primary" size="md">
                {koDev.galleryCardChip}
              </Button>
            }
          >
            <p className={styles.bodyText}>{koDev.galleryCardBody}</p>
          </PaperCard>

          <PaperCard
            readOnly
            headerIcon="book"
            headerLabel={koDev.galleryReadOnlyChip}
            title={koDev.galleryReadOnlyTitle}
          >
            <p className={styles.bodyText}>{koDev.galleryReadOnlyBody}</p>
          </PaperCard>
        </div>

        <div className={styles.twoColGrid}>
          <Panel
            icon="book"
            badgeText={koDev.galleryPanelBadge}
            title={koDev.galleryPanelTitle}
            onClose={() => {}}
            footer={
              <>
                <span className={styles.caption}>{koDev.galleryPanelFooterMeta}</span>
                <Button variant="secondary" size="md" icon="redo">
                  {koDev.galleryPanelRefresh}
                </Button>
              </>
            }
          >
            <MemoCard
              tone="praise"
              icon="check"
              heading={ko.student.aiFeedbackPraiseHeading}
              badge={ko.common.gulbeotAiBadge}
            >
              <p className={styles.bodyText}>{koDev.galleryPanelPraise}</p>
            </MemoCard>
            <MemoCard
              tone="improve"
              icon="write"
              heading={ko.student.aiFeedbackImproveHeading}
              badge={ko.common.gulbeotAiBadge}
            >
              <p className={styles.bodyText}>{koDev.galleryPanelImprove}</p>
            </MemoCard>
          </Panel>

          <div className={styles.stack}>
            <MemoCard
              tone="note"
              icon="book"
              heading={ko.student.aiFeedbackFactCheckHeading}
              footer={<span>{koDev.galleryPanelFooterMeta}</span>}
            >
              <p className={styles.bodyText}>{ko.student.aiFeedbackEraHint}</p>
            </MemoCard>
            <MemoCard interactive tone="default" icon="aiDirection" heading={ko.student.aiDirectionLabel}>
              <p className={styles.bodyText}>{ko.student.aiPolishGuide}</p>
            </MemoCard>
          </div>
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-gulbeot-stamp">
        <h2 className={styles.label}>gulbeot (24·32·48 face / 96·160 moods / scenes) · stamp (200ms)</h2>
        <div className={styles.rowWrap}>
          <figure className={styles.artPreview}>
            <Gulbeot size={24} mood="reading" priority />
            <figcaption className={styles.caption}>24px (face)</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={32} mood="thinking" />
            <figcaption className={styles.caption}>32px (face)</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={48} priority />
            <figcaption className={styles.caption}>48px (face)</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={96} mood="default" />
            <figcaption className={styles.caption}>96px default</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={96} mood="reading" />
            <figcaption className={styles.caption}>96px reading</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={96} mood="thinking" />
            <figcaption className={styles.caption}>96px thinking</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={96} mood="welcoming" />
            <figcaption className={styles.caption}>96px welcoming</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={96} mood="resting" />
            <figcaption className={styles.caption}>96px resting</figcaption>
          </figure>
          <figure className={styles.artPreview}>
            <Gulbeot size={160} name="home-book" priority />
            <figcaption className={styles.caption}>160px home-book</figcaption>
          </figure>
        </div>
        <div className={styles.rowWrap}>
          <Stamp size="sm" text={ko.student.submitStampText} />
          <Stamp size="md" text={ko.student.submitStampText} />
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-tiles">
        <h2 className={styles.label}>genre-tile (F-05) · student-tile (F-17)</h2>
        <div className={styles.genreGrid}>
          <GenreTile
            genre="story"
            label={ko.student.genreStoryLabel}
            subtitle={ko.student.genreStorySubtitle}
            selected={selectedGenreTile === 'story'}
            onClick={() => setSelectedGenreTile('story')}
          />
          <GenreTile
            genre="poem"
            label={ko.student.genrePoemLabel}
            subtitle={ko.student.genrePoemSubtitle}
            selected={selectedGenreTile === 'poem'}
            onClick={() => setSelectedGenreTile('poem')}
          />
          <GenreTile
            genre="lyrics"
            label={ko.student.genreLyricsLabel}
            subtitle={ko.student.genreLyricsSubtitle}
            selected={selectedGenreTile === 'lyrics'}
            onClick={() => setSelectedGenreTile('lyrics')}
          />
          <GenreTile
            genre="news"
            label={ko.student.genreNewsLabel}
            subtitle={ko.student.genreNewsSubtitle}
            selected={selectedGenreTile === 'news'}
            onClick={() => setSelectedGenreTile('news')}
          />
          <GenreTile
            genre="essay"
            label={ko.student.genreEssayLabel}
            subtitle={ko.student.genreEssaySubtitle}
            selected={selectedGenreTile === 'essay'}
            onClick={() => setSelectedGenreTile('essay')}
          />
          <GenreTile
            genre="other"
            label={ko.student.genreOtherLabel}
            subtitle={ko.student.genreOtherSubtitle}
            selected={selectedGenreTile === 'other'}
            onClick={() => setSelectedGenreTile('other')}
          />
        </div>

        <div className={styles.studentGrid}>
          <StudentTile
            nickname={ko.student.nicknamePlaceholder}
            status="writing"
            genreLabel={ko.student.genreNewsLabel}
            charCount={312}
            timeText={`12${ko.common.timeSecondsAgoSuffix}`}
            selected={selectedStudent === 's1'}
            onClick={() => setSelectedStudent('s1')}
          />
          <StudentTile
            nickname={koDev.galleryChipStory}
            status="writing-flow"
            genreLabel={ko.student.genrePoemLabel}
            charCount={128}
            timeText={`1${ko.common.timeMinutesAgoSuffix}`}
            selected={selectedStudent === 's2'}
            onClick={() => setSelectedStudent('s2')}
          />
          <StudentTile
            nickname={koDev.galleryChipPoem}
            status="idle"
            genreLabel={ko.student.genreLyricsLabel}
            charCount={54}
            timeText={`4${ko.common.timeMinutesAgoSuffix}`}
            selected={selectedStudent === 's3'}
            onClick={() => setSelectedStudent('s3')}
          />
          <StudentTile
            nickname={koDev.galleryChipEssay}
            status="submitted"
            genreLabel={ko.student.purposePoster}
            charCount={88}
            timeText={`10:31 ${ko.teacher.submittedAtSuffix}`}
            selected={selectedStudent === 's4'}
            onClick={() => setSelectedStudent('s4')}
          />
          <StudentTile
            nickname={koDev.roleStudent}
            status="offline"
            genreLabel={ko.student.purposeWebtoon}
            charCount={0}
            timeText={`2${ko.common.timeMinutesAgoSuffix}`}
            selected={selectedStudent === 's5'}
            onClick={() => setSelectedStudent('s5')}
          />
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-controls">
        <h2 className={styles.label}>switch · checkbox (lg · md) · slider (32px thumb)</h2>
        <div className={styles.twoColGrid}>
          <PaperCard title={ko.teacher.roomSettingsTitle}>
            <Switch
              checked={showSchool}
              onCheckedChange={setShowSchool}
              label={ko.teacher.showSchoolSwitch}
              description={ko.teacher.schoolNamePlaceholder}
            />
            <Switch
              checked={soundEnabled}
              onCheckedChange={setSoundEnabled}
              label={ko.teacher.noticeSoundSettingLabel}
            />
            <Switch disabled checked label={ko.teacher.enabledAiButtonsLabel} />
          </PaperCard>

          <PaperCard title={ko.student.consentHeading}>
            <Checkbox
              size="lg"
              card
              checked={consentAgreed}
              onCheckedChange={setConsentAgreed}
              label={ko.student.consentAgreeCheck}
              description={ko.student.consentItemSave}
            />
            <div className={styles.rowWrap}>
              <Checkbox
                size="md"
                checked={alert5Min}
                onCheckedChange={setAlert5Min}
                label={ko.teacher.timerAlert5Min}
              />
              <Checkbox
                size="md"
                checked={alert1Min}
                onCheckedChange={setAlert1Min}
                label={ko.teacher.timerAlert1Min}
              />
              <Checkbox size="md" disabled defaultChecked label={ko.teacher.timerAlertEnd} />
            </div>
          </PaperCard>
        </div>

        <PaperCard title={ko.common.rewindTitle}>
          <Slider
            value={rewindStep}
            min={0}
            max={100}
            step={5}
            onValueChange={setRewindStep}
            label={ko.common.rewindSliderLabel}
            valueText={`${Math.max(1, Math.round((100 - rewindStep) / 10))}${ko.common.timeMinutesAgoSuffix} · ${ko.common.rewindReasonSubmit}`}
          />
        </PaperCard>
      </section>

      <section className={styles.section} data-testid="gallery-overlays">
        <h2 className={styles.label}>dropdown · menu · popover · dialog · sheet (drag 60% / 900px+ side)</h2>
        <div className={styles.rowWrap}>
          <Dropdown
            ariaLabel={ko.student.genreNewsLabel}
            value={newsSubtype}
            onValueChange={setNewsSubtype}
            options={[
              { value: 'newspaper', label: ko.student.subtypeNewspaper },
              { value: 'extra', label: ko.student.subtypeExtraNews },
              { value: 'broadcast', label: ko.student.subtypeBroadcastNews },
            ]}
          />
          <Dropdown
            variant="field"
            label={ko.common.fontSize}
            value={fontSizeOption}
            onValueChange={setFontSizeOption}
            options={[
              { value: '16', label: ko.common.fontSizeSmall },
              { value: '18', label: ko.common.fontSizeMedium },
              { value: '21', label: ko.common.fontSizeLarge },
              { value: '24', label: ko.common.fontSizeXLarge },
            ]}
          />
          <Dropdown
            disabled
            ariaLabel={koDev.galleryButtonDisabled}
            defaultValue="newspaper"
            options={[{ value: 'newspaper', label: ko.student.subtypeNewspaper }]}
          />
        </div>

        <div className={styles.rowWrap}>
          <Menu
            triggerLabel={ko.common.moreMenu}
            triggerText={ko.common.moreMenu}
            items={[
              { id: 'font', label: ko.common.fontSize, icon: 'fontSize' },
              { id: 'rewind', label: ko.common.rewindTitle, icon: 'clock' },
              { id: 'copy', label: ko.common.copyDoc, icon: 'copy' },
              { id: 'save', label: ko.common.saveTxt, icon: 'download' },
              {
                id: 'delete',
                label: ko.teacher.deleteRoomNowAction,
                icon: 'delete',
                tone: 'danger',
                separatorBefore: true,
              },
            ]}
          />

          <Popover
            triggerIcon="notice"
            triggerLabel={ko.teacher.noticeButton}
            title={ko.teacher.noticeSendTab}
            showCloseButton
          >
            <div className={styles.rowWrap}>
              <Chip>{ko.teacher.noticePreset5Min}</Chip>
              <Chip>{ko.teacher.noticePresetSubmit}</Chip>
            </div>
            <Switch
              checked={soundEnabled}
              onCheckedChange={setSoundEnabled}
              label={ko.teacher.soundSwitchLabel}
            />
          </Popover>

          <Dialog
            triggerLabel={ko.teacher.deleteRoomNowAction}
            title={ko.teacher.deleteRoomConfirmTitle}
            description={ko.teacher.deleteRoomConfirmGuide}
            footer={
              <>
                <Button variant="secondary" size="md">
                  {ko.common.cancel}
                </Button>
                <Button variant="danger" size="md" delaySeconds={3}>
                  {ko.teacher.deleteRoomNowAction}
                </Button>
              </>
            }
          >
            <p className={styles.bodyText}>{ko.teacher.roomRetentionGuide}</p>
          </Dialog>

          <Sheet
            open={responsiveSheetOpen}
            onOpenChange={setResponsiveSheetOpen}
            mode="responsive"
            height="result"
            modal={false}
            showGulbeot
            headerIcon="aiFeedback"
            badgeText={ko.student.aiFeedbackLabel}
            triggerLabel={ko.student.aiFeedbackLabel}
            title={koDev.galleryPanelTitle}
            footer={
              <>
                <span className={styles.caption}>{koDev.galleryPanelFooterMeta}</span>
                <Button variant="secondary" size="md" icon="redo">
                  {ko.student.aiRefreshAction}
                </Button>
              </>
            }
          >
            <MemoCard tone="praise" heading={ko.student.aiFeedbackPraiseHeading}>
              <p className={styles.bodyText}>{koDev.galleryPanelPraise}</p>
            </MemoCard>
            <MemoCard tone="improve" heading={ko.student.aiFeedbackImproveHeading}>
              <p className={styles.bodyText}>{koDev.galleryPanelImprove}</p>
            </MemoCard>
          </Sheet>

          <Sheet
            open={bottomSheetOpen}
            onOpenChange={setBottomSheetOpen}
            mode="bottom"
            headerIcon="submit"
            triggerLabel={ko.student.submitButton}
            title={ko.student.submitConfirmTitle}
            footer={
              <>
                <Button variant="secondary" size="md" onClick={() => setBottomSheetOpen(false)}>
                  {ko.student.submitKeepWritingAction}
                </Button>
                <Button variant="primary" size="md" onClick={() => setBottomSheetOpen(false)}>
                  {ko.student.submitConfirmAction}
                </Button>
              </>
            }
          >
            <p className={styles.bodyText}>{ko.student.aiPolishGuide}</p>
          </Sheet>

          <Sheet
            open={sideSheetOpen}
            onOpenChange={setSideSheetOpen}
            mode="side"
            headerIcon="unlocked"
            badgeText={ko.teacher.statusSubmitted}
            triggerLabel={ko.teacher.reopenDocAction}
            title={koDev.galleryCardTitle}
            footer={
              <Button variant="primary" size="md" onClick={() => setSideSheetOpen(false)}>
                {ko.teacher.reopenDocAction}
              </Button>
            }
          >
            <p className={styles.bodyText}>{koDev.galleryCardBody}</p>
          </Sheet>
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-fields">
        <h2 className={styles.label}>text-field · memo-field · notebook-field (uncontrolled ref + mirror)</h2>
        <div className={styles.twoColGrid}>
          <TextField
            ref={uncontrolledInputRef}
            label={ko.student.nicknameLabel}
            placeholder={ko.student.nicknamePlaceholder}
            hint={ko.student.nicknameHint}
          />
          <TextField
            label={koDev.galleryFieldSchoolLabel}
            defaultValue={koDev.galleryFieldSchoolPlaceholder}
            error={koDev.galleryFieldErrorSample}
          />
          <TextField
            readOnly
            label={koDev.galleryFieldReadOnlyLabel}
            defaultValue={koDev.galleryFieldReadOnlyValue}
          />
          <MemoField
            ref={uncontrolledMemoRef}
            label={koDev.galleryMemoLabel}
            question={koDev.galleryMemoQuestion}
            placeholder={koDev.galleryMemoPlaceholder}
            hint={koDev.galleryMemoHint}
          />
        </div>
        <PaperCard title={ko.student.bodyAriaLabel}>
          <NotebookField
            ref={uncontrolledNotebookRef}
            mirrorRef={notebookMirrorRef}
            fontSize={notebookFontSize}
          />
        </PaperCard>
      </section>

      <section className={styles.section} data-testid="gallery-banners-toasts">
        <h2 className={styles.label}>banner · toast · notice-drop · hold-pill</h2>
        <div className={styles.stack}>
          <Banner kind="offline" />
          <Banner kind="closed" />
          <Banner
            kind="unsent"
            action={
              <Button variant="secondary" size="md" icon="copy">
                {koDev.galleryCardChip}
              </Button>
            }
          />
          <Banner
            tone="notice"
            icon="students"
            message={koDev.galleryBannerResume}
            action={
              <>
                <Button variant="primary" size="md">
                  {koDev.galleryBannerApprove}
                </Button>
                <Button variant="secondary" size="md">
                  {koDev.galleryBannerReject}
                </Button>
              </>
            }
          />
          <Banner
            tone="danger"
            icon="notice"
            message={koDev.galleryBannerExpiry}
            action={
              <Button variant="secondary" size="md" icon="download">
                {koDev.galleryBannerDownload}
              </Button>
            }
          />
        </div>
        <div className={styles.rowWrap}>
          <NoticeDrop message={ko.teacher.noticePreset5Min} onDismiss={() => {}} />
          <Toast message={ko.student.teacherEditingToast} icon="write" onDismiss={() => {}} />
          <Toast
            tone="warning"
            message={ko.student.largeDeleteToast}
            actionLabel={ko.student.restoreAction}
            onAction={() => {}}
          />
          <Toast
            tone="danger"
            message={koDev.galleryToastError}
            actionLabel={ko.common.retry}
            onAction={() => {}}
          />
          <HoldPill />
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-pills-badges">
        <h2 className={styles.label}>timer-pill · save-state · status-badge</h2>
        <div className={styles.rowWrap}>
          <TimerPill remainingSeconds={492} state="running" />
          <TimerPill remainingSeconds={300} state="paused" />
          <Menu
            items={[
              { id: 'pause', label: ko.teacher.timerPauseAction, icon: 'pause' },
              { id: 'cancel', label: ko.teacher.timerCancelAction, icon: 'close', tone: 'danger' },
            ]}
            trigger={<TimerPill asButton remainingSeconds={45} state="urgent" />}
          />
          <TimerPill remainingSeconds={0} state="ended" />
        </div>
        <div className={styles.rowWrap}>
          <SaveState state="saved" />
          <SaveState state="sending" />
          <SaveState state="local" />
          <SaveState state="locked" />
        </div>
        <div className={styles.rowWrap}>
          <StatusBadge status="writing" />
          <StatusBadge status="writing-flow" />
          <StatusBadge status="idle" />
          <StatusBadge status="submitted" />
          <StatusBadge status="offline" />
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-keypad-code">
        <h2 className={styles.label}>keypad · code-input</h2>
        <div className={styles.twoColGrid}>
          <PaperCard title={koDev.galleryCodeEntryTitle}>
            <CodeInput value={entryCode} onChange={setEntryCode} />
            <div className={styles.centerBox}>
              <Keypad
                onDigit={handleKeypadDigit}
                onBackspace={handleKeypadBackspace}
                onClear={handleKeypadClear}
              />
            </div>
          </PaperCard>
          <PaperCard title={koDev.galleryCodePinTitle}>
            <CodeInput
              value={pinCode}
              minLength={defaultConfig.PIN_MIN_LENGTH}
              maxLength={defaultConfig.PIN_MAX_LENGTH}
              size="sm"
              inputMode="none"
              masked
              onChange={setPinCode}
            />
            <CodeInput value="12" size="sm" length={8} error={koDev.galleryCodeErrorSample} />
          </PaperCard>
        </div>
      </section>

      <section className={styles.section} data-testid="gallery-skeleton-empty">
        <h2 className={styles.label}>skeleton · empty-state (artName + hand-drawn frame)</h2>
        <div className={styles.twoColGrid}>
          <div className={styles.stack}>
            <Skeleton variant="card" lines={3} showLabelImmediately />
            <Skeleton variant="tile" lines={2} showLabelImmediately />
          </div>
          <EmptyState
            artName="empty-desks"
            frameSize="md"
            title={ko.teacher.emptyRoomTitle}
            actionLabel={ko.teacher.emptyRoomAction}
            onAction={() => {}}
          />
        </div>
        <div className={styles.twoColGrid}>
          <EmptyState
            artName="closed-door"
            frameSize="md"
            title={koDev.galleryEmptyStudentTitle}
            actionLabel={koDev.galleryEmptyStudentAction}
            actionVariant="secondary"
            onAction={() => {}}
          />
          <EmptyState
            artName="waiting-letter"
            frameSize="md"
            title={ko.student.resumeWaitTitle}
            description={ko.student.resumeWaitLongHint}
            actionLabel={ko.common.cancel}
            actionVariant="secondary"
            onAction={() => {}}
          />
        </div>
      </section>
    </main>
  );
}
