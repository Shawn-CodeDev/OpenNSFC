# OpenNFSC · CLI 用法与数据源说明

> **powered by gary**
>
> 零依赖 CLI：仅需 Node.js ≥18（使用内置 `fetch` / `zlib` / `crypto`），**无需 npm install**。
> 位置：`bin/cli.mjs`（所有命令均以技能包根目录为工作目录执行）

---

## 0. 先做自检

```bash
node bin/doctor.mjs              # 全环境自检（推荐先跑）
node bin/cli.mjs self-test       # CLI 离线自检（38 项）
```

`self-test` 离线运行，验证解析、去重、校验、格式化等功能。**必须全部通过**才能继续。若失败说明工具链损坏，而非网络问题。

---

## 1. 命令总览

| 命令 | 作用 | 需要网络 |
|---|---|---|
| `plan` | 生成确定性检索计划（含自检） | 否 |
| `search` | 多源批量检索并入库（**建议加 `--fallback`**） | **是** |
| **`webget`** | **像浏览器一样访问网页 / 下载资源** | **是** |
| **`arxiv-fetch`** | **按 ID 走网页路径取元数据 + 下载 PDF** | **是** |
| `arxiv-by-id` | 按 arXiv ID 经 API 补元数据 | **是** |
| `sources` | 列出数据源与优先级 | 否 |
| `import` | 导入 RIS / BibTeX | 否 |
| `add` | 写入人工核验过的记录 | 否 |
| `note` | 给记录打分析标注 | 否 |
| `dedupe` | 去重合并 | 否 |
| `enrich` | 按 DOI 补齐正式元数据 | **是** |
| `stats` | 库统计与告警 | 否 |
| `validate` | 正文引用 ↔ 文献列表双向校验 | 否 |
| `format` | 输出 GB/T 7714 / BibTeX / JSON | 否 |
| `gaps` | 结构性不足候选筛查 | 否 |
| `self-test` | 离线自检（38 项，含回归用例） | 否 |

> pdf-probe.mjs、check-consistency.mjs、check-format.mjs 是**独立脚本**（不属于 `cli.mjs` 子命令），
> 分别见第 6 节与第 7 节。

查看帮助：`node bin/cli.mjs help`

---

## 2. 数据源

### 首选路径：像浏览器一样直接访问（实测最快最稳）

**先看实测对比——同一时刻、同一目标：**

| 路径 | 结果 |
|---|---|
| `export.arxiv.org/api/query`（API） | ✗ `UND_ERR_CONNECT_TIMEOUT`，11.5 s |
| `arxiv.org/abs/2303.01469`（网页） | ✓ HTTP 200，**268 ms**，标题/作者/学科/摘要全覆盖 |
| `arxiv.org/pdf/2303.01469`（PDF） | ✓ HTTP 200，**1.8 s**，31.5 MB，`%PDF-` 头 + `%%EOF` 尾，校验通过 |

**结论：API 端点慢且频繁断开，而网页与 PDF 端点又快又稳。**

因此提供浏览器式抓取命令：

```bash
# 抓任意网页（自动带浏览器头、跟随重定向、重试）
node bin/cli.mjs webget --url https://arxiv.org/abs/2303.01469 --head 3000

# 抽取页面内所有链接（可过滤）
node bin/cli.mjs webget --url https://arxiv.org/list/cs.LG/recent --links --filter /abs/ --limit 50

# 下载任意资源到文件（自动做 PDF 完整性校验）
node bin/cli.mjs webget --url https://arxiv.org/pdf/2303.01469 --out work/pdfs/2303.01469.pdf
```

**按 arXiv ID 取元数据 + 下载 PDF（推荐用于补已知文献）：**

```bash
node bin/cli.mjs arxiv-fetch --ids 2303.01469,2310.04378 \
  --out work/library.json --pdfDir work/pdfs
```

实测输出：
```
✓ PDF 已下载 2303.01469 (30.1 MB)
✓ PDF 已下载 2310.04378 (15.2 MB)
标题: Consistency Models
作者: Yang Song, Prafulla Dhariwal, Mark Chen, Ilya Sutskever
```

### 元数据源（批量检索用）

