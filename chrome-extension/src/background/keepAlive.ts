/**
 * MV3 Service Worker 空闲约 30s 会被挂起，WebSocket 随之断开。
 * - 周期 alarm：休眠后仍能唤醒并重连
 * - 有任务时短间隔 alarm：尽量避免执行中被挂起
 */

const PERIODIC_ALARM = "crawl-bridge-periodic";
const ACTIVE_ALARM = "crawl-bridge-active";

/** Chrome 周期 alarm 最短约 1 分钟 */
const PERIODIC_MINUTES = 1;
/** 有任务时用 one-shot 链式唤醒（约 25s） */
const ACTIVE_DELAY_MINUTES = 25 / 60;

let listenersBound = false;
let ensureConnect: () => void = () => {};
let isBusy: () => boolean = () => false;

export function bindKeepAliveHooks(hooks: {
  ensureConnect: () => void;
  isBusy: () => boolean;
}): void {
  ensureConnect = hooks.ensureConnect;
  isBusy = hooks.isBusy;
}

export async function startKeepAlive(): Promise<void> {
  bindAlarmListener();
  await chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: PERIODIC_MINUTES });
  await tickActiveKeepAlive();
}

/** 任务进行中时持续续命 */
export async function tickActiveKeepAlive(): Promise<void> {
  if (!isBusy()) {
    await chrome.alarms.clear(ACTIVE_ALARM);
    return;
  }
  await chrome.alarms.create(ACTIVE_ALARM, { delayInMinutes: ACTIVE_DELAY_MINUTES });
}

function bindAlarmListener(): void {
  if (listenersBound) return;
  listenersBound = true;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== PERIODIC_ALARM && alarm.name !== ACTIVE_ALARM) return;
    console.log("[crawl-ext] keepAlive wake", alarm.name);
    ensureConnect();
    void tickActiveKeepAlive();
  });
}
