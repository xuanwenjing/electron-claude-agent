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
import { handleCallBackend, handleCallBot } from "./ourBackend";
import {
  acquireCrawlTab,
  ensureContentReady,
  ensurePageFetchProxy,
  getOrCreateCrawlWindow,
  navigateCrawlTab,
  removeTab,
  removeTabByUrlInWindow,
  sendContentTask,
  waitTabComplete,
} from "./browser";
import {
  createCollector,
  isDataComplete,
  updateTextData,
  clearNetworkCaptureContext,
  setNetworkCaptureContext,
} from "./collect";
import { NotLoggedInError, assertLoggedIn, collectHotelInfo } from "./hotelInfo";
import type { CancelToken } from "./util";
import { TaskCancelledError, cancellableSleep, resolveMaybeExpr, safeEval } from "./util";

/** 对齐 common.ts：默认等待与 wait_before_finish 叠加 */
async function runDefaultWait(
  workflowItem: WorkflowItem,
  needCollectMs: number,
  idleMs: number,
  token?: CancelToken | null,
): Promise<void> {
  await cancellableSleep(workflowItem.need_collect ? needCollectMs : idleMs, token);
}

function bindCapture(
  tabId: number | null,
  workflowItem: WorkflowItem,
  collector: Collector,
  emit: EmitFn,
): void {
  setNetworkCaptureContext({ tabId, workflowItem, collector, emit });
}

