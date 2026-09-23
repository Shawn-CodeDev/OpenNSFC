# OpenNFSC

### AI-assisted National Natural Science Foundation of China proposal workflow

**国家自然科学基金申请书撰写技能包** · *powered by gary*

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Agent Skill](https://img.shields.io/badge/Agent%20Skill-ready-6f42c1)](SKILL.md)
[![GitHub stars](https://img.shields.io/github/stars/Shawn-CodeDev/OpenNSFC?style=social)](https://github.com/Shawn-CodeDev/OpenNSFC/stargazers)
[![Status](https://img.shields.io/badge/status-active-2ea44f)](https://github.com/Shawn-CodeDev/OpenNSFC)

> 把一个研究方向，推进成一份结构完整、引用可追溯、模板可校验、能够继续修改的申请书正文与 PDF。

OpenNFSC 把文献检索、科学问题凝练、研究方案设计、正文撰写、LaTeX 编译和质量检查串成一条可复核的 Agent 工作流。它不是“代写一篇材料”的提示词，而是一套有入口、有过程记录、有质量门禁的申请书生产工具。

## 你将得到什么

```text
研究方向
   │
   ▼
文献与现状 ──► 科学问题 ──► 研究方案 ──► 申请书正文 ──► 校验通过的 PDF
```

| 输入 | 过程 | 交付物 |
| --- | --- | --- |
| 研究方向、申请类型、个人材料、已有文献 | 检索、去重、现状梳理、方案设计、模板对齐、质量检查 | `.md` 正文、`.tex` 源码、PDF、技术路线图、过程记录 |

核心原则很简单：**不编造研究基础，不隐藏不确定性，不把“编译成功”当成“申请书完成”。**

## 30 秒开始

### 1. 获取项目

```bash
git clone https://github.com/Shawn-CodeDev/OpenNSFC.git
cd OpenNSFC
```

### 2. 检查环境

```bash
node bin/setup.mjs --check   # 只检查，不安装
node bin/doctor.mjs          # 运行技能包自检
```

如果自检报告缺少依赖，再运行：

```bash
node bin/setup.mjs
```

### 3. 交给 Agent

把项目目录交给支持 Agent Skills 的编码助手，或直接发送：

```text
读 OpenNFSC/AGENTS.md，按流程帮我写国自然青年科学基金项目（C类）申请书。
研究方向：<你的研究方向>
申报级别：青年科学基金项目（C类）
执行期限：2027-01 至 2029-12
```

建议先阅读 [`AGENTS.md`](AGENTS.md) 和 [`pipeline/00_runbook.md`](pipeline/00_runbook.md)，它们分别是 Agent 执行契约和全流程主线。

## 能力地图

| 能力 | 入口 | 解决的问题 |
| --- | --- | --- |
| Agent 工作契约 | [`AGENTS.md`](AGENTS.md) | 先做什么、禁止做什么、什么条件才算完成 |
| 技能触发入口 | [`SKILL.md`](SKILL.md) | 让支持 Skills 的 Agent 识别本项目与适用场景 |
| 总流程编排 | [`pipeline/00_runbook.md`](pipeline/00_runbook.md) | 从研究方向到成稿的阶段顺序与门禁 |
| 命令行工具 | [`bin/USAGE.md`](bin/USAGE.md) | 检索、去重、引用、模板、排版和 PDF 检查 |
| 官方模板与提纲 | [`templates/`](templates/) | 青年科学基金项目与面上项目的校验基准 |
| 可复现实例 | [`examples/test-run/`](examples/test-run/) | 查看一次完整运行的产物形状和目录组织 |

## 一条可审计的工作流

```text
阶段 0  环境与项目初始化
   ↓
阶段 1  检索计划、文献采集与去重
   ↓
阶段 2  研究现状、科学问题与研究目标
   ↓
阶段 3  研究内容、技术路线与可行性
   ↓
阶段 4  正文生成、模板对齐与 LaTeX 编译
   ↓
阶段 5  引用 / 一致性 / PDF 内容 / 页数检查
   ↓
交付    正文 + 源码 + 图表 + 过程记录
```

每个阶段都应将结果写入 `runs/<项目名>/work/` 或 `runs/<项目名>/deliverables/`，而不是只留在对话上下文中。

## 核心工具

### 文献检索与引用

```bash
# 生成确定性检索计划
node bin/cli.mjs plan \
  --topic "研究主题" \
  --english "english term" \
  --subtopics "子方向1,子方向2" \
  --venues "NeurIPS,ICLR,CVPR" \
  --out runs/<项目>/work/plan.json

# 多源检索，源不可用时自动切换
node bin/cli.mjs search --fallback \
  --query "检索式" --limit 30 \
  --out runs/<项目>/work/library.json

# 引用双向校验
node bin/cli.mjs validate \
  --manuscript runs/<项目>/deliverables/申请书正文.md \
  --lib runs/<项目>/work/library.json \
  --min-citations 15 --strict
```

`validate` 退出码为 `0` 表示通过，`2` 表示发现阻断性问题；会检查正文引用缺失、编号跳号、挂空文献、重复 DOI 和无引用文档，并兼容中文写作常用的全角方括号 `［1］`。

### 模板合规与正文生成

```bash
# 官方提纲逐字校验
node bin/check-template.mjs \
  runs/<项目>/deliverables/申请书正文.md \
  --track youth

# Markdown → LaTeX；输出文件可省略，默认生成同名 .tex
node bin/md2tex.mjs \
  runs/<项目>/deliverables/申请书正文.md \
  runs/<项目>/deliverables/申请书正文.tex \
  --track youth

# 一致性检查
node bin/check-consistency.mjs \
  runs/<项目>/deliverables/申请书正文.md --strict
```

支持两种申报轨道：`youth`（青年科学基金项目 C 类）和 `general`（面上项目）。正文层面的模板差异由 [`bin/track-params.mjs`](bin/track-params.mjs) 统一维护，避免模板与校验器各自维护一份规则。

### PDF 内容检查

“XeLaTeX 返回 0”不代表图片真的嵌入了 PDF。路径错误或占位分支可能让编译静默成功，因此出稿后还要检查 PDF 内容流：

```bash
node bin/pdf-probe.mjs \
  runs/<项目>/deliverables/申请书正文.pdf --expect-figure
```

检查器会报告绘图算子、文本绘制和嵌入字体等信息，帮助发现“能打开但内容不完整”的成稿。

## 青年 C 类与面上项目

| | 青年科学基金项目（C 类） | 面上项目 |
| --- | --- | --- |
| 资助期限 | 3 年 | **4 年** |
| 经费 | 包干制，无需编制预算 | **须编制预算表** |
| 合作研究单位 | 无明文上限 | **不超过 2 个** |
| 个人简历 | 仅申请人 | 申请人 + **主要参与者** |
| 评价重点 | 申请人本人的创新潜力 | 自主选题与创新性科学研究 |

正式提交前，请始终以 ISIS 系统下载的当年官方模板为准，再用本项目的检查器进行复核。

## 质量门禁

| 检查项 | 主要工具 | 关注点 |
| --- | --- | --- |
| 环境与依赖 | `setup.mjs` / `doctor.mjs` | Node、TeX、字体和网络可用性 |
| 文献质量 | `cli.mjs stats` / `validate` | 元数据、引用双向一致性、重复与挂空条目 |
| 模板合规 | `check-template.mjs` | 提纲标题、括号文字、四部分顺序和篇幅 |
| 语言与结构 | `check-consistency.mjs` | 术语混用、图号冲突、错字、占位符和夸大表述 |
| PDF 产物 | `pdf-probe.mjs` | 图片是否嵌入、文本绘制、字体和内容流 |

## 项目结构

```text
OpenNFSC/
├── AGENTS.md                  # Agent 执行契约
├── SKILL.md                   # Skills 入口
├── README.md                  # 项目说明
├── bin/                       # 零运行时依赖的 Node.js 工具
│   ├── cli.mjs                # 检索、导入、去重、校验、格式化
│   ├── doctor.mjs             # 环境与项目自检
│   ├── setup.mjs              # 环境检查与配置
│   ├── md2tex.mjs             # Markdown → LaTeX
│   ├── check-template.mjs     # 官方模板校验
│   ├── check-consistency.mjs  # 术语、图号和占位符校验
│   ├── pdf-probe.mjs          # PDF 内容自检
│   └── USAGE.md               # CLI 完整用法
├── pipeline/                  # 分阶段流程手册与产出模板
├── templates/                 # 官方模板、提纲与校验基准
├── docs/                      # 官方要求、评判据和质量门控
├── overrides/                 # 申请人自定义信息（可选）
├── runs/                      # 每个项目的工作区与交付物
└── examples/test-run/         # 完整端到端示例
```

## 环境要求

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| **Node.js** | ≥ 18 | 使用内置 `fetch`，必需 |
| **TeX Live** | 含 `ctex` / `xeCJK` | 生成 PDF 时需要；`setup.mjs` 可辅助配置 |
| **中文字体** | 宋体 / 黑体 | 缺失时自动回退 Fandol |
| **网络** | 检索阶段需要 | 也可以导入已有 RIS / BibTeX 文献库 |
| **PowerShell** | Windows 编译脚本需要 | macOS / Linux 可手动运行 XeLaTeX |

## 常见问题

<details>
<summary><strong>TeX Live 安装失败怎么办？</strong></summary>

先运行 `node bin/setup.mjs --check` 查看缺失项。检索、写作、引用校验和 Markdown 出稿不依赖最终 PDF 编译；可以先完成前置阶段，再单独处理 TeX 环境。
</details>

<details>
<summary><strong>所有文献源都不可用怎么办？</strong></summary>

可以稍后重试，或使用 `node bin/cli.mjs import --ris refs.ris --bib refs.bib` 导入已有文献。导入后先运行 `stats` 检查 DOI、页码和元数据完整度，不要为了填满参考文献列表而编造条目。
</details>

<details>
<summary><strong>可以写面上项目吗？</strong></summary>

可以。使用 `--track general`，并确认正文之外的期限、预算、合作单位和参与者要求。正式提交前仍需用当年官方模板复核。
</details>

<details>
<summary><strong>示例能直接提交吗？</strong></summary>

不能。`examples/test-run/` 只用于展示目录组织和产物形状；正式项目必须替换为申请人自己的研究基础、预研数据和可核验文献。
</details>

## 边界与科研诚信

1. **不编造**文献、数据、前期成果、设备条件和在研项目；缺失内容保留为待填槽位。
2. **不代填**研究基础、预研数据、团队成员和个人信息；这些内容必须由申请人提供并核验。
3. **如实披露**生成式 AI 的使用位置和内容，最终文本由申请人逐项确认。
4. **以当年官方模板为准**；本仓库内置模板仅用于流程演示与自动校验，不替代正式申报系统公告。

如果 OpenNFSC 帮你减少了重复劳动，欢迎点一个 Star；如果你发现模板变化、校验误报或新的研究场景，也欢迎提交 Issue。

---

*OpenNFSC · powered by gary*
