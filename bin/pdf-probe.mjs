// OpenNFSC · PDF 内容自检  (powered by gary)
// ---------------------------------------------------------------------------
// 解决什么问题：`xelatex` 返回 0、日志含 "Output written"、PDF 也生成了，
// 但图其实没进去——例如 \IfFileExists 走了占位分支、图片路径写错。
// 编译链路对此**完全静默**，只有直接解析 PDF 内容流才能发现。
//
// 用法：
//   node bin/pdf-probe.mjs <file.pdf>
//   node bin/pdf-probe.mjs <file.pdf> --expect-figure     # 无矢量绘图即失败
//   node bin/pdf-probe.mjs <file.pdf> --json
//
// 退出码：0 通过 / 1 失败
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json') || args.includes('--quiet');
const expectFigure = args.includes('--expect-figure');
const quiet = args.includes('--quiet');

if (!file) {
  console.error('用法: node bin/pdf-probe.mjs <file.pdf> [--expect-figure] [--json]');
  process.exit(1);
}

let buf;
try {
  buf = readFileSync(file);
} catch (e) {
  console.error(`无法读取 ${file}: ${e.message}`);
  process.exit(1);
}

if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
  console.error(`${file} 不是合法 PDF（缺少 %PDF- 文件头）`);
  process.exit(1);
}

const latin = buf.toString('latin1');

// 解压所有 FlateDecode 流，拼成整体内容。
// 同时保留对象流（ObjStm）的解压结果——XeTeX 生成的 PDF ≥1.5 会把页面树、
// 目录等对象压缩进 ObjStm，此时 /Type/Page 在文件明文里根本不存在，
// 只在 ObjStm 内部可见。漏了这一步就会误判为"0 页"。
const streams = [];
const objStmTexts = [];
const reStream = /stream\r?\n/g;
let m;
while ((m = reStream.exec(latin)) !== null) {
  const start = m.index + m[0].length;
  const end = latin.indexOf('endstream', start);
  if (end < 0) continue;
  // 检查该流对象的字典里是否声明了 ObjStm
  const dictStart = Math.max(0, m.index - 500);
  const dict = latin.slice(dictStart, m.index);
  const isObjStm = /\/ObjStm/.test(dict.slice(dict.lastIndexOf('obj')));
  let text;
  try {
    text = zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
  } catch {
    continue; // 非 Flate 流（字体二进制等），跳过
  }
  streams.push(text);
  if (isObjStm) objStmTexts.push(text);
}
const content = streams.join('\n');
const objStm = objStmTexts.join('\n');
const count = (r) => (content.match(r) || []).length;

// 页面对象计数。
// PDF 中实际写法是 `/Type/Page`（斜杠紧邻），不是 `/Type /Page`；
// 且页面树常位于 ObjStm 内部。因此：优先用页面树根的 /Count（权威），
// 与「明文 + ObjStm 内」的 /Type/Page 计数交叉验证，取二者较大值。
const pagesRootCount = (() => {
  const hay = latin + '\n' + objStm;
  const m2 = hay.match(/\/Type\s*\/Pages[\s\S]{0,4000}?\/Count\s+(\d+)/);
  return m2 ? Number(m2[1]) : 0;
})();
const typeTokenCount = ((latin + '\n' + objStm).match(/\/Type\s*\/Page(?![s])/g) || []).length;
const pageCount = Math.max(pagesRootCount, typeTokenCount);

const stats = {
  pages: pageCount,
  streams: streams.length,
  contentBytes: content.length,
  // 绘图算子
  rect: count(/\bre\b/g),
  stroke: count(/\bS\b/g),
  line: count(/\bl\b/g),
  curve: count(/\bc\b/g),
  fill: count(/\bf\b/g),
  // 文本算子
  textOps: count(/Tj/g) + count(/TJ/g),
  fonts: count(/\/FontFile[23]?/g),
};
stats.drawingOps = stats.rect + stats.stroke + stats.line + stats.curve + stats.fill;

// 判定
const problems = [];
if (stats.pages < 1) problems.push('PDF 中没有页面对象');
if (stats.streams < 1) problems.push('没有任何可解压的内容流——文件可能是空壳');
if (stats.textOps < 1) problems.push('没有文本绘制算子——正文内容可能为空');
if (expectFigure && stats.drawingOps < 40) {
  problems.push(`期望有图，但绘图算子仅 ${stats.drawingOps} 个（阈值 40）——图很可能未被真正嵌入`);
}

if (asJson) {
  console.log(JSON.stringify({ file, ok: problems.length === 0, ...stats, problems }));
} else if (!quiet) {
  console.log(`PDF 内容自检: ${file}`);
  console.log(`  页面          ${stats.pages}`);
  console.log(`  内容流        ${stats.streams} 个 / ${stats.contentBytes} 字节`);
  console.log(`  绘图算子      ${stats.drawingOps}  (矩形 ${stats.rect} / 描边 ${stats.stroke} / 直线 ${stats.line} / 曲线 ${stats.curve} / 填充 ${stats.fill})`);
  console.log(`  文本绘制      ${stats.textOps}`);
  console.log(`  嵌入字体      ${stats.fonts}`);
  console.log('');
  if (problems.length === 0) {
    console.log('  ✓ 通过');
  } else {
    problems.forEach((p) => console.log(`  ✗ ${p}`));
  }
  console.log('');
  console.log('  OpenNFSC · powered by gary');
}

process.exit(problems.length === 0 ? 0 : 1);
