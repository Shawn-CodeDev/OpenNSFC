// OpenNFSC · 一致性校验  (powered by gary)
// ---------------------------------------------------------------------------
// 检查那些"人眼通读极易漏掉"的文稿硬伤。这些缺陷不会导致编译失败、
// 也不违反模板结构，但评审一眼就能看出，且会削弱专业性判断。
//
// 四类检查（均来自对一份已获批申请书的实测缺陷，见 docs/获批本解剖.md 第 8.4 节）：
//   1. 术语混用    同一概念出现两种叫法（实测案例：半监督 18 处 vs 弱监督 2 处）
//   2. 图号一致性  正文引用「如图N所示」必须存在对应图注，且编号唯一
//                   （实测案例：正文引"图3"，图注却写"图 1"，且"图1"重复出现）
//   3. 常见错字    同音近形误用（实测案例："微妙级" 应为 "微秒级"）
//   4. 占位符残留  〔待补〕/TODO/XXX 等未清理标记
//
// 用法：
//   node bin/check-consistency.mjs <正文.md>
//   node bin/check-consistency.mjs <正文.md> --json
//   node bin/check-consistency.mjs <正文.md> --strict     # 警告也视为失败
//
// 退出码：0 通过 / 1 发现阻断问题（--strict 下警告也阻断）
import { readFileSync } from 'node:fs';
import { FIGURE_REF_PATTERN } from './lib.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const strict = args.includes('--strict');

if (!file) {
  console.error('用法: node bin/check-consistency.mjs <正文.md> [--json] [--strict]');
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(file, 'utf8');
} catch (e) {
  console.error(`无法读取 ${file}: ${e.message}`);
  process.exit(1);
}

const lines = raw.split(/\r?\n/);
const findings = [];
const add = (level, kind, message, extra = {}) =>
  findings.push({ level, kind, message, ...extra });

// ─────────────────────────────────────────────────────────────
// 1. 术语混用
// ─────────────────────────────────────────────────────────────
// 已知易混术语组。每组内多个写法指向同一概念，同时出现即告警。
const TERM_GROUPS = [
  { name: '监督学习强度', variants: ['半监督', '弱监督', '自监督'] },
  { name: '一致性模型', variants: ['一致性模型', '一致性蒸馏'] },
  { name: '采样步数', variants: ['采样步数', '推理步数', '去噪步数'] },
  { name: '轨迹', variants: ['概率流ODE', '概率流 ODE', 'PF-ODE'] },
  { name: '时间分辨', variants: ['微秒', '微妙'] },
];

