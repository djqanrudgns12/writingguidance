/**
 * 교사 화면 배치(P3-9t·P4-11). 화면은 props와 콜백만 받는 보이는 부품이고, 결합(P3-10·P4-13)이 훅을 잇는다.
 */
export { ConnectionCheckView, type CheckItemState, type ConnectionCheckModel } from './ConnectionCheck.tsx';
export {
  CreateRoomView,
  type CreateRoomCodeField,
  type CreateRoomErrors,
  type CreateRoomValues,
  type CreateRoomViewProps,
} from './CreateRoom.tsx';
export { DashboardView, type DashboardViewProps } from './Dashboard.tsx';
export {
  ClosedBand,
  ExpiryBand,
  OfflineBand,
  ResumeRequestsBand,
  type ResumeRequestItem,
} from './DashboardBands.tsx';
export { DashboardTimer } from './DashboardTimer.tsx';
export { DeleteRoomPanelView, DeleteRoomSheet } from './DeleteRoomSheet.tsx';
export { DevicesPanelView, DevicesSheet, type DeviceItem } from './DevicesSheet.tsx';
export { ExportPanelView, ExportSheet, type ExportKind } from './ExportSheet.tsx';
export { aiButtonLabel, docKindLabel, formatAgo, formatClock, formatMonthDay, genreLabel } from './format.ts';
export { NoticePanelView, type NoticePanelViewProps } from './NoticePanel.tsx';
export { PinEntryView, type PinEntryViewProps } from './PinEntry.tsx';
export { QrFullscreenView } from './QrFullscreen.tsx';
export { RewindPanelView, RewindSheet, type RewindItem } from './RewindSheet.tsx';
export { RoomPrepView, type PinReveal, type RoomPrepViewProps } from './RoomPrep.tsx';
export { RoomSettingsPanelView, RoomSettingsSheet, type RoomSettingsValues } from './RoomSettings.tsx';
export { StudentDrawerView, type DrawerMemo, type StudentDrawerViewProps } from './StudentDrawer.tsx';
export { FilterChips, StudentTilesGrid, tileTimeText } from './StudentTiles.tsx';
export { TeacherHomeView, type TeacherRecentRoom, type TeacherHomeViewProps } from './TeacherHome.tsx';
export { TeacherLinkQrView } from './TeacherLinkQr.tsx';
export { TeacherRegisterView, type TeacherRegisterState } from './TeacherRegister.tsx';
export {
  countByFilter,
  sortTilesByNickname,
  tileMatchesFilter,
  type DashboardFilter,
  type StudentTileModel,
} from './tiles.ts';
export {
  initialTimerDraft,
  TIMER_ALERT_MINUTES,
  timerAlertAvailable,
  timerDraftMinutes,
  timerDraftToCommand,
  type TimerDraft,
  type TimerModel,
} from './timerDraft.ts';
