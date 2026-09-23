// OpenNFSC · 报告正文提纲 PDF 生成器（powered by gary）
// ---------------------------------------------------------------------------
// 从 `bin/track-params.mjs` 的官方提纲原文生成《报告正文》PDF。
//
// 为什么不直接把 PDF 拷进包里：
//   · 基金委只在 ISIS 申报系统内提供 Word 版正文模板，公开渠道多为高校转发的
//     doc 附件（需验证码），难以稳定获取；
//   · 提纲原文本身是可以逐字核对的，真正的约束在**文字**而非 PDF 版式；
//   · 从同一真源生成 PDF，能保证"提纲 PDF / 校验器基准 / 模板"三者永不漂移——
//     这正是之前 `报告正文-青年C类-2026-提纲.txt` 与校验器不一致的根因。
//
// ⚠️ 生成物是**官方提纲的复刻件**，不是基金委原件。用于人工核对与模板起点；
//    正式提交请以 ISIS 系统下载的当年模板为准。
//
// 用法：
//   node bin/gen-outline-pdf.mjs                 # 生成两份干净版
//   node bin/gen-outline-pdf.mjs --track general # 只生成面上
//   node bin/gen-outline-pdf.mjs --marked        # 另生成带"复刻件"标识的一版
// ---------------------------------------------------------------------------
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRACKS, getTrack, SHARED } from './track-params.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TPL = join(ROOT, 'templates');
const TMP = join(ROOT, '.outline-build');

const args = process.argv.slice(2);
const trackArgIdx = args.findIndex((a) => a === '--track' || a.startsWith('--track='));
const trackArg = trackArgIdx < 0 ? null
  : (args[trackArgIdx].includes('=') ? args[trackArgIdx].split('=')[1] : args[trackArgIdx + 1]);
const marked = args.includes('--marked');
const targets = trackArg ? [getTrack(trackArg)] : Object.values(TRACKS);

/** TeX 转义 */
const esc = (s) => String(s)
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/([&%$#_{}])/g, '\\$1')
  .replace(/~/g, '\\textasciitilde{}')
  .replace(/\^/g, '\\textasciicircum{}');

/** 提纲条目的 LaTeX 排版：一级用黑体段，二级挂编号自然段 */
function renderItems(track) {
  const out = [];
  for (const it of track.items) {
    if (it.level === 1) {
      out.push('');
      out.push(`\\vspace{4pt}\\noindent{\\heiti\\zihao{-4} ${esc(it.text)}}\\par`);
      out.push('\\vspace{2pt}');
      if (it.paren) {
        out.push(`\\noindent{\\kaishu ${esc(it.paren)}}\\par`);
      }
    } else {
      out.push(`\\noindent ${esc(it.text)}\\par`);
    }
  }
  return out.join('\n');
}

function buildTex(track, opts = {}) {
  const mark = opts.marked
    ? `\\vspace{4pt}\\noindent\\fbox{\\parbox{0.97\\linewidth}{\\small\\kaishu
\\textbf{说明}：本文件是 OpenNFSC 依据基金委 2026 年公开发布的《${esc(track.label)}-填报说明与撰写提纲-2026》\\
生成的\\textbf{复刻件}，用于人工核对与模板起点，\\textbf{不是基金委原件}。\\
正式提交请以 ISIS 申报系统下载的当年模板为准。在本文件上撰写正文时，%
可先\\textbf{删除本说明框}。}}\\par\\vspace{6pt}`
    : '';
  return `% !TEX program = xelatex
% ============================================================================
%  国家自然科学基金 · ${track.label} · 报告正文（2026 版）
%
%  本文件由 OpenNFSC 的 bin/gen-outline-pdf.mjs 从 bin/track-params.mjs 生成。
%  提纲标题及括号中的文字与官方发布逐字一致。
%  官方原文："${SHARED.免责句}"
% ============================================================================
\\documentclass[12pt,a4paper]{ctexart}
\\usepackage[top=2.5cm,bottom=2.5cm,left=2.8cm,right=2.8cm]{geometry}
\\IfFontExistsTF{SimSun}{%
  \\setCJKmainfont{SimSun}[BoldFont=SimHei,ItalicFont=KaiTi]%
  \\setCJKsansfont{SimHei}%
}{%
  \\setCJKmainfont{FandolSong-Regular}[BoldFont=FandolHei-Regular,ItalicFont=FandolKai-Regular]%
  \\setCJKsansfont{FandolHei-Regular}%
}
\\linespread{1.45}\\selectfont
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{2pt}
\\usepackage{fancyhdr}
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\small\\songti ${esc(track.label)} · 报告正文（2026 版）}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{0pt}
\\begin{document}

\\begin{center}
  {\\heiti\\zihao{3} 报告正文（2026版）}
\\end{center}
\\vspace{2pt}

\\noindent 参照以下提纲撰写，要求内容翔实、清晰，层次分明，标题突出。\\textbf{${esc(SHARED.篇幅表述)}}${esc(SHARED.免责句)}

\\vspace{6pt}
\\noindent\\rule{\\linewidth}{0.6pt}
${mark}
${renderItems(track)}
\\vspace{8pt}
\\noindent\\rule{\\linewidth}{0.6pt}

\\vspace{4pt}
\\noindent{\\small\\kaishu 说明：正文篇幅原则上不超过 30 页（含图表）；标注"不涉及"的条目可填"无"。}

\\end{document}
`;
}

// ── 生成 ──
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });

const variants = marked
  ? [{ suffix: '', marked: false }, { suffix: '-复刻件', marked: true }]
  : [{ suffix: '', marked: false }];

let failed = 0;
for (const track of targets) {
  for (const v of variants) {
    // 命名：青年C类用 "青年C类"，面上用 "面上项目"（对齐官方文件名用词）
    const tag = track.id === 'general' ? '面上项目' : '青年C类';
    const stem = `报告正文-${tag}-2026-提纲${v.suffix}`;
    const texPath = join(TMP, `${stem}.tex`);
    writeFileSync(texPath, buildTex(track, { marked: v.marked }), 'utf8');

    const r = spawnSync('xelatex', ['-interaction=nonstopmode', '-halt-on-error', `${stem}.tex`], {
      cwd: TMP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pdfSrc = join(TMP, `${stem}.pdf`);
    if (!existsSync(pdfSrc)) {
      console.error(`✗ ${stem} 编译失败`);
      const tail = (r.stdout || '').split(/\r?\n/).filter((l) => /^!|Error/.test(l)).slice(0, 4);
      tail.forEach((l) => console.error('   ', l));
      failed++;
      continue;
    }
    const dest = join(TPL, `${stem}.pdf`);
    writeFileSync(dest, readFileSync(pdfSrc));
    console.log(`✓ ${stem}.pdf`);
  }
}

// 旧命名兼容提示
console.log('\n命名约定：报告正文-<类型>-2026-提纲.pdf（干净版）');
console.log('          报告正文-<类型>-2026-提纲-复刻件.pdf（带"复刻件"说明框）');

process.exit(failed ? 1 : 0);
