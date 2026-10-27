/**
 * 采集页面关键 DOM（可交互元素 + 标题），并生成尽量稳定的 CSS selector，
 * 供后续 click / input 使用。
 */

import { isElementClickable } from "./dom";

export type DomSnapshotItem = {
  selector: string;
  tag: string;
  text: string;
  role?: string;
  attrs: Record<string, string>;
  visible: boolean;
  clickable: boolean;
};

export type DomSnapshotResult = {
  url: string;
  title: string;
  count: number;
  truncated: boolean;
  elements: DomSnapshotItem[];
};

const DEFAULT_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[contenteditable='true']",
  "[he-click]",
  "[onclick]",
  "[data-testid]",
  "[data-test-id]",
  "[data-qa]",
  "h1",
  "h2",
  "h3",
  "label",
].join(",");

const ATTR_PRIORITY = [
  "data-testid",
  "data-test-id",
  "data-qa",
  "data-id",
  "he-click",
  "aria-label",
  "name",
  "placeholder",
  "title",
  "type",
  "role",
  "href",
] as const;

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function attrSel(name: string, value: string): string {
  return `[${name}="${escapeAttrValue(value)}"]`;
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (!document.body.contains(el)) return false;
  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function shortText(el: Element, max = 80): string {
  const raw =
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value || el.placeholder || el.getAttribute("aria-label") || ""
      : (el as HTMLElement).innerText || el.textContent || "") || "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

function pickAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ATTR_PRIORITY) {
    const v = el.getAttribute(name);
    if (v) out[name] = v.slice(0, 120);
  }
  if (el.id) out.id = el.id.slice(0, 120);
  const cls = typeof el.className === "string" ? el.className.trim() : "";
  if (cls) out.class = cls.split(/\s+/).slice(0, 4).join(" ");
  return out;
}

/** 生成尽量短且唯一的 selector */
export function buildCssSelector(el: Element): string {
  if (el.id) {
    const idSel = `#${CSS.escape(el.id)}`;
    if (isUnique(idSel)) return idSel;
  }

  for (const name of [
    "data-testid",
    "data-test-id",
    "data-qa",
    "data-id",
    "he-click",
  ] as const) {
    const v = el.getAttribute(name);
    if (!v) continue;
    const sel = attrSel(name, v);
    if (isUnique(sel)) return sel;
  }

  const aria = el.getAttribute("aria-label");
  if (aria) {
    const sel = `${el.tagName.toLowerCase()}${attrSel("aria-label", aria)}`;
    if (isUnique(sel)) return sel;
  }

  const name = el.getAttribute("name");
  if (name) {
    const sel = `${el.tagName.toLowerCase()}${attrSel("name", name)}`;
    if (isUnique(sel)) return sel;
  }

  const placeholder = el.getAttribute("placeholder");
  if (placeholder) {
    const sel = `${el.tagName.toLowerCase()}${attrSel("placeholder", placeholder)}`;
    if (isUnique(sel)) return sel;
  }

  if (el instanceof HTMLElement && el.classList.length > 0) {
    const classes = Array.from(el.classList)
      .filter((c) => c && !/^\d/.test(c) && c.length < 40)
      .slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    if (classes) {
      const sel = `${el.tagName.toLowerCase()}${classes}`;
      if (isUnique(sel)) return sel;
    }
  }

  // 短路径：父级带稳定属性时拼一层
  const parent = el.parentElement;
  if (parent && parent !== document.body) {
    let parentSel = "";
    if (parent.id && isUnique(`#${CSS.escape(parent.id)}`)) {
      parentSel = `#${CSS.escape(parent.id)}`;
    } else {
      for (const name of ["data-testid", "he-click", "data-qa"] as const) {
        const v = parent.getAttribute(name);
        if (v && isUnique(attrSel(name, v))) {
          parentSel = attrSel(name, v);
          break;
        }
      }
    }
    if (parentSel) {
      const tag = el.tagName.toLowerCase();
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = siblings.indexOf(el) + 1;
      const sel =
        siblings.length > 1
          ? `${parentSel} > ${tag}:nth-of-type(${idx})`
          : `${parentSel} > ${tag}`;
      if (isUnique(sel)) return sel;
    }
  }

  // 兜底：有限深度 nth-of-type 路径
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== document.body && depth < 5) {
    const tag = cur.tagName.toLowerCase();
    const parentEl: Element | null = cur.parentElement;
    if (!parentEl) break;
    const siblings = Array.from(parentEl.children).filter((c) => c.tagName === cur!.tagName);
    const idx = siblings.indexOf(cur) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    cur = parentEl;
    depth += 1;
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}

function collectCandidates(selector: string): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  const parts = selector.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = document.querySelectorAll(part);
    } catch {
      continue;
    }
    Array.from(nodes).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      out.push(el);
    });
  }
  return out;
}

export function handleDomSnapshotTask(opts: {
  selector?: string;
  max_count?: number | string;
}): { success: boolean; data?: DomSnapshotResult; errorMessage?: string } {
  const maxCount = Math.min(
    200,
    Math.max(1, Number(opts.max_count) || 60),
  );
  const selector =
    typeof opts.selector === "string" && opts.selector.trim()
      ? opts.selector.trim()
      : DEFAULT_SELECTOR;

  const candidates = collectCandidates(selector);
  const scored = candidates.map((el, order) => {
    const vis = visible(el);
    const clickable =
      el instanceof HTMLElement ? isElementClickable(el).clickable : false;
    const text = shortText(el);
    // 可见/可点/有文案优先
    const score = (vis ? 4 : 0) + (clickable ? 2 : 0) + (text ? 1 : 0);
    return { el, order, vis, clickable, text, score };
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  const truncated = scored.length > maxCount;
  const picked = scored.slice(0, maxCount);
  const elements: DomSnapshotItem[] = picked.map(({ el, vis, clickable, text }) => {
    const role = el.getAttribute("role") || undefined;
    return {
      selector: buildCssSelector(el),
      tag: el.tagName.toLowerCase(),
      text,
      ...(role ? { role } : {}),
      attrs: pickAttrs(el),
      visible: vis,
      clickable,
    };
  });

  return {
    success: true,
    data: {
      url: location.href,
      title: document.title || "",
      count: elements.length,
      truncated,
      elements,
    },
  };
}
