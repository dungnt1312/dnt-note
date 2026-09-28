// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./BrandMark";

describe("BrandMark", () => {
  it("renders the approved Concept A DN Fold geometry", () => {
    const html = renderToStaticMarkup(<BrandMark size={24} title="DNT Note" />);

    expect(html).toContain('viewBox="0 0 100 104"');
    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="DNT Note"');
    expect(html.match(/<path/g)).toHaveLength(3);
    expect(html).toContain('fill="currentColor"');
  });

  it("inherits theme color and stays decorative by default", () => {
    const html = renderToStaticMarkup(<BrandMark className="text-fg" />);
    expect(html).toContain('class="text-fg"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });
});
