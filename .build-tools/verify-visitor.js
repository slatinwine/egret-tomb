// 端到端验证：首页底部访客计数（IP 去重）
// mock：IP 回显服务返回固定 IP；云数据库 REST 返回计数 42
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "game.html"), "utf8");
let pass = 0, fail = 0;
function t(name, cond) { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name); }

function settle(ms) { return new Promise((r) => setTimeout(r, ms)); }

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "https://drifting-classroom.app.workbuddy.host/?sharecode=TEST",
  virtualConsole: (function () {
    const { VirtualConsole } = require("jsdom");
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => console.log("JSDOM ERROR:", String(e && e.message || e).slice(0, 300)));
    return vc;
  })(),
  beforeParse(window) {
    window.localStorage.setItem("dc_ai_cfg", JSON.stringify({ base: "https://mock.example/v1", key: "sk-test", model: "mock" }));
    window.fetch = function (url) {
      url = String(url);
      function ok(json) {
        return Promise.resolve({ ok: true, status: 200, headers: { forEach: function () {}, get: function () { return null; } }, json: async function () { return json; }, text: async function () { return JSON.stringify(json); } });
      }
      if (url.indexOf("myip.ipip.net") >= 0) return ok({ ret: "ok", data: { ip: "203.0.113.9", location: ["测试", "网络"] } });
      if (url.indexOf("api.ip.sb") >= 0) return ok({ ip: "203.0.113.9" });
      if (url.indexOf("/rpc/wb_visitor_count") >= 0) return ok(42);
      if (url.indexOf("/wb_visitors") >= 0) return Promise.resolve({ ok: true, status: 201, headers: { forEach: function () {}, get: function () { return null; } }, json: async function () { return null; }, text: async function () { return ""; } });
      if (url.indexOf("chat/completions") >= 0) return Promise.resolve({ ok: false, status: 0, headers: { forEach: function () {}, get: function () { return null; } }, json: async function () { return {}; }, text: async function () { return ""; } });
      return Promise.resolve({ ok: false, status: 0, headers: { forEach: function () {}, get: function () { return null; } }, json: async function () { return {}; }, text: async function () { return ""; } });
    };
    window.confirm = () => false;
    window.scrollTo = () => {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  },
  pretendToBeVisual: true
});

(async () => {
  await settle(600); // 页面脚本初始化
  const w = dom.window;
  t("页面脚本加载（title-screen 存在）", !!w.document.getElementById("title-screen"));
  t("云 SDK 已加载（WorkBuddyCloud 存在）", typeof w.WorkBuddyCloud !== "undefined");

  await settle(4000); // 等 IP 获取 + 入库 + 计数（补丁 1.5s 启动）

  const p = w.document.getElementById("visitor-count");
  t("计数元素已插入首页底部", !!p);
  if (p) {
    console.log("    文案: " + p.textContent);
    t("文案含计数 42", p.textContent.indexOf("42") >= 0);
    t("文案含「探险者」", p.textContent.indexOf("探险者") >= 0);
    t("文案注明按 IP 去重", p.textContent.indexOf("IP 去重") >= 0);
  }

  // 哈希不应包含原始 IP
  const pageHtml = w.document.getElementById("log") ? null : null;
  t("原始 IP 不出现在页面", w.document.body.textContent.indexOf("203.0.113.9") < 0);

  console.log("---");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("E2E ERROR:", e.message); process.exit(1); });
