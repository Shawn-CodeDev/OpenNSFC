#!/usr/bin/env node
/**
 * research-cli — 零依赖学术文献检索与校验工具库
 *
 * 设计约束：只用 Node.js 内置模块（fetch / zlib / crypto / fs），
 * 不依赖 npm 安装，任何能执行 shell 命令的 agent 均可调用。
 *
 * 供 cli.mjs 使用，也可被其他脚本 require/import。
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
// zlib 必须**显式**导入。踩过的坑：extractPdfLines 里写了 zlib.inflateSync 却没导入，
// 而 CJS 环境下 Node 恰好把 zlib 暴露为隐式全局，于是"在某个目录下测通了、
// 换到 ESM 脚本里就静默返回 0 行"——因为异常被 catch 吞掉了。
// 教训：不要依赖隐式全局；catch 块也不要无差别吞异常。
import zlib from 'node:zlib';

// ─────────────────────────────────────────────
// 基础工具
// ─────────────────────────────────────────────

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带重试与退避的 fetch。429/5xx 会重试。 */
export async function robustFetch(url, { headers = {}, timeoutMs = 25000, retries = 3, backoff = 1500 } = {}) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const ctrl = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, { headers, signal: ctrl });
      if (res.status === 429 || res.status >= 500) {
        await sleep(backoff * (i + 1) * 2);
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(backoff * (i + 1));
    }
  }
  throw lastErr || new Error('fetch failed');
}

/** 极简 XML 取值（够用即可，不引入解析库） */
export function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

export function xmlAll(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decodeEntities(m[1]).trim());
  return out;
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** 规范化标题，用于去重比对 */
export function normTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .trim();
}

export function normDoi(d) {
  return String(d || '')
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .trim();
}

export function hashId(s) {
  return createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

// ─────────────────────────────────────────────
// 数据源
// ─────────────────────────────────────────────

/**
 * arXiv Atom API。
 *
 * **两个必须处理的坑**：
 *
 * 1. **必须 HTTP/HTTPS 双栈尝试**：实测同一环境下
 *    https://export.arxiv.org 与 http://export.arxiv.org 的可用性会反转，
 *    不能只试一种协议就判定该源不可用。
 *
 * 2. **必须支持原生查询语法（rawQuery）**：arXiv 的字段前缀语法
 *    （`ti:` `au:` `abs:` `cat:`、短语引号、`AND`/`OR`/`ANDNOT`）
 *    在 **encodeURIComponent 之后会被破坏**——空格被编码为 %20，
 *    布尔表达式与短语匹配失效。
 *    实测后果：查询 `consistency models song`（想找 Song et al. 的
 *    "Consistency Models"）返回了 8 篇**音乐/歌词**论文，因为
 *    "song" 被当作普通关键词而非作者名。**这与"编造文献"同样有害。**
 *
 * 因此提供两条路径：
 * - `query`（默认）：自由文本，整体 URL 编码，适合普通关键词检索
 * - `rawQuery`：arXiv 原生语法，**不做编码**，由调用方保证已正确构造
 */
export async function searchArxiv(query, limit = 20, opts = {}) {
  const raw = opts.rawQuery || (looksLikeArxivSyntax(query) ? query : null);
  const encoded = raw ? raw : encodeURIComponent(query);
  const path = `api/query?search_query=${encoded}&start=0&max_results=${limit}&sortBy=relevance`;
  const hosts = [
    `https://export.arxiv.org/${path}`,
    `http://export.arxiv.org/${path}`,
  ];
  let lastErr = null;
  let xml = null;
  for (const url of hosts) {
    try {
      const res = await robustFetch(url, { retries: 2, timeoutMs: 15000, backoff: 1200 });
      if (!res.ok) { lastErr = new Error(`arXiv HTTP ${res.status}`); continue; }
      const t = await res.text();
      if (/<feed/i.test(t)) { xml = t; break; }
      lastErr = new Error('arXiv 返回内容不是 Atom feed');
    } catch (e) { lastErr = e; }
  }
  if (!xml) throw lastErr || new Error('arXiv 两个协议均不可用');

  const entries = xml.split(/<entry>/i).slice(1);
  return entries.map((e) => {
    const idUrl = xmlText(e, 'id').replace(/^http:\/\//, 'https://');
    const arxivId = (idUrl.match(/abs\/([^v]+)(v\d+)?$/) || [])[1] || '';
    const published = xmlText(e, 'published');
    const authors = xmlAll(e, 'name');
    const primary = (e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1] || '';
    const journalRef = (e.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/i) || [])[1];
    const comment = (e.match(/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/i) || [])[1];
    return {
      id: `arxiv:${arxivId}`,
      source: 'arxiv',
      type: journalRef ? 'journal' : 'preprint',
      title: xmlText(e, 'title').replace(/\s+/g, ' '),
      abstract: xmlText(e, 'summary').replace(/\s+/g, ' '),
      authors,
      year: published ? Number(published.slice(0, 4)) : null,
      venue: journalRef ? decodeEntities(journalRef).replace(/\s+/g, ' ').trim() : 'arXiv',
      arxivId,
      doi: xmlText(e, 'arxiv:doi') || null,
      url: idUrl,
      category: primary,
      published,
      comment: comment ? decodeEntities(comment).replace(/\s+/g, ' ').trim() : '',
      citationCount: null,
      raw: null,
    };
  });
}

/**
 * 判断检索式是否已经是 arXiv 原生语法。
 * 用于自动切换编码策略——若含字段前缀或布尔算符，则不做 URL 编码。
 */
export function looksLikeArxivSyntax(q) {
  if (typeof q !== 'string') return false;
  return /\b(all|ti|au|abs|cat|co|jr|rn|id):/i.test(q) || /\b(AND|OR|ANDNOT)\b/.test(q) || /"/.test(q);
}

/**
 * 按 arXiv ID 精确取元数据。用于补齐已知文献（如奠基工作）的正式信息。
 * 这是"补文献"最可靠的路径——不依赖检索相关性排序。
 */
export async function arxivById(ids, opts = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return [];
  const path = `api/query?id_list=${list.join(',')}&max_results=${list.length}`;
  const hosts = [`https://export.arxiv.org/${path}`, `http://export.arxiv.org/${path}`];
  let xml = null; let lastErr = null;
  for (const url of hosts) {
    try {
      const res = await robustFetch(url, { retries: 2, timeoutMs: 15000, backoff: 1200 });
      if (!res.ok) { lastErr = new Error(`arXiv HTTP ${res.status}`); continue; }
      const t = await res.text();
      if (/<feed/i.test(t)) { xml = t; break; }
    } catch (e) { lastErr = e; }
  }
  if (!xml) throw lastErr || new Error('arXiv id_list 两个协议均不可用');
  // 复用检索解析逻辑
  return parseArxivEntries(xml);
}

export function parseArxivEntries(xml) {
  const entries = xml.split(/<entry>/i).slice(1);
  return entries.map((e) => {
    const idUrl = xmlText(e, 'id').replace(/^http:\/\//, 'https://');
    const arxivId = (idUrl.match(/abs\/([^v]+)(v\d+)?$/) || [])[1] || '';
    const published = xmlText(e, 'published');
    const journalRef = (e.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/i) || [])[1];
    const comment = (e.match(/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/i) || [])[1];
    return {
      id: `arxiv:${arxivId}`,
      source: 'arxiv',
      type: journalRef ? 'journal' : 'preprint',
      title: xmlText(e, 'title').replace(/\s+/g, ' '),
      abstract: xmlText(e, 'summary').replace(/\s+/g, ' '),
      authors: xmlAll(e, 'name'),
      year: published ? Number(published.slice(0, 4)) : null,
      venue: journalRef ? decodeEntities(journalRef).replace(/\s+/g, ' ').trim() : 'arXiv',
      arxivId,
      doi: xmlText(e, 'arxiv:doi') || null,
      url: idUrl,
      category: (e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1] || '',
      published,
      comment: comment ? decodeEntities(comment).replace(/\s+/g, ' ').trim() : '',
      citationCount: null,
      raw: null,
    };
  });
}

/**
 * OpenReview（api2）。计算机学科会议（ICLR/NeurIPS 等）的官方投稿与评审数据，
 * 是 arXiv 之外覆盖 CS 预印本最完整的开放源。
 * 注意：api2 的 /notes 与 api（v1）的 /notes 在本机均超时，只有 /notes/search 可用。
 */
export async function searchOpenReview(query, limit = 20) {
  const q = encodeURIComponent(query);
  const url = `https://api2.openreview.net/notes/search?query=${q}&limit=${Math.min(limit, 100)}`;
  const res = await robustFetch(url, { retries: 2, timeoutMs: 15000, backoff: 1500 });
  if (!res.ok) throw new Error(`OpenReview HTTP ${res.status}`);
  const j = await res.json();
  const notes = j.notes || [];
  const seen = new Set();
  const out = [];
  for (const n of notes) {
    const c = n.content || {};
    const val = (k) => (c[k] && typeof c[k] === 'object' && 'value' in c[k] ? c[k].value : c[k]);
    const title = val('title');
    if (!title || typeof title !== 'string') continue;
    const key = normTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const venue = val('venue') || (n.invitations && n.invitations[0]) || '';
    const yr = Number(String(venue).match(/\b(19|20)\d{2}\b/)?.[0]) || null;
    out.push({
      id: `openreview:${n.id}`,
      source: 'openreview',
      type: 'conference',
      title,
      abstract: typeof val('abstract') === 'string' ? val('abstract').replace(/\s+/g, ' ') : '',
      authors: Array.isArray(val('authors')) ? val('authors') : [],
      year: yr,
      venue: String(venue).replace(/^.*?(ICLR|NeurIPS|ICML|CVPR|ACL|EMNLP)\s*/i, '$1 ').trim() || String(venue),
      doi: null,
      url: `https://openreview.net/forum?id=${n.id}`,
      citationCount: null,
      raw: null,
    });
  }
  return out;
}

/**
 * DBLP —— 计算机学科最权威的题录库，**提供正式的 venue 与页码**。
 *
 * 重要修正：早前判定 DBLP "不可用"是**错误的**。
 * 它确实对默认 UA 返回反爬验证页（HTTP 200 但内容是 bot 检查页），
 * 但**带上真实浏览器请求头即可正常返回 JSON**（实测 7538 B 真实数据）。
 * 这是"HTTP 200 假成功"的典型案例，也是浏览器头价值的直接证据。
 *
 * DBLP 的价值：它是补足 GB/T 7714 所需 **页码** 的关键来源——
 * arXiv 预印本没有页码，而 DBLP 记录的是正式发表版本的题录。
 */
export async function searchDblp(query, limit = 20) {
  const q = encodeURIComponent(query);
  const url = `https://dblp.org/search/publ/api?q=${q}&format=json&h=${Math.min(limit, 100)}`;
  const r = await fetchLikeBrowser(url, { timeoutMs: 20000, retries: 3 });
  if (!r.ok || !r.body) throw new Error(`DBLP 请求失败：${r.error || 'HTTP ' + r.status}`);
  const txt = r.body.toString('utf8');
  // 反爬页检测（HTTP 200 但非 JSON）
  if (/are you a bot|just a moment|not a bot/i.test(txt)) throw new Error('DBLP 返回反爬验证页');
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error('DBLP 返回内容不是 JSON'); }
  const hits = j?.result?.hits?.hit || [];
  return hits.map((h) => dblpHitToRecord(h)).filter((x) => x && x.title);
}

