#!/usr/bin/env node
/**
 * LaTeX 源文件质量检查（check-tex）
 * ─────────────────────────────────────────────────────────────
 * 检查 bin/md2tex.mjs 生成的 .tex 是否存在常见问题。
 *
 *   node bin/check-tex.mjs <正文.tex>
 *
 * 退出码：0 无致命问题；1 发现致命问题
 *
 * powered by gary
 */

import { readFileSync, existsSync } from 'node:fs';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法：node bin/check-tex.mjs <正文.tex>');
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`文件不存在：${file}`);
  process.exit(1);
}

const t = readFileSync(file, 'utf8');
const lines = t.split('\n');
const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
let fatal = 0;

console.log(`${C.b}▌${C.x} LaTeX 源质量检查`);
console.log(`${C.d}  ${file}${C.x}\n`);

const check = (name, ok, detail, isFatal = false) => {
  console.log(`  ${ok ? C.g + '✓' + C.x : (isFatal ? C.r + '✗' + C.x : C.y + '!' + C.x)} ${name.padEnd(30)} ${C.d}${detail}${C.x}`);
  if (!ok && isFatal) fatal++;
};

// ── 基本结构 ──
check('文档类声明', /\\documentclass/.test(t), (t.match(/\\documentclass\[[^\]]*\]\{[^}]+\}/) || ['未找到'])[0]);
check('\\begin{document}', /\\begin\{document\}/.test(t), /\\begin\{document\}/.test(t) ? '存在' : '缺失');
check('\\end{document}', /\\end\{document\}/.test(t), /\\end\{document\}/.test(t) ? '存在' : '缺失');

// ── 中文支持 ──
const hasCtex = /ctexart|\\usepackage\{ctex\}|xeCJK/.test(t);
check('中文支持', hasCtex, hasCtex ? 'ctex / xeCJK 已加载' : '未检测到中文支持宏包', true);
const hasFontFallback = /IfFontExistsTF/.test(t);
check('字体回退', hasFontFallback, hasFontFallback ? '含 \\IfFontExistsTF 回退' : '无回退（缺字体时可能编译失败）');

// ── 数学公式：检测是否被误转义 ──
const mathCount = (t.match(/\$[^$\n]{2,80}\$/g) || []).length;
const badMath = (t.match(/\$[^$\n]*\\textbackslash\{\}/g) || []).length;
check('数学公式', badMath === 0, `${mathCount} 个公式，误转义 ${badMath} 个`, badMath > 0);
if (badMath > 0) {
  console.log(`      ${C.y}→ 公式被转义成字面文本。检查 md2tex.mjs 的 inline() 是否先抽公式再转义。${C.x}`);
}

// ── 转义风险 ──
// 注意：必须先剥离数学模式再检查。
// `$x_t$`、`$\int_0^T$`、`$R^2$` 中的 _ 与 ^ 在数学模式内是合法的，
// 不加这一步会产生大量假阳性（实测一份正常文档会被误报 10 处）。
// 块级公式 \[...\] 同理：md2tex 会原样输出，其中的下标/上标合法，必须一并剥离，
// 否则一份未使用任何行内 $...$ 的文档会被误报数十处（实测发生）。
const noMath = t
  .replace(/\\\[[\s\S]*?\\\]/g, (m) => '\u0000'.repeat(m.length))
  .replace(/\$[^$\n]*\$/g, (m) => '\u0000'.repeat(m.length));
const bareUnderscore = (noMath.match(/(?<!\\)_/g) || []).length;
const bareCaret = (noMath.match(/(?<!\\)\^/g) || []).length;
check('裸下划线 _', bareUnderscore === 0, `${bareUnderscore} 处（数学模式内不计）`, bareUnderscore > 5);
check('裸脱字符 ^', bareCaret === 0, `${bareCaret} 处（数学模式内不计）`, bareCaret > 3);

// ── 四部分标题 ──
const parts = ['（一）立项依据', '（二）研究内容', '（三）研究基础', '（四）其他需要说明的情况'];
const foundParts = parts.filter((p) => t.includes(p));
check('四部分标题', foundParts.length === 4, `${foundParts.length}/4 存在`, foundParts.length !== 4);

// ── 表格 ──
const tables = (t.match(/\\begin\{longtable\}/g) || []).length;
const tableEnds = (t.match(/\\end\{longtable\}/g) || []).length;
check('表格配对', tables === tableEnds, `longtable ${tables} 开 / ${tableEnds} 闭`, tables !== tableEnds);

// ── 注释中的反斜杠命令（会导致 "Missing \begin{document}"）──
const commentCmd = lines.filter((l) => /^\s*%/.test(l) && /\\[a-zA-Z]{2,}/.test(l));
check('注释中的反斜杠命令', commentCmd.length === 0, `${commentCmd.length} 处`,
  commentCmd.length > 0);
if (commentCmd.length) {
  console.log(`      ${C.y}→ LaTeX 会解析注释行，其中的 \\命令 会在导言区执行而报错。${C.x}`);
  commentCmd.slice(0, 3).forEach((l) => console.log(`      ${C.d}${l.trim().slice(0, 76)}${C.x}`));
}

// ── 图片引用 ──
const imgs = [...t.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)].map((m) => m[1]);
const hasIfFile = /\\IfFileExists/.test(t);
check('图片引用', imgs.length === 0 || hasIfFile,
  imgs.length ? `${imgs.length} 个图片，${hasIfFile ? '有' : '无'}条件保护` : '无图片',
  imgs.length > 0 && !hasIfFile);

// ── 篇幅 ──
const chars = t.length;
check('源文件规模', true, `${lines.length} 行 / ${chars} 字符`);

// ── 结论 ──
console.log(`\n${C.b}▌${C.x} 结论`);
if (fatal === 0) {
  console.log(`  ${C.g}未发现致命问题，可编译。${C.x}`);
  console.log(`  ${C.d}下一步：bin/compile-tex.ps1${C.x}`);
} else {
  console.log(`  ${C.r}发现 ${fatal} 个致命问题，请先修复。${C.x}`);
}
console.log('');
console.log(`  ${C.d}OpenNFSC · powered by gary${C.x}`);

process.exit(fatal ? 1 : 0);
