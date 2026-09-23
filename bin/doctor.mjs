#!/usr/bin/env node
/**
 * OpenNFSC 自检（doctor）
 * ─────────────────────────────────────────────────────────────
 * 逐项检查本技能包是否处于可用状态，并给出针对性的修复建议。
 *
 *   node bin/doctor.mjs           # 完整自检
 *   node bin/doctor.mjs --json    # 输出机器可读结果
 *
 * powered by gary
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const IS_WIN = platform() === 'win32';
const JSON_OUT = process.argv.includes('--json');

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
const report = { poweredBy: 'gary', root: ROOT, checks: [], passed: 0, warned: 0, failed: 0 };

function check(name, level, detail, fix) {
  report.checks.push({ name, level, detail, fix: fix || null });
  if (level === 'pass') report.passed++;
  else if (level === 'warn') report.warned++;
  else report.failed++;
  if (!JSON_OUT) {
    const mark = level === 'pass' ? `${C.g}✓${C.x}` : level === 'warn' ? `${C.y}!${C.x}` : `${C.r}✗${C.x}`;
    console.log(`  ${mark} ${name.padEnd(34)} ${C.d}${detail}${C.x}`);
    if (fix && level !== 'pass') console.log(`      ${C.y}→ ${fix}${C.x}`);
  }
}
const head = (m) => { if (!JSON_OUT) console.log(`\n${C.b}▌${C.x} ${m}`); };

// ─────────────────────────────────────────────
head('运行时');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 18 && typeof fetch === 'function') {
  check('Node.js ≥ 18 且内置 fetch', 'pass', `v${process.versions.node}`);
} else {
  check('Node.js ≥ 18 且内置 fetch', 'fail', `v${process.versions.node}`, '安装 Node.js 18+：https://nodejs.org/');
}

// ─────────────────────────────────────────────
head('技能包文件完整性');

const REQUIRED = [
  ['bin/cli.mjs', '检索/校验 CLI'],
  ['bin/lib.mjs', '工具库'],
  ['bin/track-params.mjs', '申报类型参数（提纲原文唯一真源）'],
  ['bin/tex-template.mjs', 'LaTeX 模板生成器'],
  ['bin/md2tex.mjs', 'Markdown→LaTeX 转换'],
  ['bin/compile-tex.ps1', 'XeLaTeX 编译脚本'],
  ['bin/check-template.mjs', '官方模板合规校验'],
  ['bin/check-tex.mjs', 'LaTeX 质量检查'],
  ['bin/check-consistency.mjs', '术语/图号/错字一致性校验'],
  ['bin/check-format.mjs', 'PDF 版式校验（页边距/行距/字号）'],
  ['bin/vendor/pdf.min.mjs', '内置 PDF 解析器（版式校验用）'],
  ['bin/vendor/pdf.worker.min.mjs', '内置 PDF 解析器 worker'],
  ['bin/pdf-probe.mjs', 'PDF 内容自检（验证图是否真嵌入）'],
  ['templates/报告正文-青年C类-2026-提纲.txt', '青年C类官方 2026 提纲'],
  ['templates/报告正文-面上项目-2026-提纲.txt', '面上项目官方 2026 提纲'],
  ['templates/报告正文-青年C类-2026-提纲.pdf', '青年C类提纲 PDF'],
  ['templates/报告正文-面上项目-2026-提纲.pdf', '面上项目提纲 PDF'],
  ['bin/gen-outlines.mjs', '生成提纲基准文件（txt）'],
  ['bin/gen-outline-pdf.mjs', '生成报告正文提纲 PDF'],
  ['AGENTS.md', 'agent 入口'],
  ['SKILL.md', 'Claude Code 入口'],
  ['README.md', '人读说明'],
  ['pipeline/00_runbook.md', '流程编排手册'],
  ['docs/质量门控判据.md', '质量门控判据'],
  ['docs/官方评判据.md', '官方评判据'],
  ['docs/获批本解剖.md', '获批本实测剖析（写作对照）'],
  ['docs/NSFC2026要求.md', 'NSFC 2026 要求'],
];
const missing = REQUIRED.filter(([f]) => !existsSync(join(ROOT, f)));
if (missing.length === 0) {
  check('核心文件齐备', 'pass', `${REQUIRED.length} 个`);
} else {
  check('核心文件齐备', 'fail', `缺 ${missing.length} 个：${missing.map((m) => m[0]).join(', ')}`,
    '包不完整，请重新获取完整压缩包');
}

// 流程阶段手册
const stageDir = join(ROOT, 'pipeline', 'stages');
if (existsSync(stageDir)) {
  const n = readdirSync(stageDir).filter((f) => f.endsWith('.md')).length;
  check('流程阶段手册', n >= 8 ? 'pass' : 'warn', `${n} 个`, n < 8 ? '阶段手册不全，流程会缺步骤' : null);
} else {
  check('流程阶段手册', 'warn', '目录不存在', 'pipeline/stages 缺失');
}

// ─────────────────────────────────────────────
head('检索与校验工具');

try {
  const out = execFileSync(process.execPath, [join(ROOT, 'bin', 'cli.mjs'), 'self-test'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const m = out.match(/全部自检通过/) || out.match(/自检失败 (\d+) 项/);
  if (/全部自检通过/.test(out)) {
    const n = (out.match(/✓/g) || []).length;
    check('CLI 离线自检', 'pass', `${n} 项全通过`);
  } else {
    check('CLI 离线自检', 'fail', m ? m[0] : '未通过', '运行 node bin/cli.mjs self-test 查看详情');
  }
} catch (e) {
  check('CLI 离线自检', 'fail', (e.message || '').split('\n')[0], 'node bin/cli.mjs self-test');
}

// 模板校验器试运行
try {
  const tpl = readFileSync(join(ROOT, 'templates', '报告正文-青年C类-2026-提纲.txt'), 'utf8');
  const has4 = ['（一）立项依据', '（二）研究内容', '（三）研究基础', '（四）其他需要说明的情况'].every((s) => tpl.includes(s));
  check('官方模板提纲可读', has4 ? 'pass' : 'warn', has4 ? '四部分结构完整' : '未识别到完整四部分',
    has4 ? null : '模板文件可能损坏');
} catch (e) {
  check('官方模板提纲可读', 'fail', e.message, '检查 templates/ 目录');
}

// ─────────────────────────────────────────────
head('PDF 出稿链路（TeX Live）');

let texBin = null;
for (const n of (IS_WIN ? ['xelatex.exe'] : ['xelatex'])) {
  try {
    const p = execSync(IS_WIN ? `where ${n}` : `command -v ${n}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
    if (p && existsSync(p)) { texBin = dirname(p); break; }
  } catch { /* 不在 PATH */ }
}
if (!texBin) {
  for (const r of ['C:\\texlive', 'D:\\texlive', 'E:\\texlive', '/usr/local/texlive', join(process.env.USERPROFILE || '', '.TinyTeX')]) {
    if (!existsSync(r)) continue;
    for (const sub of (IS_WIN ? ['bin\\windows', '2026\\bin\\windows', '2025\\bin\\windows'] : ['2026/bin/x86_64-linux', '2025/bin/x86_64-linux', 'bin'])) {
      const d = join(r, sub);
      if (existsSync(join(d, IS_WIN ? 'xelatex.exe' : 'xelatex'))) { texBin = d; break; }
    }
    if (texBin) break;
  }
}