for (const g of TERM_GROUPS) {
  const counts = g.variants.map((v) => ({
    v,
    n: (raw.match(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length,
  })).filter((c) => c.n > 0);
  if (counts.length > 1) {
    // 若某个写法只占少数且总量小，更可能是笔误
    const total = counts.reduce((s, c) => s + c.n, 0);
    const minority = counts.filter((c) => c.n / total < 0.2);
    const detail = counts.map((c) => `「${c.v}」${c.n} 处`).join('、');
    add(
      minority.length ? 'warn' : 'info',
      '术语混用',
      `${g.name}：同一概念出现多种叫法 —— ${detail}`,
      { group: g.name, counts, minority: minority.map((m) => m.v) },
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 2. 图号一致性
// ─────────────────────────────────────────────────────────────
// 2a. 收集图注。图注的常见写法都要认：
//     · 独立成行     「图1 技术路线图」
//     · Markdown 强调 「*图1 技术路线图*」/「**图1 技术路线图**」
//     · 半角或全角空格 「图 10 动平台事件成像运动补偿」（实测获批本即用半角空格）
//     · 图文混排      「（a）原始事件帧 （b）补偿事件帧」这类子图标签紧随其后
//
//     必须排除正文中"如图1所示"这类行内引用，以及「知识产权表 1–2 项」这种
//     "表"恰好是一个多字词末字的情况（实测误报：把"表 1"当成了表号）。
const CJK = '\\u4e00-\\u9fa5';
const captionRe = new RegExp(`^\\s*(?<![-${CJK}])(图|表)\\s*(\\d+)\\s*[　:：]?\\s*(.+?)\\s*$`);
const mdWrapRe = new RegExp(`^\\s*(?:\\*{1,2}|_{1,2})?\\s*(?<![-${CJK}])(图|表)\\s*(\\d+)\\s*[　:：]?\\s*(.+?)\\s*(?:\\*{1,2}|_{1,2})?\\s*$`);
const captions = [];
lines.forEach((l, i) => {
  const m = l.match(mdWrapRe) || l.match(captionRe);
  // 排除"如图1所示""图1展示"这类行内引用被误当图注
  if (m && !/所示|展示|中给出|中可见|给出|可见/.test(m[3])) {
    captions.push({ kind: m[1], num: Number(m[2]), title: m[3].replace(/\*+/g, '').trim(), line: i + 1 });
  }
});

// 2b. 图注编号是否唯一
const byKey = new Map();
for (const c of captions) {
  const k = `${c.kind}${c.num}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(c);
}
for (const [k, arr] of byKey) {
  if (arr.length > 1) {
    add('fail', '图号重复', `${k} 出现 ${arr.length} 次图注（行 ${arr.map((a) => a.line).join('、')}）`, {
      figure: k,
      lines: arr.map((a) => a.line),
    });
  }
}

// 2c. 收集正文中出现的图号引用。
// 中文的引用写法极多：「如图1所示」「项目的技术路线如图1」「见图1」「（图1）」，
// 早期版本要求图号后必须紧跟"所示/给出/可见"，漏掉了句末引用（实测漏报）。
//
// 但无约束的 /[图表]\s*\d+/ 会产生**误报**，因为"图""表"是多字词的构成字。
// 实测两类误报：
//   「知识产权表 1–2 项」→ 误判为表号"表 1"
//   「所表现的能力 1 篇」→ 误判为表号"表 1"
// 两者共同特征是 **"表" 与数字之间有一个半角空格**——而正文引用图号几乎从不这么写
// （要么紧邻"图1"，要么用全角空格"图　1"；半角空格只出现在**图注本身**，
//  如获批本的"图 10 动平台事件成像运动补偿"，那属于 captionLine 已被跳过）。
//
// 因此采用**双保险**：
//   · 前置排除：图/表 之前是构成多字词的字（知识产权表 / 表达 / 表现 / 表明…）
//   · 间隔收紧：只允许**无间隔或全角空格**，不允许半角空格
//   · 后置排除：数字紧跟 "–/—/~/至 + 数字" 说明是数值区间，不是图号
//
// 注意：**不能用 (?<![\u4e00-\u9fa5]) 排除所有汉字**——那会把「如图2所示」的
// "如图" 一起排除掉，导致真实引用 100% 漏检（实测踩过这个坑）。
// 图/表号引用的识别正则定义在 bin/lib.mjs（与 cli.mjs 的自检共用，避免两处漂移）。
// 修改前请先看 `node bin/cli.mjs self-test` 中的「回归: 图号引用识别边界」用例。
const citationRe = new RegExp(FIGURE_REF_PATTERN, 'g');
const captionLineSet = new Set(captions.map((c) => c.line));
const cited = new Map();
lines.forEach((l, i) => {
  const lineNo = i + 1;
  if (captionLineSet.has(lineNo)) return;          // 跳过图注行
  const stripped = l.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // 去掉图片语法（含 alt）
  let m;
  const re = new RegExp(citationRe.source, 'g');
  while ((m = re.exec(stripped)) !== null) {
    const k = `${m[1]}${m[2]}`;
    if (!cited.has(k)) cited.set(k, []);
    cited.get(k).push(lineNo);
  }
});
for (const [k, ls] of cited) {
  if (!byKey.has(k)) {
    add('fail', '图号悬空', `正文引用了「${k}」（行 ${ls.join('、')}），但没有对应图注`, {
      figure: k,
      lines: ls,
    });
  }
}

// 2d. 有图注但正文从未引用
for (const [k, arr] of byKey) {
  if (!cited.has(k)) {
    add('warn', '图未被引用', `「${k} ${arr[0].title}」有图注但正文从未引用`, {
      figure: k,
      line: arr[0].line,
    });
  }
}

// 2e. 编号连续性
for (const kind of ['图', '表']) {
  const nums = [...byKey.keys()]
    .filter((k) => k.startsWith(kind))
    .map((k) => Number(k.slice(1)))
    .sort((a, b) => a - b);
  if (nums.length) {
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] !== i + 1) {
        add('fail', '图号不连续', `${kind}编号不是从 1 连续递增：实际为 ${nums.join(',')}`, {
          kind,
          nums,
        });
        break;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 2f. 自我宣称式大词（官方明确要求"摒弃套路与话术"）
// ─────────────────────────────────────────────────────────────
// 实测标尺：一份**已获批**的青年本全文，下列"硬大词"出现次数全部为 0。
// 关键是要区分两种用法——
//   · 自我宣称：「本项目首次实现…」「达到国际领先水平」→ 警告
//   · 陈述他人：「该方法首次提出…」「TRACE 识别边界首次出现的时刻…［5］」→ 正常
// 判据：**按整句判断**，句内出现引用标记或指向他人的主语即视为陈述他人。
// 教训：不要用"大词前后 N 字符内有引用"这种窗口判据——中文长句里引用常在句尾，
//       实测距大词可达 100 字符，窗口判据会误报（已踩过）。
const BIG_WORDS_HARD = ['首次', '国际领先', '填补空白', '国内外首创', '率先', '突破性'];
const BIG_WORDS_SOFT = ['有望', '可望', '旨在', '亟需', '亟待', '卡脖子'];
// 分句：按中文句读切成短句，箭头函数里再逐句定位大词
const splitSentences = (s) => s.split(/(?<=[。；！？])/).map((x) => x.trim()).filter(Boolean);
const OTHERS_SUBJECT = /(该方法|该文献|该方法|上述方法|已有方法|现有方法|相关工作|其|他们|作者|等人|团队|文献\s*[［\[]|\[[0-9])/;
lines.forEach((l, i) => {
  for (const sent of splitSentences(l)) {
    // 句内带引用标记，或主语指向他人 → 视为陈述他人，跳过
    if (/[［\[]\d+[］\]]/.test(sent) || OTHERS_SUBJECT.test(sent)) continue;
    for (const w of BIG_WORDS_HARD) {
      if (sent.includes(w)) {
        add('warn', '疑似自我宣称大词',
          `行 ${i + 1}：「${w}」——官方要求摒弃套路话术；自我宣称请改为具体机制或可检验表述`,
          { line: i + 1, word: w, snippet: sent.slice(0, 70) });
      }
    }
    for (const w of BIG_WORDS_SOFT) {
      if (sent.includes(w)) {
        // 软性词只在同句无具体内容时提示：句长过短或没有数字/条件限定，多半是空话
        const hasSubstance = /\d|[在当]|因为|由于|条件|前提|假设|若|则|使得|导致/.test(sent);
        if (!hasSubstance || sent.length < 18) {
          add('info', '疑似空洞表述',
            `行 ${i + 1}：「${w}」所在句缺少具体条件或数据——建议补上限定条件或删除`,
            { line: i + 1, word: w, snippet: sent.slice(0, 70) });
        }
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────
// 3. 常见错字（同音近形误用）
// ─────────────────────────────────────────────────────────────
const TYPOS = [
  ['微妙级', '微秒级', '时间单位应为"微秒"'],
  ['分辨率可达微妙', '分辨率可达微秒', '同上'],
  ['既使', '即使', '"既"与"即"误用'],
  ['以至于于', '以至于', '重复'],
  ['的的', '的', '重复助词'],
  ['进行行', '进行', '重复'],
  ['实验验', '实验', '重复'],
  ['精度度', '精度', '重复'],
  ['鲁棒性性', '鲁棒性', '重复'],
  ['因此此', '因此', '重复'],
];
lines.forEach((l, i) => {
  for (const [bad, good, why] of TYPOS) {
    if (l.includes(bad)) {
      add('fail', '疑似错字', `行 ${i + 1}：「${bad}」应为「${good}」（${why}）`, {
        line: i + 1,
        snippet: l.trim().slice(0, 60),
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────
// 4. 占位符残留
// ─────────────────────────────────────────────────────────────
const PLACEHOLDERS = ['〔待补〕', '[待补]', '【待补】', 'TODO', 'TBD', 'XXX', 'ＸＸＸ', '待填'];
lines.forEach((l, i) => {
  for (const p of PLACEHOLDERS) {
    if (l.includes(p)) {
      add('warn', '占位符残留', `行 ${i + 1}：发现「${p}」——正式提交前须补全或说明`, {
        line: i + 1,
        snippet: l.trim().slice(0, 60),
      });
      break;
    }
  }
});

// ─────────────────────────────────────────────────────────────
// 汇总输出
// ─────────────────────────────────────────────────────────────
const fails = findings.filter((f) => f.level === 'fail');
const warns = findings.filter((f) => f.level === 'warn');
const infos = findings.filter((f) => f.level === 'info');
const exitCode = fails.length > 0 || (strict && warns.length > 0) ? 1 : 0;

if (asJson) {
  console.log(JSON.stringify({
    file,
    ok: exitCode === 0,
    counts: { fail: fails.length, warn: warns.length, info: infos.length },
    captions,
    findings,
  }, null, 2));
} else {
  const C = {
    r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m',
    c: '\x1b[36m', b: '\x1b[1m', x: '\x1b[0m',
  };
  console.log('');
  console.log(`${C.c}▌${C.x} ${C.b}一致性校验${C.x}  ${C.d}${file}${C.x}`);
  console.log(`${C.d}  图注 ${captions.length} 个 / 行数 ${lines.length}${C.x}`);
  console.log('');

  const show = (label, arr, color) => {
    if (!arr.length) return;
    console.log(`${C.c}▌${C.x} ${label}（${arr.length}）`);
    arr.forEach((f) => {
      console.log(`  ${color}●${C.x} ${C.d}[${f.kind}]${C.x} ${f.message}`);
    });
    console.log('');
  };
  show('阻断问题', fails, C.r);
  show('警告', warns, C.y);
  show('提示', infos, C.c);

  console.log(`${C.c}▌${C.x} ${C.b}结论${C.x}`);
  const parts = [];
  if (fails.length) parts.push(`${C.r}阻断 ${fails.length}${C.x}`);
  else parts.push(`${C.g}阻断 0${C.x}`);
  parts.push(warns.length ? `${C.y}警告 ${warns.length}${C.x}` : `${C.g}警告 0${C.x}`);
  parts.push(`${C.d}提示 ${infos.length}${C.x}`);
  console.log(`  ${parts.join('   ')}`);
  if (exitCode === 0) {
    console.log(`  ${C.g}通过。${C.x}${C.d}（--strict 可把警告也视为失败）${C.x}`);
  } else {
    console.log(`  ${C.r}未通过——请逐项修正后重跑。${C.x}`);
  }
  console.log('');
  console.log(`  ${C.d}OpenNFSC · powered by gary${C.x}`);
}

process.exit(exitCode);
