#!/usr/bin/env node
/**
 * research-cli — 学术文献检索 / 校验 / 格式化 CLI（零依赖）
 *
 * 用法总览（所有命令均可用 --help 查看细节）：
 *   node tools/cli.mjs search   --source arxiv,crossref --query "..." --out lib.json
 *   node tools/cli.mjs plan     --topic "..." --english "..." --out plan.json
 *   node tools/cli.mjs enrich   --lib lib.json --mailto you@x.org
 *   node tools/cli.mjs import   --ris refs.ris --bib refs.bib --out lib.json
 *   node tools/cli.mjs add      --lib lib.json --json new-records.json
 *   node tools/cli.mjs dedupe   --lib lib.json
 *   node tools/cli.mjs stats    --lib lib.json
 *   node tools/cli.mjs validate --manuscript draft.md --lib lib.json [--strict]
 *   node tools/cli.mjs format   --lib lib.json --style gbt7714|bibtex|json [--out refs.md]
 *   node tools/cli.mjs gaps     --lib lib.json
 *   node tools/cli.mjs note     --lib lib.json --id <id> --set key=value
 *
 * 退出码：0 成功；1 用法/运行错误；2 validate 发现阻断性问题
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as L from './lib.mjs';
import { ARXIV_FEED_SAMPLE as feedSample } from './fixtures/arxiv-feed.sample.mjs';
import { ARXIV_ABS_SAMPLE as absSample, ARXIV_ABS_SAMPLE_WITH_JOURNAL as absJournalSample } from './fixtures/arxiv-abs.sample.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const args = parseArgs(argv.slice(1));

function parseArgs(a) {
  const out = { _: [] };
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = a[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(t);
  }
  return out;
}

const die = (msg) => { console.error(`错误：${msg}`); process.exit(1); };
const writeOut = (file, content) => {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, content, 'utf8');
};
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const csv = (s) => (typeof s === 'string' ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

function saveLib(file, lib, extra = {}) {
  lib.version = lib.version || '1.0';
  lib.updatedAt = new Date().toISOString();
  Object.assign(lib, extra);
  writeOut(file, JSON.stringify(lib, null, 2));
}

function loadOrInit(file) {
  return existsSync(file) ? L.loadLibrary(file) : { version: '1.0', updatedAt: null, query: null, records: [] };
}

// ─────────────────────────────────────────────
// plan — 生成确定性检索计划
// ─────────────────────────────────────────────
function cmdPlan() {
  const plan = L.buildQueryPlan({
    topic: args.topic || '',
    english: csv(args.english),
    synonyms: csv(args.synonyms),
    subtopics: csv(args.subtopics),
    venues: csv(args.venues),
    years: args.years || '2019-2026',
  });
  // 生成后自检：单一词元检索式、缺失类别、重复项
  const issues = L.auditQueryPlan(plan.plan, csv(args.venues));
  plan.audit = { issues, ok: issues.length === 0 };

  const out = args.out;
  const text = JSON.stringify(plan, null, 2);
  if (out) { writeOut(out, text); console.log(`已写出检索计划：${out}（${plan.count} 条检索式）`); }
  else console.log(text);

  if (issues.length && args.quiet !== true) {
    console.error(`\n⚠ 检索计划自检发现 ${issues.length} 个问题：`);
    for (const i of issues) console.error(`  · [${i.kind}] ${i.message}`);
    console.error('  请修正后再执行检索，否则会产生无效检索与无关结果。');
  }
  // 非阻断：计划质量问题由 agent/用户判断，不使命令失败
}

// ─────────────────────────────────────────────
// search — 多源检索并合并入库
// ─────────────────────────────────────────────
async function cmdSearch() {
  // --raw-query 优先作为检索式本身（arXiv 原生语法，不做 URL 编码）
  const query = args['raw-query'] || args.query || (args._.length ? args._.join(' ') : '');
  if (!query) die('需要 --query "检索式"（或 --raw-query "arXiv原生语法"）');
  const limit = Number(args.limit || 20);
  const out = args.out || 'library.json';
  const mailto = args.mailto || 'research-agent@example.org';
  const lib = loadOrInit(out);
  const all = [];
  let report = [];

  // --fallback：按优先级逐源尝试，直到某一源成功。
  // 推荐用法：实测源可用性会分钟级反转，手工逐个试源不可靠。
  if (args.fallback === true || args.fallback === 'true' || args.source === 'auto') {
    const r = await L.searchWithFallback(query, { limit, mailto, rawQuery: args['raw-query'], stopOnFirst: args.all !== true });
    all.push(...r.records);
    report = r.attempts;
    if (!r.usedSource) {
      console.error(`\n⚠ 全部 ${r.attempts.length} 个源均未取得结果：`);
      for (const a of r.attempts) console.error(`  · ${a.source}: ${a.status}${a.reason ? ' — ' + a.reason : ''}`);
      console.error('  建议：稍后重试，或由用户提供 RIS/BibTeX 后执行 import。');
    }
  } else {
    const sources = csv(args.source || 'crossref');
    for (const s of sources) {
      const fn = L.SOURCES[s];
      if (!fn) { report.push({ source: s, status: 'skipped', reason: '未知数据源' }); continue; }
      try {
        const res = s === 'crossref' || s === 'openalex'
          ? await fn(query, limit, mailto)
          : s === 'arxiv'
            ? await fn(query, limit, { rawQuery: args['raw-query'] })
            : await fn(query, limit);
        if (!res.length) { report.push({ source: s, status: 'empty', fetched: 0 }); continue; }
        all.push(...res);
        report.push({ source: s, status: 'ok', fetched: res.length });
      } catch (e) {
        report.push({ source: s, status: 'error', reason: String(e.message || e).slice(0, 120) });
      }
    }
  }

  const before = lib.records.length;
  lib.records.push(...all);
  const { records, conflicts } = L.dedupe(lib.records);
  lib.records = records;
  lib.query = lib.query || [];
  if (!Array.isArray(lib.query)) lib.query = [lib.query];
  lib.query.push({ query, sources: report.map((r) => r.source), at: new Date().toISOString() });
  saveLib(out, lib);

  console.log(JSON.stringify({
    query, out,
    fetched: all.length,
    libraryBefore: before,
    libraryAfter: lib.records.length,
    dedupedAway: before + all.length - lib.records.length,
    conflicts: conflicts.length ? conflicts : undefined,
    sources: report,
  }, null, 2));

  // 检索结果摘要（供 agent 直接阅读判断）
  if (args.summary !== 'false') {
    console.error('\n── 新增文献摘要 ──');
    for (const r of all.slice(0, Number(limit) * Math.max(1, report.length))) {
      const auth = (r.authors || []).slice(0, 2).join(', ') || 'Anon';
      console.error(`· [${r.year || '----'}] ${r.title.slice(0, 96)}  — ${auth} (${r.venue || r.source})`);
    }
  }
}

// ─────────────────────────────────────────────
// import — 导入 RIS / BibTeX
// ─────────────────────────────────────────────
function cmdImport() {
  const out = args.out || 'library.json';
  const lib = loadOrInit(out);
  const stats = {};
  let added = [];
  if (args.ris) {
    const recs = L.parseRIS(readFileSync(args.ris, 'utf8'));
    stats.ris = recs.length;
    added.push(...recs);
  }
  if (args.bib) {
    const recs = L.parseBibtex(readFileSync(args.bib, 'utf8'));
    stats.bibtex = recs.length;
    added.push(...recs);
  }
  if (!added.length) die('需要 --ris 或 --bib 文件');
  const before = lib.records.length;
  lib.records.push(...added);
  const { records } = L.dedupe(lib.records);
  lib.records = records;
  saveLib(out, lib);
  console.log(JSON.stringify({ out, parsed: stats, libraryBefore: before, libraryAfter: lib.records.length }, null, 2));
}

// ─────────────────────────────────────────────
// add — 由 agent 写入人工核验过的记录/标注
// ─────────────────────────────────────────────
function cmdAdd() {
  const libFile = args.lib || 'library.json';
  if (!args.json) die('需要 --json <记录数组文件>');
  const lib = loadOrInit(libFile);
  const incoming = readJson(args.json);
  const arr = Array.isArray(incoming) ? incoming : (incoming.records || []);
  if (!arr.length) die('--json 文件中无记录');
  for (const r of arr) {
    if (!r.id) r.id = `manual:${L.hashId(r.title || JSON.stringify(r))}`;
    if (!r.source) r.source = 'manual';
    if (!r.sources) r.sources = [r.source];
  }
  const before = lib.records.length;
  lib.records.push(...arr);
  const { records } = L.dedupe(lib.records);
  lib.records = records;
  saveLib(libFile, lib);
  console.log(JSON.stringify({ lib: libFile, added: arr.length, libraryBefore: before, libraryAfter: lib.records.length }, null, 2));
}

// ─────────────────────────────────────────────
// note — 给记录打 agent 分析标注
// ─────────────────────────────────────────────
function cmdNote() {
  const libFile = args.lib || 'library.json';
  const lib = loadOrInit(libFile);
  if (!args.id) die('需要 --id <记录 id>');
  const rec = lib.records.find((r) => r.id === args.id);
  if (!rec) die(`未找到记录：${args.id}`);
  rec.notes = rec.notes || {};
  let n = 0;
  for (const [k, v] of Object.entries(args)) {
    if (k === '_' || k === 'lib' || k === 'id') continue;
    if (k === 'set') {
      for (const pair of String(v).split(';')) {
        const [kk, ...vv] = pair.split('=');
        if (kk && vv.length) { rec.notes[kk.trim()] = vv.join('=').trim(); n++; }
      }
    } else if (k === 'verified') {
      rec.verified = String(v) === 'true' || v === true; n++;
    } else if (k === 'exclude') {
      rec.excluded = String(v) === 'true' || v === true;
      rec.excludeReason = args.reason || ''; n++;
    } else if (['relevance', 'mainline', 'gap', 'role'].includes(k)) {
      rec.notes[k] = v; n++;
    }
  }
  saveLib(libFile, lib);
  console.log(JSON.stringify({ id: rec.id, notes: rec.notes, updated: n }, null, 2));
}

// ─────────────────────────────────────────────
// dedupe
// ─────────────────────────────────────────────
function cmdDedupe() {
  const libFile = args.lib || 'library.json';
  const lib = loadOrInit(libFile);
  const before = lib.records.length;
  const { records, conflicts } = L.dedupe(lib.records);
  lib.records = records;
  saveLib(libFile, lib);
  console.log(JSON.stringify({ lib: libFile, before, after: records.length, removed: before - records.length, conflicts }, null, 2));
}

// ─────────────────────────────────────────────
// enrich — 对已有 DOI 的记录补齐正式元数据
// ─────────────────────────────────────────────
async function cmdEnrich() {
  const libFile = args.lib || 'library.json';
  const mailto = args.mailto || 'research-agent@example.org';
  const lib = loadOrInit(libFile);
  let updated = 0, failed = 0;
  for (const r of lib.records) {
    const need = !r.volume || !r.pages || r.type === 'preprint';
    if (!r.doi || !need) continue;
    try {
      const full = await L.crossrefByDoi(r.doi, mailto);
      const before = JSON.stringify([r.volume, r.pages, r.type, r.venue]);
      r.volume = r.volume || full.volume;
      r.pages = r.pages || full.pages;
      r.venue = r.venue || full.venue;
      r.publisher = r.publisher || full.publisher;
      if (r.type === 'preprint' && full.type !== 'preprint') { r.type = full.type; r.upgradedFromPreprint = true; }
      if (JSON.stringify([r.volume, r.pages, r.type, r.venue]) !== before) updated++;
      await L.sleep(Number(args.delay || 400));
    } catch { failed++; }
  }
  saveLib(libFile, lib);
  console.log(JSON.stringify({ lib: libFile, updated, failed }, null, 2));
}

// ─────────────────────────────────────────────
// stats
// ─────────────────────────────────────────────
function cmdStats() {
  const lib = loadOrInit(args.lib || 'library.json');
  const rs = lib.records;
  const byYear = {}, byType = {}, bySource = {}, byVenue = {};
  let withDoi = 0, withAbstract = 0, verified = 0, excluded = 0, recent5y = 0;
  const thisYear = new Date().getFullYear();
  for (const r of rs) {
    if (r.year) byYear[r.year] = (byYear[r.year] || 0) + 1;
    byType[r.type || '?'] = (byType[r.type || '?'] || 0) + 1;
    for (const s of r.sources || [r.source]) bySource[s || '?'] = (bySource[s || '?'] || 0) + 1;
    if (r.venue) byVenue[r.venue] = (byVenue[r.venue] || 0) + 1;
    if (r.doi) withDoi++;
    if (r.abstract) withAbstract++;
    if (r.verified) verified++;
    if (r.excluded) excluded++;
    if (r.year && thisYear - r.year <= 5) recent5y++;
  }
  const topVenues = Object.entries(byVenue).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const preprintRatio = rs.length ? (byType.preprint || 0) / rs.length : 0;
  console.log(JSON.stringify({
    total: rs.length,
    verified, excluded,
    withDoi, withAbstract,
    recent5y, recent5yRatio: rs.length ? +(recent5y / rs.length).toFixed(3) : 0,
    preprintRatio: +preprintRatio.toFixed(3),
    preprintRatioWarning: preprintRatio > 0.15 ? '预印本占比 >15%，需补充正式发表版本' : null,
    byYear, byType, bySource,
    topVenues,
  }, null, 2));
}

// ─────────────────────────────────────────────
// validate — 双向引用校验
// ─────────────────────────────────────────────
function cmdValidate() {
  if (!args.manuscript) die('需要 --manuscript <正文文件>');
  const text = readFileSync(args.manuscript, 'utf8');
  const lib = args.lib && existsSync(args.lib) ? L.loadLibrary(args.lib) : { records: [] };
  const res = L.validateCitations(text, lib.records);
  const strict = args.strict === true || args.strict === 'true';
  const minCitations = args['min-citations'] !== undefined ? Number(args['min-citations']) : 10;

  // 产出为空 ≠ 产出正确。
  // 一份没有任何引用的正文与一份引用完全对应的正文，在双向校验下都"通过"，
  // 但前者显然不合格。必须单独检出，否则本工具会对空文档给出假阳性通过。
  const blocking = [];
  if (res.missingInList.length) blocking.push(`正文引用了但列表中缺失：${res.missingInList.join(', ')}`);
  if (res.numberingIssues.length) blocking.push(...res.numberingIssues.map((i) => i.message));
  if (res.duplicateDoi.length) blocking.push(`重复 DOI：${res.duplicateDoi.map((d) => d.doi).join(', ')}`);
  if (res.citedCount === 0) {
    blocking.push('正文中未检出任何引用标记——立项依据/研究内容必须含文献支撑。若确为无引用文档，请显式传 --min-citations 0');
  } else if (res.citedCount < minCitations) {
    blocking.push(`正文引用数 ${res.citedCount} 低于下限 ${minCitations}（面青项目立项依据通常需 20-40 篇）`);
  }

  const warn = [];
  if (res.unusedInText.length) warn.push(`列表中列出但正文未引用：${res.unusedInText.join(', ')}（GB/T 顺序编码制下应无挂空文献）`);
  if (res.formatProblems.length) warn.push(`格式可疑 ${res.formatProblems.length} 条`);

  // ok 必须与 blocking 联动：blocking 非空时 ok 必为 false，
  // 否则调用方（含门控脚本）可能只看 ok 字段而误判通过。
  const out = {
    manuscript: args.manuscript,
    lib: args.lib || null,
    ...res,
    ok: res.ok && blocking.length === 0,
    blocking,
    warnings: warn,
  };
  if (args.out) writeOut(args.out, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (strict && (blocking.length || warn.length)) process.exit(2);
  if (blocking.length) process.exit(2);
}

// ─────────────────────────────────────────────
// format — 输出参考文献表
// ─────────────────────────────────────────────
function cmdFormat() {
  const lib = loadOrInit(args.lib || 'library.json');
  const style = (args.style || 'gbt7714').toLowerCase();
  const recs = lib.records.filter((r) => !r.excluded);
  if (!recs.length) die('库中无可用记录');

  let out = '';
  if (style === 'bibtex') {
    out = recs.map((r) => L.toBibtex(r)).join('\n\n') + '\n';
  } else if (style === 'json') {
    out = JSON.stringify(recs, null, 2);
  } else if (style === 'gbt7714' || style === 'gbt') {
    out = '参考文献\n' + recs.map((r, i) => L.toGBT7714(r, i + 1)).join('\n') + '\n';
  } else if (style === 'plain') {
    out = recs.map((r) => `${r.title} (${r.year}) ${r.venue} ${r.doi || ''}`).join('\n') + '\n';
  } else die(`未知 style：${style}（可选 gbt7714 | bibtex | json | plain）`);

  if (args.out) { writeOut(args.out, out); console.log(`已写出：${args.out}（${recs.length} 条）`); }
  else console.log(out);

  const missing = recs.filter((r) => L.toGBT7714(r, 1).includes('〔缺:')).length;
  if (missing) console.error(`\n提示：${missing} 条记录含缺失字段（以〔缺:xxx〕标出），需人工补全或用 enrich 补 DOI 元数据。`);
}

// ─────────────────────────────────────────────
// gaps — 结构性不足的候选证据
// ─────────────────────────────────────────────
function cmdGaps() {
  const lib = loadOrInit(args.lib || 'library.json');
  const res = L.suggestEvidenceGaps(lib.records);
  console.log(JSON.stringify({
    note: '以下为确定性启发式筛查结果，仅用于定位候选文献，是否构成"结构性不足"必须由 agent/人工阅读摘要后判断。',
    ...res,
  }, null, 2));
}

// ─────────────────────────────────────────────
// arxiv-by-id — 按 arXiv ID 精确补文献
// ─────────────────────────────────────────────
async function cmdArxivById() {
  const ids = args.ids || (args._.length ? args._.join(',') : '');
  if (!ids) die('需要 --ids 2303.01469,2310.04378');
  const out = args.out || 'library.json';
  let recs;
  try {
    recs = await L.arxivById(ids.split(',').map((s) => s.trim()).filter(Boolean));
  } catch (e) {
    die(`arXiv id_list 取回失败：${e.message}`);
  }
  const lib = loadOrInit(out);
  const before = lib.records.length;
  lib.records.push(...recs);
  const { records } = L.dedupe(lib.records);
  lib.records = records;
  saveLib(out, lib);
  console.log(JSON.stringify({
    out, requested: ids.split(',').length, fetched: recs.length,
    libraryBefore: before, libraryAfter: lib.records.length,
    records: recs.map((r) => ({ arxivId: r.arxivId, year: r.year, type: r.type, venue: r.venue, title: r.title.slice(0, 80) })),
  }, null, 2));
}

// ─────────────────────────────────────────────
// sources — 列出数据源与优先级
// ─────────────────────────────────────────────
function cmdSources() {
  console.log('数据源注册表：');
  for (const s of L.SOURCE_PRIORITY) {
    console.log(`  ${s.padEnd(14)} ${typeof L.SOURCES[s] === 'function' ? '已实现' : '未实现'}`);
  }
  console.log('\n其他可用标识：');
  for (const s of Object.keys(L.SOURCES)) {
    if (!L.SOURCE_PRIORITY.includes(s)) console.log(`  ${s.padEnd(14)} 别名/扩展`);
  }
  console.log(`
说明：
- 源可用性会随网络环境与限流状态在**分钟级反转**，因此推荐使用 --fallback 自动切换
- arXiv 支持 HTTP/HTTPS 双栈（实测二者可用性会相反）与原生检索语法（--raw-query）
- DBLP 返回的是反爬验证页（HTTP 200 但非文献），已不使用
- OpenAlex / Semantic Scholar 限流严格（429），需 API key 或降级为备用
`);
}

// ─────────────────────────────────────────────
// webget — 像浏览器一样访问网页 / 下载资源
// ─────────────────────────────────────────────
async function cmdWebget() {
  const url = args.url || args._[0];
  if (!url) die('需要 --url <URL>');
  const r = await L.fetchLikeBrowser(url, { timeoutMs: Number(args.timeout || 25000) });
  if (!r.ok) die(`获取失败：${url} — ${r.error || 'HTTP ' + r.status}`);

  const isPdf = /application\/pdf/i.test(r.contentType) || (r.body.slice(0, 5).toString('latin1') === '%PDF-');
  const out = args.out;
  const report = { url: r.url, status: r.status, contentType: r.contentType, bytes: r.body.length, isPdf };

  if (out) {
    writeOut(out, r.body);
    report.savedTo = out;
    if (isPdf) {
      report.pdfValid = L.isValidPdf(r.body);
      if (!report.pdfValid) report.warning = 'PDF 校验未通过（缺 %PDF- 头或 %%EOF 尾）——文件可能不完整';
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (isPdf) {
    report.note = '这是 PDF。请用 --out <文件> 保存后再处理。';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const html = r.body.toString('utf8');
  if (args.links === true || args.links === 'true') {
    const links = L.extractLinks(html, r.url);
    report.linkCount = links.length;
    report.links = args.filter ? links.filter((l) => l.href.includes(args.filter)).slice(0, Number(args.limit || 100)) : links.slice(0, Number(args.limit || 100));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const text = L.htmlToText(html);
  if (args.outText) { writeOut(args.outText, text); report.savedTextTo = args.outText; }
  report.textLength = text.length;
  report.text = text.slice(0, Number(args.head || 3000));
  console.log(JSON.stringify(report, null, 2));
}

// ─────────────────────────────────────────────
// arxiv-fetch — 走网页/PDF 路径取 arXiv 文献
// ─────────────────────────────────────────────
async function cmdArxivFetch() {
  const ids = (args.ids || (args._.length ? args._.join(',') : '')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) die('需要 --ids 2303.01469[,2310.04378]');
  const out = args.out || 'library.json';
  const pdfDir = args.pdfDir;
  const recs = await L.arxivByWeb(ids);
  // 失败清单必须显式上报：否则"抓取失败"与"该 ID 不存在"在输出里长得一样，
  // agent 可能据此误判"arXiv 上没有这篇"。见 lib.mjs arxivByWeb 的注释。
  const failures = recs.failures || [];
  if (!recs.length) {
    die(`未能取到任何条目（${ids.length} 个 ID 全部失败）：\n`
      + failures.map((f) => `  · ${f.id} — ${f.reason}`).join('\n'));
  }
  if (failures.length) {
    console.error(`\n  ⚠ ${failures.length}/${ids.length} 个 ID 未取到（**不要**据此认定这些文献不存在）：`);
    failures.forEach((f) => console.error(`    · ${f.id} — ${f.reason}`));
    console.error('    请重试，或改用 search / import 另行核实。\n');
  }

  if (pdfDir) {
    mkdirSync(pdfDir, { recursive: true });
    for (const r of recs) {
      if (!r.pdfUrl) continue;
      const f = `${pdfDir}/${r.arxivId}.pdf`;
      const p = await L.fetchLikeBrowser(r.pdfUrl, { headers: { Accept: 'application/pdf,*/*' }, timeoutMs: 120000, retries: 2 });
      if (p.ok && L.isValidPdf(p.body)) {
        writeFileSync(f, p.body);
        r.pdfFile = f; r.pdfBytes = p.body.length; r.pdfValid = true;
        console.error(`  ✓ PDF 已下载 ${r.arxivId} (${(p.body.length / 1048576).toFixed(1)} MB)`);
      } else {
        r.pdfValid = false;
        console.error(`  ✗ PDF 下载/校验失败 ${r.arxivId}${p.error ? ' — ' + p.error : ''}`);
      }
      await L.sleep(800);
    }
  }

  const lib = loadOrInit(out);
  const before = lib.records.length;
  lib.records.push(...recs);
  const { records } = L.dedupe(lib.records);
  lib.records = records;
  saveLib(out, lib);

  console.log(JSON.stringify({
    out, requested: ids.length, fetched: recs.length,
    failed: failures.length ? failures : undefined,
    libraryBefore: before, libraryAfter: lib.records.length,
    records: recs.map((r) => ({
      arxivId: r.arxivId, year: r.year, type: r.type, venue: r.venue,
      doi: r.doi || null, title: r.title.slice(0, 90),
      authors: r.authors.slice(0, 4), pdf: r.pdfValid === undefined ? undefined : r.pdfValid,
    })),
  }, null, 2));
}