if (texBin) {
  let ver = '';
  try { ver = execFileSync(join(texBin, IS_WIN ? 'xelatex.exe' : 'xelatex'), ['--version'], { encoding: 'utf8' }).split('\n')[0]; } catch { /* ignore */ }
  check('XeLaTeX 可用', 'pass', `${texBin}${ver ? ' · ' + ver.replace(/\(preloaded format=xelatex\)/, '').trim().slice(0, 46) : ''}`);

  const NEED = ['ctex.sty', 'xeCJK.sty', 'longtable.sty', 'enumitem.sty', 'fancyhdr.sty', 'caption.sty', 'amsmath.sty', 'fancyvrb.sty', 'float.sty', 'hyperref.sty', 'xcolor.sty', 'array.sty'];
  const kp = join(texBin, IS_WIN ? 'kpsewhich.exe' : 'kpsewhich');
  const miss = [];
  for (const p of NEED) {
    try { if (!execFileSync(kp, [p], { encoding: 'utf8' }).trim()) miss.push(p); } catch { miss.push(p); }
  }
  if (miss.length === 0) {
    check('TeX 宏包齐备', 'pass', `${NEED.length} 个`);
  } else {
    const names = miss.map((m) => m.replace('.sty', ''));
    check('TeX 宏包齐备', 'warn', `缺 ${miss.length} 个：${names.join(', ')}`,
      IS_WIN ? `"${join(texBin, 'tlmgr.bat')}" install ${names.join(' ')}` : `sudo tlmgr install ${names.join(' ')}`);
  }

  // 中文字体（tex 模板有 Fandol 回退，故仅提示）
  const sysFont = IS_WIN
    ? ['C:\\Windows\\Fonts\\simsun.ttc', 'C:\\Windows\\Fonts\\simhei.ttf'].some((f) => existsSync(f))
    : ['/usr/share/fonts/opentype/noto', '/usr/share/fonts'].some((d) => existsSync(d));
  check('中文字体', sysFont ? 'pass' : 'warn', sysFont ? '系统字体可用（宋体/黑体）' : '未检测到，将回退 Fandol 字体',
    sysFont ? null : '不影响编译，模板已内置字体回退');
} else {
  check('XeLaTeX 可用', 'warn', '未找到 TeX 发行版',
    'node bin/setup.mjs 自动安装；或手动装 TeX Live / MiKTeX');
  console.log(`      ${C.d}不影响：检索、写作、校验、以及 Markdown/HTML 出稿都无需 TeX。${C.x}`);
}

