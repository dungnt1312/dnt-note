import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses multiple calls into one after the delay", () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d("a");
    vi.advanceTimersByTime(300);
    d("b");
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
  });

  it("flush() runs the pending call immediately", () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d("x");
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("x");
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() drops the pending call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d("x");
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush() with nothing pending is a no-op", () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    expect(() => d.flush()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});
