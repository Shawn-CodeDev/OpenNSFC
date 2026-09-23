// OpenNFSC · PDF 版式校验（powered by gary）
// ---------------------------------------------------------------------------
// 把生成的 PDF 与**实测基准**逐项比对：页边距、正文边界、行距、字号、页眉页脚。
// 基准来自两份已获批申请书 PDF 原件的实测值，写在 track-params.mjs 的 LAYOUT / LEADING。
//
// 解决什么问题：排版差异（页边距是否对称、行距 1.5 还是 2 倍）肉眼几乎看不出来，
// 但它直接改变页数、进而决定能否塞进 30 页。必须数值比对，不能"看着差不多"。
//
// 解析器：内置 bin/vendor/pdfjs-dist（Apache-2.0，见 bin/vendor/pdfjs-LICENSE.txt）。
// 为什么内置而不零依赖自建：自建解析器需要处理 CTM 变换、CID 编码、多 Filter 流、
// 对象流映射等，实测反复出错（把 1.1 MB 的 ASCII85 图像流当内容流、把全篇并成一段、
// 左边距算成 3 mm）。版式校验是**判定性**用途，宁可多带 1.8 MB 也不给错数。
//
// 用法：
//   node bin/check-format.mjs <file.pdf> --expect youth|general
//   node bin/check-format.mjs <file.pdf> --expect general --json
//
// 退出码：0 通过 / 1 有超差项
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LAYOUT, LEADING, getTrack } from './track-params.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(HERE, 'vendor');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const exIdx = args.findIndex((a) => a === '--expect' || a.startsWith('--expect='));
const expectArg = exIdx < 0 ? null
  : (args[exIdx].includes('=') ? args[exIdx].split('=')[1] : args[exIdx + 1]);

if (!file) {
  console.error('用法: node bin/check-format.mjs <file.pdf> --expect youth|general [--json]');
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`文件不存在：${file}`);
  process.exit(1);
}
if (!expectArg) {
  console.error(`必须指定 --expect youth|general。
两类原件的行距不同（青年 22pt≈1.5 倍 / 面上 28pt≈2.0 倍），不指定就无法判定行距是否合规。`);
  process.exit(1);
}

let track;
try { track = getTrack(expectArg); } catch (e) { console.error(e.message); process.exit(1); }

const buf = readFileSync(file);
if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
  console.error(`${file} 不是合法 PDF（缺少 %PDF- 文件头）`);
  process.exit(1);
}

// ── 加载内置 pdfjs ──
let pdfjs;
try {
  const m = await import(`file:///${join(VENDOR, 'pdf.min.mjs').replace(/\\/g, '/')}`);
  pdfjs = m.default || m;
  pdfjs.GlobalWorkerOptions.workerSrc = `file:///${join(VENDOR, 'pdf.worker.min.mjs').replace(/\\/g, '/')}`;
} catch (e) {
  console.error(`无法加载内置 pdfjs（bin/vendor/）：${e.message}`);
  console.error('请确认 bin/vendor/ 下的 pdf.min.mjs 与 pdf.worker.min.mjs 完整。');
  process.exit(1);
}

const doc = await pdfjs.getDocument({
  data: new Uint8Array(buf),
  disableFontFace: true,
  isEvalSupported: false,
  useSystemFonts: false,
}).promise;

const PT2MM = 25.4 / 72;
const mm = (v) => +(v * PT2MM).toFixed(1);

