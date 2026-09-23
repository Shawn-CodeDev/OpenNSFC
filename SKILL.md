---
name: OpenNFSC
description: 国家自然科学基金（及省部级科研项目）申请书全流程撰写技能包——从研究方向到可提交正文与 PDF 成稿。覆盖环境自动配置（TeX Live 安装）、多源文献检索与权威元数据核验、研究现状梳理、可证伪科学问题凝练、研究方案与验证方案设计、官方 2026 版模板对齐、LaTeX 编译出稿、模板合规与引用双向自动校验。当用户要求写国自然申报书、青年基金/面上项目申请书、科研项目申报书、开题报告，或提到"申请书""标书""本子""立项依据""研究基础""国自然"等需求时触发。内置官方模板合规校验器（逐字比对）与零依赖检索工具，通过 AGENTS.md 对任意 agent 框架开放。
---

# OpenNFSC — 国家自然科学基金申请书撰写技能包

> **powered by gary**
>
> 本文件是 **Claude Code 入口**。内容与 `AGENTS.md` 等价，仅多出自动发现所需的 frontmatter。
> 其他 agent 框架请读 `AGENTS.md`；两者内容应保持一致，如遇冲突以 `AGENTS.md` 为准。

---

## 三十秒上手

```bash
node bin/doctor.mjs        # 自检：确认技能包可用
node bin/setup.mjs         # 若自检提示缺环境，运行此命令自动配置
```

通过后直接开始：

```
读 OpenNFSC/AGENTS.md，按流程帮我写国自然青年基金申请书。
研究方向：<你的方向>
申报级别：青年科学基金项目（C类）
执行期限：2027-01 至 2029-12
```

---

## 立即开始

**第一步（必须）**：读取以下两个文件，然后才开始动手。

1. `pipeline/00_runbook.md` —— 流程编排真源：阶段划分、状态机、质量门控
2. `docs/NSFC2026要求.md` —— 官方要求与判据来源

---

## 这是什么

把「一个研究方向」变成「一份可提交的申请书正文与 PDF」：

```
环境配置 → 文献检索 → 现状梳理 → 科学问题凝练 → 研究方案设计
        → 正文撰写 → 官方模板对齐 → LaTeX 编译 → 自动校验 → PDF 成稿
```

**产出物**：`申请书正文.pdf` / `.tex` / `.md` + 技术路线图，且通过**官方模板逐字合规校验**与**引用双向一致校验**。

---

## 索引

| 你需要 | 读这个 |
|---|---|
| 整体编排 | `pipeline/00_runbook.md` |
| 执行某阶段 | `pipeline/stages/00-scope.md` … `09-assemble.md` |
| 官方 2026 要求 | `docs/NSFC2026要求.md` |
| 评议要点与负面意见清单 | `docs/官方评判据.md` |
| 质量门控判据 | `docs/质量门控判据.md` |
| **已获批本逐项剖析（写作对照）** | `docs/获批本解剖.md` |
| 检索/校验/格式化命令 | `bin/USAGE.md` |
| **已获批本实测剖析（写作对照）** | `docs/获批本解剖.md` |
| 端到端实测样例（产出形状参照） | `examples/test-run/README.md` |
| agent 无关约定 | `AGENTS.md` |
| 人读说明 | `README.md` |

---

## 阶段清单

```
阶段 0　环境与定位　　　　pipeline/stages/00-scope.md      ← 不可跳过
阶段 1　检索计划　　　　　pipeline/stages/01-search.md
阶段 2　多源检索与入库　　pipeline/stages/02-collect.md    ← 唯一需要网络的阶段
阶段 3　筛选、核验与打标　pipeline/stages/03-screen.md
阶段 4　精读与证据提取　　pipeline/stages/04-extract.md
阶段 5　缺口综合　　　　　pipeline/stages/05-synthesize.md ← 产出交接物 GAP-MAP.md
阶段 6　（一）立项依据　　pipeline/stages/06-part1.md
阶段 7　（二）研究内容　　pipeline/stages/07-part2.md
阶段 8　（三）（四）补充　pipeline/stages/08-part3.md
阶段 9　出稿与终检　　　　pipeline/stages/09-assemble.md  ← 出 PDF + 双校验
```

---

## 工具（零依赖 Node.js）

