#!/usr/bin/env node
/**
 * OpenNFSC 环境配置（setup）
 * ─────────────────────────────────────────────────────────────
 * 目标：一条命令把运行本技能包所需的全部环境准备好。
 *
 *   node bin/setup.mjs            # 自动检测 + 按需安装
 *   node bin/setup.mjs --check    # 只检测，不安装
 *   node bin/setup.mjs --mirror https://mirrors.aliyun.com/CTAN/systems/texlive/tlnet/
 *
 * 会做的事：
 *   1. 检查 Node.js 版本（≥18，需内置 fetch）
 *   2. 检测/安装 TeX Live（含中文支持），自动挑选可用镜像
 *   3. 校验中文字体，给出回退方案
 *   4. 写出 .opennfsc.json，供其他脚本复用
 *
 * powered by gary
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG = join(ROOT, '.opennfsc.json');

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.includes(k);
const CHECK_ONLY = has('--check');
const IS_WIN = platform() === 'win32';

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
const ok = (m) => console.log(`  ${C.g}✓${C.x} ${m}`);
const warn = (m) => console.log(`  ${C.y}!${C.x} ${m}`);
const bad = (m) => console.log(`  ${C.r}✗${C.x} ${m}`);
const info = (m) => console.log(`  ${C.d}${m}${C.x}`);
const head = (m) => console.log(`\n${C.b}▌${C.x} ${m}`);

const state = { version: 1, poweredBy: 'gary', generatedAt: new Date().toISOString(), platform, node: null, tex: null, fonts: null, sources: null };

// ─────────────────────────────────────────────
// 1. Node.js
// ─────────────────────────────────────────────
function checkNode() {
  head('1/4  Node.js 运行时');
  const major = Number(process.versions.node.split('.')[0]);
  state.node = { version: process.versions.node, ok: major >= 18, hasFetch: typeof fetch === 'function' };
  if (major >= 18 && typeof fetch === 'function') {
    ok(`Node.js v${process.versions.node}（内置 fetch 可用）`);
  } else {
    bad(`Node.js v${process.versions.node} 版本过低或缺少 fetch`);
    info('请安装 Node.js ≥ 18：https://nodejs.org/');
    state.node.ok = false;
  }
  return state.node.ok;
}

// ─────────────────────────────────────────────
// 2. TeX Live（用于 PDF 出稿）
// ─────────────────────────────────────────────
const CTAN_MIRRORS = [
  'https://mirrors.aliyun.com/CTAN/systems/texlive/tlnet/',
  'https://mirrors.ustc.edu.cn/CTAN/systems/texlive/tlnet/',
  'https://mirrors.cloud.tencent.com/CTAN/systems/texlive/tlnet/',
  'https://mirrors.bfsu.edu.cn/CTAN/systems/texlive/tlnet/',
  'https://mirror.ctan.org/systems/texlive/tlnet/',
];

/** 在常见位置查找已有的 TeX 二进制目录 */
function findExistingTex() {
  const names = IS_WIN ? ['xelatex.exe'] : ['xelatex'];
  const roots = IS_WIN
    ? ['C:\\texlive', 'D:\\texlive', 'E:\\texlive', 'C:\\Program Files\\MiKTeX', 'C:\\Program Files\\texlive',
       join(process.env.LOCALAPPDATA || '', 'Programs', 'MiKTeX'), join(process.env.USERPROFILE || '', '.TinyTeX'), 'C:\\TinyTeX']
    : ['/usr/local/texlive', '/usr/local/bin', '/opt/texlive', join(process.env.HOME || '', '.TinyTeX'), '/Library/TeX/texbin'];

  // 先看 PATH
  for (const n of names) {
    try {
      const p = execSync(IS_WIN ? `where ${n}` : `command -v ${n}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
      if (p && existsSync(p)) return { bin: dirname(p), source: 'PATH' };
    } catch { /* 不在 PATH */ }
  }
  // 再扫常见安装根目录（限制深度，避免全盘扫描过慢）
  for (const r of roots) {
    if (!r || !existsSync(r)) continue;
    for (const depth of [['bin'], ['2026', 'bin'], ['2025', 'bin'], ['2024', 'bin'], ['bin', 'windows'], ['2026', 'bin', 'windows']]) {
      for (const sub of IS_WIN ? [depth.join('\\'), depth.join('\\') + '\\windows'] : [depth.join('/')]) {
        const d = join(r, sub);
        if (!existsSync(d)) continue;
        for (const n of names) if (existsSync(join(d, n))) return { bin: d, source: r };
      }
    }
  }
  return null;
}

async function probeMirrors(mirrors) {
  const good = [];
  for (const m of mirrors) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${m}tlpkg/texlive.tlpdb.sha512`, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
      if (res.ok) { good.push({ mirror: m, ms: Date.now() - t0 }); ok(`${m}  ${Date.now() - t0}ms`); }
      else warn(`${m}  HTTP ${res.status}`);
    } catch (e) {
      warn(`${m}  ${(e.cause && e.cause.code) || e.message}`);
    }
  }
  return good.sort((a, b) => a.ms - b.ms);
}

async function setupTex() {
  head('2/4  TeX Live（中文 PDF 出稿）');
  const found = findExistingTex();
  if (found) {
    let ver = '';
    try {
      ver = execFileSync(join(found.bin, IS_WIN ? 'xelatex.exe' : 'xelatex'), ['--version'], { encoding: 'utf8' }).split('\n')[0];
    } catch { /* ignore */ }
    ok(`已安装：${found.bin}`);
    if (ver) info(ver.trim());

    // 校验关键宏包
    const need = ['ctex.sty', 'xeCJK.sty', 'longtable.sty', 'enumitem.sty', 'fancyhdr.sty', 'caption.sty', 'amsmath.sty', 'fancyvrb.sty'];
    const missing = [];
    const kp = join(found.bin, IS_WIN ? 'kpsewhich.exe' : 'kpsewhich');
    for (const p of need) {
      try {
        const r = execFileSync(kp, [p], { encoding: 'utf8' }).trim();
        if (!r) missing.push(p);
      } catch { missing.push(p); }
    }
    if (missing.length === 0) {
      ok(`关键宏包齐备（${need.length} 个）`);
    } else {
      warn(`缺少宏包：${missing.join(', ')}`);
      info(IS_WIN ? `补装：${join(found.bin, 'tlmgr.bat')} install ${missing.map((m) => m.replace('.sty', '')).join(' ')}`
        : `补装：sudo tlmgr install ${missing.map((m) => m.replace('.sty', '')).join(' ')}`);
    }
    state.tex = { bin: found.bin, source: found.source, version: ver.trim(), missingPackages: missing, ok: true };
    return true;
  }

  bad('未找到 TeX 发行版');
  info('PDF 出稿需要 TeX Live（含 ctex 中文支持）。');
  info('不装也能用：检索、写作、校验、以及 Markdown/HTML 出稿均不依赖 TeX。');

  if (CHECK_ONLY) {
    state.tex = { ok: false, skipped: true };
    info('（--check 模式，跳过安装）');
    return false;
  }

  console.log('');
  info('探测 CTAN 镜像…');
  const good = await probeMirrors(arg('--mirror') ? [arg('--mirror')] : CTAN_MIRRORS);
  if (!good.length) {
    bad('所有镜像均不可达。可稍后重试，或手动安装 TeX Live 后重跑本脚本。');
    state.tex = { ok: false, error: 'no-mirror' };
    return false;
  }
  const mirror = good[0].mirror;
  ok(`选用镜像：${mirror}`);

  const dir = arg('--texdir', IS_WIN ? 'C:\\texlive' : '/usr/local/texlive');
  info(`将安装到：${dir}（可用 --texdir 修改）`);
  info('安装规模：scheme-small（约 400 个包，10–20 分钟）');

  // 下载网络安装器
  const tmp = join(tmpdir(), `opennfsc-texlive-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const zip = join(tmp, 'install-tl.zip');
  info('下载安装器…');
  try {
    const res = await fetch(`${mirror}install-tl.zip`, { signal: AbortSignal.timeout(600000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(zip, buf);
    ok(`安装器已下载（${(buf.length / 1048576).toFixed(1)} MB）`);
  } catch (e) {
    bad(`安装器下载失败：${(e.cause && e.cause.code) || e.message}`);
    state.tex = { ok: false, error: 'download-failed' };
    return false;
  }

  // 解压
  try {
    if (IS_WIN) execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force"`, { stdio: 'ignore' });
    else execSync(`unzip -q '${zip}' -d '${tmp}'`, { stdio: 'ignore' });
    ok('已解压');
  } catch (e) {
    bad(`解压失败：${e.message}`);
    state.tex = { ok: false, error: 'unzip-failed' };
    return false;
  }

  const instDir = execSync(IS_WIN ? `dir /b /ad "${tmp}"` : `ls -d "${tmp}"/install-tl-*`, { encoding: 'utf8' })
    .trim().split(/\r?\n/).find((s) => s.startsWith('install-tl'));
  if (!instDir) { bad('未找到安装器目录'); state.tex = { ok: false, error: 'no-install-dir' }; return false; }
  const work = join(tmp, instDir.trim());

  // 写 profile
  const profile = [
    'selected_scheme scheme-small',
    `TEXDIR ${dir.replace(/\\/g, '/')}`,
    `TEXMFLOCAL ${dir.replace(/\\/g, '/')}/texmf-local`,
    `TEXMFSYSVAR ${dir.replace(/\\/g, '/')}/texmf-var`,
    `TEXMFSYSCONFIG ${dir.replace(/\\/g, '/')}/texmf-config`,
    'TEXMFVAR ~/.texlive/texmf-var',
    'TEXMFCONFIG ~/.texlive/texmf-config',
    'TEXMFHOME ~/texmf',
    'instopt_adjustpath 1',
    'instopt_adjustrepo 1',
    'tlpdbopt_install_docfiles 0',
    'tlpdbopt_install_srcfiles 0',
  ].join('\n');
  const profilePath = join(tmp, 'texlive.profile');
  writeFileSync(profilePath, profile, 'utf8');

  console.log('');
  info('开始安装（输出较多，以下仅显示阶段提示）…');
  const exe = IS_WIN ? join(work, 'install-tl-windows.bat') : join(work, 'install-tl');
  const cmdArgs = IS_WIN
    ? ['-profile', profilePath, '-repository', mirror, '-no-interaction']
    : ['-profile', profilePath, '-repository', mirror, '-no-interaction'];
  try {
    execFileSync(exe, cmdArgs, { stdio: 'inherit', shell: IS_WIN });
  } catch (e) {
    // 安装器收尾阶段可能返回非零（tlaunch.ini 之类的无害警告），故以实际二进制是否存在为准
    const again = findExistingTex();
    if (!again) {
      bad(`安装失败：${e.message}`);
      info(`可手动安装：https://tug.org/texlive/  （或用 --texdir 换目录重试）`);
      state.tex = { ok: false, error: 'install-failed' };
      return false;
    }
  }

  const after = findExistingTex();
  if (after) {
    ok(`安装完成：${after.bin}`);
    info('若当前终端仍找不到 xelatex，请重开终端以刷新 PATH。');
    state.tex = { bin: after.bin, source: after.source, mirror, ok: true };
    return true;
  }
  bad('安装后仍未找到 xelatex，请重开终端后重跑 setup。');
  state.tex = { ok: false, error: 'post-check-failed' };
  return false;
}

