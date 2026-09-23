// OpenNFSC · LaTeX 模板生成器（powered by gary）
// ---------------------------------------------------------------------------
// 生成**自包含**的申请书正文 .tex（导言区 + 封面 + 正文），直接交给 xelatex 编译，
// 不需要任何额外的 .sty/.cls 文件——这是刻意的：
//   · `bin/compile-tex.ps1` 只把 .tex 与同目录图片/TikZ 复制到临时构建目录，
//     不复制其它源文件；自包含才能保证编译一定成功。
//   · 交付时单个 .tex 即可整体复现整份稿件，便于版本管理与长期归档。
//
// 两套模板（青年C类 / 面上项目）由 `track-params.mjs` 驱动。正文结构与提纲要求
// 两类几乎相同（仅 4 处措辞），但**排版规格有一处实测差异：行距**——
// 青年本 22pt（≈1.5 倍），面上本 28pt（≈2.0 倍）。其余版式两份一致。
// 所有数值取自两份已获批本 PDF 原件的逐项实测，见 track-params.mjs 的 LAYOUT / LEADING。
// ---------------------------------------------------------------------------
import { SHARED, LAYOUT, LEADING } from './track-params.mjs';

/** 把 mm 转成 TeX 可用的长度字符串 */
const mm = (v) => `${v}mm`;