| 源 | 标识 | 优势 | 限制 |
|---|---|---|---|
| **Crossref** | `crossref` | 元数据权威；覆盖会议与期刊；无需 key | 无预印本；含大量非文献记录（已自动过滤） |
| **arXiv API** | `arxiv` | 批量检索；支持 HTTP/HTTPS 双栈与原生语法 | **API 端点不稳定，仅作批量检索用；单篇取用 `arxiv-fetch`** |
| **OpenReview** | `openreview` | CS 会议（ICLR/NeurIPS 等）官方数据 | 仅 `/notes/search` 可用 |
| **OpenAlex** | `openalex` | 引用数、开放获取链接 | **限流严格（429）** |
| **Semantic Scholar** | `s2` | 引用数、开放获取 PDF | 无 key 时限流严格 |
| **EuropePMC** | `europepmc` | 无需 key | **学科偏生物医学**，CS 命中率低，仅作兜底 |

查看当前注册表：`node bin/cli.mjs sources`

### ⚠️ 源可用性会分钟级反转——**必须用 `--fallback`**

实测记录（同一会话内）：

| 时刻 | arxiv https | arxiv http | crossref | openreview | openalex |
|---|---|---|---|---|---|
| T1 | ✗ 超时 | ✓ 200 | ✓ 200 | ✓ 200 | ✗ 429 |
| T2 | ✗ 超时 | ✓ 200 | ✓ 200 | ✗ 超时 | ✗ 429 |
| T3 | ✓ 200 | ✓ 200 | ✗ 超时 | ✓ 200 | ✗ 429 |

**结论：不要手工挑源。** 用 `--fallback` 让工具按优先级自动切换：

```bash
node bin/cli.mjs search --fallback --query "consistency model" --out work/library.json
```

`--fallback` 的行为：
1. 按 `crossref → arxiv → openreview → openalex → s2 → europepmc` 依次尝试
2. 每个源的结果先经**内容质量过滤**（剔除同行评审记录、决定信、空标题）
3. **择优**：保留有效条数最多的源，而非"先到先得"
4. 全部失败时列出每个源的真实状态，并提示改用 `import` 或稍后重试

加 `--all` 可让所有可用源都参与并合并结果（更慢但覆盖更全）。

### 无效源（已实测，不要使用）

| 源 | 现象 |
|---|---|
| **DBLP** | 返回反爬验证页（**HTTP 200 但内容是 bot 检查页**——典型的假成功） |
| ar5iv / HuggingFace / PapersWithCode / OpenAIRE / BASE | 连接超时 |
| CORE | 429 |
| Unpaywall | API 路径 404 |
| openreview PDF 直链 | 403 |
| S2 的 `DOI:10.48550/...` 查询 | 404（arXiv DOI 不被支持） |

> **假成功比失败更危险**：DBLP 的 HTTP 200 会被朴素实现当成成功。因此本工具对每个源做**内容有效性校验**（标题长度、类型、标题模式），而不只看状态码。

### Crossref 的内容质量过滤（必须了解）

Crossref 检索会返回大量**非文献记录**。实测查询 `consistency model diffusion`：

```
抓取 15 条 → 剔除 10 条 → 保留 5 条
被剔除的包括：
  · Review for "Molecule Generation with Consistency Diffusion"   (type=peer-review)
  · Decision letter for "Some Paper"                              (type=peer-review)
  · 3 条空标题记录
```

这些不是论文。`filterUsable()` 会剔除：
- 空标题或标题短于 8 字符
- `type` 属于 `peer-review` / `component` / `grant` / `dataset` / `journal-issue` 等非文献类型
- 标题以 `Review for` / `Decision letter for` / `Editorial` / `Erratum` / `Corrigendum` / `Retraction` 开头

**若不过滤**，这些记录会进入文献库并最终变成引用错误——正是官方负面意见第六条。

### arXiv 的双栈与原生语法

**双栈**：实测 `https://export.arxiv.org` 与 `http://export.arxiv.org` 的可用性会**相反**。`searchArxiv` 自动依次尝试两者，任一成功即返回。

**原生语法**：arXiv 的字段前缀在 `encodeURIComponent` 后会被破坏（空格变 `%20`，布尔表达式与短语匹配失效）。