export function dblpHitToRecord(h) {
  const info = h?.info || {};
  const authorsRaw = info.authors?.author;
  const authors = Array.isArray(authorsRaw)
    ? authorsRaw.map((a) => (typeof a === 'string' ? a : a?.text || '')).filter(Boolean)
    : (authorsRaw ? [typeof authorsRaw === 'string' ? authorsRaw : authorsRaw.text || ''] : []);
  const typeMap = {
    'Conference and Workshop Papers': 'conference',
    'Journal Articles': 'journal',
    'Books and Theses': 'book',
    'Informal and Other Publications': 'preprint',
    'Editorship': 'book',
  };
  const dblpType = info.type || '';
  const pages = info.pages || '';
  return {
    id: info.doi ? `doi:${normDoi(info.doi)}` : `dblp:${info.key || hashId(info.title || '')}`,
    source: 'dblp',
    type: typeMap[dblpType] || 'unknown',
    _dblpType: dblpType,
    title: String(info.title || '').replace(/\s+/g, ' ').trim().replace(/\.$/, ''),
    abstract: '',
    authors,
    year: Number(info.year) || null,
    venue: info.venue || '',
    doi: normDoi(info.doi || ''),
    url: info.ee || info.url || (info.doi ? `https://doi.org/${normDoi(info.doi)}` : ''),
    volume: info.volume || '',
    issue: info.number || '',
    pages: String(pages).replace(/--/g, '-'),
    publisher: '',
    dblpKey: info.key || '',
    citationCount: null,
    raw: null,
  };
}
/**
 * EuropePMC —— 学科偏生物医学，作为**兜底源**使用。
 * 对计算机学科主题命中率低，但在其他源全部不可用时仍可能提供元数据。
 */
export async function searchEuropePMC(query, limit = 20) {
  const q = encodeURIComponent(query);
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&format=json&pageSize=${Math.min(limit, 100)}&resultType=core`;
  const res = await robustFetch(url, { retries: 2, timeoutMs: 15000, backoff: 1500 });
  if (!res.ok) throw new Error(`EuropePMC HTTP ${res.status}`);
  const j = await res.json();
  return (j.resultList?.result || []).map((r) => ({
    id: `europepmc:${r.id || r.pmid || hashId(r.title || '')}`,
    source: 'europepmc',
    type: r.source === 'MED' ? 'journal' : 'preprint',
    title: (r.title || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    abstract: (r.abstractText || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    authors: r.authorString ? r.authorString.split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [],
    year: Number(r.pubYear) || null,
    venue: r.journalInfo?.journal?.title || r.journalTitle || r.source || '',
    doi: normDoi(r.doi),
    url: r.doi ? `https://doi.org/${normDoi(r.doi)}` : '',
    volume: r.journalInfo?.volume || '',
    issue: r.journalInfo?.issue || '',
    pages: r.pageInfo || '',
    citationCount: r.citedByCount ?? null,
    raw: null,
  })).filter((r) => r.title);
}

/** Crossref REST API（无需 key，元数据权威，覆盖会议/期刊） */
export async function searchCrossref(query, limit = 20, mailto = 'research-agent@example.org') {
  const q = encodeURIComponent(query);
  const url = `https://api.crossref.org/works?query=${q}&rows=${limit}&mailto=${encodeURIComponent(mailto)}`;
  const res = await robustFetch(url, { headers: { 'User-Agent': `research-cli/1.0 (mailto:${mailto})` } });
  if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
  const j = await res.json();
  const items = (j.message && j.message.items) || [];
  return items.map(crossrefToRecord);
}

/** Crossref 的 type 值里带有大量非文献记录，需过滤 */
const CROSSREF_REJECT_TYPES = new Set([
  'peer-review', 'component', 'grant', 'dataset', 'standard-series',
  'journal-issue', 'journal-volume', 'journal', 'proceedings', 'reference-entry',
  'edited-book', 'monograph', 'report-series', 'book-series', 'book-set',
]);

export function crossrefToRecord(it) {
  const authors = (it.author || []).map((a) =>
    [a.family, a.given].filter(Boolean).join(' ') || a.name || ''
  ).filter(Boolean);
  const year =
    it.issued?.['date-parts']?.[0]?.[0] ??
    it.published?.['date-parts']?.[0]?.[0] ??
    it['published-print']?.['date-parts']?.[0]?.[0] ??
    it['published-online']?.['date-parts']?.[0]?.[0] ??
    null;
  const typeMap = {
    'proceedings-article': 'conference',
    'journal-article': 'journal',
    'book-chapter': 'chapter',
    book: 'book',
    'posted-content': 'preprint',
    dissertation: 'thesis',
  };
  const ct = it['container-title'] || [];
  const venue = Array.isArray(ct) && ct.length ? ct[0] : (it.event && it.event.name) || '';
  const title = Array.isArray(it.title) ? (it.title[0] || '') : (it.title || '');
  return {
    id: `doi:${normDoi(it.DOI)}`,
    source: 'crossref',
    type: typeMap[it.type] || it.type || 'unknown',
    _crossrefType: it.type || '',
    title: String(title).replace(/<[^>]+>/g, '').trim(),
    abstract: it.abstract ? String(it.abstract).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '',
    authors,
    year,
    venue: Array.isArray(venue) ? String(venue[0] || '') : String(venue || ''),
    doi: normDoi(it.DOI),
    url: it.URL || (it.DOI ? `https://doi.org/${normDoi(it.DOI)}` : ''),
    volume: it.volume || '',
    issue: it.issue || '',
    pages: it.page || '',
    publisher: it.publisher || '',
    citationCount: it['is-referenced-by-count'] ?? null,
    raw: null,
  };
}

/**
 * 内容质量过滤：剔除不可能作为参考文献的记录。
 *
 * 必要性（实测）：Crossref 检索 "consistency model diffusion" 时，
 * 前 10 条中有 6 条是 "Review for ..." / "Decision letter for ..." 的
 * 同行评审记录与空标题记录。它们 type='peer-review' 或标题为空，
 * **不是论文**，直接入库会污染文献库并导致后续引用错误。
 */
export function isUsableRecord(r) {
  if (!r || !r.title || r.title.trim().length < 8) return false;
  if (r._crossrefType && CROSSREF_REJECT_TYPES.has(r._crossrefType)) return false;
  // 同行评审/决定信类记录的标题模式
  if (/^\s*(review|decision letter|editorial|erratum|corrigendum|retraction)\s+(for|of)\b/i.test(r.title)) return false;
  return true;
}

export function filterUsable(records) {
  const kept = [];
  const dropped = [];
  for (const r of records) (isUsableRecord(r) ? kept : dropped).push(r);
  return { kept, dropped };
}