// ─────────────────────────────────────────────
// 3. 中文字体
// ─────────────────────────────────────────────
function checkFonts() {
  head('3/4  中文字体');
  const candidates = IS_WIN
    ? [['SimSun', 'C:\\Windows\\Fonts\\simsun.ttc'], ['SimHei', 'C:\\Windows\\Fonts\\simhei.ttf'], ['KaiTi', 'C:\\Windows\\Fonts\\simkai.ttf']]
    : [['Noto Serif CJK', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'],
       ['Source Han Serif', '/usr/share/fonts/opentype/adobe-source-han-serif/SourceHanSerif-Regular.otf'],
       ['FandolSong', '/usr/share/texmf/fonts/opentype/public/fandol/FandolSong-Regular.otf']];
  const found = candidates.filter(([, p]) => existsSync(p)).map(([n]) => n);
  if (found.length) {
    ok(`可用中文字体：${found.join('、')}`);
    state.fonts = { ok: true, available: found };
  } else {
    warn('未检测到系统中文字体');
    info('不影响编译：tex 模板已内置回退到 TeX Live 自带的 Fandol 字体。');
    state.fonts = { ok: false, fallback: 'Fandol' };
  }
  return true;
}

// ─────────────────────────────────────────────
// 4. 网络源可达性
// ─────────────────────────────────────────────
const SOURCES = [
  ['arxiv-web', 'https://arxiv.org/abs/2303.01469'],
  ['openreview', 'https://api2.openreview.net/notes/search?query=consistency&limit=1'],
  ['crossref', 'https://api.crossref.org/works?query=test&rows=1'],
  ['arxiv-api-http', 'http://export.arxiv.org/api/query?search_query=all:test&max_results=1'],
  ['openalex', 'https://api.openalex.org/works?search=test&per-page=1'],
];

async function checkSources() {
  head('4/4  文献数据源可达性');
  const results = {};
  await Promise.all(SOURCES.map(async ([name, url]) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/126' }, signal: AbortSignal.timeout(15000) });
      const txt = await r.text();
      const bot = /not a bot|just a moment|cf-browser/i.test(txt.slice(0, 3000));
      results[name] = { ok: r.ok && !bot, status: r.status, ms: Date.now() - t0, botPage: bot };
      if (r.ok && !bot) ok(`${name.padEnd(16)} ${String(Date.now() - t0).padStart(6)}ms`);
      else warn(`${name.padEnd(16)} HTTP ${r.status}${bot ? '（反爬验证页）' : ''}`);
    } catch (e) {
      results[name] = { ok: false, error: (e.cause && e.cause.code) || e.message };
      warn(`${name.padEnd(16)} ${(e.cause && e.cause.code) || e.message}`);
    }
  }));
  const usable = Object.values(results).filter((r) => r.ok).length;
  console.log('');
  if (usable === 0) {
    bad('当前无可用数据源。检索阶段将无法联网，可改用「导入已有文献」路径继续。');
  } else {
    ok(`${usable}/${SOURCES.length} 个源可用；检索时请统一使用 --fallback 自动切换`);
  }
  info('源可用性会分钟级反转，脚本已实现自动故障切换，无需手工挑源。');
  state.sources = results;
  return usable > 0;
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
console.log(`${C.b}
  ╔══════════════════════════════════════════════════════════╗
  ║   OpenNFSC · 国家自然科学基金申请书撰写技能包            ║
  ║   环境配置向导                          powered by gary ║
  ╚══════════════════════════════════════════════════════════╝${C.x}`);

const nodeOk = checkNode();
if (!nodeOk) {
  bad('Node.js 不满足要求，后续步骤无法进行。');
  process.exit(1);
}

await setupTex();
checkFonts();
await checkSources();

writeFileSync(CONFIG, JSON.stringify(state, null, 2), 'utf8');

head('配置完成');
console.log(`  配置文件：${CONFIG}`);
console.log('');
console.log(`  ${C.b}下一步${C.x}`);
console.log(`    node bin/doctor.mjs          # 自检，确认一切就绪`);
console.log(`    node bin/cli.mjs help        # 查看检索/校验工具用法`);
console.log('');
if (!state.tex?.ok) {
  console.log(`  ${C.y}注意${C.x} TeX Live 未就绪：仍可完成检索、写作、校验，`);
  console.log(`       并输出 Markdown / HTML / DOCX；PDF 出稿需先装 TeX Live。`);
  console.log('');
}
console.log(`  ${C.d}powered by gary${C.x}`);
