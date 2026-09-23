#!/usr/bin/env node
/**
 * 官方模板合规性校验（check-template）
 * ─────────────────────────────────────────────────────────────
 * 逐字比对正文是否符合国家自然科学基金委《报告正文（2026 版）·
 * 青年科学基金项目（C 类）》的提纲要求。
 *
 * 官方模板原文明令：「请勿删除或改动下述提纲标题及括号中的文字。」
 *
 *   node bin/check-template.mjs <正文.md>
 *   node bin/check-template.mjs <正文.md> --out <结果.json>
 *
 * 退出码：0 全部通过；1 有未通过项
 *
 * powered by gary
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getTrack } from './track-params.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null;
/** --track：申报类型（youth=青年C类 / general=面上项目） */
const trackIdx = argv.findIndex((a) => a === '--track' || a.startsWith('--track='));
const trackArg = trackIdx < 0 ? null
  : (argv[trackIdx].includes('=') ? argv[trackIdx].split('=')[1] : argv[trackIdx + 1]);

if (!file) {
  console.error('用法：node bin/check-template.mjs <正文.md> [--track youth|general] [--out 结果.json]');
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`文件不存在：${file}`);
  process.exit(1);
}

let track;
try {
  track = getTrack(trackArg || process.env.OPENNFSC_TRACK || 'youth');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const txt = readFileSync(file, 'utf8');
/**
 * 归一化：去掉所有空白类字符，并统一标点写法，便于跨行比对。
 * 模板 PDF 提取会断行；此外官方提纲用全角句点"1．"，作者常用半角"1."，
 * 标题末尾的冒号也常被省略——这些写法差异不影响合规，必须归一化后再比。
 */
const norm = (s) => String(s)
  .replace(/[\s\u3000]+/g, '')
  .replace(/[．.]/g, '.')
  .replace(/[：:]/g, ':')
  .replace(/[；;]/g, ';')
  .replace(/[（(]/g, '(')
  .replace(/[）)]/g, ')')
  .replace(/[，,]/g, ',');
const T = norm(txt);

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };

// ─────────────────────────────────────────────
// 官方提纲逐字清单
// ─────────────────────────────────────────────
// 来源：bin/track-params.mjs —— 两套模板（青年C类 / 面上项目）的唯一真源。
// 该文件中的 items[].text 与官方《报告正文（2026 版）》提纲逐字一致，
// 并按申报类型区分：（三）3 与（四）2/3/4 在面上项目下含"主要参与者"。
// **不要把清单抄回本文件**——那是之前造成"青年提纲基准被写死"的原因。
const REQUIRED = track.items.map((it) => {
  const label = it.key === 'part4-5'
    ? '（四）5 ★AI披露'
    : it.key.replace(/^part(\d)$/, '（$1）标题').replace(/^part(\d)-(\d)$/, '（$1）$2');
  return [it.text, label, it.required === true];
});

// 模板明确要求"应提炼出"的内容（两类通用）
const MUST_HAVE = [
  ['特色与创新点', /特色与创新点/],
  ['（二）1.1 研究特色', /研究特色/],
  ['（二）1.2 本项目的创新之处', /本项目的创新之处|创新之处/],
  ['年度研究计划', /年度研究计划/],
  ['参考文献', /参考文献/],
];

console.log(`${C.b}▌${C.x} 官方模板合规性校验（${track.label} · 2026 版）`);
console.log(`${C.d}  正文：${file}${C.x}`);
if (track.id === 'general') {
  console.log(`${C.d}  已按面上项目提纲校验（（三）3 与（四）2/3/4 含"主要参与者"）${C.x}`);
}
console.log('');

let pass = 0;
const failed = [];

for (const [needle, label] of REQUIRED) {
  const found = T.includes(norm(needle));
  console.log(`  ${found ? C.g + '✓' + C.x : C.r + '✗' + C.x} ${label}`);
  if (found) pass++;
  else failed.push({ kind: 'required', label, needle });
}

console.log(`\n${C.b}▌${C.x} 模板要求必含的内容`);
for (const [label, re] of MUST_HAVE) {
  const found = re.test(txt);
  console.log(`  ${found ? C.g + '✓' + C.x : C.r + '✗' + C.x} ${label}`);
  if (found) pass++;
  else failed.push({ kind: 'must-have', label, needle: String(re) });
}

// ─────────────────────────────────────────────
// 四部分顺序（只在标题行中查找，避免正文提及造成误判）
// ─────────────────────────────────────────────
console.log(`\n${C.b}▌${C.x} 四部分顺序`);
const headingLines = txt.split('\n').filter((l) => /^#{2,4}\s/.test(l));
const ORDER = ['（一）立项依据', '（二）研究内容', '（三）研究基础', '（四）其他需要说明的情况'];
let last = -1;
let orderOk = true;
for (const p of ORDER) {
  const idx = headingLines.findIndex((l) => norm(l).includes(norm(p)));
  const good = idx >= 0 && idx > last;
  console.log(`  ${good ? C.g + '✓' + C.x : C.r + '✗' + C.x} ${p}  ${C.d}(标题行序 ${idx >= 0 ? idx + 1 : '未找到'})${C.x}`);
  if (!good) orderOk = false;
  last = idx >= 0 ? idx : last;
}
if (!orderOk) failed.push({ kind: 'order', label: '四部分顺序', needle: '（一）→（二）→（三）→（四）' });

// ─────────────────────────────────────────────
// 篇幅
// ─────────────────────────────────────────────
const chars = txt.replace(/\s/g, '').length;
const estPages = Math.ceil(chars / 950);
const pageOk = estPages <= 30;

console.log(`\n${C.b}▌${C.x} 篇幅`);
console.log(`  字数（去空白）：${chars}`);
console.log(`  估计页数：约 ${estPages} 页 / 限 30 页  ${pageOk ? C.g + '✓' + C.x : C.r + '✗' + C.x}`);
if (!pageOk) failed.push({ kind: 'length', label: '页数超限', needle: `${estPages} 页 > 30` });

const pending = (txt.match(/〔待补/g) || []).length;
console.log(`  ${C.d}待补标记：${pending} 处${C.x}`);

// ─────────────────────────────────────────────
// 结论
// ─────────────────────────────────────────────
const total = REQUIRED.length + MUST_HAVE.length;
console.log(`\n${C.b}▌${C.x} 结论`);
console.log(`  通过 ${C.g}${pass}${C.x} / ${total} 项（另含顺序与篇幅检查）`);

if (failed.length) {
  console.log(`\n  ${C.r}未通过项：${C.x}`);
  for (const f of failed) {
    console.log(`    · [${f.kind}] ${f.label}`);
    if (f.kind === 'required') {
      console.log(`      ${C.d}期望原文：${f.needle.slice(0, 96)}${C.x}`);
      console.log(`      ${C.d}提示：官方模板要求逐字保留，请从 templates/${track.outlineFile} 复制${C.x}`);
    }
  }
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ file, pass, total, chars, estPages, pending, failed }, null, 2), 'utf8');
  console.log(`\n  结果已写入：${OUT}`);
}

console.log('');
console.log(`  ${C.d}OpenNFSC · powered by gary${C.x}`);

process.exit(failed.length ? 1 : 0);