/** 通过 DOI 取正式元数据（用于校正 arXiv 预印本 → 正式发表版本） */
export async function crossrefByDoi(doi, mailto = 'research-agent@example.org') {
  const d = normDoi(doi);
  const url = `https://api.crossref.org/works/${encodeURIComponent(d)}?mailto=${encodeURIComponent(mailto)}`;
  const res = await robustFetch(url, { headers: { 'User-Agent': `research-cli/1.0 (mailto:${mailto})` } });
  if (!res.ok) throw new Error(`Crossref DOI HTTP ${res.status}`);
  const j = await res.json();
  return crossrefToRecord(j.message);
}

/** OpenAlex（限流较严，作为可选增强源） */
export async function searchOpenAlex(query, limit = 20, mailto = 'research-agent@example.org') {
  const q = encodeURIComponent(query);
  const url = `https://api.openalex.org/works?search=${q}&per-page=${Math.min(limit, 50)}&mailto=${encodeURIComponent(mailto)}`;
  const res = await robustFetch(url, { retries: 4, backoff: 3000 });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const j = await res.json();
  return (j.results || []).map((w) => ({
    id: `openalex:${(w.id || '').split('/').pop()}`,
    source: 'openalex',
    type: w.type === 'article' ? (w.primary_location && w.primary_location.source && w.primary_location.source.type === 'conference' ? 'conference' : 'journal') : (w.type || 'unknown'),
    title: w.title || w.display_name || '',
    abstract: w.abstract_inverted_index ? reconstructAbstract(w.abstract_inverted_index) : '',
    authors: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean),
    year: w.publication_year || null,
    venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
    doi: normDoi(w.doi),
    url: w.doi || w.id || '',
    citationCount: w.cited_by_count ?? null,
    openAccess: w.open_access ? !!w.open_access.is_oa : null,
    oaUrl: (w.open_access && w.open_access.oa_url) || (w.best_oa_location && w.best_oa_location.pdf_url) || null,
    raw: null,
  }));
}

function reconstructAbstract(inv) {
  const arr = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions) arr[p] = word;
  return arr.filter(Boolean).join(' ');
}

/** Semantic Scholar（建议配 API key；无 key 时常限流） */
export async function searchSemanticScholar(query, limit = 20, apiKey = process.env.S2_API_KEY || '') {
  const q = encodeURIComponent(query);
  const fields = 'title,abstract,year,venue,authors,externalIds,citationCount,publicationTypes,openAccessPdf';
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${q}&limit=${Math.min(limit, 100)}&fields=${fields}`;
  const headers = apiKey ? { 'x-api-key': apiKey } : {};
  const res = await robustFetch(url, { headers, retries: 3, backoff: 4000 });
  if (!res.ok) throw new Error(`S2 HTTP ${res.status}${apiKey ? '' : '（未设 S2_API_KEY，限流严格）'}`);
  const j = await res.json();
  return (j.data || []).map((p) => ({
    id: `s2:${p.paperId}`,
    source: 'semanticscholar',
    type: (p.publicationTypes || [])[0] || 'unknown',
    title: p.title || '',
    abstract: p.abstract || '',
    authors: (p.authors || []).map((a) => a.name).filter(Boolean),
    year: p.year || null,
    venue: p.venue || '',
    doi: normDoi(p.externalIds && p.externalIds.DOI),
    arxivId: (p.externalIds && p.externalIds.ArXiv) || null,
    url: p.externalIds && p.externalIds.DOI ? `https://doi.org/${normDoi(p.externalIds.DOI)}` : '',
    citationCount: p.citationCount ?? null,
    oaUrl: (p.openAccessPdf && p.openAccessPdf.url) || null,
    raw: null,
  }));
}

export const SOURCES = {
  arxiv: searchArxiv,
  crossref: searchCrossref,
  openreview: searchOpenReview,
  openalex: searchOpenAlex,
  s2: searchSemanticScholar,
  semanticscholar: searchSemanticScholar,
  dblp: searchDblp,
  europepmc: searchEuropePMC,
};

/**
 * 源优先级（默认故障切换顺序）。
 * 排序依据：学科相关性 × 实测可用性。
 * - crossref：元数据权威、覆盖会议期刊、实测稳定
 * - arxiv   ：CS 预印本主力，但协议可用性随环境反转（已做 http/https 双栈）
 * - openreview：CS 会议官方数据，arXiv 之外的补充
 * - openalex / s2：元数据丰富但限流严格
 * - europepmc：学科偏生物医学，仅作兜底
 */
export const SOURCE_PRIORITY = ['crossref', 'dblp', 'arxiv', 'openreview', 'openalex', 's2', 'europepmc'];

/**
 * 按优先级依次尝试各源，直到某一源成功返回结果。
 *
 * 设计理由：实测同一会话内源的可用性会分钟级反转——arXiv 的 http 与 https
 * 可用性相反、OpenAlex/S2 间歇 429、DBLP 返回反爬页（HTTP 200 但内容是
 * bot 验证页，属**假成功**）。因此不能依赖任何单一源，也不能以 HTTP 200
 * 判定成功。本函数逐源尝试，并记录每个源的真实结果。
 *
 * @returns {{records:Array, attempts:Array, usedSource:string|null}}
 */
export async function searchWithFallback(query, { sources = SOURCE_PRIORITY, limit = 20, mailto = 'research-agent@example.org', stopOnFirst = true, rawQuery = null } = {}) {
  const attempts = [];
  let best = null; // { records, source }

  for (const s of sources) {
    const fn = SOURCES[s];
    if (!fn) { attempts.push({ source: s, status: 'unknown' }); continue; }
    try {
      // 原生语法只对支持它的源生效，其他源回退到自由文本
      const useRaw = rawQuery && (s === 'arxiv');
      const raw = s === 'crossref' || s === 'openalex'
        ? await fn(query, limit, mailto)
        : s === 'arxiv'
          ? await fn(useRaw ? rawQuery : query, limit, { rawQuery: useRaw ? rawQuery : null })
          : await fn(query, limit);

      // 内容质量过滤：剔除同行评审记录、决定信、空标题等非文献条目
      const { kept, dropped } = filterUsable(raw || []);
      if (kept.length === 0) {
        attempts.push({
          source: s, status: raw && raw.length ? 'filtered-out' : 'empty',
          fetched: (raw || []).length, kept: 0, dropped: dropped.length,
          reason: dropped.length ? `全部 ${dropped.length} 条被质量过滤（非文献记录）` : undefined,
        });
        continue;
      }
      attempts.push({ source: s, status: 'ok', fetched: raw.length, kept: kept.length, dropped: dropped.length });

      // 择优：保留条数最多的源。避免"先到先得"选中一个只返回 2 条低质结果的源，
      // 而错过后面能返回 40 条高质结果的源。
      if (!best || kept.length > best.records.length) best = { records: kept, source: s };
      if (stopOnFirst && best.records.length >= Math.min(limit, 5)) break;
    } catch (e) {
      attempts.push({ source: s, status: 'error', reason: String(e.message || e).slice(0, 120) });
      await sleep(500);
    }
  }
  return { records: best ? best.records : [], attempts, usedSource: best ? best.source : null };
}

// ─────────────────────────────────────────────
// 浏览器式抓取（绕开不稳定的 API 端点）
// ─────────────────────────────────────────────

/**
 * 真实浏览器请求头。
 *
 * 必要性（实测对比，同一时刻）：
 *   export.arxiv.org/api（API 端点）  → UND_ERR_CONNECT_TIMEOUT，11.5s
 *   arxiv.org/abs/2303.01469（网页）  → HTTP 200，268ms
 *   arxiv.org/pdf/2303.01469（PDF）   → HTTP 200，1.8s，31.5MB，%PDF- 头 + %%EOF 尾
 *
 * API 端点慢且频繁断开，而网页与 PDF 端点又快又稳。
 * 很多站点还会按 UA 判断是否返回验证页——带浏览器头能显著提高成功率。
 */
export const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

/** 简易 HTML 实体与标签清理 */
export function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

/**
 * 像浏览器一样获取资源（自动跟随重定向、模拟浏览器头、超时重试）。
 * @returns {{ok:boolean,status:number,body:Buffer|null,contentType:string,url:string,error?:string}}
 */
export async function fetchLikeBrowser(url, { headers = {}, timeoutMs = 25000, retries = 3, backoff = 1200 } = {}) {
  const h = { ...BROWSER_HEADERS, ...headers };
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      // 假成功检测：HTTP 200 但返回验证页/挑战页
      if (res.ok && /text\/html/.test(ct) && buf.length < 40000) {
        const t = buf.toString('utf8');
        if (/are you a robot|just a moment|cf-browser-verification|enable javascript and cookies|access denied/i.test(t)) {
          lastErr = new Error('返回验证页（疑似反爬拦截）');
          await sleep(backoff * (i + 1) * 2);
          continue;
        }
      }
      return { ok: res.ok, status: res.status, body: buf, contentType: ct, url: res.url };
    } catch (e) { lastErr = e; await sleep(backoff * (i + 1)); }
  }
  return { ok: false, status: 0, body: null, contentType: '', url, error: String((lastErr && ((lastErr.cause && lastErr.cause.code) || lastErr.message)) || 'unknown') };
}

