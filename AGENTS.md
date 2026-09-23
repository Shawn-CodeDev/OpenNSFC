# OpenNFSC — 国家自然科学基金申请书撰写技能包

> **powered by gary**
>
> 本文件是 **agent 入口**。任何具备「读文件 + 写文件 + 执行 shell」能力的 agent，读完本文件即可开始工作，无需额外说明。

---

## 0. 三十秒上手

```bash
node bin/doctor.mjs        # 自检：确认技能包可用
node bin/setup.mjs         # 若自检提示缺环境，运行此命令自动配置
```

两项都通过后，**直接告诉 agent 你的研究方向即可**：

```
读 OpenNFSC/AGENTS.md，按流程帮我写国自然青年基金申请书。
研究方向：<你的方向>
申报级别：青年科学基金项目（C类）
执行期限：2027-01 至 2029-12
```

---

## 1. 这个包做什么

把「一个研究方向」变成「一份可提交的国家自然科学基金申请书正文」，覆盖全链条：

```
环境配置 → 文献检索 → 现状梳理 → 科学问题凝练 → 研究方案设计
        → 正文撰写 → 官方模板对齐 → LaTeX 编译 → 自动校验 → PDF 成稿
```

**产出物**：`申请书正文.pdf` + `.tex` + `.md` + 技术路线图，且通过模板合规校验与引用双向校验。

---

## 2. 目录结构

```
OpenNFSC/
├── AGENTS.md                  ← 本文件（agent 入口）
├── SKILL.md                   ← Claude Code 入口（含 frontmatter，内容等价）
├── README.md                  ← 人读说明
├── bin/                       ← 可执行工具（零依赖 Node.js）
│   ├── setup.mjs              环境配置（TeX Live 自动安装）
│   ├── doctor.mjs             自检
│   ├── cli.mjs                检索 / 去重 / 校验 / 格式化
│   ├── lib.mjs                工具库
│   ├── track-params.mjs       申报类型参数（两套提纲的唯一真源）
│   ├── tex-template.mjs       LaTeX 模板生成器（导言区/封面/渲染）
│   ├── md2tex.mjs             Markdown → LaTeX（--track youth|general）
│   ├── gen-outlines.mjs       生成两份提纲基准文件（txt）
│   ├── gen-outline-pdf.mjs    生成两份报告正文提纲 PDF
│   ├── compile-tex.ps1        XeLaTeX 编译 → PDF
│   ├── pdf-probe.mjs          PDF 内容自检（确认图真的嵌进去了）
│   ├── check-template.mjs     官方模板逐字合规校验（--track）
│   ├── check-tex.mjs          LaTeX 质量检查
│   ├── check-consistency.mjs  术语/图号/错字/大词/占位符校验
│   └── USAGE.md               CLI 完整用法
├── templates/                 ← 官方模板与提纲（两套，txt 供校验 / pdf 供人读）
│   ├── 报告正文-青年C类-2026.pdf          青年C类模板（含 LaTeX 使用说明）
│   ├── 报告正文-青年C类-2026-提纲.txt      青年C类提纲（**校验基准**）
│   ├── 报告正文-青年C类-2026-提纲.pdf      青年C类提纲 PDF（同 txt，便于核对）
│   ├── 报告正文-面上项目-2026-提纲.txt     面上项目提纲（**校验基准**）
│   ├── 报告正文-面上项目-2026-提纲.pdf     面上项目提纲 PDF
│   └── mynsfc-模板示例.pdf                LaTeX 模板示例
├── pipeline/                  ← 流程手册
│   ├── 00_runbook.md          总编排（**必读**）
│   ├── stages/                各阶段操作手册
│   └── templates/             产出物模板与 JSON Schema
│       └── technical-roadmap.tikz   技术路线图模板（纯 TikZ，免外部图片）
├── docs/                      ← 判据与知识库
│   ├── NSFC2026要求.md        官方要求原文摘录
│   ├── 官方评判据.md          评议要点与负面意见清单
│   ├── 质量门控判据.md        逐项验收标准
│   └── 获批本解剖.md          已获批申请书的逐项实测剖析（**写作时对照用**）
├── overrides/                 ← 可选：申请人覆盖文件（见第 7 节）
├── runs/                      ← 运行时产出（每个项目一个子目录）
└── examples/test-run/         ← 端到端实测样例（**不可直接提交**，仅作参照）
```

---

## 3. Agent 执行契约

### 必须先做