> **实测后果（真实案例）**：查询 `consistency models song`（意图是找 Song et al. 的 *Consistency Models*）返回了 **8 篇音乐/歌词论文**——因为 "song" 被当作普通关键词而非作者名。
> **这与编造文献同样有害**：结果看起来是真实论文，但完全无关，且不会触发任何警告。

因此提供 `--raw-query`，**不做 URL 编码**，支持 arXiv 原生语法：

```bash
# 标题短语（引号内的空格会正确保留）
node bin/cli.mjs search --source arxiv --raw-query 'ti:"consistency models"' --limit 10 --out work/library.json

# 作者 + 标题组合
node bin/cli.mjs search --source arxiv --raw-query 'au:Yang_S AND ti:"consistency models"' --out work/library.json

# 分类限定
node bin/cli.mjs search --source arxiv --raw-query 'cat:cs.LG AND abs:"few-step"' --out work/library.json
```

含 `ti:` `au:` `abs:` `cat:` 等前缀、`AND`/`OR` 布尔算符或引号的检索式会被**自动识别**为原生语法，无需显式传 `--raw-query`。

### 按 ID 精确补文献（最可靠的补文献方式）

不依赖相关性排序，直接按 arXiv ID 取元数据：

```bash
node bin/cli.mjs arxiv-by-id --ids 2303.01469,2310.04378 --out work/library.json
```

> **⚠️ 绝不要凭记忆填 ID。** 实测：凭记忆写下的 `2303.04947` 自以为是某篇一致性模型工作，
> 实际返回的是 **InfoBatch: Lossless Training Speed Up by Unbiased Dynamic Data Pruning**——完全不相关。
> `arxiv-by-id` 如实返回了真相，这正是它存在的意义。
> **必须先检索确认标题，再按 ID 精确取回。**

### 提高配额友好度

Crossref 与 OpenAlex 建议带上邮箱：

```bash
node bin/cli.mjs search --fallback --query "..." --mailto you@example.org --out work/library.json
```

Semantic Scholar 建议配置环境变量：

```bash
# Linux / macOS
export S2_API_KEY=your_key
# Windows PowerShell
$env:S2_API_KEY="your_key"
```

## 3. 各命令详解

### plan — 生成检索计划

```bash
node bin/cli.mjs plan \
  --topic "多模态大模型安全评测" \
  --english "multimodal LLM safety,MLLM security" \
  --synonyms "vision-language model attack" \
  --subtopics "jailbreak,backdoor,alignment,benchmark" \
  --venues "NeurIPS,ICML,CVPR,ACL" \
  --years 2019-2026 \
  --out work/plan.json
```

**固定包含六类检索**（保证覆盖不因主观判断漂移）：

| 类别 | 生成规则 |
|---|---|
| 主题词直查 | `--topic` |
| 英文等价 | `--english` |
| 同义词扩展 | `--synonyms` |
| 子方向覆盖 | `--subtopics` |
| **综述检索** | `survey <term>`、`<term> review` |
| **不足证据** | `<term> limitation failure mode` |
| **评测基准** | `<term> benchmark evaluation`、`<term> baseline comparison` |
| **国内工作** | `<term> China` |
| venue 定向 | `--venues` |

### search — 多源检索并入库

```bash
node bin/cli.mjs search \
  --source crossref,arxiv \
  --query "multimodal large language model safety" \
  --limit 30 \
  --out work/library.json
```

| 参数 | 说明 |
|---|---|
| `--source` | 逗号分隔，按优先级尝试 |
| `--query` | 检索内容。**arXiv 支持字段前缀**：`all:` `ti:` `abs:`，布尔用 `AND` / `OR` / `ANDNOT` |
| `--limit` | 每源返回条数，建议 20-30 |
| `--out` | 库文件。**始终用同一个**，工具会累积并自动去重 |
| `--mailto` | 提高 Crossref / OpenAlex 配额友好度 |
| `--summary false` | 关闭 stderr 的结果摘要输出 |

**输出 JSON 字段**：

| 字段 | 含义 |
|---|---|
| `fetched` | 本次新增条数 |
| `libraryBefore` / `libraryAfter` | 入库前后总数 |
| `dedupedAway` | 被去重合并掉的条数 |
| `sources[]` | 各源状态：`ok` / `error` / `skipped`，含 `fetched` 或 `reason` |