/** 校验下载到的 PDF 是否完整（防止把 HTML 错误页存成 .pdf） */
export function isValidPdf(buf) {
  if (!buf || buf.length < 1000) return false;
  const head = buf.slice(0, 5).toString('latin1');
  const tail = buf.slice(-2048).toString('latin1');
  return head.startsWith('%PDF-') && tail.includes('%%EOF');
}

/**
 * 解析 arXiv 摘要页（HTML）。
 * 这是**最可靠的 arXiv 元数据来源**——摘要页实测 268ms 返回，
 * 而 API 端点同期超时。
 */
export function parseArxivAbsPage(html, url = '') {
  const pick = (re) => {
    const m = html.match(re);
    return m ? stripHtml(m[1]) : '';
  };
  const title = pick(/<h1 class="title[^"]*">([\s\S]*?)<\/h1>/i).replace(/^Title:\s*/i, '');
  const authorsRaw = pick(/<div class="authors">([\s\S]*?)<\/div>/i).replace(/^Authors:\s*/i, '');
  const abstract = pick(/<blockquote class="abstract[^"]*">([\s\S]*?)<\/blockquote>/i).replace(/^Abstract:\s*/i, '');
  // arXiv 页面在不同版本里用 <td> 或 <div> 承载 tablecell，两者都要兼容
  // （实测真实页面为 <td class="tablecell subjects">）
  const pickCell = (cls) => {
    const m = html.match(new RegExp(`<t[dh] class="tablecell ${cls}[^"]*">([\\s\\S]*?)</t[dh]>`, 'i'))
      || html.match(new RegExp(`<div class="tablecell ${cls}[^"]*">([\\s\\S]*?)</div>`, 'i'));
    return m ? stripHtml(m[1]) : '';
  };
  const subjects = pickCell('subjects');
  const journalRef = pickCell('journal_ref') || pick(/Journal&nbsp;ref:<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  const doiRaw = pickCell('doi');
  const comments = pickCell('comments');
  const arxivId = (url.match(/abs\/([^v/?]+)/) || html.match(/abs\/([0-9]{4}\.[0-9]{4,5})/) || [])[1] || '';
  const pdfHref = (html.match(/href="(\/pdf\/[^"]+)"/) || [])[1] || (arxivId ? `/pdf/${arxivId}` : '');
  // 提交日期：位于 <div class="dateline">[Submitted on 2 Mar 2023 (v1), last revised ...]</div>
  // 取首个年份 = v1 提交年（作为文献年份的规范选择）
  const dateline = pick(/<div class="dateline">([\s\S]*?)<\/div>/i);
  const published = (dateline.match(/Submitted on ([^()]+)/i) || [])[1]?.trim() || '';
  const year = Number((dateline.match(/\b(19|20)\d{2}\b/) || [])[0]) || null;

  const authors = authorsRaw
    ? authorsRaw.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    id: `arxiv:${arxivId}`,
    source: 'arxiv-web',
    type: journalRef ? 'journal' : 'preprint',
    title,
    abstract,
    authors,
    year,
    venue: journalRef || 'arXiv',
    arxivId,
    doi: normDoi((doiRaw.match(/10\.\d{4,9}\/[^\s<]+/) || [])[0]),
    url: arxivId ? `https://arxiv.org/abs/${arxivId}` : url,
    category: (subjects.match(/\(([a-z]+\.[A-Za-z]+)\)/) || [])[1] || '',
    subjects,
    comment: comments,
    pdfUrl: pdfHref ? `https://arxiv.org${pdfHref}` : '',
    published,
    citedBy: null,
    citationCount: null,
    raw: null,
  };
}

/** 按 arXiv ID 走网页路径取元数据（比 API 可靠）
 *
 * **为什么要把失败显式带出来**：本函数原先是"失败就 `continue`"，于是少一条记录与
 * "该 ID 根本不存在"在调用方看来完全一样。对"绝不编造文献"这条核心约束而言这是危险的——
 * 网络抖动会让 agent 误以为"arXiv 上没有这篇"，进而可能在别处凭记忆补一个标题。
 * 因此把失败清单挂在返回数组的 `failures` 属性上，让调用方能把"取不到"与"不存在"分开。
 */
export async function arxivByWeb(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map((s) => String(s).trim()).filter(Boolean);
  const out = [];
  const failures = [];
  for (const id of list) {
    let r;
    try {
      r = await fetchLikeBrowser(`https://arxiv.org/abs/${id}`);
    } catch (e) {
      failures.push({ id, reason: `请求异常：${e.message}` });
      continue;
    }
    if (!r.ok || !r.body) {
      failures.push({ id, reason: r.error || `HTTP ${r.status}` });
      continue;
    }
    const rec = parseArxivAbsPage(r.body.toString('utf8'), r.url);
    if (rec.title) {
      out.push(rec);
    } else {
      // 抓到了页面但解析不出标题：可能是 404 页面，也可能是版式变化，需人看
      failures.push({ id, reason: '页面已取回但未解析出标题（可能是 404 或版式变化）' });
    }
    await sleep(500);
  }
  out.failures = failures;
  return out;
}

/**
 * 从 PDF 提取**版式统计量**（不依赖页归属）。
 *
 * 为什么不按页分组：实测两份原件是 iText 全压缩输出——**所有对象都没有 `N 0 obj`
 * 明文头**（只有交叉引用流），因此无法按对象号把内容流映射回页。而版式校验真正需要的
 * 是**全局聚合量**（行距分布、左右边界、字号分布），这些不需要页归属。
 * 页数另由 doctor / pdf-probe 的 `/Count` 或 `/Type/Page` 计数给出。
 *
 * 实现要点（都踩过）：
 *   · 文本矩阵 Tm 写作 `1 0 0 1 x y`，**a=d=1，字号不在 Tm 里**；字号来自 `Tf` 的
 *     左操作数。靠 Tm 推字号会得 0。
 *   · 文本为 CID 编码，**无需也无法解码**；text 字段恒为空，不可用于内容比对。
 *   · 行宽用"同一行内连续 Tm 的 x 跨度"估算，够用于判断左右边界。
 *   · `zlib` 必须显式导入：曾经漏了 import，被 catch 吞掉、静默返回 0 行。
 */
export function extractPdfLines(buf) {
  const latin = buf.toString('latin1');

  // MediaBox；压进对象流时回退 A4（国自然一律 A4，实测均为 595.3×841.9）
  let pageMediaBox = [0, 0, 595.276, 841.89];
  const mb = latin.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  if (mb) pageMediaBox = mb.slice(1, 5).map(Number);

  const { chunks, inflateFail } = inflateAllStreams(buf, latin);
  if (!chunks.length && inflateFail > 0) {
    throw new Error('PDF 内容流解压全部失败，通常是解析器缺陷而非文件问题');
  }

  // 扫描所有内容流里的文本算子，收集"文本段"（run）。
  // 同一行可能由多个 Tj 拼成（中文排版常见），故用 y 容差 3pt 归并——
  // 实测英文用基线坐标、CJK 用 bbox 坐标，数值下标/上标会让 y 略有偏移，
  // 用过严的容差（如 0.6pt）会把一行的片段拆成多行。
  const runs = [];
  for (const cs of chunks) {
    if (!cs.includes('Tj') && !cs.includes('TJ')) continue;
    let curSize = 12, curX = 0, curY = 0;
    let run = null;                 // **每个流独立重置**：否则跨流会把全篇并成一段
    RE_TEXT_OP.lastIndex = 0;
    let t;
    while ((t = RE_TEXT_OP.exec(cs)) !== null) {
      if (t[6] !== undefined) {                       // a b c d e f Tm
        // 新的文本矩阵意味着新的一段：先收尾上一段，避免把不同位置并到一起
        run = null;
        curX = Number(t[5]); curY = Number(t[6]);
      } else if (t[8] !== undefined) {                 // /Font size Tf
        curSize = Number(t[8]) || curSize;
      } else {                                         // Tj / TJ
        const w = estimateGlyphs(t[0]) * curSize;
        if (!run || Math.abs(run.y - curY) > 3) {
          run = { y: curY, x0: curX, x1: curX + w, size: curSize };
          runs.push(run);
        } else {
          run.x0 = Math.min(run.x0, curX);
          run.x1 = Math.max(run.x1, curX + w);
          run.size = Math.max(run.size, curSize);
        }
      }
    }
  }

  // 聚合成行（跨流也按 y 归并；同一 y 的多个 run 合并）
  const byY = new Map();
  for (const r of runs) {
    const k = Math.round(r.y);
    if (!byY.has(k)) byY.set(k, []);
    byY.get(k).push(r);
  }
  const lines = [...byY.entries()].map(([y, arr]) => ({
    y,
    size: +Math.max(...arr.map((a) => a.size)).toFixed(1),
    x0: +Math.min(...arr.map((a) => a.x0)).toFixed(1),
    x1: +Math.max(...arr.map((a) => a.x1)).toFixed(1),
    hasSup: arr.some((a) => a.size < 9),
    text: '',
  })).sort((a, b) => b.y - a.y);

  return { lines, pageMediaBox, pageCount: countPages(buf.toString('latin1')) };
}

