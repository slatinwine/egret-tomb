// JSON 修复器 v2 验证：用用户实际遇到的坏输出（单引号定界 + \' 转义 + 超量物品）
// 断言：parseGM 能修复出有效状态，narration 正常渲染，不显示原始 JSON。
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
  e.parentNode = e;
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

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const main = blocks.find(b => b.includes("LS_AI"));
const patchV2 = blocks.find(b => b.includes("JSON 修复 v5") || b.includes("tryRepair"));
if (!main || !patchV2) { console.error("未找到主逻辑块或 v2 补丁块"); process.exit(1); }
vm.runInThisContext(main);
// 浏览器里顶层函数声明会挂到 window；vm 环境里 window 与全局是两个对象，需手动同步
window.parseGM = parseGM;
window.normalizeGM = normalizeGM;
vm.runInThisContext(patchV2);

let pass = 0, fail = 0;
function t(name, cond) { cond ? pass++ : fail++; console.log((cond ? "PASS" : "FAIL") + " " + name); }

// 用户截图 1000070513 中的坏输出形态：单引号定界、内部 \' 转义、中文标点、10 件物品
const broken =
  "林川停下脚步。\n" +
  "{'narration':'林川收起青铜古镜，火把的光在墓砖上晃动。他低声说：\\'墓志上那张「图纸」画法不一样，这不是葬制，是封印。\\' 祭殿方向传来一声铜响，像是有什么东西醒了。','state':{'day':3,'time':'深夜','location':'前厅营地','hp':56,'sanity':48,'inventory':['青铜古镜','火把','干粮','水囊','麻绳','工兵铲','拓片','护腕','铜铃','符纸']},'options':['回前厅营地休息','循铜声探祭殿','细看拓片','翻检行囊']}";

let gm = window.parseGM(broken);

t("v2 修复成功（state 非 null）", gm && gm.state !== null);
t("不显示原始 JSON", !(gm && gm.narration && gm.narration.trim().charAt(0) === "{"));
t("内部单引号还原为正常引号（画法不一样…）", !!(gm && gm.narration && gm.narration.includes("画法不一样")));
t("day/time 应用", !!(gm && gm.state && gm.state.day === 3 && gm.state.time === "深夜"));
t("location 应用（前厅营地）", !!(gm && gm.state && gm.state.location === "前厅营地"));
t("hp 应用（56）", !!(gm && gm.state && gm.state.hp === 56));
t("物品钳制到 8 件", !!(gm && gm.state && Array.isArray(gm.state.inventory) && gm.state.inventory.length === 8));
t("选项保留", !!(gm && Array.isArray(gm.options) && gm.options.length === 4 && gm.options[0] === "回前厅营地休息"));

// 回归：正常双引号 JSON 不被 v2 干扰
let gmOk = window.parseGM('{"narration":"风停了。","state":{"day":2,"time":"深夜","location":"祭殿","hp":50,"sanity":40,"inventory":["水"]},"options":["搜祭殿","睡觉"]}');
t("正常 JSON 不受影响", gmOk.narration === "风停了。" && gmOk.state.day === 2);

// 回归：尾逗号
let gmTail = window.parseGM("{'narration':'尾逗号测试。','state':{'day':2,'time':'中午','location':'耳室','hp':60,'sanity':50,'inventory':[]},}");
t("尾逗号可修复", gmTail.state !== null && gmTail.narration === "尾逗号测试。");

// 用户截图 1000070514 中的坏输出形态：双引号定界但 state 的 } 后多了一个 ]（括号不配对），
// 且 options 嵌在 state 内部
const brokenBracket =
  "石台上的刻痕亮起，你差点叫出声。\n" +
  '{"narration":"你把古镜按进凹槽。刹那间满室青白灯膏爆亮，缠绕齿轮齐齐倒转，轰鸣中一个不男不女、平静得可怕的声音从四面八方响起：封存协议确认，持镜者归来。寒意从脚根往上爬，你咬住牙关，才没有叫出声。","state":{"day":3,"time":"清晨","location":"青铜机枢石室","hp":58,"sanity":20,"inventory":["水（不足半壶）","手电三支","洛阳铲","老周的图纸","火柴五根","碎粮少许","旧报纸残页","墓志残石拓文"],"time_machine":{"acquired":false,"charges":3},"options":["扳下是","扳下否","先问它问题","拔出古镜后退"]}],"ending":null}';