1. **读 `pipeline/00_runbook.md`** —— 它是流程的唯一真源，本文件只做索引。
2. **运行 `node bin/doctor.mjs`** —— 确认环境可用，不要假设。
3. **状态落盘** —— 每阶段产出写入 `runs/<项目名>/work/`，不要只留在对话里。
4. **逐项核对完成判据** —— 每个阶段手册末尾有硬判据，不得凭感觉判断"差不多了"。
5. **出稿前跑四项校验** —— 模板合规 + 引用双向 + 一致性 + PDF 内容，都必须通过。

### 禁止做

1. **禁止编造**：文献、数据、前期成果、设备条件、在研项目一律不得编造。缺什么就写成待填槽位。
2. **禁止代填申请人个人信息**：研究基础、在研项目、团队成员、算力条件只能由申请人提供。
3. **禁止跳过模板校验**：官方模板明令"请勿删除或改动提纲标题及括号中的文字"。
4. **禁止在 AI 使用披露上含糊**：这是官方必填项（（四）第 5 项），必须如实。

---

## 4. 工具速查

### 文献检索（含自动故障切换）

```bash
# 生成确定性检索计划（保证覆盖不漂移）
node bin/cli.mjs plan --topic "研究主题" --english "english term" \
  --subtopics "子方向1,子方向2" --venues "NeurIPS,ICLR,CVPR" --out runs/<项目>/work/plan.json

# 多源检索（--fallback 几乎总是要加：源可用性会分钟级反转）
node bin/cli.mjs search --fallback --query "检索式" --limit 30 --out runs/<项目>/work/library.json

# 单篇精确定位（最可靠的补文献方式）
node bin/cli.mjs arxiv-fetch --ids 2303.01469 --out runs/<项目>/work/library.json --pdfDir runs/<项目>/work/pdfs

# 权威元数据（会议官方 BibTeX，计算机学科首选）
node bin/cli.mjs search --source openreview --query "论文标题" --out runs/<项目>/work/library.json

# 浏览器式抓取网页 / 下载资源
node bin/cli.mjs webget --url https://example.com --out <文件>
```

### 参考文献与校验

```bash
node bin/cli.mjs stats    --lib runs/<项目>/work/library.json          # 统计与告警
node bin/cli.mjs format   --lib runs/<项目>/work/library.json --style gbt7714 --out refs.md
node bin/cli.mjs validate --manuscript runs/<项目>/deliverables/正文.md \
                          --lib runs/<项目>/work/library.json --min-citations 15 --strict
```

`validate` **退出码 0 = 通过，2 = 发现阻断性问题**（引用缺失、编号跳号、挂空文献、无引用文档）。

### 出稿

**两套模板**：2026 年国自然对**面上项目**与**青年科学基金项目（C 类）分别发布**了填报说明、
撰写提纲与正文模板，因此本包提供两套。用 `--track` 选择（默认 `youth`）：

```bash
node bin/md2tex.mjs  <正文.md> <输出.tex> --track youth     # 青年科学基金项目（C类）
node bin/md2tex.mjs  <正文.md> <输出.tex> --track general   # 面上项目
node bin/compile-tex.ps1                        # XeLaTeX 编译 → PDF（内置 PDF 内容自检）
node bin/check-template.mjs <正文.md> --track youth   # 官方模板合规校验（须与上面一致）
node bin/check-consistency.mjs <正文.md>        # 术语/图号/错字/大词/占位符
node bin/pdf-probe.mjs <正文.pdf> --expect-figure   # 单独确认图真的嵌进去了
```

**两类在正文层面的实质差异只有 4 处措辞**（（三）3、（四）2/3/4 在面上项目下含"主要参与者"），
另有 4 处标点差异（面上四个部分标题带全角冒号，青年不带——校验器已归一化，写不写都能过），
LaTeX 排版完全相同。真正的差别在**正文之外**，写错会被视为"不了解自己申报的类型"：

| | 青年C类 | 面上项目 |
|---|---|---|
| 资助期限 | **3 年** | **4 年** |
| 经费 | 包干制，**无需编制预算** | **须编制预算表** |
| 合作研究单位 | 无明文上限 | **不超过 2 个** |
| 个人简历 | 仅申请人 | 申请人 + **主要参与者** |
| 评价侧重 | **申请人本人的创新潜力** | 自主选题、创新性科学研究 |

> 提纲原文的唯一真源是 `bin/track-params.mjs`，两套模板与校验器都从它取参数，
> 避免多处副本漂移。`templates/报告正文-*-2026-提纲.txt` 由 `bin/gen-outlines.mjs` 生成。

