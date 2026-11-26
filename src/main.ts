/**
 * Launchpad X Chord Visualizer — メイン画面の合成ルート。
 * ここで各部品を作り、つなぎ方をすべて明示する（部品同士が互いを直接参照しない）。
 */
import { logStateChanges } from './app/activity-log';
import { NoteController } from './app/note-controller';
import { pressTopRow, type TopRowCommands } from './app/top-row';
import { AudioEngine } from './audio/engine';
import { createMetronome } from './audio/metronome';
import { LOGO_LED } from './config/roles';
import { noteLabel } from './core/pitch';
import { createLedController } from './led/controller';
import { DeviceManager } from './midi/device-manager';
import { byId } from './platform/dom';
import { Logger } from './platform/logger';
import { loadPersisted, startPersistence } from './platform/persistence';
import { browserStorage } from './platform/storage';
import { startTicker } from './platform/ticker';
import { SongLoader } from './song/loader';
import { PlayerHost } from './song/media/player-host';
import { SongRuntime } from './song/runtime';
import { mediaFromLocation, searchForMedia } from './song/url-params';
import { mountNowNext, mountSongOverview, mountSongTimeline } from './song/views/playback-views';
import { mountSearchPanel } from './song/views/search-panel-view';
import { mountSongBar } from './song/views/song-bar-view';
import { createStore } from './store/create-store';
import { createInitialState } from './store/initial-state';
import { reduce } from './store/reducer';
import { PRESS_SOURCE } from './store/state';
import { mountMetronomeView, mountSoundView, mountVolumeView } from './ui/audio-views';
import { mountChordControls } from './ui/chord-controls-view';
import { mountChordDisplay } from './ui/chord-display-view';
import { mountDeviceView } from './ui/device-view';
import { mountGridView } from './ui/grid-view';
import { createLogPanelSink } from './ui/log-view';
import { applyTheme } from './ui/theme';

// ---------- 基盤 ----------
const storage = browserStorage();
const logger = new Logger();
logger.addSink(createLogPanelSink());
logger.addSink(({ message }) => {
  console.log(message);
});
applyTheme();

const store = createStore(reduce, createInitialState(loadPersisted(storage)));
startPersistence(store, storage);
logStateChanges(store, logger);

// ---------- 音 ----------
const soundView = mountSoundView(store);
const audio = new AudioEngine(
  {
    logger,
    onSampleStatus: (instrument, status) => {
      store.dispatch({ type: 'sampleStatusChanged', instrument, status });
    },
    onBlockedChange: (blocked) => {
      soundView.setBlocked(blocked);
    },
  },
  { instrument: store.getState().audio.instrument, volumePercent: store.getState().audio.volume },
);
store.watch(
  (state) => state.audio.volume,
  (volume) => {
    audio.setVolume(volume);
  },
);
store.watch(
  (state) => state.audio.instrument,
  (instrument) => {
    audio.setInstrument(instrument);
  },
);
// ブラウザはユーザー操作の後でないと音を出せない。最初の操作で音声を有効にする
for (const gesture of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(
    gesture,
    () => {
      audio.unlock();
    },
    { capture: true },
  );
}

const notes = new NoteController(store, audio);
// 画面のパッドを押したままウィンドウを離れたら音を止める
// （Launchpad 本体の押下は止めない: 別のウィンドウを前面にしたまま演奏できるように）
window.addEventListener('blur', () => {
  notes.releaseAll(PRESS_SOURCE.pointer);
});

// ---------- Song（再生位置の追従） ----------
const runtime = new SongRuntime(store, logger);

// ---------- 上段ボタン（画面 / Launchpad 共通） ----------
const topRowCommands: TopRowCommands = {
  shiftOctave: (delta) => {
    store.dispatch({ type: 'octaveShifted', delta });
  },
  shiftCapo: (delta) => {
    store.dispatch({ type: 'capoShifted', delta });
  },
  togglePlay: () => {
    runtime.togglePlay();
  },
  backOneBar: () => {
    runtime.backOneBar();
  },
  toggleFollow: () => {
    runtime.toggleFollow();
  },
  cycleLoop: () => {
    runtime.cycleLoop();
  },
};