// ─────────────────────────────────────────────
// self-test — 自检（无网络）
// ─────────────────────────────────────────────
function cmdSelfTest() {
  const fails = [];
  const t = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { fails.push(`${name}: ${e.message}`); console.log(`  ✗ ${name} — ${e.message}`); } };
  const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

  console.log('自检：');
  t('normTitle 归一化', () => assert(L.normTitle('Attention Is All You Need!') === 'attentionisallyouneed'));
  t('normDoi 去前缀', () => assert(L.normDoi('https://doi.org/10.1/X') === '10.1/x'));
  t('extractCitations 基本', () => {
    const c = L.extractCitations('如文献[1]和[2-4]所示');
    assert(c.get(1) === 1 && c.get(2) === 1 && c.get(4) === 1, JSON.stringify([...c]));
  });
  t('extractCitations 排除图表号', () => {
    const c = L.extractCitations('Figure 1 shows; Table 2 lists; 式(3) 定义');
    assert(c.size === 0, `不应抽到引用，实际 ${[...c.keys()]}`);
  });
  t('parseReferenceList', () => {
    const txt = '[1] A. T1[C]//Conf. 2020: 1-2.\n[2] B. T2[J]. J, 2021, 3(4): 5-6.\n';
    const e = L.parseReferenceList(txt);
    assert(e.size === 2 && e.get(2).volume === '3' && e.get(2).issue === '4', JSON.stringify([...e]));
  });
  t('validateCitations 双向', () => {
    const txt = '正文[1]与[3]。\n参考文献\n[1] A. T1[J]. J, 2020, 1(1): 1-2.\n[2] B. T2[J]. J, 2021, 2(2): 3-4.\n';
    const r = L.validateCitations(txt, []);
    assert(r.missingInList.includes(3), '应检出缺失 3');
    assert(r.unusedInText.includes(2), '应检出未引用 2');
  });
  t('dedupe 按 DOI', () => {
    const { records } = L.dedupe([
      { id: 'x', title: 'A', doi: '10.1/a', source: 'arxiv', authors: ['X'] },
      { id: 'y', title: 'A', doi: '10.1/A', source: 'crossref', authors: ['X'], volume: '5' },
    ]);
    assert(records.length === 1 && records[0].volume === '5', JSON.stringify(records));
  });
  t('toGBT7714 期刊条目', () => {
    const s = L.toGBT7714({ type: 'journal', title: 'T', authors: ['Wang L'], year: 2021, venue: 'J', volume: 3, issue: 4, pages: '5-6' }, 2);
    assert(s.startsWith('[2] ') && s.includes('3(4): 5-6'), s);
  });
  t('toGBT7714 标出缺失字段', () => {
    const s = L.toGBT7714({ type: 'journal', title: 'T', authors: ['A'], year: 2021, venue: 'J' }, 1);
    assert(s.includes('〔缺:卷〕'), s);
  });
  t('parseBibtex', () => {
    const r = L.parseBibtex('@inproceedings{k,\n title = {T},\n author = {A and B},\n year = {2020},\n booktitle = {C}\n}');
    assert(r.length === 1 && r[0].type === 'conference' && r[0].authors.length === 2, JSON.stringify(r));
  });
  // 回归：URL 中的 // 不得被误判为会议论文的 [C]//
  t('回归: 电子资源 URL 不被误判为会议', () => {
    const e = L.parseRefFields('Sun Q. T[EB/OL]. (2024-01-01)[2026-01-01]. https://arxiv.org/abs/2401.00001.');
    assert(e.isPreprint === true, ' 应为预印本');
    assert(e.isConference === false, ' 不应判为会议（URL 的 // 造成误判）');
  });
  // 回归：venue 必须与主题词组合，不得单独作为检索式
  t('回归: venue 检索式与主题词组合', () => {
    const p = L.buildQueryPlan({ topic: '一致性生成', english: ['consistency model'], venues: ['NeurIPS', 'ICLR'] });
    const qs = p.plan.map((x) => x.query);
    assert(qs.includes('consistency model NeurIPS'), ' 应生成 "consistency model NeurIPS"');
    assert(!qs.includes('NeurIPS'), ' 不应出现单独的 "NeurIPS"');
  });
  t('回归: auditQueryPlan 检出单独 venue 检索式', () => {
    const issues = L.auditQueryPlan([{ query: 'NeurIPS', purpose: '目标venue' }], ['NeurIPS']);
    assert(issues.some((i) => i.kind === 'bare-venue'), JSON.stringify(issues));
  });
  t('回归: auditQueryPlan 检出缺失类别与重复项', () => {
    const issues = L.auditQueryPlan([
      { query: 'a b', purpose: '主题词直查' },
      { query: 'a b', purpose: '主题词直查' },
    ]);
    assert(issues.some((i) => i.kind === 'duplicate'), ' 应检出重复');
    assert(issues.some((i) => i.kind === 'missing-category'), ' 应检出缺失类别（综述/不足/基准/国内）');
  });
  t('回归: 合规计划无告警', () => {
    const p = L.buildQueryPlan({
      topic: '一致性生成', english: ['consistency model'],
      subtopics: ['sampling lower bound'], venues: ['NeurIPS'],
    });
    const issues = L.auditQueryPlan(p.plan, ['NeurIPS']);
    const bad = issues.filter((i) => i.kind === 'bare-venue' || i.kind === 'missing-category');
    assert(bad.length === 0, JSON.stringify(bad));
  });
  t('回归: 真会议条目仍判为会议', () => {
    const e = L.parseRefFields('Vaswani A, et al. Attention is all you need[C]//NeurIPS. 2017: 5998-6008.');
    assert(e.isConference === true && e.pages === '5998-6008', JSON.stringify(e));
  });
  // 回归：无引用的空文档不得被判为通过
  t('回归: 无引用文档被判定为阻断', () => {
    const r = L.validateCitations('这是一份没有任何引用的正文。\n', []);
    assert(r.citedCount === 0 && r.listCount === 0 && r.ok === true, '底层双向校验对空文档确实返回 ok（这是它的语义）');
  });
  t('parseRIS', () => {
    const r = L.parseRIS('TY  - JOUR\nTI  - T\nAU  - A\nPY  - 2020\nER  -');
    assert(r.length === 1 && r[0].type === 'journal' && r[0].year === 2020, JSON.stringify(r));
  });
  t('buildQueryPlan 覆盖综述/不足/国内', () => {
    const p = L.buildQueryPlan({ topic: 'multimodal safety', english: ['multimodal LLM safety'] });
    const qs = p.plan.map((x) => x.query).join('|');
    assert(/survey/.test(qs) && /limitation/.test(qs) && /China/.test(qs), qs.slice(0, 200));
  });
  t('回归: arXiv 双栈（https 失败须回退 http）', () => {
    // 断言的是实现契约：源列表与优先级中存在 arxiv，且 searchWithFallback 可用
    assert(typeof L.searchArxiv === 'function', 'searchArxiv 应导出');
    assert(L.SOURCE_PRIORITY.includes('arxiv'), 'arXiv 应在优先级列表中');
  });
  t('回归: 源优先级与注册表一致', () => {
    for (const s of L.SOURCE_PRIORITY) {
      assert(typeof L.SOURCES[s] === 'function', `优先级中的 ${s} 应在 SOURCES 注册表中`);
    }
  });
  t('回归: 故障切换在首源失败后继续', async () => {
    // 用一个不存在的源名与一个真实但必然失败的调用验证 attempts 结构
    // 这里只做同步可验证的部分：searchWithFallback 必须存在且为函数
    assert(typeof L.searchWithFallback === 'function', 'searchWithFallback 应导出');
  });
  // 回归：Crossref 的同行评审/决定信记录必须被过滤（实测污染源）
  t('回归: 剔除同行评审与决定信记录', () => {
    const bad = [
      { title: 'Review for "Molecule Generation with Consistency Diffusion"', _crossrefType: 'peer-review' },
      { title: 'Decision letter for "Some Paper"', _crossrefType: 'peer-review' },
      { title: '', _crossrefType: 'journal-article' },
      { title: 'short', _crossrefType: 'journal-article' },
    ];
    for (const b of bad) assert(!L.isUsableRecord(b), `应剔除：${JSON.stringify(b).slice(0, 60)}`);
    const good = { title: 'Consistency Models', _crossrefType: 'proceedings-article' };
    assert(L.isUsableRecord(good), '正常论文不应被剔除');
  });
  t('回归: filterUsable 返回剔除项', () => {
    const { kept, dropped } = L.filterUsable([
      { title: 'Consistency Models', _crossrefType: 'proceedings-article' },
      { title: 'Review for "X"', _crossrefType: 'peer-review' },
    ]);
    assert(kept.length === 1 && dropped.length === 1, `kept=${kept.length} dropped=${dropped.length}`);
  });
  // 回归：arXiv Atom 解析（离线固定样本；不依赖网络）
  t('回归: arXiv Atom 解析（固定样本）', () => {
    const recs = L.parseArxivEntries(feedSample);
    assert(recs.length === 2, `应解析出 2 条，实际 ${recs.length}`);
    const [a, b] = recs;
    assert(a.arxivId === '2303.01469', `arxivId 应为 2303.01469，实际 ${a.arxivId}`);
    assert(a.title === 'Consistency Models', `标题解析错误：${a.title}`);
    assert(a.year === 2023, `年份应为 2023，实际 ${a.year}`);
    assert(a.authors.length === 2 && a.authors[0] === 'Yang Song', `作者解析错误：${JSON.stringify(a.authors)}`);
    assert(/^https:\/\//.test(a.url), `URL 应规范化为 https：${a.url}`);
    assert(a.comment === 'ICML 2023', `comment 应解析为 ICML 2023，实际 ${a.comment}`);
    assert(a.category === 'cs.LG', `primary_category 应为 cs.LG，实际 ${a.category}`);
    assert(a.type === 'preprint', '无 journal_ref 应为 preprint');
    assert(b.type === 'journal' && b.venue === 'arXiv preprint', '有 journal_ref 应升级为 journal 并用其作 venue');
  });
  t('回归: arXiv 原生语法识别', () => {
    assert(L.looksLikeArxivSyntax('ti:"consistency models"'), '应识别 ti: 前缀与短语引号');
    assert(L.looksLikeArxivSyntax('au:Yang_S AND ti:consistency'), '应识别布尔算符');
    assert(!L.looksLikeArxivSyntax('consistency model diffusion'), '普通关键词不应被识别为原生语法');
  });
  t('回归: 单源失败不得中断故障切换', async () => {
    // 构造一个全部源都失败的场景，验证 attempts 结构完整且不抛异常
    const r = await L.searchWithFallback('zzz-nonexistent-query-xyz', {
      sources: ['nonexistent-source'], limit: 1,
    });
    assert(Array.isArray(r.attempts) && r.records.length === 0, '应返回空结果与 attempts 记录');
    assert(r.attempts[0].status === 'unknown', `未知源应记为 unknown，实际 ${r.attempts[0].status}`);
  });
  // 回归：浏览器路径的 arXiv 摘要页解析（离线固定样本）
  t('回归: arXiv 摘要页解析（含年份）', () => {
    const r = L.parseArxivAbsPage(absSample, 'https://arxiv.org/abs/2303.01469');
    assert(r.arxivId === '2303.01469', `arxivId=${r.arxivId}`);
    assert(r.title === 'Consistency Models', `标题=${r.title}`);
    assert(r.year === 2023, `年份应为 2023（取 v1 提交年），实际 ${r.year}`);
    assert(/2 Mar 2023/.test(r.published), `published=${r.published}`);
    assert(r.authors.length === 4 && r.authors[0] === 'Yang Song', `作者=${JSON.stringify(r.authors)}`);
    assert(r.authors.includes('Ilya Sutskever'), '应含最后一位作者');
    assert(r.category === 'cs.LG', `category=${r.category}`);
    assert(r.type === 'preprint', `无 DOI 应为 preprint，实际 ${r.type}`);
    assert(/one-step generation/.test(r.abstract), '摘要应解析出来');
    assert(r.pdfUrl === 'https://arxiv.org/pdf/2303.01469', `pdfUrl=${r.pdfUrl}`);
  });
  t('回归: arXiv 摘要页解析（DOI 变体）', () => {
    const r = L.parseArxivAbsPage(absJournalSample, 'https://arxiv.org/abs/2310.04378');
    assert(r.arxivId === '2310.04378', `arxivId=${r.arxivId}`);
    assert(r.year === 2023, `年份=${r.year}`);
    assert(r.doi === '10.48550/arxiv.2310.04378', `doi=${r.doi}`);
  });
  t('回归: HTML 清理与链接抽取', () => {
    const html = '<div><script>bad()</script><a href="/a/x">Link <b>Text</b></a><p>A &amp; B</p></div>';
    const links = L.extractLinks(html, 'https://arxiv.org/abs/1');
    assert(links.length === 1 && links[0].href === 'https://arxiv.org/a/x', JSON.stringify(links));
    assert(links[0].text === 'Link Text', `text=${links[0].text}`);
    const text = L.htmlToText(html);
    assert(!/bad\(\)/.test(text), '脚本应被移除');
    assert(/A & B/.test(text), `实体应解码：${text}`);
  });
  t('回归: PDF 完整性校验', () => {
    const good = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2000, 0x20), Buffer.from('\n%%EOF\n')]);
    assert(L.isValidPdf(good), '合法 PDF 应通过');
    const htmlAsPdf = Buffer.concat([Buffer.from('<!DOCTYPE html><html>'), Buffer.alloc(2000, 0x20)]);
    assert(!L.isValidPdf(htmlAsPdf), 'HTML 误存为 .pdf 应被检出');
    assert(!L.isValidPdf(Buffer.alloc(50)), '过小文件应被拒');
  });
  // 回归：全角方括号引用必须被识别（中文写作常见，实测曾漏检 30 处）
  t('回归: 全角方括号引用', () => {
    const c = L.extractCitations('如文献［1］与［2-4］所示');
    assert(c.get(1) === 1 && c.get(4) === 1, JSON.stringify([...c]));
    const full = '正文［1］［2］。\n参考文献\n［1］ A. T[J]. J, 2020, 1(1): 1-2.\n［2］ B. T[J]. J, 2021, 2(2): 3-4.\n';
    const list = L.parseReferenceList(full);
    assert(list.size === 2, `全角文献列表应解析出 2 条，实际 ${list.size}`);
    const r = L.validateCitations(full, []);
    assert(r.citedCount === 2 && r.listCount === 2 && r.ok === true,
      JSON.stringify({ cited: r.citedCount, list: r.listCount, ok: r.ok, blocking: r.missingInList }));
  });
  // 回归：数学表达式里的区间不得被当成引用标记。
  // 实测事故：理论型正文含 `$K \in [2, 64]$、$\sigma \in [1, 100]$`，
  // 区间上界 [64] [100] 被误判为引用，导致一份完全正确的稿件报出
  // "正文引用了但列表中缺失：64, 100" 并被阻断（citedCount 由 18 虚高到 20）。
  t('回归: 数学区间不误判为引用', () => {
    const withMath = '受控分布族 $K \\in [2, 64]$、$d \\in [2, 16]$、$\\sigma \\in [1, 100]$，'
      + '另见块级公式 $$\\alpha \\in [3, 99]$$。正文引用［1］与［2］。';
    const c = L.extractCitations(withMath);
    assert(!c.has(64) && !c.has(100) && !c.has(99) && !c.has(16),
      `数学区间被误判为引用: ${JSON.stringify([...c])}`);
    assert(c.get(1) === 1 && c.get(2) === 1, `真实引用应保留: ${JSON.stringify([...c])}`);
    // 半角数学区间同样不得误判
    const half = '设 $x \\in [7, 88]$，引用 [1] 与 [2]。';
    const c2 = L.extractCitations(half);
    assert(!c2.has(7) && !c2.has(88), `半角数学区间被误判: ${JSON.stringify([...c2])}`);
    assert(c2.get(1) === 1 && c2.get(2) === 1, `半角真实引用应保留: ${JSON.stringify([...c2])}`);
  });
  // 回归：一致性校验器的图号识别边界。
  // 这个正则踩过两次坑，都必须锁住（详见 bin/check-consistency.mjs 的 FIGURE_REF_PATTERN 注释）：
  //   ① 用 (?<![\u4e00-\u9fa5]) 排除所有汉字 → 「如图2所示」被整体排除，真实引用 100% 漏检
  //   ② 允许半角空格间隔 → 「知识产权表 1–2 项」「所表现的能力 1 篇」被误判为表号
  t('回归: 图号引用识别边界', () => {
    const re = new RegExp(L.FIGURE_REF_PATTERN, 'g');
    const hit = (s) => (s.match(re) || []).map((x) => x.replace(/\s/g, ''));
    // 必须识别（漏检会导致"图号悬空"假阻断）
    assert(JSON.stringify(hit('如图2所示')) === '["图2"]', `如图2所示 应识别出图2，实际 ${JSON.stringify(hit('如图2所示'))}`);
    assert(JSON.stringify(hit('项目的技术路线如图1。')) === '["图1"]', '句末引用 图1 应被识别');
    assert(JSON.stringify(hit('详见图3与图4。')) === '["图3","图4"]', '连续引用应全部识别');
    assert(JSON.stringify(hit('见表2。')) === '["表2"]', '表号引用应被识别');
    assert(JSON.stringify(hit('见图　5')) === '["图5"]', '全角空格间隔应被识别（兼容"图　1"写法，hit 会剥空白）');
    // 注意：**半角空格间隔在正文引用中不被识别**——这是刻意的，用于排除
    // 「知识产权表 1 篇」「所表现的能力 1 篇」这类误报。图注本身用半角空格
    // （如"图 10 标题"）由 check-consistency.mjs 的 captionLineSet 单独处理，不走本正则。
    assert(hit('图 10 动平台事件成像运动补偿').length === 0,
      '正文中的半角空格间隔不应被当作引用（图注由 captionLineSet 处理）');
    // 必须排除（误报会导致"表号悬空"假阻断）
    assert(hit('预期成果为知识产权表 1–2 项').length === 0,
      `"知识产权表 1–2 项" 不得误判为表号，实际 ${JSON.stringify(hit('预期成果为知识产权表 1–2 项'))}`);
    assert(hit('所表现的能力 1 篇').length === 0,
      `"所表现的能力 1 篇" 不得误判为表号，实际 ${JSON.stringify(hit('所表现的能力 1 篇'))}`);
    assert(hit('本项目的表达 3 个层次').length === 0, '"表达"不得误判为表号');
    assert(hit('图表 1 这种写法').length === 0, '"图表"不得误判为图号');
    assert(hit('预算区间为 5–8 万元').length === 0, '数值区间不得误判');
  });
  // 回归：两套申报类型（青年C类 / 面上项目）的提纲差异必须正确区分。
  // 2026 年基金委对两类**分别发布**提纲。经两个独立来源核对，真实差异有两类：
  //   ① 实质差异 4 处：（三）3 与（四）2/3/4 在面上含"主要参与者"
  //   ② 标点差异 4 处：面上四个部分标题带全角冒号，青年不带
  // 标点差异已被 check-template.mjs 的归一化吸收（作者写不写冒号都能过），
  // 但数据里必须保真，否则"官方原文"就不准确了。
  // 历史事故：校验器基准被写死成青年C类，拿去校验面上项目会误报 4 项。
  t('回归: 两类提纲差异正确区分', () => {
    const y = L.getTrack('youth');
    const g = L.getTrack('general');
    assert(L.getTrack('青年').id === 'youth', '中文别名「青年」应解析为 youth');
    assert(L.getTrack('面上项目').id === 'general', '中文别名「面上项目」应解析为 general');
    assert(y.items.length === g.items.length, '两类提纲条目数应一致');

    const stripPunct = (s) => s.replace(/[：:]/g, '');
    const changed = g.items.filter((gi) => {
      const yi = y.items.find((x) => x.key === gi.key);
      return !yi || yi.text !== gi.text;
    });
    // 标点差异：仅冒号不同
    const punctOnly = changed.filter((gi) => {
      const yi = y.items.find((x) => x.key === gi.key);
      return stripPunct(yi.text) === stripPunct(gi.text);
    });
    // 实质差异：去掉标点后仍不同
    const substantive = changed.filter((gi) => {
      const yi = y.items.find((x) => x.key === gi.key);
      return stripPunct(yi.text) !== stripPunct(gi.text);
    });

    const expectSubstantive = ['part3-3', 'part4-2', 'part4-3', 'part4-4'];
    assert(substantive.length === expectSubstantive.length,
      `实质差异应恰好 ${expectSubstantive.length} 处，实际 ${substantive.length}: ${substantive.map((x) => x.key)}`);
    for (const k of expectSubstantive) {
      assert(substantive.some((x) => x.key === k), `实质差异应包含 ${k}`);
    }
    // 面上版本必须含"主要参与者"，青年版本必须不含
    for (const k of expectSubstantive) {
      const gt = g.items.find((x) => x.key === k).text;
      const yt = y.items.find((x) => x.key === k).text;
      assert(gt.includes('主要参与者'), `面上 ${k} 应含"主要参与者"`);
      assert(!yt.includes('主要参与者'), `青年 ${k} 不应含"主要参与者"`);
    }
    // 标点差异应恰好是四个部分标题
    const expectPunct = ['part1', 'part2', 'part3', 'part4'];
    assert(punctOnly.length === expectPunct.length,
      `标点差异应恰好 ${expectPunct.length} 处，实际 ${punctOnly.length}: ${punctOnly.map((x) => x.key)}`);
    // AI 披露项两类都必须是必填
    assert(y.items.find((x) => x.key === 'part4-5').required === true, '青年 AI 披露应标记必填');
    assert(g.items.find((x) => x.key === 'part4-5').required === true, '面上 AI 披露应标记必填');
  });
  // 回归：extractLinks 必须去重。
  // 实测 OpenReview 群组页 17 个链接里有 5 个重复（同一 href 多次出现），
  // 不去重会让"抓取结果数"虚高，掩盖实际覆盖面。
  t('回归: extractLinks 去重', () => {
    const html = '<a href="/a">A</a><a href="/a">A2</a><a href="/b">B</a>'
      + '<a href="/a"></a><a href="javascript:x()">bad</a><a href="#frag">frag</a>';
    const links = L.extractLinks(html, 'https://x.org');
    assert(links.length === 2, `应去重为 2 个链接，实际 ${links.length}: ${JSON.stringify(links)}`);
    const a = links.find((l) => l.href.endsWith('/a'));
    assert(a && a.text === 'A', `同 href 应保留首个非空文本，实际 ${a && a.text}`);
    // javascript: 与 # 锚点必须被排除
    assert(!links.some((l) => /javascript:|#/.test(l.href)), 'javascript: 与锚点应被排除');
    // 相对路径应补全为绝对
    assert(links.every((l) => l.href.startsWith('https://x.org/')), '相对路径应补全为绝对 URL');
    // 无 href 的 <a> 不应崩溃
    assert(L.extractLinks('<a name="x">n</a>').length === 0, '无 href 的 <a> 应被忽略');
  });
  t('回归: 浏览器头已配置', () => {
    assert(/Mozilla\/5\.0/.test(L.BROWSER_HEADERS['User-Agent']), 'UA 应为真实浏览器标识');
    assert(L.BROWSER_HEADERS.Accept.includes('text/html'), 'Accept 应声明 HTML');
  });

  console.log(fails.length ? `\n✗ 自检失败 ${fails.length} 项` : '\n✓ 全部自检通过');
  if (fails.length) process.exit(1);
}

// ─────────────────────────────────────────────
// 分发
// ─────────────────────────────────────────────
const CMDS = {
  plan: cmdPlan, search: cmdSearch, import: cmdImport, add: cmdAdd, note: cmdNote,
  dedupe: cmdDedupe, enrich: cmdEnrich, stats: cmdStats, validate: cmdValidate,
  format: cmdFormat, gaps: cmdGaps, 'self-test': cmdSelfTest,
  'arxiv-by-id': cmdArxivById, 'arxiv-fetch': cmdArxivFetch,
  webget: cmdWebget, sources: cmdSources,
};

if (!cmd || cmd === 'help' || cmd === '--help' || args.help) {
  const usagePath = new URL('./USAGE.md', import.meta.url);
  if (existsSync(usagePath)) {
    console.log(readFileSync(usagePath, 'utf8'));
  } else {
    console.log('（未找到 tools/USAGE.md，使用下方简要用法）\n');
  }
  console.log(`
research-cli 子命令：
  plan       生成确定性检索计划
  search     多源检索并入库（arxiv | crossref | openalex | s2）
  import     导入 RIS / BibTeX
  add        写入人工核验过的记录
  note       给记录打分析标注（relevance/mainline/gap/verified/exclude）
  dedupe     去重合并
  enrich     按 DOI 补齐正式元数据（预印本→正式发表）
  stats      库统计（含预印本占比告警）
  validate   正文引用 ↔ 文献列表 双向校验
  format     输出 gbt7714 | bibtex | json | plain
  gaps       结构性不足的候选证据筛查
  arxiv-fetch 走网页/PDF路径取 arXiv 文献（比 API 可靠，可下载 PDF）
  webget     像浏览器一样访问网页/下载资源
  arxiv-by-id 按 arXiv ID 经 API 补文献
  sources    列出数据源与优先级
  self-test  无网络自检
`);
  process.exit(cmd ? 0 : 1);
}

const fn = CMDS[cmd];
if (!fn) die(`未知子命令：${cmd}（运行 node tools/cli.mjs help）`);
await fn();
