import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_RECORD_MS = 10 * 60 * 1000;

interface Options {
  onBlob: (blob: Blob) => void;
  onError: (e: unknown) => void;
  maxMs?: number;
}

/** Microphone recorder: getUserMedia → MediaRecorder; tracks always released. */
export function useRecorder({ onBlob, onError, maxMs = MAX_RECORD_MS }: Options) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cbRef = useRef({ onBlob, onError });
  cbRef.current = { onBlob, onError };

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else cleanup();
  }, [cleanup]);

  const start = useCallback(async () => {
    if (recRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType =
        typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined;
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        recRef.current = null;
        cleanup();
        setRecording(false);
        cbRef.current.onBlob(new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }));
      };
      recRef.current = rec;
      rec.start();
      const began = Date.now();
      setElapsedMs(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const ms = Date.now() - began;
        setElapsedMs(ms);
        if (ms >= maxMs) stop();
      }, 250);
    } catch (e) {
      recRef.current = null;
      cleanup();
      setRecording(false);
      cbRef.current.onError(e);
    }
  }, [cleanup, maxMs, stop]);

  // Unmount: drop the recording without emitting a blob.
  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== "inactive") rec.stop();
        recRef.current = null;
      }
      cleanup();
    },
    [cleanup],
  );

  return { recording, elapsedMs, start, stop };
}