export async function runWorkflow(
  config: WorkflowConfig,
  emit: EmitFn,
  token?: CancelToken | null,
): Promise<WorkflowResult> {
  const maxRetry = Math.max(1, Number(config.maxRetry) || 3);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    if (token?.cancelled) {
      return { ok: false, error: "任务已取消", data: null };
    }

    const collector = createCollector();
    let windowId: number | null = null;
    let tabId: number | null = null;
    try {
      emit(`第 ${attempt}/${maxRetry} 次尝试`);
      const workflow = Array.isArray(config.workflow) ? config.workflow : [];
      if (!workflow.length) throw new Error("workflow 为空");

      windowId = await getOrCreateCrawlWindow();
      // 对齐 createTaskStore：任务开始先建空白工作标签，一任务绑定一标签
      const blank = await acquireCrawlTab(windowId);
      tabId = blank.id!;
      await waitTabComplete(tabId, emit);
      emit(`采集窗口 windowId=${windowId}，任务标签 tabId=${tabId}（首标签保活；结束后关闭任务标签）`);

      const runStep = async (workflowItem: WorkflowItem): Promise<void> => {
        if (token?.cancelled) throw new TaskCancelledError();
        emit(`步骤 ${workflowItem.type}: ${workflowItem.event || ""}`);
        bindCapture(tabId, workflowItem, collector, emit);

        if (workflowItem.type === "navigate") {
          if (!workflowItem.url) throw new Error("任务采集页面URL不能为空");
          const url = String(resolveMaybeExpr(collector.variables, workflowItem.url));
          emit(`正在打开任务采集页面: ${url}`);

          if (tabId == null) throw new Error("任务标签未创建");
          const navigated = await navigateCrawlTab(tabId, url);
          tabId = navigated.id!;
          bindCapture(tabId, workflowItem, collector, emit);

          await waitTabComplete(tabId, emit);
          await ensureContentReady(tabId);
          await ensurePageFetchProxy(tabId);
          const hotelInfo = await collectHotelInfo(tabId, collector, emit);
          assertLoggedIn(config, url, hotelInfo);
          await runDefaultWait(workflowItem, 15000, 3000, token);
        } else if (workflowItem.type === "call_api") {
          await handleApiFetch(tabId, collector, workflowItem, emit, token);
          await runDefaultWait(workflowItem, 5000, 3000, token);
        } else if (workflowItem.type === "call_bot") {
          await handleCallBot(collector, workflowItem, emit, token);
        } else if (workflowItem.type === "call_backend") {
          await handleCallBackend(collector, workflowItem, emit);
        } else if (
          workflowItem.type === "click" ||
          workflowItem.type === "text" ||
          workflowItem.type === "input" ||
          workflowItem.type === "check" ||
          workflowItem.type === "dom_snapshot"
        ) {
          if (tabId == null) throw new Error(`${workflowItem.type} 前需要先 navigate`);
          const item: WorkflowItem = {
            ...workflowItem,
            value:
              workflowItem.value !== undefined
                ? resolveMaybeExpr(collector.variables, workflowItem.value)
                : workflowItem.value,
          };
          const commonTaskRes = await sendContentTask(tabId, item);
          if (!commonTaskRes?.success) {
            if (workflowItem.allow_exception) {
              emit(`忽略异常: ${commonTaskRes?.errorMessage || "unknown"}`);
            } else {
              throw new Error(commonTaskRes?.errorMessage || `${workflowItem.type} 失败`);
            }
          } else {
            updateTextData(collector, workflowItem, commonTaskRes.data);
          }
          await runDefaultWait(workflowItem, 10000, 3000, token);
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
          await cancellableSleep(Number(workflowItem.wait_before_finish), token);
        }

        const complete = await isDataComplete(collector, workflowItem, tabId);
        if (!complete.success) {
          if (workflowItem.allow_exception) {
            emit(`忽略异常: ${complete.errorMessage}`);
          } else {
            throw new Error(complete.errorMessage);
          }
        }

        if (workflowItem.pass_condition) {
          const ok = !!safeEval(collector.variables, workflowItem.pass_condition);
          if (!ok) throw new Error(`pass_condition 未通过: ${workflowItem.pass_condition}`);
        }
      };

      const runLoop = async (loopItem: WorkflowItem): Promise<void> => {
        const children = Array.isArray(loopItem.children) ? loopItem.children : [];
        let maxCount = 0;
        if (
          typeof loopItem.max_count === "string" &&
          /^\${[\s\S]*}$/.test(loopItem.max_count.trim())
        ) {
          maxCount = Number(safeEval(collector.variables, loopItem.max_count)) || 0;
        } else {
          maxCount = Number(loopItem.max_count) || 0;
        }
        if (Number.isNaN(maxCount)) {
          throw new Error(`[loop] max_count 不是数字: ${loopItem.max_count}`);
        }
        if (!children.length || maxCount <= 0) {
          emit("loop 跳过：children/max_count 无效");
          return;
        }
        const indexVar = loopItem.loop_index_var || "_loopIndex";
        emit(`循环最大次数 max_count=${maxCount}`);
        for (let i = 0; i < maxCount; i++) {
          if (token?.cancelled) throw new TaskCancelledError();
          collector.variables[indexVar] = i;
          emit(`循环 ${i + 1}/${maxCount}, ${indexVar}=${i}`);
          for (const child of children) {
            await runItem(child);
          }
          if (loopItem.break_condition) {
            let stop = false;
            try {
              stop = !!safeEval(collector.variables, loopItem.break_condition);
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
      };

      const runItem = async (item: WorkflowItem): Promise<void> => {
        if (item.type === "loop") return runLoop(item);
        return runStep(item);
      };

      for (const item of workflow) {
        await runItem(item);
      }

      emit("采集完成");
      return {
        ok: true,
        data: {
          collected: collector.data,
          variables: collector.variables,
        },
      };
    } catch (err) {
      if (err instanceof TaskCancelledError || token?.cancelled) {
        emit("任务已取消");
        return { ok: false, error: "任务已取消", data: null };
      }
      if (err instanceof NotLoggedInError) {
        emit(err.message);
        return { ok: false, error: err.message, data: null };
      }
      lastError = err instanceof Error ? err.message : String(err);
      emit(`失败(${attempt}/${maxRetry}): ${lastError}`);
      if (attempt < maxRetry) await cancellableSleep(1000 * attempt, token);
    } finally {
      clearNetworkCaptureContext();
      // 对齐 stopCrawlTask：关掉任务绑定的工作标签
      if (tabId != null) {
        emit(`关闭任务标签 tabId=${tabId}`);
        await removeTab(tabId);
        tabId = null;
      }
    }
  }

  return { ok: false, error: lastError || "未知错误", data: null };
}
