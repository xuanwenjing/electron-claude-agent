/**
 * 对齐 wormhole handleGenericTaskCollect 编排（去登录/平台等业务）
 */
import type {
  Collector,
  EmitFn,
  WorkflowConfig,
  WorkflowItem,
  WorkflowResult,
} from "./types";
import { handleApiFetch } from "./api";
import { handleCallBackend } from "./ourBackend";
import { handleRunAgent } from "./agent";
import {
  acquireCrawlTab,
  assertSiteAllowed,
  blockedOriginOf,
  describePage,
  ensureContentReady,
  ensurePageFetchProxy,
  getOrCreateCrawlWindow,
  navigateCrawlTab,
  pageLoadProblem,
  removeTab,
  removeTabByUrlInWindow,
  sendContentTask,
  waitTabComplete,
} from "./browser";
import {
  createCollector,
  clearNetworkCaptureContext,
  describeCaptureMiss,
  getCaptureHits,
  setNetworkCaptureContext,
} from "./collect";
import { tryAutoLogin } from "./autoLogin";
import { OutletMismatchError, assertBoundOutlet } from "./boundOutlet";
import {
  HOTEL_INFO_KEY,
  NotLoggedInError,
  assertLoggedIn,
  collectHotelInfo,
  getMissingLoginPlatform,
  loginPageError,
  type HotelInfoResult,
} from "./hotelInfo";
import type { CancelToken } from "./util";
import { TaskCancelledError, cancellableSleep, resolveMaybeExpr, safeEval } from "./util";
import { TaskErrorCode } from "../../../src/shared/bridgeProtocol";
import { applyStepOutputs, assertVarName, validateStepVariables } from "./variables";
import { TaskKind, classifyWorkflow } from "./taskKind";

/** 没有 capture 的步骤，动作后固定等待 */
const IDLE_WAIT_MS = 3000;
/** 有 capture 的步骤，等待全部命中的默认超时 */
const NAVIGATE_CAPTURE_TIMEOUT_MS = 15000;
const CAPTURE_TIMEOUT_MS = 10000;
const CAPTURE_POLL_MS = 300;

function stepLabel(item: WorkflowItem): string {
  return `${item.type}${item.name ? ` ${item.name}` : ""}`;
}