```bash
node bin/doctor.mjs                                   # 自检
node bin/setup.mjs                                    # 环境配置
node bin/cli.mjs self-test                            # 工具离线自检
node bin/cli.mjs plan    --topic "..." --english "..." --out work/plan.json
node bin/cli.mjs search  --fallback --query "..." --out work/library.json
node bin/cli.mjs arxiv-fetch --ids 2303.01469 --out work/library.json --pdfDir work/pdfs
node bin/cli.mjs stats   --lib work/library.json
node bin/cli.mjs format  --lib work/library.json --style gbt7714 --out refs.md
node bin/cli.mjs validate --manuscript work/正文.md --lib work/library.json --strict
node bin/md2tex.mjs work/正文.md work/正文.tex --track youth|general
node bin/compile-tex.ps1                              # 编译 + PDF 内容自检
node bin/check-template.mjs work/正文.md --track youth|general
node bin/check-consistency.mjs work/正文.md --strict   # 术语/图号/错字/大词/占位符
node bin/pdf-probe.mjs work/正文.pdf --expect-figure  # 确认图真的嵌进去了
```

仅需 Node.js ≥ 18（使用内置 fetch/zlib/crypto），**无需 npm install**。PDF 出稿另需 TeX Live（`setup.mjs` 可自动安装）。

### 两套模板：青年C类 vs 面上项目

2026 年基金委对两类**分别发布**了提纲与正文模板，用 `--track` 选择（默认 `youth`）：

| | `youth`（青年C类） | `general`（面上项目） |
|---|---|---|
| 实质差异（4 处） | 基准 | （三）3、（四）2/3/4 含**"主要参与者"** |
| 资助期限 | 3 年 | **4 年** |
| 经费 | 包干制，无需编预算 | **须编制预算表** |
| 合作研究单位 | 无明文上限 | **不超过 2 个** |
| 个人简历 | 仅申请人 | 申请人 + **主要参与者** |

LaTeX 排版完全相同。**提纲原文唯一真源是 `bin/track-params.mjs`**，模板与校验器都从它取参数。

### 四个容易踩的坑

1. **编译成功 ≠ 图进去了。** `\IfFileExists` 走占位分支、图片路径写错等情况，`xelatex` 退出码 0、日志无错误、PDF 照常生成——完全静默。`compile-tex.ps1` 已内置 PDF 内容流解析自检。
2. **术语混用/图号冲突/同音错字躲过所有其他校验。** 实测一份**已获批**申请书里「半监督」18 处与「弱监督」2 处混用、正文引「图3」而图注写「图 1」、「微妙级」误作「微秒级」。人眼通读漏检率极高，必须跑 `check-consistency.mjs`。
3. **大词要区分自我宣称与陈述他人。** 获批本「首次/国际领先/填补空白/有望/旨在」全部 0 次——不用这些词完全能中；但陈述被引文献贡献时说"首次"是正常的。
4. **技术路线图用纯 TikZ 更省事。** 把 `pipeline/templates/technical-roadmap.tikz` 复制到 `.tex` 同目录并改名 `图1-技术路线图.tikz`，正文照常写 `![图1 技术路线图](图1-技术路线图.png)` 即自动优先嵌入——矢量、免 drawio/Visio、单文件可复现。

**实测样例**：`examples/test-run/` 是一次完整跑通的原始产物（26 页 PDF、18 条核验文献），可作参照物（**不可直接提交**）。**写作对照**：`docs/获批本解剖.md`（含青年+面上两份获批本的逐项实测）。

---

## 官方模板的硬性约束

依据基金委《报告正文（2026 版）· 青年科学基金项目（C 类）》：

| 约束 | 说明 |
|---|---|
| **正文四部分** | （一）立项依据 /（二）研究内容 /（三）研究基础 /（四）其他需要说明的情况 |
| **不得删改提纲标题** | 模板原文明令"请勿删除或改动下述提纲标题及括号中的文字" |
| **（二）必须含** | 特色与创新点（1.1 研究特色 / 1.2 本项目的创新之处）、年度研究计划 |
| **（四）共 6 项** | 第 5 项为**生成式人工智能使用披露**，独立必填 |
| **（三）2 必含** | "尚缺少的实验条件和拟解决的途径" |
| **篇幅 ≤ 30 页** | 含图表 |

---

## 执行契约

**必须**：读 runbook → 跑 doctor → 状态落盘 → 逐项核对硬判据 → 出稿前跑双校验。

**禁止**：编造文献/数据/成果/条件 → 代填申请人个人信息 → 跳过模板校验 → AI 使用披露含糊。

---

## 边界

**本技能包不能替你产出科学洞察。** 它保证结构合规、论证链完整、引用可溯源、格式正确；**不能**把一个平庸的科学问题变好。

**研究基础与预研数据不可代写**——这是自由探索类项目竞争力的核心。

**生成式 AI 使用需如实披露**（官方必填项，披露不实属科研诚信问题）。

---

*OpenNFSC · powered by gary*