// ---------- グリッド / MIDI / LED ----------
const gridView = mountGridView({
  store,
  notes,
  onTopRow: (index) => {
    pressTopRow(index, topRowCommands);
  },
  onRightColumn: (index) => {
    logger.in(`Right column button ${index + 1} pressed`);
  },
});

const devices = new DeviceManager(store, logger, {
  padDown(padIndex, velocity, deviceNumber) {
    const note = notes.press(`${PRESS_SOURCE.device}${deviceNumber}`, padIndex, velocity);
    if (note !== null)
      logger.in(`Pad IN: note=${deviceNumber} → ${noteLabel(note)} vel=${velocity}`);
  },
  padUp(deviceNumber) {
    notes.release(`${PRESS_SOURCE.device}${deviceNumber}`);
  },
  topRow(index) {
    pressTopRow(index, topRowCommands);
    gridView.flashTopRow(index);
  },
  rightColumn(index, via) {
    logger.in(`Right column button ${index + 1} pressed (${via})`);
    gridView.flashRightColumn(index, via);
  },
});

const leds = createLedController({ store, logger, getDevice: () => devices.device });

// ---------- メトロノーム ----------
const metronome = createMetronome({
  getBpm: () => store.getState().metronome.bpm,
  scheduleClick: (accent, delaySec) => {
    audio.scheduleClick(accent, delaySec);
  },
  onBeat: (accent) => {
    leds.flashLogo(accent ? LOGO_LED.accent : LOGO_LED.beat);
  },
});
store.watch(
  (state) => state.metronome.running,
  (running) => {
    if (running) metronome.start();
    else metronome.stop();
  },
);

// ---------- パネル ----------
mountChordControls(store);
mountChordDisplay(store);
mountVolumeView(store);
mountMetronomeView(store);
mountDeviceView({
  store,
  onSelect: (outputId) => {
    devices.selectByUser(outputId);
  },
  onRescan: () => {
    void devices.start();
  },
  onSend: () => {
    leds.resend();
  },
  onClear: () => {
    leds.clear();
  },
});

// ---------- Song バー ----------
const loader = new SongLoader({
  store,
  logger,
  storage,
  host: new PlayerHost(byId('song-player', 'div')),
  onPlayer: (player) => {
    runtime.setPlayer(player);
  },
  onPlayerStateChange: () => {
    runtime.syncPlaying();
  },
});
mountSearchPanel({
  store,
  onSubmit: (input) => {
    loader.submit(input);
  },
  onPick: (media) => {
    void loader.load(media);
  },
});
mountSongBar({
  store,
  onTogglePlay: topRowCommands.togglePlay,
  onBackOneBar: topRowCommands.backOneBar,
  onCycleLoop: topRowCommands.cycleLoop,
});
const playbackDeps = {
  store,
  getTime: () => runtime.time(),
  onSeek: (t: number) => {
    runtime.seekTo(t);
  },
};
runtime.addView(mountSongTimeline(playbackDeps));
runtime.addView(mountNowNext(store));
runtime.addView(mountSongOverview(playbackDeps));

// 読み込んだ曲を URL に反映する（リロード・共有で同じ曲を開けるように）
store.watch(
  (state) => state.song.load,
  (load) => {
    if (load.status === 'fetching')
      history.replaceState(null, '', searchForMedia(location.search, load.media));
  },
);

startTicker({
  onTick: (visible) => {
    runtime.frame(visible);
  },
  neededWhileHidden: () => runtime.neededWhileHidden(),
});

// ---------- 起動 ----------
logger.log('App started');
void devices.start();
const initialMedia = mediaFromLocation(location.search);
if (initialMedia) void loader.load(initialMedia);
