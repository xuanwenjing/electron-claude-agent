/**
 * 对齐 wormhole taskExecutor + customCrawler（realClick / type / check / clickable）
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitForSelector(
  selector: string,
  options: { timeout?: number } = {},
): Promise<Element | null> {
  const timeout = options.timeout ?? 20000;
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeout) {
        resolve(null);
        return;
      }
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

/** 多 selector（逗号分隔），对齐 taskExecutor.getElement */
export async function getElement(
  selector: string,
  timeout = 20000,
): Promise<{ element: Element; elementSelector: string }> {
  if (!selector) throw new Error("selector 不能为空");
  const selectorArray = selector.split(",").map((item) => item.trim()).filter(Boolean);
  let element: Element | null = null;
  let elementSelector = "";
  for (const sel of selectorArray) {
    element = await waitForSelector(sel, { timeout });
    if (element) {
      elementSelector = sel;
      break;
    }
  }
  if (!element) {
    throw new Error(`${selectorArray.join(",")} 元素不存在，页面URL: ${window.location.href}`);
  }
  return { element, elementSelector };
}

export function isElementClickable(element: HTMLElement): { clickable: boolean; reason?: string } {
  if (!element || !document.body.contains(element)) {
    return { clickable: false, reason: "元素不存在或已从DOM中移除" };
  }
  if ((element as HTMLButtonElement).disabled || element.getAttribute("disabled") !== null) {
    return { clickable: false, reason: "元素被禁用（disabled）" };
  }
  if (element.getAttribute("aria-disabled") === "true") {
    return { clickable: false, reason: "元素被禁用（aria-disabled）" };
  }
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    (element.offsetWidth === 0 && element.offsetHeight === 0)
  ) {
    return { clickable: false, reason: "元素不可见" };
  }
  if (style.pointerEvents === "none") {
    return { clickable: false, reason: "元素禁止了指针事件（pointer-events: none）" };
  }
  const loadingIndicators = ["loading", "disabled", "inactive"];
  const className = element.className?.toString().toLowerCase() || "";
  if (loadingIndicators.some((indicator) => className.includes(indicator))) {
    return { clickable: false, reason: "元素处于加载或禁用状态" };
  }
  return { clickable: true };
}

/** 对齐 customCrawler.realClick */
export function realClick(el: HTMLElement): boolean {
  if (!el) return false;
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const seq: Event[] = [
    new PointerEvent("pointerover", {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
    }),
    new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }),
    new PointerEvent("pointerdown", {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      buttons: 1,
    }),
    new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y, buttons: 1 }),
    new PointerEvent("pointerup", {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
    }),
    new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }),
    new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
  ];
  for (const e of seq) el.dispatchEvent(e);
  return true;
}

export function triggerInputEvent(element: HTMLInputElement | HTMLTextAreaElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event("keyup", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event("keydown", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event("keypress", { bubbles: true, cancelable: true }));
}

/** 对齐 customCrawler.type（不含 React MAIN 桥，原生事件链已对齐） */
export async function typeText(
  selectorOrElement: string | Element,
  text: string,
): Promise<void> {
  const element =
    typeof selectorOrElement === "string"
      ? await waitForSelector(selectorOrElement)
      : selectorOrElement;
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new Error("type 仅支持输入框元素（input 或 textarea）");
  }
  element.focus();
  element.value = text;
  triggerInputEvent(element);
}

export async function checkCheckbox(
  selectorOrElement: string | Element,
  value: boolean,
): Promise<void> {
  const element =
    typeof selectorOrElement === "string"
      ? await waitForSelector(selectorOrElement)
      : selectorOrElement;
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("check 仅支持 input 元素");
  }
  element.checked = value;
  triggerInputEvent(element);
}

export async function handleClickTask(opts: {
  selector?: string;
  recycle_count?: number;
  timeout?: number;
}): Promise<{ success: boolean; data?: string; errorMessage?: string }> {
  const { selector, recycle_count, timeout } = opts;
  if (!selector) throw new Error("selector 不能为空");

  if (recycle_count && recycle_count > 0) {
    for (let i = 0; i < recycle_count; i++) {
      const { element } = await getElement(selector, timeout);
      const clickableCheck = isElementClickable(element as HTMLElement);
      if (!clickableCheck.clickable) {
        return {
          success: true,
          data: `元素不可点击，停止循环。原因: ${clickableCheck.reason}`,
        };
      }
      realClick(element as HTMLElement);
      // 对齐原版：random * 1000 + 4000
      await sleep(Math.random() * 1000 + 4000);
    }
    return { success: true, data: `点击成功 ${recycle_count} 次` };
  }

  const { element } = await getElement(selector, timeout);
  realClick(element as HTMLElement);
  return { success: true, data: "点击成功 1 次" };
}

export async function handleInputTask(opts: {
  selector?: string;
  value?: unknown;
  timeout?: number;
}): Promise<{ success: boolean; data?: string }> {
  const { element } = await getElement(opts.selector || "", opts.timeout);
  await typeText(element, String(opts.value ?? ""));
  return { success: true, data: "input ok" };
}

export async function handleTextTask(opts: {
  selector?: string;
  timeout?: number;
}): Promise<{ success: boolean; data?: string }> {
  const { element } = await getElement(opts.selector || "", opts.timeout);
  return {
    success: true,
    data: (element as HTMLElement).innerText || element.textContent || "",
  };
}

export async function handleCheckTask(opts: {
  selector?: string;
  value?: unknown;
  timeout?: number;
}): Promise<{ success: boolean; data?: string }> {
  const { element } = await getElement(opts.selector || "", opts.timeout);
  const checked = opts.value === true || opts.value === "true" || opts.value === 1 || opts.value === "1";
  await checkCheckbox(element, checked);
  return { success: true, data: `checkbox[${checked}]选中成功` };
}