// Word COM（可选，备用出稿）
if (IS_WIN) {
  try {
    execSync('powershell -NoProfile -Command "try{$w=New-Object -ComObject Word.Application;$w.Quit();exit 0}catch{exit 1}"', { stdio: 'ignore' });
    check('Word COM（备用）', 'pass', '可用于 DOCX 出稿与 PDF 渲染校验');
  } catch {
    check('Word COM（备用）', 'warn', '不可用', '可选功能，不影响 LaTeX 主链路');
  }
}

// ─────────────────────────────────────────────
head('覆盖文件与临时产物');

for (const d of ['overrides', 'runs']) {
  const p = join(ROOT, d);
  if (existsSync(p)) {
    const n = readdirSync(p).length;
    check(`${d}/ 目录`, 'pass', `${n} 项`);
  } else {
    check(`${d}/ 目录`, 'warn', '不存在（首次运行时自动创建）', null);
  }
}

// ─────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n${C.b}▌${C.x} 结论`);
  console.log(`  ${C.g}通过 ${report.passed}${C.x}   ${C.y}警告 ${report.warned}${C.x}   ${C.r}失败 ${report.failed}${C.x}`);
  console.log('');
  if (report.failed === 0) {
    console.log(`  ${C.g}技能包可用。${C.x}把本目录交给 agent，或直接说：`);
    console.log(`    ${C.d}读 OpenNFSC/AGENTS.md，按流程帮我写国自然申请书${C.x}`);
  } else {
    console.log(`  ${C.r}存在阻塞项，请先按上面的提示修复。${C.x}`);
  }
  console.log('');
  console.log(`  ${C.d}powered by gary${C.x}`);
}

process.exit(report.failed ? 1 : 0);
