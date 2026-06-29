import { useCallback, useEffect, useRef, useState } from "react";

export type BgmMode = "first_breath" | "where_morning" | "stillness" | "automatic";
export type BgmTrackKey = "first_breath" | "where_morning" | "stillness";

export const BGM_TRACKS: Record<BgmTrackKey, { src: string; label: string }> = {
  first_breath: { src: "/audio/First_Breath_of_Light.mp3", label: "First Breath of Light" },
  where_morning: { src: "/audio/Where_Morning_Begins.mp3", label: "Where Morning Begins" },
  stillness: { src: "/audio/Stillness_of_the_House.mp3", label: "Stillness of the House" },
};

// Bumped to v2 so the new default track ("First Breath of Light") takes effect
// even for browsers that already saved a sound preference.
const STORAGE_KEY = "clearpath_bgm_v2";

// How long a crossfade lasts (both for looping a track and switching tracks).
const CROSSFADE_SEC = 3;

// Automatic schedule: Where Morning Begins from 04:30 to 19:00 (local time),
// Stillness of the House otherwise.
const AUTO_START_MIN = 4 * 60 + 30; // 04:30
const AUTO_END_MIN = 19 * 60; // 19:00

export function autoTrackKey(now: Date = new Date()): BgmTrackKey {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= AUTO_START_MIN && minutes < AUTO_END_MIN ? "where_morning" : "stillness";
}

function modeToTrack(mode: BgmMode): BgmTrackKey {
  return mode === "automatic" ? autoTrackKey() : mode;
}

interface StoredSettings {
  mode: BgmMode;
  volume: number;
  enabled: boolean;
}

function loadSettings(): StoredSettings {
  const defaults: StoredSettings = { mode: "first_breath", volume: 0.4, enabled: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      mode: ["first_breath", "where_morning", "stillness", "automatic"].includes(parsed?.mode) ? parsed.mode : defaults.mode,
      volume: typeof parsed?.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : defaults.volume,
      enabled: typeof parsed?.enabled === "boolean" ? parsed.enabled : defaults.enabled,
    };
  } catch {
    return defaults;
  }
}

export interface BgmState {
  mode: BgmMode;
  setMode: (m: BgmMode) => void;
  volume: number;
  setVolume: (v: number) => void;
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  isPlaying: boolean;
  /** The track actually playing right now (resolves 'automatic' to a concrete track). */
  currentKey: BgmTrackKey;
  /** True when the browser blocked autoplay and we're waiting for a first interaction. */
  blocked: boolean;
}

