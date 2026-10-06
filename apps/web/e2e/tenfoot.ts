import type { Page } from "@playwright/test";

export interface Audit {
  violations: string[];
  checkedText: number;
  minFontPx: number;
  minContrast: number;
}

/**
 * Checks the ten-foot rules on the current screen:
 *  - every visible text is at least 28 px at 1080p (scaled with the viewport height)
 *  - text contrast at least 7:1 against its effective background
 *  - text and focusable elements stay inside the 5% safe area (focus scale removed)
 *  - the focused element is scaled and ringed (not colour alone)
 *  - no scrollbars / scrollable overflow, no :hover rules, pointer hidden
 */
export async function tenFootAudit(page: Page): Promise<Audit> {
  return page.evaluate(() => {
    const violations: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = vh / 1080;

    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        // color(srgb r g b / a) or oklab: fall back to a probe element.
        const probe = document.createElement("div");
        probe.style.color = c;
        document.body.appendChild(probe);
        const cc = getComputedStyle(probe).color;
        probe.remove();
        const m2 = cc.match(/rgba?\(([^)]+)\)/);
        if (!m2) return [0, 0, 0, 0];
        const p2 =
          m2[1]
            ?.split(/[,\s/]+/)
            .filter(Boolean)
            .map(Number) ?? [];
        return [p2[0] ?? 0, p2[1] ?? 0, p2[2] ?? 0, p2[3] ?? 1];
      }
      const p =
        m[1]
          ?.split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number) ?? [];
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    // Normalise any CSS colour (oklch etc.) to rgba via canvas.
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const rgba = (c: string): [number, number, number, number] => {
      if (c === "transparent" || c === "rgba(0, 0, 0, 0)") return [0, 0, 0, 0];
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = c;
      const alpha = parse(c)[3];
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      // getImageData premultiplies against nothing; recover straight colour.
      const a = (d[3] ?? 255) / 255;
      return a === 0
        ? [0, 0, 0, 0]
        : [(d[0] ?? 0) / a, (d[1] ?? 0) / a, (d[2] ?? 0) / a, Number.isFinite(alpha) ? alpha : a];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
    };
    const over = (top: number[], bottom: number[]) => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (bottom[i] ?? 0) * (1 - a)).concat(1);
    };
    const backgroundOf = (el: Element): number[] => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.push(e);
      let bg: number[] = rgba(getComputedStyle(document.body).backgroundColor);
      for (const e of chain.reverse()) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if ((c[3] ?? 0) > 0) bg = over(c, bg);
      }
      return bg;
    };
    const visibleRect = (el: Element): DOMRect | null => {
      let r = el.getBoundingClientRect();
      let x1 = r.left;
      let y1 = r.top;
      let x2 = r.right;
      let y2 = r.bottom;
      for (let e = el.parentElement; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
          r = e.getBoundingClientRect();
          x1 = Math.max(x1, r.left);
          y1 = Math.max(y1, r.top);
          x2 = Math.min(x2, r.right);
          y2 = Math.min(y2, r.bottom);
        }
      }
      if (x2 - x1 < 1 || y2 - y1 < 1) return null;
      return new DOMRect(x1, y1, x2 - x1, y2 - y1);
    };
    const inSafe = (r: DOMRect) =>
      r.left >= vw * 0.05 - 1 &&
      r.top >= vh * 0.05 - 1 &&
      r.right <= vw * 0.95 + 1 &&
      r.bottom <= vh * 0.95 + 1;
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${(el as HTMLElement).dataset.focusKey ? `[${(el as HTMLElement).dataset.focusKey}]` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;

    // Focus indicator.
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.dataset.focused !== "true" || !focused) violations.push("no focused element");
    else {
      const cs = getComputedStyle(focused);
      const m = cs.transform.match(/matrix\(([^,]+)/);
      const sx = m ? Number(m[1]) : 1;
      if (!(sx > 1.01)) violations.push(`focused element is not scaled up (${cs.transform})`);
      if (cs.boxShadow === "none") violations.push("focused element has no ring");
    }

    // Remove focus scale for geometry checks.
    const neutral = document.createElement("style");
    neutral.textContent = "[data-focused='true']{transform:none !important;transition:none !important}";
    document.head.appendChild(neutral);

    let checkedText = 0;
    let minFontPx = Number.POSITIVE_INFINITY;
    let minContrast = Number.POSITIVE_INFINITY;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent ?? "").trim()) continue;
      seen.add(el);
      if (el.closest("[aria-hidden='true'][data-decorative]")) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      const vr = visibleRect(el);
      if (!vr) continue;
      checkedText++;
      const fs = Number.parseFloat(cs.fontSize);
      minFontPx = Math.min(minFontPx, fs / scale);
      if (fs < 28 * scale - 0.5)
        violations.push(`font ${fs.toFixed(1)}px < ${(28 * scale).toFixed(1)}px: ${describe(el)}`);
      const fg = rgba(cs.color);
      const bg = backgroundOf(el);
      const fgOnBg = over(fg, bg);
      const L1 = lum(fgOnBg);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      minContrast = Math.min(minContrast, ratio);
      if (ratio < 7) violations.push(`contrast ${ratio.toFixed(2)}:1 < 7:1: ${describe(el)}`);
      if (!inSafe(vr)) violations.push(`text outside the safe area: ${describe(el)} ${JSON.stringify(vr)}`);
    }
    for (const el of document.querySelectorAll("[data-focus-key]")) {
      const vr = visibleRect(el);
      if (vr && !inSafe(vr)) violations.push(`focusable outside the safe area: ${describe(el)}`);
    }
    neutral.remove();

    // No scrollbars or scrollable overflow; no hover rules; pointer hidden.
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth || de.scrollHeight > de.clientHeight) violations.push("page scrolls");
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (["auto", "scroll"].includes(cs.overflowX) || ["auto", "scroll"].includes(cs.overflowY))
        violations.push(`scrollable overflow: ${describe(el)}`);
    }
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const walk = (list: CSSRuleList) => {
        for (const r of list) {
          if ("selectorText" in r && /:hover/.test((r as CSSStyleRule).selectorText))
            violations.push(`hover rule: ${(r as CSSStyleRule).selectorText}`);
          if ("cssRules" in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
        }
      };
      walk(rules);
    }
    if (getComputedStyle(document.body).cursor !== "none") violations.push("pointer cursor is visible");
    const bodyBg = rgba(getComputedStyle(document.body).backgroundColor);
    if (lum(bodyBg) > 0.05) violations.push("theme is not dark");

    return { violations, checkedText, minFontPx, minContrast };
  });
}