/** 解压所有**纯 FlateDecode**流；返回成功解压的文本与失败计数
 *
 * 必须按 `/Filter` 过滤，**不能见流就 inflate**：
 * 实测 PDF 里既有 `/Filter/FlateDecode` 的内容流，也有
 * `/Filter[/ASCII85Decode/FlateDecode]` 的**图像 XObject**。后者被强行 inflateSync
 * 时会因前导字节被容忍而"部分成功"，产出 1.1 MB 的 `ÿÿÿ…` 垃圾；若垃圾里恰好
 * 含 `Tj`/`TJ` 字样，就会被当成内容流扫描，统计值全乱（实测左边距算成 3 mm）。
 */
function inflateAllStreams(buf, latin) {
  const chunks = [];
  let inflateFail = 0;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    // 该流对象的字典（往回找不超过 800 字符）
    const dict = latin.slice(Math.max(0, m.index - 800), m.index);
    const filters = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/g) || []).join(' ');
    if (filters && !/\/FlateDecode/.test(filters)) continue;      // 非 Flate：跳过
    if (filters && /ASCII85|ASCIIHex|DCTDecode|JPXDecode|CCITTFax|RunLength/.test(filters)) continue; // 图像类
    try {
      chunks.push(zlib.inflateSync(buf.subarray(start, end)).toString('latin1'));
    } catch {
      inflateFail++;
    }
  }
  return { chunks, inflateFail };
}

/** 数页数：优先 /Type/Pages 的 /Count（权威），退回 /Type/Page 计数 */
function countPages(latin) {
  const c = latin.match(/\/Type\s*\/Pages[\s\S]{0,4000}?\/Count\s+(\d+)/);
  const n = (latin.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  return Math.max(c ? Number(c[1]) : 0, n);
}

/**
 * 估算一段文本显示算子所绘制的**字符数**。
 *
 * 两种写法都要支持（实测混用）：
 *   · 字面字符串 `(....)Tj` —— 括号内字节数即字符数（中文每字 2 字节，故 /2）
 *   · **十六进制字符串** `[<18DB0A8021991BBD>] TJ` —— CID 字体下每字 2 字节，
 *     即每 **4 个十六进制字符 = 1 字**。
 * 早期版本只认括号写法，导致正文段被整段忽略、只剩页眉页脚——
 * "左边距 3mm、右边界超出页面"这类荒谬统计值就是这么来的。
 */
function estimateGlyphs(raw) {
  let bytes = 0;
  for (const s of raw.match(/\((?:\\.|[^\\()])*\)/g) || []) bytes += s.length - 2;
  for (const s of raw.match(/<[0-9A-Fa-f\s]*>/g) || []) {
    bytes += Math.floor(s.slice(1, -1).replace(/\s/g, '').length / 2);
  }
  return Math.max(1, Math.round(bytes / 2));
}

const RE_TEXT_OP = new RegExp(
  '([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+Tm'
  + '|(/[A-Za-z0-9]+)\\s+([\\d.]+)\\s+Tf'
  + '|(?:<[0-9A-Fa-f\\s]*>|\\((?:\\\\.|[^\\\\()])*\\))\\s*Tj'
  + '|\\[[^\\]]*\\]\\s*TJ',
  'g',
);

/**
 * 计算版式统计量——版式校验的真正依据。
 * 全部为**全局聚合量**，不依赖页归属（见 extractPdfLines 的说明）。
 *
 * @param {Buffer} buf
 * @returns {{pageWidth:number,pageHeight:number,pageCount:number,
 *            leftMargin:number,rightMargin:number,
 *            bodyTop:number,bodyBottom:number,headerBaseline:number,footerBaseline:number,
 *            bodySize:number,leading:{value:number,share:number,samples:number}}}
 *          全部单位为 mm（字号为 pt）
 */
export function pdfLayoutStats(buf) {
  const { lines, pageMediaBox, pageCount } = extractPdfLines(buf);
  const [x0, y0, x1, y1] = pageMediaBox;
  const W = x1 - x0, H = y1 - y0;
  const MM = 25.4 / 72;
  const toMm = (v) => +(v * MM).toFixed(1);

  const head = lines.filter((l) => l.y > H * 0.93);
  const foot = lines.filter((l) => l.y < H * 0.07);
  const body = lines.filter((l) => l.y <= H * 0.93 && l.y >= H * 0.07);

  // 字号众数（正文）
  const sizeFreq = new Map();
  body.forEach((l) => sizeFreq.set(l.size, (sizeFreq.get(l.size) || 0) + 1));
  const bodySize = sizeFreq.size
    ? +[...sizeFreq.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  // 行距：同一页内相邻正文行的 y 差众数。
  // 页归属不可用，故用"y 单调下降、差值在合理区间"近似——行距本身是稳定量，
  // 跨页处会出现大跳变，被 g<60 的阈值滤掉。
  const sorted = [...body].sort((a, b) => b.y - a.y);
  const gapFreq = new Map();
  let gapTotal = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const g = +(a.y - b.y).toFixed(1);
    if (a.size < 11.5 || b.size < 11.5 || a.hasSup || b.hasSup) continue;
    if (g <= 10 || g >= 60) continue;
    gapFreq.set(g, (gapFreq.get(g) || 0) + 1);
    gapTotal++;
  }
  const leadingTop = gapFreq.size
    ? [...gapFreq.entries()].sort((a, b) => b[1] - a[1])[0]
    : [null, 0];

  return {
    pageWidth: toMm(W),
    pageHeight: toMm(H),
    pageCount,
    leftMargin: body.length ? toMm(Math.min(...body.map((l) => l.x0))) : null,
    rightMargin: body.length ? toMm(W - Math.max(...body.map((l) => l.x1))) : null,
    bodyTop: body.length ? toMm(H - Math.max(...body.map((l) => l.y))) : null,
    bodyBottom: body.length ? toMm(Math.min(...body.map((l) => l.y))) : null,
    headerBaseline: head.length ? toMm(H - Math.max(...head.map((l) => l.y))) : null,
    footerBaseline: foot.length ? toMm(Math.min(...foot.map((l) => l.y))) : null,
    bodySize,
    leading: {
      value: leadingTop[0],
      share: gapTotal ? +(leadingTop[1] / gapTotal).toFixed(2) : 0,
      samples: gapTotal,
    },
  };
}

/** 从 HTML 中提取链接
 *
 * 会**去重**（按 href）：实测 OpenReview 群组页 17 个链接里有 5 个重复，
 * 不去重会让"抓取结果数"虚高，掩盖实际覆盖面。
 * 同 href 多次出现时，保留**首个非空文本**（导航链接常无文本，正文链接有文本，
 * 后者信息更多）。
 */
export function extractLinks(html, baseUrl = '') {
  const byHref = new Map();
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1].trim();
    if (/^(javascript:|mailto:|#)/i.test(href)) continue;
    if (baseUrl && !/^https?:\/\//i.test(href)) {
      try { href = new URL(href, baseUrl).toString(); } catch { /* 保持原样 */ }
    }
    const text = stripHtml(m[2]).slice(0, 200);
    const prev = byHref.get(href);
    if (!prev) {
      byHref.set(href, { href, text });
    } else if (!prev.text && text) {
      prev.text = text; // 保留更有信息量的那个
    }
  }
  return [...byHref.values()];
}

/** 从 HTML 提取纯文本（去脚本、样式、导航噪声） */
export function htmlToText(html) {
  return stripHtml(
    String(html)
      .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  );
}

// ─────────────────────────────────────────────
// 去重与题库操作
// ─────────────────────────────────────────────

export function loadLibrary(file) {
  if (!existsSync(file)) return { version: '1.0', updatedAt: null, records: [] };
  const j = JSON.parse(readFileSync(file, 'utf8'));
  if (!j.records) j.records = [];
  return j;
}

/**
 * 去重合并记录。
 * 判据优先级：DOI 相同 > arXiv ID 相同 > 规范化标题相同（+年份接近）
 * 合并时保留信息更完整的字段，并记录来源。
 */
export function dedupe(records) {
  const byDoi = new Map();
  const byTitle = new Map();
  const out = [];
  const conflicts = [];

  for (const r of records) {
    const doi = normDoi(r.doi);
    const t = normTitle(r.title);
    let existing = null;
    if (doi && byDoi.has(doi)) existing = byDoi.get(doi);
    else if (t && byTitle.has(t)) {
      const cand = byTitle.get(t);
      // 标题相同但年份差 >1 年，视为不同文献（可能是同名工作）
      if (!cand.year || !r.year || Math.abs(cand.year - r.year) <= 1) existing = cand;
      else conflicts.push({ title: r.title, years: [cand.year, r.year] });
    }

    if (existing) {
      mergeInto(existing, r);
    } else {
      const copy = { ...r, sources: [r.source].filter(Boolean), mergedFrom: [] };
      out.push(copy);
      if (doi) byDoi.set(doi, copy);
      if (t) byTitle.set(t, copy);
    }
  }
  return { records: out, conflicts };
}

function mergeInto(target, src) {
  if (!target.sources) target.sources = [target.source].filter(Boolean);
  if (src.source && !target.sources.includes(src.source)) target.sources.push(src.source);
  if (!target.mergedFrom) target.mergedFrom = [];
  target.mergedFrom.push({ id: src.id, source: src.source });

  // 填充空缺字段；对预印本→正式发表做升级
  const keepIfEmpty = ['abstract', 'venue', 'doi', 'url', 'year', 'volume', 'issue', 'pages', 'publisher', 'arxivId', 'oaUrl'];
  for (const k of keepIfEmpty) {
    if (!target[k] && src[k]) target[k] = src[k];
  }
  if (target.type === 'preprint' && src.type && src.type !== 'preprint') {
    target.type = src.type;
    target.upgradedFromPreprint = true;
  }
  if ((src.citationCount ?? -1) > (target.citationCount ?? -1)) target.citationCount = src.citationCount;
  if ((src.authors || []).length > (target.authors || []).length) target.authors = src.authors;
}

// ─────────────────────────────────────────────
// 引用校验
// ─────────────────────────────────────────────

/**
 * 图/表号引用的识别正则（供 `check-consistency.mjs` 与 `cli.mjs` 共用）。
 *
 * 这个正则踩过两次坑，改动前务必先看 `node bin/cli.mjs self-test` 里的
 * 「回归: 图号引用识别边界」用例：
 *
 *   ① **不能用 (?<![\u4e00-\u9fa5]) 排除所有汉字**——那会把「如图2所示」的
 *      "如图" 一起排除掉，导致真实引用 100% 漏检（实测踩过）。
 *      正确做法是只排除真正与「图/表」构成多字词的字（知识产权表、表达、表明、
 *      图表、试点、报告、代表、地面…），即下面的 WORD_CHARS。
 *   ② **只能允许无间隔或全角空格，不允许半角空格**——否则
 *      「知识产权表 1–2 项」「所表现的能力 1 篇」会被误判为表号（实测误报）。
 *
 * 失效表现：漏检会造成"图号悬空"假阻断；误报会造成"表号悬空"假阻断。
 * 两种情况都会让一份正确的稿件无法通过校验。
 */
const FIGURE_WORD_CHARS = '意达明试报代地面权图想论述示标所体';
export const FIGURE_REF_PATTERN =
  `(?<![-${FIGURE_WORD_CHARS}])`
  + '(图|表)[\u3000]*(\\d+)(?!\\s*[\u2013\u2014~\uFF5E\u81F3-]\\s*\\d)';

/** 从正文抽取引用标记：[1] [1,2] [1-3] [1–3]
 *
 * **必须兼容全角方括号 ［1］**：中文写作中全角括号极为常见（实测一份中文立项依据
 * 中 30 处引用里 18 处用半角、30 处用全角混用），若只识别半角会导致
 * citedCount = 0，进而把整篇有引用的正文误判为"无引用文档"。
 *
 * **必须先剥离数学片段**：理论型申请书里带方括号的数学表达式极多，例如
 * `$K \in [2, 64]$`、`$d \in [2, 16]$`、`$\sigma \in [1, 100]$`。若不剥离，
 * 区间上界 `[64]`、`[100]` 会被当成引用标记，报出"正文引用了但列表中缺失：64, 100"
 * ——这是**误报**，且会阻断一份本身完全正确的稿件（实测已发生）。
 */
export function extractCitations(text) {
  const found = new Map(); // num -> count
  // 统一全角括号与全角逗号/连字符为半角，再做抽取
  const norm = String(text)
    .replace(/［/g, '[').replace(/］/g, ']')
    .replace(/，/g, ',')
    .replace(/[－—–]/g, '-');
  // 剥离数学片段：块级 $$...$$ 与 $...$（含跨行），避免其中的区间/下标被当作引用。
  // 注意顺序：先 $$ 后 $，否则 $$..$$ 会被 $..$ 规则错切。
  const withoutMath = norm
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ');
  // 排除图/表/公式编号：Figure 1 / Fig. 1 / Table 1 / 式(1) / Eq. (1)
  const cleaned = withoutMath
    .replace(/\b(?:fig(?:ure)?|tab(?:le)?|eq(?:uation)?|算法|图|表|式)\s*\.?\s*\(?\d+[a-z]?\)?/gi, ' ')
    .replace(/\[[^\]]*\b(?:pts?|points?|GB|MB|TB|ms|s|%)\b[^\]]*\]/gi, ' ');

  const re = /\[(\d+(?:\s*[-,]\s*\d+)*)\]/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const body = m[1];
    for (const part of body.split(',')) {
      const range = part.split('-').map((s) => s.trim()).filter(Boolean);
      if (range.length === 2) {
        const a = +range[0], b = +range[1];
        if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a < 200) {
          for (let i = a; i <= b; i++) found.set(i, (found.get(i) || 0) + 1);
        }
      } else if (range.length === 1) {
        const n = +range[0];
        if (Number.isFinite(n)) found.set(n, (found.get(n) || 0) + 1);
      }
    }
  }
  return found;
}