// Background-music engine with crossfading. Uses two <audio> "decks": to loop a
// track we start a fresh copy on the idle deck a few seconds before the playing
// one ends and crossfade between them; switching tracks crossfades the same way.
export function useBgm(): BgmState {
  // Read persisted settings exactly once (not on every render).
  const initialRef = useRef<StoredSettings | null>(null);
  if (initialRef.current === null) initialRef.current = loadSettings();
  const initial = initialRef.current;

  const [mode, setMode] = useState<BgmMode>(initial.mode);
  const [volume, setVolume] = useState<number>(initial.volume);
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [isPlaying, setIsPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [currentKey, setCurrentKey] = useState<BgmTrackKey>(modeToTrack(initial.mode));

  // The track we *want* playing (driven by mode + the automatic clock).
  const [desiredKey, setDesiredKey] = useState<BgmTrackKey>(modeToTrack(initial.mode));

  // Two decks + bookkeeping kept in refs so timers/animation frames see fresh values.
  const decksRef = useRef<HTMLAudioElement[]>([]);
  const activeRef = useRef(0);
  const fadeRafRef = useRef<number | null>(null);
  const fadingRef = useRef(false);
  const playingKeyRef = useRef<BgmTrackKey>(modeToTrack(initial.mode));
  const volumeRef = useRef(volume);
  const enabledRef = useRef(enabled);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const cancelFade = useCallback(() => {
    if (fadeRafRef.current != null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }
    fadingRef.current = false;
  }, []);

  // Start `key` on the idle deck and crossfade to it over CROSSFADE_SEC. Used both
  // for seamless looping (key === current) and track switches (key !== current).
  const crossfadeTo = useCallback((key: BgmTrackKey) => {
    const decks = decksRef.current;
    if (decks.length < 2) return;

    cancelFade();
    const target = volumeRef.current;
    const outgoing = decks[activeRef.current];
    const incoming = decks[1 - activeRef.current];

    const src = BGM_TRACKS[key].src;
    if (!incoming.src.endsWith(src)) incoming.src = src;
    try { incoming.currentTime = 0; } catch { /* not ready yet */ }
    incoming.volume = 0;

    const p = incoming.play();
    if (p && typeof p.then === "function") {
      p.then(() => setBlocked(false)).catch(() => setBlocked(true));
    }

    // The incoming deck becomes active immediately (it's what we're fading toward).
    activeRef.current = 1 - activeRef.current;
    playingKeyRef.current = key;
    setCurrentKey(key);

    fadingRef.current = true;
    const startVol = outgoing.volume;
    const startT = performance.now();
    const durMs = CROSSFADE_SEC * 1000;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startT) / durMs);
      outgoing.volume = Math.max(0, startVol * (1 - t));
      incoming.volume = Math.max(0, Math.min(1, target * t));
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(tick);
      } else {
        fadeRafRef.current = null;
        fadingRef.current = false;
        try { outgoing.pause(); } catch { /* ignore */ }
      }
    };
    fadeRafRef.current = requestAnimationFrame(tick);
  }, [cancelFade]);

  // Create the two decks once and run the loop-watcher that triggers loop crossfades.
  useEffect(() => {
    const make = () => {
      const a = new Audio();
      a.preload = "auto";
      a.loop = false; // we handle looping via crossfade, not the native seam
      return a;
    };
    const decks = [make(), make()];
    decksRef.current = decks;

    const updatePlaying = () => setIsPlaying(decks.some(d => !d.paused));
    decks.forEach(d => { d.onplay = updatePlaying; d.onpause = updatePlaying; });

    // Watch the active deck; when it nears the end, crossfade into a fresh copy.
    const loopWatch = window.setInterval(() => {
      if (!enabledRef.current || fadingRef.current) return;
      const deck = decksRef.current[activeRef.current];
      if (!deck || deck.paused) return;
      const dur = deck.duration;
      if (!isFinite(dur) || dur <= 0) return;
      if (dur - deck.currentTime <= CROSSFADE_SEC) {
        crossfadeTo(playingKeyRef.current);
      }
    }, 250);

    return () => {
      window.clearInterval(loopWatch);
      if (fadeRafRef.current != null) cancelAnimationFrame(fadeRafRef.current);
      decks.forEach(d => { d.pause(); d.src = ""; });
      decksRef.current = [];
    };
  }, [crossfadeTo]);

  // Persist settings.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, volume, enabled })); } catch { /* ignore */ }
  }, [mode, volume, enabled]);

  // Resolve the desired track from the mode; re-check every 30s in automatic mode so
  // it flips at the 04:30 / 19:00 boundaries while the app stays open.
  useEffect(() => {
    setDesiredKey(modeToTrack(mode));
    if (mode !== "automatic") return;
    const id = window.setInterval(() => setDesiredKey(modeToTrack("automatic")), 30_000);
    return () => window.clearInterval(id);
  }, [mode]);

  // Drive playback: start/crossfade to the desired track, or pause when disabled.
  useEffect(() => {
    const decks = decksRef.current;
    if (decks.length < 2) return;

    if (!enabled) {
      cancelFade();
      decks.forEach(d => d.pause());
      return;
    }

    const active = decks[activeRef.current];
    // Crossfade if we're not already playing the desired track, or nothing's playing.
    if (playingKeyRef.current !== desiredKey || active.paused) {
      crossfadeTo(desiredKey);
    } else if (!fadingRef.current) {
      active.volume = volumeRef.current;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, enabled]);

  // Live master-volume changes (skip while a fade is animating the volumes).
  useEffect(() => {
    volumeRef.current = volume;
    if (fadingRef.current) return;
    const active = decksRef.current[activeRef.current];
    if (active && !active.paused) active.volume = volume;
  }, [volume]);

  // Browsers block audio-with-sound until a genuine user-activation gesture (a
  // click/keypress/tap — NOT mousemove or scroll). So we arm listeners for the
  // earliest such gestures as soon as music is enabled (not waiting on the autoplay
  // rejection round-trip), so the very first interaction anywhere starts playback.
  // (If the browser already permits autoplay — e.g. site sound is allowed or Chrome's
  // media-engagement threshold is met — the mount play() above starts it with no click.)
  useEffect(() => {
    if (!enabled) return;
    // Capture-phase + early-firing events so the first press wins, even on buttons.
    const events: (keyof WindowEventMap)[] = ["pointerdown", "mousedown", "touchstart", "keydown", "click"];
    let done = false;
    const cleanup = () => events.forEach(e => window.removeEventListener(e, start, true));
    function start() {
      if (done) return;
      const active = decksRef.current[activeRef.current];
      if (!active) return;
      if (!active.paused) { done = true; setBlocked(false); cleanup(); return; }
      const p = active.play();
      if (p && typeof p.then === "function") {
        p.then(() => { done = true; setBlocked(false); cleanup(); }).catch(() => { /* try again next gesture */ });
      } else {
        done = true; setBlocked(false); cleanup();
      }
    }
    events.forEach(e => window.addEventListener(e, start, { capture: true, passive: true }));
    return cleanup;
  }, [enabled]);

  return { mode, setMode, volume, setVolume, enabled, setEnabled, isPlaying, currentKey, blocked };
}