> **arXiv 注意**：布尔表达式中的空格会被 URL 编码，可能影响解析。若一条布尔检索式返回 0 结果，改用纯关键词形式重试。

### import — 导入用户已有文献

```bash
node bin/cli.mjs import --ris refs.ris --bib refs.bib --out work/library.json
```

支持 RIS（Zotero / EndNote 导出）与 BibTeX。

### note — 打分析标注

```bash
# 排除某条
node bin/cli.mjs note --lib work/library.json --id <id> --exclude true --reason "主题不相关"

# 打标注
node bin/cli.mjs note --lib work/library.json --id <id> \
  --set "mainline=主线2;gap=指出跨模态对齐缺失评估;relevance=high;role=baseline"

# 标记已核验
node bin/cli.mjs note --lib work/library.json --id <id> --verified true
```

| 字段 | 取值 |
|---|---|
| `mainline` | 研究主线名称 |
| `gap` | 该文献暴露的不足 |
| `relevance` | high / medium / low |
| `role` | foundation / review / baseline / method / evidence |
| `verified` | true / false（**默认 false，实际核对后才置 true**） |
| `excluded` | true / false（须配 `--reason`） |

### enrich — 补齐正式元数据

```bash
node bin/cli.mjs enrich --lib work/library.json --mailto you@example.org
```

对含 DOI 但缺卷期页、或类型仍为 `preprint` 的记录，从 Crossref 拉取权威元数据，并把预印本升级为正式发表版本。**这是提高参考文献质量的关键一步。**

### stats — 统计与告警

```bash
node bin/cli.mjs stats --lib work/library.json
```

关注字段：

| 字段 | 含义 | 阈值 |
|---|---|---|
| `preprintRatio` | 预印本占比 | >0.15 触发告警 |
| `recent5yRatio` | 近 5 年占比 | 建议 ≥0.6 |
| `withDoi` / `total` | DOI 覆盖率 | 建议 ≥0.7 |
| `withAbstract` / `total` | 摘要覆盖率 | 建议 ≥0.5 |
| `byType`、`byYear`、`topVenues` | 分布 | 用于覆盖度自评 |

### validate — 双向引用校验

```bash
node bin/cli.mjs validate --manuscript work/report.md --lib work/library.json --strict
```

**退出码**：`0` 通过；`2` 发现阻断性问题。

| 检出项 | 说明 |
|---|---|
| `missingInList` | 正文引用了但文献列表中缺失 |
| `unusedInText` | 列表中列出但正文未引用（顺序编码制下应为空） |
| `numberingIssues` | 编号不连续、未从 1 开始 |
| `formatProblems` | 缺年份、期刊缺卷/页、会议缺页码或缺 `//`、含未核实占位符 |
| `duplicateDoi` | 重复 DOI |

**实现要点**：校验前会先剥离"参考文献"区段，否则列表里每条的 `[n]` 会被误判为正文引用。同时排除 `Figure 1`、`Table 2`、`式(3)` 等非引用方括号。

### format — 输出参考文献

```bash
# GB/T 7714-2015 顺序编码制
node bin/cli.mjs format --lib work/library.json --style gbt7714 --out work/refs.md

# BibTeX
node bin/cli.mjs format --lib work/library.json --style bibtex --out work/refs.bib

# 纯 JSON（供程序处理）
node bin/cli.mjs format --lib work/library.json --style json
```

**缺失字段会以 `〔缺:卷〕` 等形式标出**，便于人工补全。输出末尾会提示缺失条数。

### gaps — 结构性不足候选筛查

```bash
node bin/cli.mjs gaps --lib work/library.json
```

按关键词启发式筛查五类证据：`assumption`（暴露假设）、`limitation`（自陈局限）、`mechanism`（机理缺失）、`bound`（界限缺失）、`scale`（规模受限）。

> **重要**：这是**关键词匹配，不懂语义**。结果仅用于定位候选文献，**是否构成"结构性不足"必须阅读摘要后判断**。不得直接采信。

---

## 4. 库文件格式