export async function runWorkflow(
  config: WorkflowConfig,
  emit: EmitFn,
  token?: CancelToken | null,
  taskId?: string,
): Promise<WorkflowResult> {
  let kind: TaskKind;
  try {
    kind = classifyWorkflow(config);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emit(error);
    return { ok: false, error, errorCode: TaskErrorCode.InvalidTask, data: null };
  }
  const isBrowser = kind === TaskKind.Browser;
  const maxRetry = Math.max(1, Number(config.maxRetry) || 3);
  let lastError: string | null = null;
  let lastErrorCode: TaskErrorCode = TaskErrorCode.WorkflowFailed;

  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    if (token?.cancelled) {
      return { ok: false, error: "任务已取消", errorCode: TaskErrorCode.Cancelled, data: null };
    }

    const collector = createCollector();
    let windowId: number | null = null;
    let tabId: number | null = null;
    /** 任务标签页 / 采集窗口被关闭：立即结束本次尝试，进入重试（重新建窗口和标签页） */
    let closedTabId: number | null = null;
    const onTabRemoved = (id: number) => {
      if (id === tabId) closedTabId = id;
    };
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    /** 已绑定捕获上下文的标签；navigate 可能换标签，换了要清掉旧的 */
    let captureTabId: number | null = null;
    const bindCapture = (workflowItem: WorkflowItem): void => {
      if (tabId == null) return;
      if (captureTabId != null && captureTabId !== tabId) clearNetworkCaptureContext(captureTabId);
      captureTabId = tabId;
      setNetworkCaptureContext({ tabId, workflowItem, collector, emit });
    };
    const stepToken: CancelToken = {
      get cancelled() {
        return !!token?.cancelled || closedTabId != null;
      },
      cancel: () => token?.cancel(),
    };
    try {
      emit(`第 ${attempt}/${maxRetry} 次尝试（${isBrowser ? "浏览器任务" : "非浏览器任务"}）`);
      const workflow = config.workflow!;

      if (isBrowser) {
        const crawlWindow = await getOrCreateCrawlWindow();
        windowId = crawlWindow.windowId;
        emit(crawlWindow.note);
        // 对齐 createTaskStore：任务开始先建空白工作标签，一任务绑定一标签
        const blank = await acquireCrawlTab(windowId);
        tabId = blank.id!;
        await waitTabComplete(tabId, emit);
        emit(`采集窗口 windowId=${windowId}，任务标签 tabId=${tabId}（首标签保活；结束后关闭任务标签）`);
      }

      /** 动作后：有 capture 则等到本步全部命中（超时失败），没有则固定等待 */
      const waitAfterAction = async (workflowItem: WorkflowItem, captureTimeoutMs: number): Promise<void> => {
        const configured =
          workflowItem.wait == null || workflowItem.wait === ""
            ? undefined
            : Number(resolveMaybeExpr(collector.variables, workflowItem.wait));
        const names = Object.keys(workflowItem.capture ?? {});
        if (!names.length || tabId == null) {
          await cancellableSleep(configured ?? IDLE_WAIT_MS, stepToken);
          return;
        }
        const timeoutMs = configured ?? captureTimeoutMs;
        const deadline = Date.now() + timeoutMs;
        const missing = () => names.filter((name) => !getCaptureHits(tabId!).has(name));
        while (missing().length && Date.now() < deadline) {
          await cancellableSleep(CAPTURE_POLL_MS, stepToken);
        }
        const left = missing();
        if (!left.length) return;
        const message = `${timeoutMs / 1000}s 内未捕获到 ${left.map((name) => `${name}（${workflowItem.capture![name]}）`).join("、")}`;
        emit(`[capture 排查] ${message}`);
        const missingRules = Object.fromEntries(left.map((name) => [name, workflowItem.capture![name]]));
        for (const line of describeCaptureMiss(tabId, missingRules)) emit(`[capture 排查] ${line}`);
        emit(`[capture 排查] ${await describePage(tabId)}`);
        if (!workflowItem.allow_exception) throw new Error(message);
        emit(`忽略异常: ${message}`);
      };

      const runStep = async (workflowItem: WorkflowItem): Promise<void> => {
        if (stepToken.cancelled) throw new TaskCancelledError();
        emit(`步骤 ${stepLabel(workflowItem)}`);
        validateStepVariables(workflowItem);
        bindCapture(workflowItem);
        let stepResult: unknown;

        if (workflowItem.type === "navigate") {
          if (!workflowItem.url) throw new Error("任务采集页面URL不能为空");
          const url = String(resolveMaybeExpr(collector.variables, workflowItem.url));
          emit(`正在打开任务采集页面: ${url}`);

          if (tabId == null) throw new Error("任务标签未创建");
          await assertSiteAllowed(url);
          const openPage = async (): Promise<HotelInfoResult> => {
            const navigatedAt = Date.now();
            const navigated = await navigateCrawlTab(tabId!, url);
            tabId = navigated.id!;
            bindCapture(workflowItem);
            await waitTabComplete(tabId, emit);
            const loadProblem = await pageLoadProblem(tabId);
            if (loadProblem) throw new Error(loadProblem);
            await ensureContentReady(tabId);
            await ensurePageFetchProxy(tabId);
            return collectHotelInfo(tabId, collector, emit, navigatedAt);
          };

          let hotelInfo = await openPage();
          let autoLoginError: string | undefined;
          const missingLogin = getMissingLoginPlatform(config, url, hotelInfo);
          if (missingLogin) {
            const login = await tryAutoLogin(tabId, missingLogin, emit);
            if (login.success) {
              emit("自动登录成功，重新打开任务采集页面");
              hotelInfo = await openPage();
            } else {
              autoLoginError = login.errorMessage;
              emit(`自动登录失败: ${login.errorMessage}`);
            }
          }
          assertLoggedIn(config, url, hotelInfo, autoLoginError);
          assertBoundOutlet(config.external_outlets, collector.variables[HOTEL_INFO_KEY]);
          await waitAfterAction(workflowItem, NAVIGATE_CAPTURE_TIMEOUT_MS);
        } else if (workflowItem.type === "call_api") {
          stepResult = await handleApiFetch(tabId, collector, workflowItem, emit, stepToken);
          await waitAfterAction(workflowItem, CAPTURE_TIMEOUT_MS);
        } else if (workflowItem.type === "call_backend") {
          stepResult = await handleCallBackend(collector, workflowItem, emit);
        } else if (workflowItem.type === "click") {
          if (tabId == null) throw new Error("click 前需要先 navigate");
          const commonTaskRes = await sendContentTask(tabId, workflowItem);
          if (!commonTaskRes?.success) {
            if (workflowItem.allow_exception) {
              emit(`忽略异常: ${commonTaskRes?.errorMessage || "unknown"}`);
            } else {
              throw new Error(commonTaskRes?.errorMessage || "click 失败");
            }
          }
          await waitAfterAction(workflowItem, CAPTURE_TIMEOUT_MS);
        } else if (workflowItem.type === "run_agent") {
          stepResult = await handleRunAgent(collector, workflowItem, emit, { taskId, token: stepToken });
        } else if (workflowItem.type === "loop") {
          await runLoop(workflowItem);
          return;
        } else {
          throw new Error(`不支持的步骤类型: ${workflowItem.type}`);
        }

        if (workflowItem.close_tab_before_finish) {
          await removeTabByUrlInWindow(windowId, workflowItem.close_tab_before_finish);
        }
        if (workflowItem.wait_before_finish != null) {
          await cancellableSleep(Number(workflowItem.wait_before_finish), stepToken);
        }

        applyStepOutputs(collector, workflowItem, stepResult, emit);

        if (workflowItem.pass_condition) {
          const ok = !!safeEval(collector.variables, workflowItem.pass_condition);
          if (!ok) throw new Error(`pass_condition 未通过: ${workflowItem.pass_condition}`);
        }
      };

      const runLoop = async (loopItem: WorkflowItem): Promise<void> => {
        validateStepVariables(loopItem);
        const children = Array.isArray(loopItem.children) ? loopItem.children : [];
        const vars = collector.variables;

        let items: unknown[] | null = null;
        if (loopItem.list !== undefined) {
          const listValue = resolveMaybeExpr(vars, loopItem.list);
          if (listValue != null && !Array.isArray(listValue)) {
            throw new Error(`[loop] list 不是数组: ${String(loopItem.list)}`);
          }
          items = Array.isArray(listValue) ? [...listValue] : [];
        }

        let maxCount: number;
        if (loopItem.max_count === undefined || loopItem.max_count === "") {
          maxCount = items ? items.length : 0;
        } else {
          maxCount = Number(resolveMaybeExpr(vars, loopItem.max_count)) || 0;
          if (items) maxCount = Math.min(maxCount, items.length);
        }
        if (!children.length || maxCount <= 0) {
          emit("loop 跳过：children 为空或循环次数为 0");
          return;
        }

        const indexVar = loopItem.index_var ? assertVarName(loopItem.index_var, "index_var") : "_index";
        const itemVar = items
          ? loopItem.item_var
            ? assertVarName(loopItem.item_var, "item_var")
            : "_item"
          : null;
        const scopedVars = itemVar ? [indexVar, itemVar] : [indexVar];
        const saved = scopedVars.map((name) => ({
          name,
          had: Object.prototype.hasOwnProperty.call(vars, name),
          value: vars[name],
        }));

        emit(
          items
            ? `遍历 list，共 ${maxCount} 项（${indexVar} / ${itemVar}）`
            : `循环最大次数 max_count=${maxCount}`,
        );
        try {
          for (let i = 0; i < maxCount; i++) {
            if (stepToken.cancelled) throw new TaskCancelledError();
            vars[indexVar] = i;
            if (items && itemVar) vars[itemVar] = items[i];
            emit(`循环 ${i + 1}/${maxCount}, ${indexVar}=${i}`);
            collector.loopPath.push(i);
            try {
              for (const child of children) {
                await runItem(child);
              }
            } finally {
              collector.loopPath.pop();
            }
            if (loopItem.break_condition) {
              let stop = false;
              try {
                stop = !!safeEval(vars, loopItem.break_condition);
              } catch (error) {
                throw new Error(
                  `[loop] break_condition 求值失败: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
              }
              if (stop) {
                emit(`循环提前结束: ${loopItem.break_condition}`);
                break;
              }
            }
          }
        } finally {
          for (const { name, had, value } of saved) {
            if (had) vars[name] = value;
            else delete vars[name];
          }
        }
      };

      const runItem = async (item: WorkflowItem): Promise<void> => {
        if (item.skip_if) {
          let skip: boolean;
          try {
            skip = !!safeEval(collector.variables, item.skip_if);
          } catch (error) {
            throw new Error(`skip_if 求值失败: ${error instanceof Error ? error.message : String(error)}`);
          }
          if (skip) {
            emit(`跳过 ${stepLabel(item)}: ${item.skip_if}`);
            return;
          }
        }
        if (item.type === "loop") return runLoop(item);
        return runStep(item);
      };

      for (const item of workflow) {
        await runItem(item);
      }

      emit("采集完成");
      return {
        ok: true,
        data: { variables: collector.variables },
      };
    } catch (err) {
      if (token?.cancelled || (err instanceof TaskCancelledError && closedTabId == null)) {
        emit("任务已取消");
        return { ok: false, error: "任务已取消", errorCode: TaskErrorCode.Cancelled, data: null };
      }
      const blockedOrigin = closedTabId != null ? null : await blockedOriginOf(err, tabId);
      if (blockedOrigin) {
        const error = `浏览器已设置不允许在 ${blockedOrigin} 使用扩展`;
        emit(error);
        return { ok: false, error, errorCode: TaskErrorCode.SiteBlocked, blockedOrigin, data: null };
      }
      if (err instanceof OutletMismatchError) {
        emit(err.message);
        return {
          ok: false,
          error: err.message,
          errorCode: TaskErrorCode.OutletMismatch,
          data: null,
        };
      }
      const notLoggedIn =
        closedTabId != null ? null : err instanceof NotLoggedInError ? err : await loginPageError(tabId);
      if (notLoggedIn) {
        if (!(err instanceof NotLoggedInError)) {
          emit(`步骤失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        emit(notLoggedIn.message);
        return { ok: false, error: notLoggedIn.message, errorCode: TaskErrorCode.NotLoggedIn, data: null };
      }
      if (closedTabId != null) {
        lastError = `任务标签页被关闭（tabId=${closedTabId}）`;
        lastErrorCode = TaskErrorCode.TabClosed;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
        lastErrorCode = TaskErrorCode.WorkflowFailed;
      }
      emit(`失败(${attempt}/${maxRetry}): ${lastError}${attempt < maxRetry ? (isBrowser ? "，重新打开标签页重试" : "，重试") : ""}`);
      if (attempt < maxRetry) await cancellableSleep(1000 * attempt, token);
    } finally {
      chrome.tabs.onRemoved.removeListener(onTabRemoved);
      if (captureTabId != null) clearNetworkCaptureContext(captureTabId);
      // 对齐 stopCrawlTask：关掉任务绑定的工作标签
      if (tabId != null && closedTabId == null) {
        emit(`关闭任务标签 tabId=${tabId}`);
        await removeTab(tabId);
        tabId = null;
      }
    }
  }

  return { ok: false, error: lastError || "未知错误", errorCode: lastErrorCode, data: null };
}