// ── 逐页取文本项（**全页扫描**）──
// 为什么不用"取中间几页"：实测那样做极不稳——若取样页恰好是表格页或图页，
// 正文行极少，行距众数会落到表格行距上（面上本曾算出 12.4pt 而非 28pt），
// 右边界也会因该页无满行而偏小。全页扫描 + 稳健统计（众数/高分位）才可靠。
const all = [];              // {y, x0, x1, size, len, page}
let pageW = 595.276, pageH = 841.89;
for (let pn = 1; pn <= doc.numPages; pn++) {
  const page = await doc.getPage(pn);
  const vp = page.getViewport({ scale: 1 });
  pageW = vp.width; pageH = vp.height;
  const tc = await page.getTextContent();
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const size = Math.abs(it.transform[3]) || Math.abs(it.transform[0]);
    all.push({ y, x0: x, x1: x + (it.width || 0), size, len: it.str.trim().length, page: pn });
  }
}
if (!all.length) {
  console.error('未能从 PDF 取出文本——无法做版式校验。');
  process.exit(1);
}

// 行聚合：按 (页, y) 归并
all.sort((a, b) => a.page - b.page || b.y - a.y || a.x0 - b.x0);
const lines = [];
for (const it of all) {
  const last = lines[lines.length - 1];
  if (last && last.page === it.page && Math.abs(last.y - it.y) <= Math.max(2, it.size * 0.3)) {
    last.x0 = Math.min(last.x0, it.x0);
    last.x1 = Math.max(last.x1, it.x1);
    last.size = Math.max(last.size, it.size);
    last.chars += it.len;
  } else {
    lines.push({ page: it.page, y: it.y, x0: it.x0, x1: it.x1, size: it.size, chars: it.len });
  }
}

// 正文区判定。
// **不能用 0.07/0.93 这类比例阈值**：实测页脚那行 "第 N 页 版本：…" 一直延伸到
// x=535.3pt（与页眉同宽）；若把它算进正文，右边界被拉宽、右边距会算成 21mm
// （真实值 29.8mm）——本基准最初就是这么写错的。页眉基线 796.9pt、页脚 45pt，
// 故用固定界 y∈(60, 780) 更可靠。
const head = lines.filter((l) => l.y > 790);
const foot = lines.filter((l) => l.y <= 60);
const body = lines.filter((l) => l.y > 60 && l.y <= 790);

// 字号众数：按**字符数**加权（短行不足以代表正文）
const sizeWeight = new Map();
body.forEach((l) => sizeWeight.set(+l.size.toFixed(1), (sizeWeight.get(+l.size.toFixed(1)) || 0) + l.chars));
const bodySize = sizeWeight.size
  ? +[...sizeWeight.entries()].sort((a, b) => b[1] - a[1])[0][0]
  : null;

/** 取数组的众数（四舍五入到 1 位后统计） */
const mode = (arr) => {
  if (!arr.length) return { value: null, share: 0, n: 0 };
  const f = new Map();
  arr.forEach((v) => { const k = +v.toFixed(1); f.set(k, (f.get(k) || 0) + 1); });
  const top = [...f.entries()].sort((a, b) => b[1] - a[1])[0];
  return { value: top[0], share: +(top[1] / arr.length).toFixed(2), n: arr.length };
};

// 左边界：正文行的 x0 众数（比极值稳健——极值会受缩进/居中标题干扰）
const bodyLines = body.filter((l) => Math.abs(l.size - (bodySize || 12)) <= 0.6 && l.chars >= 6);
const leftMode = mode(bodyLines.map((l) => l.x0));
// 右边界：正文行 x1 的**最大值**。
// 曾用 90 分位，但实测 x1 的分位曲线很平（50%=487、90%=505、99%=511），
// 90 分位只到 505 而真实右边界是 510.8——分位法在此偏保守。
// 改用最大值，并靠"已排除页眉页脚 + 只取正文字号行"来防越界项。
const x1sorted = bodyLines.map((l) => l.x1).sort((a, b) => a - b);
const rightEdge = x1sorted.length ? x1sorted[x1sorted.length - 1] : null;

// 行距：全篇相邻正文行 y 差众数
const gaps = [];
const byPage = new Map();
bodyLines.forEach((l) => {
  if (!byPage.has(l.page)) byPage.set(l.page, []);
  byPage.get(l.page).push(l);
});
for (const [, arr] of byPage) {
  arr.sort((a, b) => b.y - a.y);
  for (let i = 1; i < arr.length; i++) {
    const g = +(arr[i - 1].y - arr[i].y).toFixed(1);
    if (g > 10 && g < 60) gaps.push(g);
  }
}
const leadMode = mode(gaps);