```json
{
  "version": "1.0",
  "updatedAt": "<ISO8601>",
  "query": [{ "query": "...", "sources": ["crossref"], "at": "..." }],
  "records": [
    {
      "id": "doi:10.xxxx/yyyy",
      "sources": ["crossref", "arxiv"],
      "type": "conference",
      "title": "...",
      "abstract": "...",
      "authors": ["..."],
      "year": 2024,
      "venue": "...",
      "doi": "10.xxxx/yyyy",
      "url": "...",
      "volume": "", "issue": "", "pages": "",
      "citationCount": 42,
      "verified": false,
      "excluded": false,
      "excludeReason": "",
      "notes": { "mainline": "", "gap": "", "relevance": "", "role": "" }
    }
  ]
}
```

**去重判据优先级**：DOI 相同 > arXiv ID 相同 > 规范化标题相同（且年份相近）。

---

## 5. 降级方案（agent 无 shell 能力时）

| 正常做法 | 降级做法 |
|---|---|
| `cli.mjs search` | 用 agent 自带检索能力，手写记录到 `library.json` |
| `cli.mjs validate` | 按 `docs/质量门控判据.md` 终检清单人工核对 |
| `cli.mjs format` | 按 `docs/NSFC2026要求.md` 的 GB/T 7714-2015 模板手写 |

降级时在 `state.json` 记 `degraded: true` 与原因。

---

## 6. PDF 内容自检（`pdf-probe.mjs`）

### 它解决的不是"编译失败"，而是"编译**假成功**"

有一类故障，整条编译链路对它**完全静默**：

| 环节 | 表现 |
|---|---|
| `xelatex` 退出码 | `0` |
| 日志 | 含 `Output written on ... (N pages)`，无 `^!` 错误 |
| PDF 文件 | 正常生成，大小合理 |
| **实际内容** | **图根本没进去** |

触发方式很常见：图片路径写错、`\IfFileExists` 走了占位分支、TikZ 片段里引用了不存在的
节点、`.tikz` 被当成普通超链接处理等。**退出码、日志、文件大小三者全都看不出来。**

唯一可靠的判据是直接解析 PDF 内容流。

```bash
node bin/pdf-probe.mjs <正文.pdf>
node bin/pdf-probe.mjs <正文.pdf> --expect-figure   # 无矢量绘图则判失败
node bin/pdf-probe.mjs <正文.pdf> --json            # 机器可读
```

输出示例（真实的 26 页申请书）：

```
  页面          26
  内容流        65 个 / 1205896 字节
  绘图算子      9741  (矩形 0 / 描边 1601 / 直线 4977 / 曲线 1156 / 填充 2007)
  文本绘制      2483
  嵌入字体      14
  ✓ 通过
```

### 实现上的两个坑（改这个脚本时务必注意）

1. **页面数不能靠明文正则数。** XeTeX 输出 PDF 1.5+，页面树被压缩进**对象流（ObjStm）**，
   文件明文里 `/Page` 出现次数是 **0**。必须先把 ObjStm 解压再统计，
   并与页面树根的 `/Count` 交叉验证。
2. **`/Type/Page` 的写法是斜杠紧邻**，不是 `/Type /Page`。用 `/Type\s+/Page` 永远匹配不到。

### 与 `compile-tex.ps1` 的关系

`compile-tex.ps1` 在编译成功后**自动调用**本脚本：

- 文本绘制算子为 0 → 直接判失败（正文为空）
- 绘图算子为 0 且正文含图 → 明确告警（不判失败：并非所有申请书都必须含图）
- 正常 → 打印一行统计

`compile-tex.ps1` 自身另有三条硬判据，用于堵住"假成功"：

| 判据 | 挡住的情况 |
|---|---|
| 每次使用**全新**构建目录 | 上一轮残留 PDF 被误判为本轮成功 |
| `-halt-on-error` + 捕获 stdout | TeX 出错后仍返回 0 |
| 日志必须含 `Output written` 且 `^!` 计数为 0 | 中止但残留旧 PDF |

---

## 7. 一致性校验（`check-consistency.mjs`）

### 为什么需要它：三类缺陷躲过了所有其他检查

编译能过、模板校验能过、引用校验能过，但评审一眼就能看出来的问题。
以下案例**全部来自一份已获批申请书的实测**（见 `docs/获批本解剖.md` 第 8.4 节）：

