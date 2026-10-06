/**
 * Deterministic scrolling for the focused element (no scroll bars, no pointer).
 *  - The nearest `[data-scroll-x]` ancestor scrolls horizontally so the element is fully visible.
 *  - The nearest `[data-scroll-y]` ancestor scrolls vertically so the element's nearest
 *    `[data-scroll-anchor]` (a whole section or tile with caption) is fully visible, or, with
 *    `data-scroll-y="start"`, aligned to the top.
 * A margin leaves room for the focus ring and scale.
 */
const MARGIN_REM = 1.5;

function rem(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export function revealFocused(el: HTMLElement): void {
  const margin = MARGIN_REM * rem();
  const sx = el.closest<HTMLElement>("[data-scroll-x]");
  if (sx) {
    const c = sx.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < c.left + margin) sx.scrollLeft -= c.left + margin - r.left;
    else if (r.right > c.right - margin) sx.scrollLeft += r.right - (c.right - margin);
  }
  const sy = el.closest<HTMLElement>("[data-scroll-y]");
  if (sy) {
    const anchor = el.closest<HTMLElement>("[data-scroll-anchor]") ?? el;
    const c = sy.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    // data-scroll-y="start": the focused anchor always moves to the top (Watch rows).
    if (sy.dataset.scrollY === "start") sy.scrollTop += r.top - c.top;
    else if (r.top < c.top + margin) sy.scrollTop -= c.top + margin - r.top;
    else if (r.bottom > c.bottom - margin) sy.scrollTop += r.bottom - (c.bottom - margin);
  }
}
