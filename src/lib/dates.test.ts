import { describe, it, expect } from "vitest";
import { timeBucket, groupByTime, shortDate, relativeTime } from "./dates";

const NOW = new Date(2026, 8, 27, 15, 0); // Sun 27 Sep 2026 15:00 local

function at(daysAgo: number, hour = 10) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe("timeBucket", () => {
  it("classifies by calendar day, not elapsed hours", () => {
    expect(timeBucket(at(0, 1), NOW)).toBe("today");
    expect(timeBucket(at(1, 23), NOW)).toBe("yesterday");
    expect(timeBucket(at(6), NOW)).toBe("week");
    expect(timeBucket(at(7), NOW)).toBe("month");
    expect(timeBucket(at(29), NOW)).toBe("month");
    expect(timeBucket(at(30), NOW)).toBe("older");
  });
});

describe("groupByTime", () => {
  it("keeps bucket order and drops empty buckets", () => {
    const items = [
      { id: "a", d: at(40) },
      { id: "b", d: at(0) },
      { id: "c", d: at(3) },
      { id: "d", d: at(0, 8) },
    ];
    const groups = groupByTime(items, (i) => i.d, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Hôm nay", "7 ngày qua", "Cũ hơn"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["b", "d"]);
  });
});

describe("shortDate", () => {
  it("today → time, yesterday → label, this week → weekday, else dd/mm", () => {
    expect(shortDate(at(0, 9), NOW)).toMatch(/09:00/);
    expect(shortDate(at(1), NOW)).toBe("Hôm qua");
    expect(shortDate(at(3), NOW).toLowerCase()).toContain("thứ");
    expect(shortDate(at(20), NOW)).toBe("07/09");
  });
});

describe("relativeTime", () => {
  it("formats recent times in Vietnamese", () => {
    expect(relativeTime(new Date(NOW.getTime() - 20_000), NOW)).toBe("vừa xong");
    expect(relativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5 phút trước");
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe("3 giờ trước");
  });
});
