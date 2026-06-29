import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

// Minimal typing for the Web Speech API (not in the standard DOM lib).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

interface VoiceInputButtonProps {
  /** Called with the live transcript as the user speaks (interim + final). */
  onTranscript: (text: string) => void;
  /** Called once with the final transcript when recognition ends (optional, e.g. to auto-submit). */
  onFinal?: (text: string) => void;
  disabled?: boolean;
  /** Compact icon-only style for tight layouts. */
  compact?: boolean;
}

export default function VoiceInputButton({ onTranscript, onFinal, disabled, compact }: VoiceInputButtonProps) {
  const SpeechRecognitionCtor = getSpeechRecognition();
  const supported = Boolean(SpeechRecognitionCtor);

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef<string>("");

  // Tear down any in-flight recognition when the component unmounts.
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    };
  }, []);

  const stop = () => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  };

  const start = () => {
    if (!SpeechRecognitionCtor || disabled) return;
    setError(null);
    finalTranscriptRef.current = "";

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) finalTranscriptRef.current += final;
      const combined = (finalTranscriptRef.current + interim).trim();
      if (combined) onTranscript(combined);
    };

    recognition.onerror = (event: any) => {
      const code = event?.error || "unknown";
      // "aborted"/"no-speech" are benign user/no-input cases — keep the message gentle.
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone permission denied.");
      } else if (code === "no-speech") {
        setError("Didn't catch that — try again.");
      } else if (code !== "aborted") {
        setError("Voice input error. Try again.");
      }
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      const text = finalTranscriptRef.current.trim();
      if (text && onFinal) onFinal(text);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Calling start() twice throws; ignore and reset.
      setListening(false);
    }
  };

  const toggle = () => (listening ? stop() : start());

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Voice input isn't supported in this browser. Try Chrome or Edge."
        className="shrink-0 p-2.5 rounded-xl border border-slate-200 text-slate-300 cursor-not-allowed"
      >
        <MicOff className="w-4.5 h-4.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={listening ? "Stop listening" : (error || "Speak your task")}
      aria-pressed={listening}
      aria-label={listening ? "Stop voice input" : "Start voice input"}
      className={`shrink-0 flex items-center gap-1.5 rounded-xl font-semibold text-xs transition-all disabled:opacity-50 ${
        compact ? "p-2.5" : "px-3.5 py-2.5"
      } ${
        listening
          ? "bg-rose-600 text-white shadow-xs animate-pulse"
          : "border border-slate-200 text-slate-600 hover:bg-slate-100"
      }`}
    >
      <Mic className="w-4.5 h-4.5" />
      {!compact && <span>{listening ? "Listening…" : "Speak"}</span>}
    </button>
  );
}
