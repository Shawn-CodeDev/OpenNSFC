#!/usr/bin/env node
/**
 * Markdown 正文 → LaTeX 源文件（ctexart，四部分结构严格对齐官方模板）
 * ─────────────────────────────────────────────────────────────
 *   node bin/md2tex.mjs <正文.md> <输出.tex>
 *   node bin/md2tex.mjs <正文.md>              # 输出同名 .tex
 *
 * 排版规格（国自然通行）：
 *   A4，页边距 上2.5/下3.0/左2.5/右2.5cm
 *   正文宋体小四，1.5 倍行距，首行缩进 2 字符
 *   标题黑体；页脚居中页码
 *   字体缺失时自动回退到 TeX Live 自带的 Fandol 字体
 *
 * 编译：xelatex 两遍（见 bin/compile-tex.ps1）
 *
 * powered by gary
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { getTrack, TRACKS } from './track-params.mjs';
import { buildCover, renderTex } from './tex-template.mjs';

const rawArgs = process.argv.slice(2);
const argv = rawArgs.filter((a) => !a.startsWith('--'));
if (!argv.length || rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`OpenNFSC · Markdown → LaTeX（powered by gary）

用法：
  node bin/md2tex.mjs <正文.md> [输出.tex] [--track youth|general] [--meta "…"]

参数：
  --track   申报类型，决定封面、页眉与提纲约束提示（默认 youth）
              youth    青年科学基金项目（C 类）—— 资助 3 年、经费包干制
              general  面上项目 —— 资助 4 年、须编预算表、合作单位≤2 个
  --meta    追加到封面的元信息行，可重复；如 --meta "申请代码：F0601"

两类的 LaTeX 排版完全相同，差异在于封面/页眉文字与正文外约束提示。
`);
  process.exit(argv.length ? 0 : 1);
}

/** 解析 --track 值（支持 --track=general 与 --track general 两种写法） */
function argValue(name) {
  const eq = rawArgs.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = rawArgs.indexOf(`--${name}`);
  return i >= 0 ? rawArgs[i + 1] : null;
}

