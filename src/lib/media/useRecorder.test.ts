import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "./useRecorder";

class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  static created = 0;
  constructor(public stream: unknown, public opts?: unknown) {
    FakeRecorder.created++;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["abc"]) });
    this.onstop?.();
  }
}

let trackStop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  trackStop = vi.fn();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] })) },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useRecorder", () => {
  it("start → stop emits blob and stops tracks", async () => {
    const onBlob = vi.fn();
    const { result } = renderHook(() => useRecorder({ onBlob, onError: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.recording).toBe(true);
    act(() => result.current.stop());
    expect(onBlob).toHaveBeenCalledTimes(1);
    expect((onBlob.mock.calls[0][0] as Blob).size).toBe(3);
    expect(trackStop).toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it("auto-stops at max duration", async () => {
    const onBlob = vi.fn();
    const { result } = renderHook(() => useRecorder({ onBlob, onError: vi.fn(), maxMs: 1000 }));
    await act(async () => {
      await result.current.start();
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onBlob).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalled();
  });

  it("reports permission errors", async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("denied"));
    const onError = vi.fn();
    const { result } = renderHook(() => useRecorder({ onBlob: vi.fn(), onError }));
    await act(async () => {
      await result.current.start();
    });
    expect(onError).toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it("stops tracks on unmount without emitting", async () => {
    const onBlob = vi.fn();
    const { result, unmount } = renderHook(() => useRecorder({ onBlob, onError: vi.fn() }));
    await act(async () => {
      await result.current.start();
    });
    unmount();
    expect(trackStop).toHaveBeenCalled();
    expect(onBlob).not.toHaveBeenCalled();
  });

  it("ignores concurrent start calls", async () => {
    const { result } = renderHook(() => useRecorder({ onBlob: vi.fn(), onError: vi.fn() }));
    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("releases mic if unmounted while permission is pending", async () => {
    let resolve!: (s: unknown) => void;
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((r) => (resolve = r)),
    );
    FakeRecorder.created = 0;
    const { result, unmount } = renderHook(() => useRecorder({ onBlob: vi.fn(), onError: vi.fn() }));
    let p!: Promise<void>;
    act(() => {
      p = result.current.start();
    });
    unmount();
    resolve({ getTracks: () => [{ stop: trackStop }] });
    await p;
    expect(trackStop).toHaveBeenCalled();
    expect(FakeRecorder.created).toBe(0);
  });
});