/**
 * 正文上/下边界：取**各页极值的众数**，而不是全篇单一极值。
 *
 * 为什么：实测承诺书页的「项目名称：…」在 y=769.84pt（页眉下方、10.5pt），
 * 比正文首行的 752.3pt 高出一行。用全篇最大 y 会把这类非正文行算进来，
 * 上边界算成 25.4mm（真实 31.6mm）。
 * **页眉与正文之间常有这类元信息行，无法靠 y 阈值把它们与正文分开**；
 * 但它们在绝大多数页上并不存在——取众数即可自然过滤。
 */
const perPageTop = [...byPage.values()].map((arr) => Math.max(...arr.map((l) => l.y)));
const perPageBottom = [...byPage.values()].map((arr) => Math.min(...arr.map((l) => l.y)));
const topMode = mode(perPageTop);
const bottomMode = mode(perPageBottom);

const measured = {
  页面: `${mm(pageW)} × ${mm(pageH)} mm`,
  左边距mm: leftMode.value === null ? null : mm(leftMode.value),
  右边距mm: rightEdge === null ? null : mm(pageW - rightEdge),
  正文上边界mm: topMode.value === null ? null : mm(pageH - topMode.value),
  正文下边界mm: bottomMode.value === null ? null : mm(bottomMode.value),
  页眉基线mm: head.length ? mm(pageH - Math.max(...head.map((l) => l.y))) : null,
  页脚基线mm: foot.length ? mm(Math.min(...foot.map((l) => l.y))) : null,
  正文字号pt: bodySize,
  行距pt: leadMode.value,
  行距占比: leadMode.share,
  左边界众数占比: leftMode.share,
  右边界取值: '正文行 x1 最大值',
  页数: doc.numPages,
};

const TOL = LAYOUT.容差;
const checks = [];
/**
 * 三档结论——区分"几何参数错了"与"内容把版心撑破了"：
 *   hard  硬性失败：由 geometry / linespread / 字号设定决定，**必须**落在基准内。
 *         左边界、页眉页脚位置、字号、行距 —— 这些只取决于模板，与正文内容无关。
 *   soft  内容相关：取决于正文写了什么（有无宽表格、首行位置）。
 *         越界说明**内容**有问题（如表格宽过版心），应当报出，但不代表模板错。
 *   floor 下限：正文末行距页底的距离不得小于基准（越大越宽松）。
 */
const cmp = (name, got, want, tol, level = 'hard') => {
  if (got === null || want === null || want === undefined) return;
  checks.push({ name, got, want, tol, ok: Math.abs(got - want) <= tol, level });
};
const cmpAtLeast = (name, got, min, level = 'floor') => {
  if (got === null || min === null || min === undefined) return;
  checks.push({ name, got, want: `≥ ${min}`, tol: '—', ok: got >= min - 0.5, level });
};

// —— 硬性：只由模板设定决定 ——
cmp('左边距', measured.左边距mm, LAYOUT.左边距mm, TOL.左, 'hard');
cmp('页眉基线', measured.页眉基线mm, LAYOUT.页眉基线mm, TOL.页眉页脚, 'hard');
cmp('页脚基线', measured.页脚基线mm, LAYOUT.页脚基线mm, TOL.页眉页脚, 'hard');
cmp('正文字号', measured.正文字号pt, LAYOUT.正文字号pt, TOL.字号pt, 'hard');
cmp('行距', measured.行距pt, LEADING[track.id].pt, TOL.行距pt, 'hard');

// —— 内容相关：模板设对了，但正文可能把版心撑破 ——
cmp('右边距', measured.右边距mm, LAYOUT.右边距mm, TOL.右, 'soft');
cmp('正文上边界', measured.正文上边界mm, LAYOUT.正文上边界mm, TOL.上, 'soft');
cmpAtLeast('正文下边界', measured.正文下边界mm, LAYOUT.正文下边界mm, 'floor');