/**
 * 解析参考文献列表。
 * 支持：
 *   [1] 作者. 题名[C]//会议. 地: 社, 年: 页.
 *   [1] 作者. 题名[J]. 刊名, 年, 卷(期): 页.
 */
export function parseReferenceList(text) {
  const entries = new Map();
  // 条目边界：下一个行首 [数字]，或字符串结束
  // 注意：此处必须用 \\s 而非 \\t —— 在普通字符串里 "\t" 会变成真实制表符
  // 兼容全角方括号 [［ ］]（中文写作常见）
  const re = new RegExp('^\\s*[\\[［](\\d+)[\\]］]\\s*([\\s\\S]*?)(?=^\\s*[\\[［]\\d+[\\]］]\\s|$)', 'gm');
  let m;
  while ((m = re.exec(text)) !== null) {
    const num = +m[1];
    const body = m[2].replace(/\s+/g, ' ').trim();
    if (!body) continue;
    entries.set(num, { num, raw: body, ...parseRefFields(body) });
  }
  return entries;
}

export function parseRefFields(body) {
  const typeMatch = body.match(/\[([A-Z/]+)\]/);
  const typeTag = typeMatch ? typeMatch[1] : '';
  const hasDoi = /10\.\d{4,9}\/\S+/.test(body);
  const hasArxiv = /arXiv:\s*\d{4}\.\d{4,5}/i.test(body);
  const doi = (body.match(/10\.\d{4,9}\/[^\s,;]*[^\s,;.]/) || [])[0] || null;
  const isPreprint = typeTag.includes('EB') || typeTag.includes('OL') || hasArxiv;
  const isJournal = typeTag.includes('J') || (!typeTag && /\.[Jj]\.\s/.test(body));
  // 会议判定：必须看 [C] 类型标识或 [C]// 连接符。
  // 不能用裸 "//" —— 电子资源的 URL（https://…）里也含 "//"，会造成误判。
  const isConference = !isPreprint && (typeTag.includes('C') || /\[[A-Z]*C[A-Z]*\]\s*\/\//.test(body));

  // 年份：排除紧跟在"页码区间"里的数字；取最靠后的合理 4 位年
  const years = (body.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  const year = years.length ? years[years.length - 1] : null;

  // 卷(期): 页 —— 仅对期刊解析；卷号不超过 3 位且不等于年份
  let volume = null, issue = null, pages = null;
  if (isJournal && !isConference) {
    const m = body.match(/,\s*((?:19|20)\d{2})\s*,\s*(\d{1,3})\s*(?:\((\d{1,3})\))?\s*:\s*([\d\-–]+)/);
    if (m) {
      volume = m[2];
      issue = m[3] || null;
      pages = m[4];
    } else {
      const m2 = body.match(/(\d{1,3})\s*\((\d{1,3})\)\s*:\s*([\d\-–]+)/);
      if (m2) { volume = m2[1]; issue = m2[2]; pages = m2[3]; }
    }
  }
  if (!pages) {
    // 会议或兜底：取末尾 ": 页码" 或 "页" 模式
    const mp = body.match(/:\s*([\d]+(?:\s*[-–]\s*[\d]+)?)\s*\.?\s*$/);
    if (mp) pages = mp[1].replace(/\s+/g, '');
  }
  // 卷号合理性校验：不能是年份
  if (volume && year && Number(volume) === year) volume = null;

  return {
    typeTag,
    isConference,
    isJournal,
    isPreprint,
    hasDoi,
    doi,
    hasArxiv,
    year,
    volume,
    issue,
    pages,
    looksLikeDoiLink: /doi\.org|https?:\/\//i.test(body),
  };
}

/**
 * 从全文中剥离"参考文献"区段，返回正文部分。
 * 必要性：若把整篇文档交给 extractCitations，文献列表里每条的 [n]
 * 都会被误判为"正文引用"，导致 unusedInText 永远为空（漏检挂空文献）。
 */
export function stripReferenceSection(text) {
  const lines = text.split(/\r?\n/);
  const patterns = [
    /^\s*#{0,6}\s*参\s*考\s*文\s*献\s*[:：]?\s*$/,
    /^\s*#{0,6}\s*References\s*[:：]?\s*$/i,
    /^\s*#{0,6}\s*Bibliography\s*[:：]?\s*$/i,
    /^\s*#{0,6}\s*引\s*用\s*文\s*献\s*[:：]?\s*$/,
  ];
  // 编号条目起始行（半角或全角方括号）
  const entryRe = /^\s*[\[［]\d+[\]］]/;
  // 关键：正文中"参考文献"区段可能**出现多次**（例如国自然模板把参考文献
  // 紧接在（一）立项依据之后，其后还有（二）（三）（四））。若只在第一个
  // 标题处截断，则标题之后的正文会被整体吞掉，导致大量引用漏检。
  // 因此这里改为「掩蔽所有参考文献区段」：保留文档其余部分（含其后的正文），
  // 仅把每个区段自身的文字置空，既不让条目里的 [n] 被算作正文引用，
  // 也不丢失区段之后的正文。
  const mask = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!patterns.some((re) => re.test(lines[i]))) continue;
    mask[i] = true;
    // 掩蔽该标题之后的连续编号条目（空行一并跳过），遇到非条目行即止
    for (let j = i + 1; j < lines.length; j++) {
      const L = lines[j];
      if (!L.trim()) { mask[j] = true; continue; }
      if (entryRe.test(L)) { mask[j] = true; continue; }
      // 条目可能续行（无编号的续行属于同一条目）：若前行已被掩蔽且本行非标题，继续掩蔽
      if (mask[j - 1] && !/^\s*#{1,6}\s/.test(L)) { mask[j] = true; continue; }
      break;
    }
  }
  if (!mask.some(Boolean)) return { body: text, refs: '', splitAt: -1 };
  const body = lines.filter((_, i) => !mask[i]).join('\n');
  const refs = lines.filter((_, i) => mask[i]).join('\n');
  const splitAt = mask.findIndex(Boolean) + 1;
  return { body, refs, splitAt };
}

/**
 * 双向校验：正文引用 ↔ 文献列表。
 */
export function validateCitations(manuscriptText, libRecords) {
  const { body } = stripReferenceSection(manuscriptText);
  const cited = extractCitations(body);
  const list = parseReferenceList(manuscriptText);
  const libNums = new Set(libRecords.map((r, i) => i + 1));

  const missingInList = [...cited.keys()].filter((n) => !list.has(n)).sort((a, b) => a - b);
  const unusedInText = [...list.keys()].filter((n) => !cited.has(n)).sort((a, b) => a - b);
  const orphans = [...list.keys()].filter((n) => !libNums.has(n) && cited.has(n)).sort((a, b) => a - b);

  const issues = [];
  const nums = [...list.keys()].sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) issues.push({ kind: 'gap', message: `编号不连续：${nums[i - 1]} → ${nums[i]}` });
  }
  if (nums.length && nums[0] !== 1) issues.push({ kind: 'start', message: `编号未从 1 开始（首个为 ${nums[0]}）` });

  const formatProblems = [];
  for (const [n, e] of list) {
    const p = [];
    // 定位标识：页码/卷期、或 DOI/arXiv ID/URL。
    // GB/T 7714-2015 允许电子资源以 [EB/OL] + 获取路径作为定位方式，
    // 而计算机学科大量会议论文（TMLR、arXiv-only、OpenReview-only）本就没有页码。
    // 因此"有页码"与"有持久标识"二者具其一即可，**不强制要求页码**。
    const hasPagination = Boolean((e.volume && e.pages) || e.pages);
    const hasIdentifier = Boolean(e.doi || e.hasArxiv || /https?:\/\//i.test(e.raw) || e.looksLikeDoiLink);
    const hasLocator = hasPagination || hasIdentifier;

    if (!e.year) p.push('缺年份');
    if (!hasLocator) p.push('缺定位信息（既无卷期页，也无 DOI / arXiv ID / URL）');
    if (e.isJournal && !e.volume && !hasIdentifier) p.push('期刊缺卷且无持久标识');
    if (e.isConference && !/\/\//.test(e.raw) && !e.isPreprint) p.push('会议缺 "//" 连接符');
    if (e.isPreprint && !/https?:\/\//.test(e.raw)) p.push('电子资源缺获取路径');
    if (/待确认|待核实|TODO|XXX|\?\?\?/i.test(e.raw)) p.push('含未核实占位符');
    if (p.length) formatProblems.push({ num: n, problems: p, raw: e.raw.slice(0, 120) });
  }

  const dupDoi = [];
  const seen = new Map();
  for (const [n, e] of list) {
    if (e.doi) {
      if (seen.has(e.doi)) dupDoi.push({ doi: e.doi, nums: [seen.get(e.doi), n] });
      else seen.set(e.doi, n);
    }
  }

  return {
    citedCount: cited.size,
    listCount: list.size,
    missingInList,
    unusedInText,
    orphans,
    numberingIssues: issues,
    formatProblems,
    duplicateDoi: dupDoi,
    ok:
      missingInList.length === 0 &&
      unusedInText.length === 0 &&
      issues.length === 0 &&
      formatProblems.length === 0 &&
      dupDoi.length === 0,
  };
}

// ─────────────────────────────────────────────
// 格式化输出
// ─────────────────────────────────────────────

/** 中文姓名/西文姓名统一处理 */
function fmtAuthors(authors, { max = 3, lang = 'en' } = {}) {
  const list = (authors || []).filter(Boolean);
  if (!list.length) return lang === 'zh' ? '佚名' : 'Anon.';
  const shown = list.slice(0, max);
  const rest = list.length > max;
  const sep = lang === 'zh' ? ', ' : ', ';
  let s = shown.join(sep);
  if (rest) s += lang === 'zh' ? ', 等' : ', et al';
  return s;
}

function fmtPages(p) {
  if (!p) return '';
  return String(p).replace(/[-–]+/g, '-');
}

/**
 * 输出 GB/T 7714-2015 顺序编码制条目。
 * 不自动编造缺失字段；缺字段会以 〔缺:xxx〕 标出，便于人工补全。
 */
export function toGBT7714(rec, num) {
  const prefix = num != null ? `[${num}] ` : '';
  const zh = /[\u4e00-\u9fff]/.test(rec.title || '');
  const authors = fmtAuthors(rec.authors, { lang: zh ? 'zh' : 'en' });
  const title = (rec.title || '〔缺:题名〕').replace(/\.$/, '');
  const year = rec.year || '〔缺:年〕';

  if (rec.type === 'conference') {
    const venue = rec.venue || '〔缺:会议名〕';
    const pages = fmtPages(rec.pages) || '〔缺:页码〕';
    const place = rec.publisher || '';
    const pub = place ? `${place}, ${year}: ${pages}` : `${year}: ${pages}`;
    return `${prefix}${authors}. ${title}[C]//${venue}. ${pub}.`;
  }
  if (rec.type === 'journal') {
    const venue = rec.venue || '〔缺:刊名〕';
    const vol = rec.volume || '〔缺:卷〕';
    const iss = rec.issue ? `(${rec.issue})` : '';
    const pages = fmtPages(rec.pages) || '〔缺:页〕';
    return `${prefix}${authors}. ${title}[J]. ${venue}, ${year}, ${vol}${iss}: ${pages}.`;
  }
  if (rec.type === 'book') {
    const pub = rec.publisher || '〔缺:出版社〕';
    return `${prefix}${authors}. ${title}[M]. ${pub}, ${year}.`;
  }
  if (rec.type === 'thesis') {
    return `${prefix}${authors}. ${title}[D]. ${rec.venue || '〔缺:单位〕'}, ${year}.`;
  }
  // preprint / other → EB/OL
  const url = rec.url || (rec.arxivId ? `https://arxiv.org/abs/${rec.arxivId}` : '〔缺:URL〕');
  const date = rec.published ? rec.published.slice(0, 10) : year;
  return `${prefix}${authors}. ${title}[EB/OL]. (${date})[${new Date().toISOString().slice(0, 10)}]. ${url}.`;
}

/** 输出 BibTeX */
export function toBibtex(rec, key) {
  const first = (rec.authors && rec.authors[0]) || 'anon';
  const surname = first.split(' ').pop().replace(/[^A-Za-z]/g, '') || 'anon';
  const k = key || `${surname}${rec.year || ''}${hashId(rec.title || '').slice(0, 4)}`;
  const type = rec.type === 'conference' ? 'inproceedings' : rec.type === 'journal' ? 'article' : rec.type === 'book' ? 'book' : 'misc';
  const f = [
    `  title = {${(rec.title || '').replace(/[{}]/g, '')}}`,
    `  author = {${(rec.authors || []).join(' and ')}}`,
    rec.year ? `  year = {${rec.year}}` : null,
    rec.venue ? (type === 'inproceedings' ? `  booktitle = {${rec.venue}}` : `  journal = {${rec.venue}}`) : null,
    rec.volume ? `  volume = {${rec.volume}}` : null,
    rec.issue ? `  number = {${rec.issue}}` : null,
    rec.pages ? `  pages = {${fmtPages(rec.pages)}}` : null,
    rec.publisher ? `  publisher = {${rec.publisher}}` : null,
    rec.doi ? `  doi = {${rec.doi}}` : null,
    rec.url ? `  url = {${rec.url}}` : null,
    rec.arxivId ? `  eprint = {${rec.arxivId}}` : null,
  ].filter(Boolean);
  return `@${type}{${k},\n${f.join(',\n')}\n}`;
}

/** 极简 RIS 解析（用于导入 Zotero/EndNote 导出） */
export function parseRIS(text) {
  const blocks = text.split(/^ER\s+-.*$/m).map((b) => b.trim()).filter(Boolean);
  const typeMap = { JOUR: 'journal', CONF: 'conference', CPAPER: 'conference', BOOK: 'book', THES: 'thesis', GEN: 'preprint' };
  return blocks.map((b) => {
    const get = (tag) => {
      const re = new RegExp(`^${tag}\\s+-\\s*(.*)$`, 'gm');
      const out = [];
      let m;
      while ((m = re.exec(b)) !== null) out.push(m[1].trim());
      return out;
    };
    const ty = (get('TY')[0] || 'GEN').toUpperCase();
    const sp = get('SP')[0], ep = get('EP')[0];
    return {
      id: `ris:${hashId(b)}`,
      source: 'ris',
      type: typeMap[ty] || 'unknown',
      title: get('TI')[0] || get('T1')[0] || '',
      abstract: get('AB')[0] || '',
      authors: [...get('AU'), ...get('A1')],
      year: Number((get('PY')[0] || get('Y1')[0] || '').slice(0, 4)) || null,
      venue: get('JO')[0] || get('JF')[0] || get('T2')[0] || '',
      doi: normDoi(get('DO')[0] || ''),
      url: get('UR')[0] || '',
      volume: get('VL')[0] || '',
      issue: get('IS')[0] || '',
      pages: sp && ep ? `${sp}-${ep}` : (sp || ''),
      citationCount: null,
      raw: null,
    };
  }).filter((r) => r.title);
}

/** 极简 BibTeX 解析 */
export function parseBibtex(text) {
  const out = [];
  const re = /@(\w+)\s*\{\s*([^,]+),([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase();
    const body = m[3];
    const field = (name) => {
      const f = body.match(new RegExp(`${name}\\s*=\\s*[{"]([\\s\\S]*?)[}"]\\s*,?`, 'i'));
      return f ? f[1].replace(/[{}]/g, '').trim() : '';
    };
    const typeMap = { inproceedings: 'conference', conference: 'conference', article: 'journal', book: 'book', phdthesis: 'thesis', mastersthesis: 'thesis', misc: 'preprint' };
    out.push({
      id: `bib:${hashId(m[2] + field('title'))}`,
      source: 'bibtex',
      key: m[2].trim(),
      type: typeMap[kind] || 'unknown',
      title: field('title'),
      abstract: field('abstract'),
      authors: field('author').split(/\s+and\s+/).map((s) => s.trim()).filter(Boolean),
      year: Number(field('year')) || null,
      venue: field('booktitle') || field('journal') || '',
      doi: normDoi(field('doi')),
      url: field('url'),
      volume: field('volume'),
      issue: field('number'),
      pages: field('pages'),
      publisher: field('publisher'),
      citationCount: null,
      raw: null,
    });
  }
  return out.filter((r) => r.title);
}

// ─────────────────────────────────────────────
// 检索策略辅助
// ─────────────────────────────────────────────

/**
 * 把研究主题展开为一组可执行的检索式（供 agent 按序调用 search）。
 * 这是一个确定性模板，不调用 LLM —— 目的是让任何 agent 都得到一致的检索覆盖。
 */
export function buildQueryPlan({ topic, english = [], synonyms = [], subtopics = [], venues = [], years = '2019-2026' }) {
  const plan = [];
  const push = (q, purpose) => plan.push({ query: q, purpose });

  if (topic) push(topic, '主题词直查（建立基线）');
  for (const t of english) push(t, `主题英文等价表达：${t}`);
  for (const s of synonyms) push(s, `同义词扩展：${s}`);
  for (const s of subtopics) push(s, `子方向覆盖：${s}`);

  // 综述优先：快速建立领域地图
  for (const t of (english.length ? english : [topic]).slice(0, 3)) {
    push(`survey ${t}`, '综述检索（建立领域地图与主线划分）');
    push(`${t} review`, '综述检索（补充）');
  }
  // 方法/基准/失败模式：支撑"结构性不足"的判断
  for (const t of (english.length ? english : [topic]).slice(0, 2)) {
    push(`${t} limitation failure mode`, '结构性不足证据');
    push(`${t} benchmark evaluation`, '评测基准与可比性');
    push(`${t} baseline comparison`, '最强基线识别');
  }
  // 国内工作
  for (const t of (english.length ? english : [topic]).slice(0, 2)) {
    push(`${t} China`, '国内代表性工作');
  }
  // venue 定向检索：必须与主题词组合。
  // 单独检索会议名（如仅 "NeurIPS"）会返回大量无关结果，是无效检索式。
  const venueBase = (english.length ? english : [topic]).filter(Boolean);
  if (venueBase.length) {
    const base = venueBase[0];
    for (const v of venues) push(`${base} ${v}`, `目标 venue 定向检索：${v}`);
  }

  return { years, count: plan.length, plan };
}

/**
 * 检查检索计划的质量问题（供 plan 命令在生成后自检并告警）。
 * 返回问题列表，空数组表示无问题。
 *
 * @param {Array<{query:string,purpose:string}>} plan
 * @param {string[]} venues 已知的会议/期刊名，用于判断"单独检索会议名"这一无效模式
 *
 * 注意：不能仅凭"词元数少"判定检索式无效——中文主题词（如"一致性生成"）本身就是
 * 合法的短检索式。只有**单独出现的 venue 名**才是确定无效的模式。
 */
export function auditQueryPlan(plan, venues = []) {
  const issues = [];
  const qs = plan.map((p) => p.query);
  const venueSet = new Set(venues.map((v) => v.trim().toLowerCase()).filter(Boolean));

  // 1. 单独把 venue 名作为检索式（确定无效：会返回大量无关结果）
  for (const q of qs) {
    const t = q.trim();
    if (!t) {
      issues.push({ kind: 'empty', query: q, message: '存在空检索式' });
      continue;
    }
    if (venueSet.has(t.toLowerCase())) {
      issues.push({
        kind: 'bare-venue', query: t,
        message: `检索式「${t}」是单独的会议/期刊名，应改为「<主题词> ${t}」`,
      });
    }
  }
  // 2. 是否覆盖五类关键检索
  const joined = plan.map((p) => `${p.query} ${p.purpose}`).join(' | ');
  const required = {
    主题词: /主题|topic/i,
    综述: /survey|review|综述/i,
    不足证据: /limitation|failure|不足|缺陷/i,
    评测基准: /benchmark|evaluation|baseline|基准/i,
    国内工作: /China|国内/i,
  };
  for (const [name, re] of Object.entries(required)) {
    if (!re.test(joined)) issues.push({ kind: 'missing-category', query: null, message: `缺少「${name}」类检索` });
  }
  // 3. 重复检索式
  const seen = new Map();
  for (const q of qs) {
    const k = q.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) issues.push({ kind: 'duplicate', query: q, message: `检索式重复：「${q}」` });
    seen.set(k, true);
  }
  return issues;
}

/** 从记录推断"结构性不足"的候选证据（确定性启发式，供人工判断） */
export function suggestEvidenceGaps(records) {
  const t = (r) => `${r.title} ${r.abstract}`.toLowerCase();
  const patterns = {
    assumption: [/assum(e|es|ption|ing)/i, /we assume/i, /under the assumption/i],
    limitation: [/limitation/i, /fails? to/i, /cannot/i, /does not generalize/i, /degrades? (when|under)/i],
    mechanism: [/mechanism/i, /why does/i, /root cause/i, /we observe that/i, /we find that/i],
    bound: [/upper bound/i, /lower bound/i, /impossibility/i, /no .* can/i, /trade-?off/i],
    scale: [/at scale/i, /scalab/i, /billion|million parameters/i, /compute budget/i],
  };
  const hits = {};
  for (const [k, res] of Object.entries(patterns)) {
    hits[k] = records.filter((r) => res.some((re) => re.test(t(r)))).map((r) => r.title).slice(0, 8);
  }
  return hits;
}

// 申报类型参数（两套模板的唯一真源），re-export 供 cli.mjs 自检与外部调用
export { TRACKS, getTrack, renderOutline, SHARED } from './track-params.mjs';

