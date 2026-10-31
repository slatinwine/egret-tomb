// 端到端验证：模型返回变化状态后，顶部状态条（日期/体力/精神进度条）是否立即更新
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// 模型返回：第3天·黄昏，hp 80→52，sanity 70→41（含时段别名「傍晚」测试归一）
const MODEL_RAW =
  '好的，这是本回合的推进。\n```json\n{"narration":"石门在你身后轰然合拢。尘埃落定，火把的光变暗了。","state":{"day":3,"time":"傍晚","location":"藏兵室","hp":52,"sanity":41,"inventory":["火把","青铜古镜"]},"options":["搜查藏兵室","休息片刻"]}]\n```'.replace("}]", "}");

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "https://drifting-classroom.app.workbuddy.host/?sharecode=TEST",
  virtualConsole: (function(){ const { VirtualConsole } = require("jsdom"); const vc = new VirtualConsole(); vc.on("jsdomError", (e) => console.log("JSDOM ERROR:", String(e && e.message || e).slice(0, 300))); vc.on("error", (...a) => console.log("VC ERROR:", String(a[0]).slice(0, 200))); return vc; })(),
  beforeParse(window) {
    // 云端不可用（ok:false）→ callLLM 落到备用通道；备用通道指向 mock 接口
    window.localStorage.setItem("dc_ai_cfg", JSON.stringify({ base: "https://mock.example/v1", key: "sk-test", model: "mock" }));
    window.fetch = function (url, opts) {
      url = String(url);
      if (url.indexOf("chat/completions") >= 0) {
        return Promise.resolve({
          ok: true, status: 200,
          headers: { forEach: function () {} },
          json: async function () { return { choices: [{ message: { content: MODEL_RAW } }] }; },
          text: async function () { return JSON.stringify({ choices: [{ message: { content: MODEL_RAW } }] }); }
        });
      }
      return Promise.resolve({ ok: false, status: 0, headers: { forEach: function () {} }, text: async function () { return ""; } });
    };
    window.confirm = () => false;
    window.scrollTo = () => {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  },
  pretendToBeVisual: true,
});

const { window } = dom;
const { document } = window;

let pass = 0, fail = 0;
function t(name, cond) { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name); }

function settle(ms) { return new Promise((r) => setTimeout(r, ms || 50)); }

(async function main() {
  await settle(1200); // 等页面脚本初始化

  t("页面脚本加载（parseGM/act 可用）", typeof window.parseGM === "function" && typeof window.act === "function");
  if (typeof window.act !== "function") { console.log("页面未初始化，终止"); process.exit(1); }

  // 点击「开始探墓」触发开局回合（模型 mock 会返回变化后的状态）
  const startBtn = document.getElementById("btn-start");
  t("开局按钮存在", !!startBtn);
  if (startBtn) startBtn.click();
  await settle(2000); // 等开局序幕（本地文本，不消耗 mock）

  // 驱动一个真实回合（走备用通道 mock → parseGM → 合并 → renderState）
  window.G.turn = 0;
  await window.act("推开石门进入藏兵室");
  await settle(1500);

  t("回合后 G 已合并（day=3）", window.G && window.G.day === 3);
  if (!window.G || window.G.day !== 3) {
    console.log("G:", window.G && JSON.stringify({ day: window.G.day, time: window.G.time, hp: window.G.hp }));
  }

  const dayTxt = document.getElementById("s-day").textContent;
  const hpW = document.getElementById("m-hp").style.width;
  const saW = document.getElementById("m-sa").style.width;
  const locTxt = document.getElementById("s-loc").textContent;

  t("G.time 归一 傍晚→黄昏", window.G.time === "黄昏");
  t("G.hp=52 / G.sanity=41", window.G.hp === 52 && window.G.sanity === 41);
  t("顶部日期文字已更新（" + dayTxt + "）", dayTxt.indexOf("第3天") >= 0 && dayTxt.indexOf("黄昏") >= 0);
  t("顶部地点已更新（" + locTxt + "）", locTxt === "藏兵室");
  t("体力条宽度=52%（实际 " + hpW + "）", hpW === "52%");
  t("精神条宽度=41%（实际 " + saW + "）", saW === "41%");

  console.log("---");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("E2E ERROR:", e.message); process.exit(1); });