> **编译成功不等于图进去了。** `\IfFileExists` 走了占位分支、图片路径写错等情况，
> `xelatex` 依然返回 0、日志无错误、PDF 也照常生成——完全静默。
> `compile-tex.ps1` 已内置 PDF 内容流解析来自检（绘图算子为 0 时会明确告警）。
>
> **技术路线图推荐用纯 TikZ**：把 `pipeline/templates/technical-roadmap.tikz` 复制到
> `.tex` 同目录并改名为 `图1-技术路线图.tikz`，正文里正常写 `![图1 技术路线图](图1-技术路线图.png)` 即可
> 自动优先嵌入——矢量输出、无需 drawio/Visio、单一源文件可复现。

---

## 5. 官方模板的硬性约束（**最容易踩的坑**）

依据基金委《报告正文（2026 版）》。**以下正文要求青年C类与面上项目完全一致**，
差异仅在（三）3 与（四）2/3/4 的"主要参与者"表述（见第 4 节）：

| 约束 | 说明 |
|---|---|
| **正文四部分** | （一）立项依据 /（二）研究内容 /（三）研究基础 /（四）其他需要说明的情况 |
| **不得删改提纲标题** | 模板原文明令"请勿删除或改动下述提纲标题及括号中的文字" |
| **（二）提纲不做限制** | 但**必须**含"特色与创新点"（1.1 研究特色 / 1.2 本项目的创新之处）与"年度研究计划" |
| **（四）共 6 项** | 第 5 项为**生成式人工智能使用披露**，独立必填；第 6 项为兜底"其他" |
| **（三）2 必含** | "尚缺少的实验条件和拟解决的途径" —— 不可只列已有条件 |
| **（三）4 附附件** | 须另附 500 字总结摘要 + 成果详细目录 |
| **篇幅 ≤ 30 页** | 含图表 |
| **不涉及可填"无"** | 官方模板明示："不涉及的内容可以填无" |

`bin/check-template.mjs --track <youth|general>` 会按对应类型的提纲逐字校验以上各项。

> **不要凭记忆写"（三）3 是申请人正在承担的项目"**——面上项目下这一条与（四）2/3/4
> 都含"主要参与者"。校验器会精确报出不一致处。提纲原文写在 `bin/track-params.mjs`。

---

## 6. 网络不可用时的降级路径

源不可达是常态（实测同一会话内可用性会分钟级反转）。三种降级方式，按优先级：

| 情况 | 处理 |
|---|---|
| 部分源不可用 | 用 `--fallback` 自动切换；已实测 7 个源，任一可用即可工作 |
| 全部源不可用、但用户有文献库 | `node bin/cli.mjs import --ris refs.ris --bib refs.bib` |
| 全部源不可用、用户也无文献 | 明确告知用户"检索阶段无法进行"，把已有的研究方向信息写入正文，**绝不编造文献** |

> **降级路径的适用边界**：导入的文献库若缺 DOI/页码，将无法生成合规的 GB/T 7714 条目，进而无法通过引用校验。选降级路径时**立即**检查 `stats` 输出中的 `withDoi/total`——低于 0.3 意味着只能支撑到"缺口识别"，写作阶段需另补书目。

---

## 7. 申请人覆盖文件（可选）

为避免每次运行都要重复提供个人信息，可在 `overrides/` 下放置：

| 文件 | 内容 |
|---|---|
| `applicant.yaml` | 申请人姓名、职称、单位、申请代码、执行期限 |
| `foundation.md` | 研究基础、前期成果、预研数据（**只能由申请人本人提供**） |
| `conditions.md` | 工作条件、算力资源、在研项目 |
| `template-overrides.md` | 若官方提纲与 `templates/` 中的版本有差异，在此说明 |

agent 在阶段 0 会优先读取这些文件；不存在则向用户逐项询问。

---

## 8. 边界声明（必须转达给用户）

1. **本技能包不能替你产出科学洞察。** 它保证结构合规、论证链完整、引用可溯源、格式正确；**不能**把一个平庸的科学问题变好。
2. **研究基础与预研数据不可代写。** 这是自由探索类项目竞争力的核心，也是官方评审明确考察的内容。
3. **生成式 AI 使用需如实披露。** 官方要求在（四）第 5 项详细说明使用位置和内容；披露不实属科研诚信问题。
4. **正式提交前须以 ISIS 系统下载的当年模板为准。** 本包内置的模板来自公开渠道，与基金委 2025-12-30 公开表述一致，但请用 `check-template.mjs` 对你自己下载的版本再校验一次。

---

*OpenNFSC · powered by gary*