let gmB = window.parseGM(brokenBracket);
t("括号不配对可修复（state 非 null）", !!(gmB && gmB.state !== null));
t("括号修复：narration 正常", !!(gmB && gmB.narration && gmB.narration.includes("封存协议确认") && !gmB.narration.trim().startsWith("{")));
t("括号修复：state 应用", !!(gmB && gmB.state && gmB.state.day === 3 && gmB.state.location === "青铜机枢石室" && gmB.state.hp === 58));
t("括号修复：嵌套 options 提升到顶层", !!(gmB && Array.isArray(gmB.options) && gmB.options.length === 4 && gmB.options[0] === "扳下是"));

// 弯引号形态（模型用 “ ” 作定界符）
const brokenCurly =
  "{“narration”:“灯影摇曳。”,“state”:{“day”:2,“time”:“黄昏”,“location”:“耳室”,“hp”:60,“sanity”:50,“inventory”:[]},“options”:[“坐下休息”,“查看壁画”]}";
let gmC = window.parseGM(brokenCurly);
t("弯引号可修复", !!(gmC && gmC.state !== null && gmC.narration === "灯影摇曳。" && gmC.state.location === "耳室"));

// 截断形态（JSON 中途被截断）
const brokenTrunc =
  '{"narration":"地面开始震动。","state":{"day":4,"time":"正午","location":"殉葬坑","hp":40,"sanity":30,"inventory":["洛阳铲"],"options":["爬出坑';
let gmT = window.parseGM(brokenTrunc);
t("截断 JSON 可修复", !!(gmT && gmT.state !== null && gmT.narration === "地面开始震动。" && gmT.state.day === 4));

// 字段打捞：结构完全坏掉（括号错乱 + 字符串内有未转义引号），JSON.parse 永远无法成功
const brokenHopeless =
  "陈小雨扶着墙站起来。\n" +
  '{"narration":"黑暗里那个声音最后响起，依旧平静："本机只是执行。"然后是长久的死寂。","state":{"day":3,"time":"清晨","location":"青铜机枢石室","hp":58,"sanity":17,"inventory":["水（不足半壶）","防护服白骨的日志残页"],"clue":{"title":"白骨日志","text":"病毒是治疗。它一直在听。"},"options":["查看日志残页","检查防护服"]}],"ending":null}';
let gmS = window.parseGM(brokenHopeless);
t("打捞：结构尽毁仍能提取状态", !!(gmS && gmS.state !== null));
t("打捞：narration 提取且无原始 JSON", !!(gmS && gmS.narration && gmS.narration.includes("本机只是执行") && !gmS.narration.includes('"narration"')));
t("打捞：day/hp 提取", !!(gmS && gmS.state && gmS.state.day === 3 && gmS.state.hp === 58));
t("打捞：clue 提取", !!(gmS && gmS.clue && gmS.clue.title === "白骨日志"));

// 终极兜底：连打捞都失败（narration 字段本身缺失），也绝不显示原始 JSON
const brokenBlackHole =
  '{"narration":"前面的话被吞掉了……{"state":{"day":5,"time":"黄昏","location":"未知","hp":10,"sanity":5,"inventory":[]},"options":[]}';
let gmH = window.parseGM(brokenBlackHole);
t("兜底：打捞净化嵌套污染", !!(gmH && gmH.state !== null && gmH.narration === "前面的话被吞掉了……" && gmH.state.day === 5));

// 真兜底：narration 字段名本身坏掉，打捞也失败 → 显示呓语而非原始 JSON
const brokenBlackHole2 =
  '手电灭了。{"naration":"字段名打错了","state":{"day":1,"time":"深夜","location":"墓道","hp":50,"sanity":40,"inventory":[]},"options":["摸黑前进"]}';
let gmH2 = window.parseGM(brokenBlackHole2);
t("兜底：绝不显示原始 JSON", !!(gmH2 && gmH2.narration && gmH2.narration.includes("呓语") && gmH2.narration.includes("手电灭了") && !gmH2.narration.includes('"state"')));

console.log("---");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