/** 转义 TeX 特殊字符（用于封面等直接插入的位置） */
export function escapeTex(s) {
  return String(s)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * 从 Markdown 自动提取封面信息，并识别申报类型。
 * 不硬编码任何项目信息，因此适用于任何方向的申请书。
 */
export function buildCover(markdown, track) {
  const L = markdown.split(/\r?\n/);

  // 标题：第一个一级标题
  let title = '';
  for (const l of L) {
    const m = l.match(/^#\s+(.+?)\s*$/);
    if (m) { title = m[1]; break; }
  }
  if (!title) title = '国家自然科学基金项目申请书';

  // 副标题：优先取"含申报类型名"的行，否则退回默认
  let subtitle = `国家自然科学基金 · ${track.label} · 报告正文`;
  for (const l of L.slice(0, 30)) {
    const t = l.replace(/[*_>#]/g, '').trim();
    if (t.length >= 80) continue;
    // 明确写了类型名的行优先
    if (/(青年科学基金项目|青年基金|青年C类|面上项目)/.test(t) && t.length < 60) { subtitle = t; break; }
    if (/申请书/.test(t) && /正文/.test(t)) { subtitle = t; }
  }

  // 元信息：申请代码 / 研究属性 / 执行期 / 依托单位
  const meta = [];
  const grab = (re) => {
    for (const l of L.slice(0, 40)) {
      const m = l.match(re);
      if (m) return m[0].replace(/[*_]/g, '').trim();
    }
    return null;
  };
  const code = grab(/申请代码[：:][^\n|]*/);
  const attr = grab(/研究属性[：:][^\n|]*/);
  const dur = grab(/(执行期|执行期限|研究期限)[：:][^\n|]*/);
  const inst = grab(/(依托单位|申请单位)[：:][^\n|]*/);
  for (const v of [code, attr, dur, inst]) if (v) meta.push(v);

  // 未提供执行期时，给出与申报类型一致的提示（青年 3 年 / 面上 4 年）
  if (!dur) {
    meta.push(track.id === 'general'
      ? '执行期：〔待补：面上项目资助期限为 4 年〕'
      : '执行期：〔待补：青年科学基金项目（C类）资助期限为 3 年〕');
  }

  // 标题过长时在标点处折行，避免超出页面宽度
  let titleTex = escapeTex(title);
  if (title.length > 22) {
    const cut = title.search(/[：:——]| 的/);
    if (cut > 6 && cut < title.length - 4) {
      const a = title.slice(0, cut + 1);
      const b = title.slice(cut + 1).trim();
      titleTex = `${escapeTex(a)}\\\\[6pt] ${escapeTex(b)}`;
    }
  }

  return {
    coverTitle: titleTex,
    coverSubtitle: escapeTex(subtitle),
    coverMeta: meta.length
      ? meta.map(escapeTex).join('\\\\[3pt]\n    ')
      : '（申请代码 / 研究属性 / 执行期请在正文开头补充）',
  };
}

/**
 * 生成完整的 .tex 源码。
 * @param {object} opts
 * @param {object} opts.track   来自 track-params.mjs 的申报类型参数
 * @param {string} opts.body    已转换好的 LaTeX 正文
 * @param {object} opts.cover   buildCover() 的返回值
 * @returns {string}
 */
export function renderTex({ track, body, cover }) {
  const { coverTitle, coverSubtitle, coverMeta } = cover;
  return `% !TEX program = xelatex
% ============================================================================
%  国家自然科学基金 · ${track.label} · 报告正文
%
%  结构严格遵循国家自然科学基金委《报告正文（2026 版）》模板：
%    （一）立项依据
%    （二）研究内容（提纲不做限制，按研究工作的自身逻辑撰写；
%                    应提炼出特色与创新点、年度研究计划）
%    （三）研究基础 → 1.研究基础与可行性分析 / 2.工作条件 /
%                     3.正在承担的与本项目相关的科研项目情况 /
%                     4.完成国家自然科学基金项目情况
%    （四）其他需要说明的情况 → 1.–6.（第 5 项为生成式 AI 使用披露，独立必填）
%
%  篇幅：${SHARED.篇幅表述}
%
%  本文件由 OpenNFSC 依据 ${track.label} 的 2026 版官方提纲生成。
%  提纲标题及括号中的文字已逐字保留（官方明令"${SHARED.免责句}"）。
%
%  【${track.label}关键约束（正文之外，易被忽略）】
${Object.entries(track.facts).map(([k, v]) => `%    · ${k}：${v}`).join('\n')}
%
%  编译方式：xelatex 连续编译两次（生成页码与交叉引用）
%      & 'bin/compile-tex.ps1' -TexPath <本文件>
%
%  依赖：TeX Live 或 MiKTeX，需含 ctex / xeCJK / longtable / enumitem /
%        fancyhdr / hyperref / xcolor / caption / float / verbatim / tikz 宏包
% ============================================================================
\\documentclass[12pt,a4paper]{ctexart}

% ============================================================================
%  页面版式 —— **逐项复刻自已获批申请书 PDF 原件的实测值**
%
%  实测方法：用 pdf.js 取每个文本项的 transform（字号 / x / y），按行聚合后取众数。
%  两份原件（青年本 2024 版、面上本 2021 版）的下列数值完全一致：
%    · 左右边距非对称：左 ${LAYOUT.左边距mm} mm / 右 ${LAYOUT.右边距mm} mm（**不是**常见的对称页边距）
%    · 正文上边界距页顶 ${LAYOUT.正文上边界mm} mm，下边界距页底 ${LAYOUT.正文下边界mm} mm
%    · 页眉基线距页顶 ${LAYOUT.页眉基线mm} mm，页脚基线距页底 ${LAYOUT.页脚基线mm} mm
%    · 正文与各级标题同为 ${LAYOUT.正文字号pt} pt（小四），靠加粗/字体区分层级
%    · 页眉页脚 ${LAYOUT.页眉页脚字号pt} pt（小五）
%
%  几何参数换算说明：LaTeX 的 top/bottom 量的是"版心"边界，而上面是"文字实际位置"。
%  因此 top/bottom 取版心值，另用 head/headsep 与 foot/footskip 把页眉页脚推到实测位置。
% ============================================================================
\\usepackage[
  a4paper,
  left=${mm(LAYOUT.左边距mm)}, right=${mm(LAYOUT.右边距mm)},
  top=${LAYOUT.正文上边界mm}mm, bottom=${LAYOUT.正文下边界mm}mm,
  headheight=4mm, headsep=${(LAYOUT.正文上边界mm - LAYOUT.页眉基线mm).toFixed(1)}mm,
  footskip=${(LAYOUT.正文下边界mm - LAYOUT.页脚基线mm).toFixed(1)}mm
]{geometry}

% ---------- 字体（正文宋体小四；标题黑体；与原件观感一致） ----------
% 优先使用系统 Windows 中文字体；若缺失则回退到 TeX Live 自带的 Fandol 字体，
% 保证在任意平台都能编译成功（字体存在性判断命令由 fontspec 提供）。
\\IfFontExistsTF{SimSun}{%
  \\setCJKmainfont{SimSun}[BoldFont=SimHei,ItalicFont=KaiTi]%
  \\setCJKsansfont{SimHei}%
  \\setCJKmonofont{FangSong}%
}{%
  \\setCJKmainfont{FandolSong-Regular}[BoldFont=FandolHei-Regular,ItalicFont=FandolKai-Regular]%
  \\setCJKsansfont{FandolHei-Regular}%
  \\setCJKmonofont{FandolFang-Regular}%
}
\\IfFontExistsTF{Times New Roman}{\\setmainfont{Times New Roman}}{}
\\IfFontExistsTF{Consolas}{\\setmonofont{Consolas}}{}

% ---------- 行距与段落 ----------
% 行距为**实测值**，两类不同：
%   青年本（2024 版）实测 22pt（93% 的行）≈ Word 1.5 倍行距
%   面上本（2021 版）实测 28pt（73% 的行）≈ Word 2.0 倍行距
% 换算：行距系数 = 目标行距pt / (字号12pt × 1.2)。
\\linespread{${(LEADING[track.id].pt / (12 * 1.2)).toFixed(4)}}\\selectfont
\\setlength{\\parindent}{${LAYOUT.首行缩进字符}em}
\\setlength{\\parskip}{0pt}

% ---------- 标题格式 ----------
% 实测：原件各级标题与正文**同为 12pt**，没有字号放大；层级靠加粗与字体区分。
% 因此这里不再使用放大字号命令，避免与原件观感不符。
\\ctexset{
  section       = {format = \\heiti\\bfseries\\zihao{${LAYOUT.标题字号pt === 12 ? '-4' : '4'}}\\raggedright,
                   beforeskip = ${(LEADING[track.id].pt * 0.5).toFixed(0)}pt plus 2pt minus 2pt,
                   afterskip  = ${(LEADING[track.id].pt * 0.3).toFixed(0)}pt},
  subsection    = {format = \\heiti\\bfseries\\raggedright, beforeskip = ${(LEADING[track.id].pt * 0.4).toFixed(0)}pt, afterskip = ${(LEADING[track.id].pt * 0.2).toFixed(0)}pt},
  subsubsection = {format = \\heiti\\raggedright, beforeskip = ${(LEADING[track.id].pt * 0.3).toFixed(0)}pt, afterskip = ${(LEADING[track.id].pt * 0.15).toFixed(0)}pt},
}

% ---------- 其它宏包 ----------
\\usepackage{longtable}
\\usepackage{enumitem}
% amsmath 提供 lVert / rVert / text 等数学命令
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{tikz}
\\usetikzlibrary{arrows.meta,positioning,shapes.geometric,fit,backgrounds,calc}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{fancyhdr}
\\usepackage{xcolor}
\\usepackage{caption}
\\usepackage{float}
\\usepackage{verbatim}
\\usepackage{fancyvrb}
\\usepackage[hidelinks]{hyperref}
\\hypersetup{colorlinks=true,linkcolor=black,citecolor=black,urlcolor=blue}

\\newcolumntype{L}{>{\\raggedright\\arraybackslash}p{0.22\\linewidth}}
\\captionsetup{font=small,labelsep=quad}

% ---------- 页眉页脚（复刻原件样式） ----------
% 原件实测：页眉"国家自然科学基金申请书<年份>版"、页脚"第 N 页  版本：<系统编号>"，
% 均为 8pt。其中"版本："后的长编号由 ISIS 系统生成，无法离线复现，故此处留参数。
% 页眉居中、页脚页码居中（实测原件页眉居中于版心、页脚页码靠右，见下方 fancyhdr 设置）。
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[C]{\\songti\\zihao{${LAYOUT.页眉页脚字号pt === 8 ? '6' : '-5'}} \\nsfcHeader}
\\fancyfoot[C]{\\songti\\zihao{${LAYOUT.页眉页脚字号pt === 8 ? '6' : '-5'}} \\nsfcFooter}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}
% 页眉/页脚文字（可在正文 Markdown 顶部用 HTML 注释覆盖：<!-- nsfc-header: … -->）
\\newcommand{\\nsfcHeader}{国家自然科学基金申请书2026版}
\\newcommand{\\nsfcFooter}{第 \\thepage 页}

% ============================================================================
\\begin{document}

% 放宽断行容忍度：参考文献中的长 URL（OpenReview / arXiv）缺少常规断点，
% 不这样做会产生大量 Overfull hbox 溢出页边距。
% 注意：sloppy 与 emergencystretch 只能在 begin{document} 之后设置。
\\sloppy
\\emergencystretch=3em

% ---------- 封面信息 ----------
\\begin{center}
  {\\heiti\\zihao{2} ${coverTitle}}\\\\[14pt]
  {\\heiti\\zihao{4} ${coverSubtitle}}\\\\[10pt]
  {\\songti\\zihao{-4}
${coverMeta}
  }
\\end{center}
\\vspace{6pt}
\\noindent\\rule{\\linewidth}{0.8pt}

${body}

\\end{document}
`;
}