const hardFail = checks.filter((c) => !c.ok && c.level === 'hard');
const softFail = checks.filter((c) => !c.ok && c.level !== 'hard');
// 退出码只由硬性项决定：几何参数错了会**系统性**影响每一页，必须拦住；
// 内容相关项则取决于正文写了什么（如某张表格宽过版心），报出但不阻断。
const ok = hardFail.length === 0;

if (asJson) {
  console.log(JSON.stringify({
    file, track: track.id, measured,
    expected: { ...LAYOUT, 行距: LEADING[track.id] },
    checks, hardFailures: hardFail.map((c) => c.name), softWarnings: softFail.map((c) => c.name),
    ok,
  }, null, 2));
} else {
  const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', c: '\x1b[36m', b: '\x1b[1m', x: '\x1b[0m' };
  console.log('');
  console.log(`${C.c}▌${C.x} ${C.b}PDF 版式校验${C.x}  ${C.d}${file}${C.x}`);
  console.log(`${C.d}  申报类型：${track.label}；基准为两份已获批本 PDF 的实测值${C.x}`);
  console.log(`${C.d}  全页扫描，共 ${doc.numPages} 页${C.x}`);
  console.log('');
  console.log(`${C.c}▌${C.x} 实测 vs 基准`);
  const show = (arr, label) => {
    if (!arr.length) return;
    console.log(`  ${C.d}— ${label} —${C.x}`);
    for (const c of arr) {
      const mark = c.ok ? `${C.g}✓${C.x}` : (c.level === 'hard' ? `${C.r}✗${C.x}` : `${C.y}!${C.x}`);
      const tag = c.level === 'hard' ? '模板' : (c.level === 'floor' ? '下限' : '内容');
      console.log(`  ${mark} ${c.name.padEnd(6)} 实测 ${String(c.got).padStart(6)}  基准 ${String(c.want).padStart(6)}  容差 ${String(c.tol).padStart(4)}  ${C.d}[${tag}]${C.x}`);
    }
  };
  show(checks.filter((c) => c.level === 'hard'), '硬性项（只由模板设定决定）');
  show(checks.filter((c) => c.level === 'soft'), '内容相关项（取决于正文写了什么）');
  show(checks.filter((c) => c.level === 'floor'), '下限项');
  console.log(`  ${C.d}· 行距众数占比 ${measured.行距占比}（越高越可靠）${C.x}`);
  console.log('');
  console.log(`${C.c}▌${C.x} ${C.b}结论${C.x}`);
  if (hardFail.length === 0 && softFail.length === 0) {
    console.log(`  ${C.g}版式与实测基准一致。${C.x}`);
  } else if (hardFail.length === 0) {
    console.log(`  ${C.g}模板版式正确${C.x}（硬性项全通过）。`);
    console.log(`  ${C.y}另有 ${softFail.length} 项内容相关提示：${softFail.map((f) => f.name).join('、')}${C.x}`);
    console.log(`  ${C.d}这通常意味着正文里有宽表格或长串顶到版心外——建议核对该处内容；${C.x}`);
    console.log(`  ${C.d}不是模板问题，故不影响退出码。${C.x}`);
  } else {
    console.log(`  ${C.r}${hardFail.length} 项**模板几何**超差：${hardFail.map((f) => f.name).join('、')}${C.x}`);
    console.log(`  ${C.d}排版基准见 bin/track-params.mjs 的 LAYOUT / LEADING${C.x}`);
    if (softFail.length) console.log(`  ${C.y}另有内容相关提示：${softFail.map((f) => f.name).join('、')}${C.x}`);
  }
  console.log('');
  console.log(`  ${C.d}OpenNFSC · powered by gary${C.x}`);
}

process.exit(ok ? 0 : 1);