let track;
try {
  track = getTrack(argValue('track') || process.env.OPENNFSC_TRACK || 'youth');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const SRC = resolve(argv[0]);
if (!existsSync(SRC)) {
  console.error(`文件不存在：${SRC}`);
  process.exit(1);
}
const OUT = argv[1] ? resolve(argv[1]) : join(dirname(SRC), basename(SRC).replace(/\.md$/i, '') + '.tex');

const md = readFileSync(SRC, 'utf8');

// ── 转义 ──
const ESC = {
  '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#',
  '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
};
const esc = (s) => String(s).replace(/[\\&%$#_{}~^]/g, (c) => ESC[c]);

/** 行内标记：粗体 / 代码 / 链接 / 公式保护
 *
 * 处理顺序至关重要，分四步：
 *   1) 抽出数学公式（$...$）并替换为占位符 —— 公式内容**不做任何转义**
 *   2) 抽出行内代码（`...`）并替换为占位符 —— 代码内容也不转义
 *   3) 对剩余纯文本做 LaTeX 特殊字符转义（含裸 _ ^ & % $ # ~ 与单反斜杠）
 *   4) 还原公式与代码占位符，再套上 \textbf / \href 等标记
 *
 * 若把转义放在抽公式之前，`$\int_0^T$` 会被转义成字面文本；若先套标记再转义，
 * 我们插入的 `\textbf` 又会被二次转义。故必须严格按上述顺序。
 *
 * 注意：公式必须在**单元格粒度**调用（表格逐格处理），否则跨单元格的 $ 会被错误配对。
 */
function inline(s) {
  const stash = [];
  const protect = (content) => `\u0000X${stash.push(content) - 1}\u0000`;

  let x = String(s);

  // 1) 公式
  //    顺序：块级 $$...$$ 与 \[...\] 先行（跨行、内部可含空行），再处理行内 $...$。
  //    否则 $$...$$ 会被行内规则拆成两个 $ 而吞掉正文；\[...\] 若不被保护，
  //    会在第 4 步被 esc() 转义成字面 \textbackslash{}[，公式整段作废。
  x = x.replace(/\$\$([\s\S]*?)\$\$/g, (m, b) => protect(`\\[\n${b.trim()}\n\\]`));
  x = x.replace(/\\\[([\s\S]*?)\\\]/g, (m, b) => protect(`\\[\n${b.trim()}\n\\]`));
  x = x.replace(/\$([^$\n]+)\$/g, (m, b) => protect(`$${b}$`));
  // 2) 行内代码
  //    代码内容不参与第 4 步转义，因此必须在此处自行转义 LaTeX 特殊字符：
  //    否则 `e_∥`、`A_k` 中的下划线会在文本模式触发 "Missing $ inserted"，
  //    LaTeX 进入数学模式后 \item / \end{itemize} 全部报错，PDF 被静默截断。
  const escCode = (t) => String(t).replace(/([\\{}#$%&_^~])/g, (c) => (
    c === '^' ? '\\^{}' : c === '~' ? '\\textasciitilde{}' : `\\${c}`
  ));
  x = x.replace(/`([^`]+)`/g, (m, b) => protect(`\\texttt{${escCode(b)}}`));
  // 3) 链接与图片（先取出目标，避免 URL 中的特殊字符被转义）
  //
  //    图片采用条件包含，保证任何情况下文档都能完整编译（不产生
  //    "Unable to load picture" 这类致命错误）：
  //      · 写到 .png/.jpg 时 —— ① 同名 .tikz 存在则 \input（矢量，免外部文件）
  //                            ② 位图存在则 \includegraphics
  //                            ③ 都没有则输出一行占位说明
  //      · 直接写到 .tikz 时 —— ① 存在则 \input
  //                            ② 不存在则输出一行占位说明
  //    注意：绝不能把 .tikz 当成普通链接，否则 \href 会让图整块消失。
  const figPlaceholder = (txt, hint) =>
    `\\begin{center}\\fbox{\\parbox{0.9\\linewidth}{\\small\\noindent`
    + `【此处应为图：${esc(txt)}】${hint}}}\\end{center}`;

  x = x.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, href) =>
    /\.(png|jpg|jpeg)$/i.test(href)
      ? protect(
          `\\IfFileExists{${href.replace(/\.(png|jpg|jpeg)$/i, '.tikz')}}`
          + `{\\input{${href.replace(/\.(png|jpg|jpeg)$/i, '.tikz')}}}`
          + `{\\IfFileExists{${href}}`
          + `{\\begin{center}\\includegraphics[width=\\linewidth]{${href}}\\end{center}}`
          + `{${figPlaceholder(txt,
              '尚未提供图片文件。可二选一：(a) 把同名 \\texttt{.tikz} 矢量文件放在本 '
              + '\\texttt{.tex} 同目录，重新编译即自动嵌入；'
              + `(b) 提供 \\texttt{${esc(href)}} 位图后重新编译。`)}}}`,
        )
      : /\.tikz$/i.test(href)
        ? protect(
            `\\IfFileExists{${href}}{\\input{${href}}}`
            + `{${figPlaceholder(txt,
                '尚未提供 \\texttt{.tikz} 文件：请把它放在本 \\texttt{.tex} 同目录后重新编译。')}}`,
          )
        : protect(`\\href{${href}}{${esc(txt)}}`));

  // 4) 转义纯文本
  x = esc(x);

  // 5) 粗体（在转义之后套，避免被二次转义；** 本身不含特殊字符）
  x = x.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');

  // 6) 还原占位符
  x = x.replace(/\u0000X(\d+)\u0000/g, (m, k) => stash[Number(k)]);
  return x;
}

const lines = md.split(/\r?\n/);

/**
 * 按列数计算表格列宽。
 *
 * 三条约束（都是踩出来的）：
 *   · 固定 0.22\linewidth 在 5 列以上会溢出（5×0.22 = 1.10 > 1），必须按列数分配。
 *   · 需为**列间距（2×\tabcolsep）与边框线**留余量，否则列宽之和看似 <1 仍会越界——
 *     实测一份稿件因此有 2 处文本超出页面右边界 4.2pt（居中列被推出纸张）。
 *   · 每列上限不能太大：2 列时 0.45 恰好把内容顶到右边缘，故降到 0.42。
 * 另在导言区把 \tabcolsep 收小，进一步留出安全余量。
 */
function tableColSpec(n) {
  const total = 0.90;                     // 为边框、列间距与累积误差留 10% 余量
  const each = total / n;
  const w = Math.max(0.08, Math.min(each, 0.40));
  return '|' + `>{\\raggedright\\arraybackslash}p{${w.toFixed(3)}\\linewidth}|`.repeat(n);
}

const body = [];
let i = 0;
let para = [];
const flush = () => { if (para.length) { body.push(inline(para.join(''))); body.push(''); para = []; } };

// 跳过文首的元信息（标题与说明块），由 preamble 统一处理
let start = 0;
for (let k = 0; k < lines.length; k++) { if (/^##\s*（一）/.test(lines[k])) { start = k; break; } }

for (i = start; i < lines.length; i++) {
  const L = lines[i];

  // 代码块 → verbatim
  if (/^```/.test(L)) {
    flush();
    const buf = [];
    i++;
    while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
    body.push('\\begin{Verbatim}[fontsize=\\scriptsize,frame=single,breaklines=true]');
    body.push(...buf);
    body.push('\\end{Verbatim}');
    body.push('');
    continue;
  }

  // 表格
  if (/^\s*\|/.test(L) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    flush();
    const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(L);
    i += 2;
    const rows = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
    i--;
    const colSpec = tableColSpec(head.length);
    body.push(`\\begin{longtable}{${colSpec}}`);
    body.push('\\hline');
    body.push(head.map((c) => `\\textbf{${inline(c)}}`).join(' & ') + ' \\\\');
    body.push('\\hline');
    body.push('\\endfirsthead');
    body.push('\\hline');
    body.push(head.map((c) => `\\textbf{${inline(c)}}`).join(' & ') + ' \\\\');
    body.push('\\hline');
    body.push('\\endhead');
    for (const r of rows) {
      const padded = [...r];
      while (padded.length < head.length) padded.push('');
      body.push(padded.slice(0, head.length).map((c) => inline(c)).join(' & ') + ' \\\\');
      body.push('\\hline');
    }
    body.push('\\end{longtable}');
    body.push('');
    continue;
  }

  // 标题
  let m;
  if ((m = L.match(/^(#{1,6})\s+(.*)$/))) {
    flush();
    const lv = m[1].length;
    const txt = m[2];
    // 一级（#）→ 不输出（标题在 preamble 里）；二级（##）→ section；三级 → subsection；四级 → subsubsection；五/六级 → paragraph
    if (lv === 1) { /* 题目在 preamble */ }
    else if (lv === 2) body.push(`\\section*{${inline(txt)}}`);
    else if (lv === 3) body.push(`\\subsection*{${inline(txt)}}`);
    else if (lv === 4) body.push(`\\subsubsection*{${inline(txt)}}`);
    else body.push(`\\paragraph{${inline(txt)}}`);
    body.push('');
    continue;
  }

  // 引用块 → quote 环境（紧凑）
  if (/^>\s?/.test(L)) {
    flush();
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
    i--;
    body.push('\\begin{quote}\\small');
    for (const b of buf) {
      if (!b.trim()) { body.push(''); continue; }
      body.push(inline(b));
      body.push('');
    }
    body.push('\\end{quote}');
    body.push('');
    continue;
  }

  // 列表
  if (/^\s*[-*]\s+/.test(L)) {
    flush();
    const items = [];
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
    i--;
    body.push('\\begin{itemize}[leftmargin=2em,itemsep=2pt,topsep=3pt]');
    for (const t of items) body.push(`  \\item ${inline(t)}`);
    body.push('\\end{itemize}');
    body.push('');
    continue;
  }
  if (/^\s*\d+\.\s+/.test(L)) {
    flush();
    const items = [];
    while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
    i--;
    body.push('\\begin{enumerate}[leftmargin=2em,itemsep=2pt,topsep=3pt]');
    for (const t of items) body.push(`  \\item ${inline(t)}`);
    body.push('\\end{enumerate}');
    body.push('');
    continue;
  }

  if (/^\s*---+\s*$/.test(L)) { flush(); body.push('\\vspace{4pt}\\noindent\\rule{\\linewidth}{0.4pt}\\vspace{4pt}'); body.push(''); continue; }
  if (!L.trim()) { flush(); continue; }

  para.push(L);
}
flush();

// ─────────────────────────────────────────────
// 封面信息与 LaTeX 模板
// ─────────────────────────────────────────────
// 均从共享模块取，保证两套模板（青年C类 / 面上）与合规校验器使用同一真源：
//   · track-params.mjs  申报类型参数（官方提纲原文、正文外约束）
//   · tex-template.mjs  导言区、封面与整体渲染
const cover = buildCover(md, track);
// --meta 追加行（可重复），如 --meta "申请代码：F0601"
const extraMeta = rawArgs
  .map((a, i) => (a === '--meta' ? rawArgs[i + 1] : null))
  .filter(Boolean);
if (extraMeta.length) {
  const esc2 = (s) => String(s).replace(/([&%$#_{}])/g, '\\$1');
  cover.coverMeta += '\\\\[3pt]\n    ' + extraMeta.map(esc2).join('\\\\[3pt]\n    ');
}

const tex = renderTex({ track, body: body.join('\n'), cover });

writeFileSync(OUT, tex, 'utf8');
console.log('LaTeX 源已生成:', OUT);
console.log('  申报类型:', `${track.label}（${track.id}）`);
console.log('  长度:', tex.length, '字符');
console.log('  section*:', (tex.match(/\\section\*/g) || []).length);
console.log('  longtable:', (tex.match(/\\begin\{longtable\}/g) || []).length);
console.log('  Verbatim:', (tex.match(/\\begin\{Verbatim\}/g) || []).length);
