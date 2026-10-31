// 数据层冒烟测试：node smoke-test.js（无需浏览器）
// 用桩替换 DOM / localStorage / fetch，只测核心逻辑。
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

function el() {
  const e = {
    style: {}, classList: { toggle() {}, add() {} },
    textContent: "", innerHTML: "", value: "",
    appendChild() {}, insertBefore() {},
    onclick: null, getAttribute() { return ""; }, disabled: false
  };
  e.parentNode = e; // 自引用，支撑 renderState 的 parentNode 链
  return e;
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || el()),
  querySelectorAll: () => [],
  createElement: () => el(),
  body: { scrollHeight: 0 }
};
global.window = { scrollTo() {} };
global.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] || null; },
  setItem(k, v) { this._s[k] = v; },
  removeItem(k) { delete this._s[k]; }
};
global.fetch = async () => ({ ok: false, status: 0, text: async () => "" });
global.confirm = () => false;

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
// 页面有多个 <script> 块（内联 SDK / 主逻辑），取含主逻辑标记的块
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const src = blocks.find(b => b.includes("LS_AI")) || blocks.sort((a, b) => b.length - a.length)[0];
vm.runInThisContext(src);

let pass = 0, fail = 0;
function t(name, cond) { cond ? pass++ : fail++; console.log((cond ? "PASS" : "FAIL") + " " + name); }

// 1. 围栏 JSON 提取
const raw1 = '好的\n```json\n{"narration":"风停了。","state":{"day":2,"time":"深夜","location":"食堂","hp":50,"sanity":40,"inventory":["水"]},"options":["搜食堂","睡觉"],"ending":null}\n```';
let gm = parseGM(raw1);
t("parseGM 提取围栏JSON", gm.narration === "风停了。");
t("normalize 状态合并", gm.state.day === 2 && gm.state.hp === 50);

// 2. 纯文本兜底
let gm2 = parseGM("这只是一段没有JSON的话。");
t("parseGM 纯文本兜底", gm2.narration.includes("没有JSON") && gm2.state === null);

// 3. 状态钳制
G = newState();
const badInv = JSON.stringify(Array.from({ length: 20 }, (_, i) => "物品" + i));
let gm3 = parseGM('{"narration":"x","state":{"day":-5,"time":"中午","hp":999,"sanity":-99,"inventory":' + badInv + "}}");
t("钳制 hp/day/精神", gm3.state.hp === 100 && gm3.state.day === G.day && gm3.state.sanity === 0);
t("物品最多8个", gm3.state.inventory.length === 8);

// 4. 非法时间回退
let gm4 = parseGM('{"narration":"x","state":{"time":"凌晨三点半","hp":10,"sanity":10,"day":1}}');
t("非法时段回退", gm4.state.time === G.time);

// 5. 纸条海：能捞到种子纸条且不重复
G = newState();
const n = fishNote();
t("捞到种子纸条", n && typeof n.text === "string");
t("同一张不重复捞", (function () {
  let seen = new Set();
  for (let i = 0; i < 40; i++) {
    const x = fishNote();
    if (x) { if (seen.has(x.text)) return false; seen.add(x.text); }
  }
  return true;
})());

// 6. system prompt 携带世界观与当前状态
const sys = buildSystem();
t("system prompt 含世界观与当前状态", sys.includes("白鹭冢") && sys.includes('"hp":' + G.hp));

// 7. 结局解析
let gm5 = parseGM('{"narration":"你死了。","state":{"hp":0,"day":3,"time":"深夜","location":"体育馆","sanity":20,"inventory":[]},"options":[],"ending":{"type":"death","title":"葬身体育馆","epitaph":"别回头。"}}');
t("ending 解析", gm5.ending && gm5.ending.type === "death" && gm5.ending.epitaph === "别回头。");

// 8. localStorage 存取
save("t1", { a: 1 });
t("save/load", load("t1", null).a === 1);

// 8. 时光机线索协议：clue + unlock 解析
let gm6 = parseGM('{"narration":"幻象浮现。","state":{"hp":70,"sanity":55,"day":2,"time":"黄昏","location":"广播室","inventory":["电波表"]},"options":["再看一次"],"clue":{"title":"报纸残页","text":"白椿研究所今晨试验成功。三名研究员失踪。"},"unlock":"time_machine"}');
t("clue/unlock 解析", gm6.clue && gm6.clue.title === "报纸残页" && gm6.unlock === "time_machine");

// 9. applyExtras：解锁、扣充能、线索去重
G = newState();
G.tm = { has: false, charges: 3 }; G.clues = [];
applyExtras(gm6, false);
t("unlock 生效", G.tm.has === true && G.tm.charges === 3);
t("线索入账", G.clues.length === 1);
applyExtras(gm6, true); // 重复线索 + 时光机行程
t("重复线索去重且扣充能", G.clues.length === 1 && G.tm.charges === 2);
applyExtras({ clue: { title: "机器人残骸", text: "胸口编号 WHITEBOX-07。" }, unlock: null }, true);
t("第二条线索入账", G.clues.length === 2 && G.tm.charges === 1);
applyExtras({ clue: null, unlock: null }, true);
t("充能耗尽不为负", G.tm.charges === 0);

// 10. 旧存档迁移字段
t("newState 含时光机与线索", (function(){ const g = newState(); return g.tm && g.tm.charges === 3 && Array.isArray(g.clues) && g.clues.length === 0; })());

console.log("---");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