| 缺陷 | 实测案例 | 为什么只有脚本能发现 |
|---|---|---|
| **术语混用** | 「半监督」18 处 vs 「弱监督」2 处 | 两处相隔数千字，通读时注意力在内容上，不在用词一致性上 |
| **图号冲突** | 正文引「图3」，图注写「图 1」，且「图1」重复 | 需同时记住"引用过的编号"与"图注编号"两个集合 |
| **同音错字** | 「事件分辨率可达**微妙**级」（应为微秒） | 字形差异极小，且"微妙"本身是合法词，拼写检查不报 |

```bash
node bin/check-consistency.mjs <正文.md>
node bin/check-consistency.mjs <正文.md> --strict    # 警告也视为失败
node bin/check-consistency.mjs <正文.md> --json      # 机器可读
```

检出项：

| 类别 | 判据 | 级别 |
|---|---|---|
| 术语混用 | 预置易混术语组内多种写法同时出现 | 少量写法为警告，均衡出现为提示 |
| 图号重复 | 同一编号出现多次图注 | 阻断 |
| 图号悬空 | 正文引用「如图N所示」但无对应图注 | 阻断 |
| 图号不连续 | 编号未从 1 连续递增 | 阻断 |
| 图未被引用 | 有图注但正文从未引用 | 警告 |
| 疑似错字 | 预置同音近形词表 | 阻断 |
| **自我宣称大词** | 「首次/国际领先/填补空白/率先/突破性」且为自我宣称 | 警告 |
| 疑似空洞表述 | 「有望/亟待/旨在」所在句缺少条件或数据 | 提示 |
| 占位符残留 | `〔待补〕`/`TODO`/`TBD` 等 | 警告 |

**图注识别**兼容独立成行、Markdown 强调（`*图1 …*`）、半角/全角空格分隔等写法，
并自动排除正文中的"如图1所示"这类行内引用，避免误判。

**大词识别**会区分**自我宣称**与**陈述他人**——「TRACE 识别边界**首次**出现的时刻［5］」
属于陈述他人，不报；「本项目**首次**实现…」才报。判据是**整句**范围：句内出现引用
标记或指向他人的主语即跳过。

> ⚠️ 不要用"大词前后 N 字符内有引用"这种**窗口判据**——中文长句里引用常在句尾，
> 实测距大词可达 100 字符，窗口判据会误报（已踩过这个坑）。

> **共性**：这些问题的漏检率因人眼通读而极高。**不要指望"再读一遍"能发现**——
> 必须跑脚本。

---

## 8. 两套模板与 `--track`

2026 年基金委对**面上项目**与**青年科学基金项目（C 类）分别发布**了提纲与正文模板
（2026-01-05 通知，四个独立附件）。本包据此提供两套模板。

```bash
node bin/md2tex.mjs         <正文.md> <输出.tex> --track youth|general
node bin/check-template.mjs <正文.md>            --track youth|general
node bin/gen-outlines.mjs                        # 重新生成两份提纲基准文件
```

| | `youth`（青年C类） | `general`（面上项目） |
|---|---|---|
| 提纲差异 | 基准 | （三）3、（四）2/3/4 含**"主要参与者"** |
| 资助期限 | 3 年 | **4 年** |
| 经费 | 包干制，**无需编制预算** | **须编制预算表** |
| 合作研究单位 | 无明文上限 | **不超过 2 个** |
| 个人简历 | 仅申请人 | 申请人 + **主要参与者** |

两套的 LaTeX 排版完全相同，差异只在封面、页眉与约束注释。

**提纲原文的唯一真源是 `bin/track-params.mjs`**（`TRACKS`）。`md2tex.mjs`、
`check-template.mjs`、`gen-outlines.mjs` 都从它取参数——这样就不会出现
"模板里写一套、校验器里写另一套"的漂移。历史上正是这种漂移导致
校验器基准被写死成青年C类，拿去校验面上项目会误报。

改动提纲原文时：**只改 `track-params.mjs`**，然后

```bash
node bin/gen-outlines.mjs            # 同步 templates/*.txt
node bin/cli.mjs self-test           # 跑回归
```

---

*OpenNFSC · powered by gary*
