const statusEl = document.getElementById("status");
const btn = document.getElementById("reconnect");

function refresh(): void {
  chrome.runtime.sendMessage({ type: "GET_BRIDGE_STATUS" }, (res) => {
    if (!statusEl) return;
    if (!res) {
      statusEl.textContent = "无法读取状态";
      return;
    }
    statusEl.textContent = res.connected
      ? `已连接 ${res.url}`
      : `未连接 ${res.url}（请先 npm start Electron）`;
  });
}

btn?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "RECONNECT_BRIDGE" }, () => refresh());
});

refresh();
setInterval(refresh, 2000);
