# 流程编排手册（Runbook）

> **本文件是流程的唯一真源。** agent 接到本技能包的任务时，第一步就是完整读取本文件。
> 各阶段操作细节在 `pipeline/stages/*.md`；本文件只负责编排、状态与门控。
>
> *OpenNFSC · powered by gary*

---

## 0. 执行者须知

你（执行本流程的 agent）必须遵守：

1. **状态落盘**：每完成一个阶段，更新 `runs/<项目名>/work/state.json`。不要依赖对话上下文记忆。
2. **不跳阶段**：阶段门未通过不得进入下一阶段。若用户明确要求跳过，在 `state.json.gates` 记录 `skipped: true` 与风险。
3. **不编造**：文献、数据、前期成果、设备条件、在研项目一律不得编造。缺什么就写 `〔待补：X，需用户提供〕`。
4. **网络调用集中在 `bin/cli.mjs`**：不要用其他方式发起检索（除非用户同意降级）。
5. **每阶段先读手册再动手**：`pipeline/stages/<阶段号>-<名称>.md` 必须完整读取。
6. **知识判断先查库**：`docs/` 下的三份文件是判据来源。不要凭记忆写国自然要求。
7. **出稿必过双校验**：官方模板逐字合规 + 引用双向一致。

---

## 1. 工作目录约定

首次运行时创建：

```bash
mkdir -p runs/<项目名>/{work,work/notes,deliverables,figures}
```

```
runs/<项目名>/
├── work/
│   ├── state.json          ← 流程状态（唯一真源）
│   ├── plan.json           ← 阶段 1 检索计划
│   ├── library.json        ← 阶段 2~3 文献库（累积）
│   ├── screening.json      ← 阶段 3 筛选结果
│   ├── notes/              ← 阶段 4 精读笔记
│   ├── meta/               ← 元数据开采记录
│   ├── pdfs/               ← 已下载的论文 PDF
│   └── GAP-MAP.md          ← 阶段 5 交付物：缺口地图
├── deliverables/
│   ├── 申请书正文.md
│   ├── 申请书正文.tex
│   ├── 申请书正文.pdf      ← 最终交付物
│   ├── 图1-技术路线图.tikz  ← 推荐：纯 TikZ（也可用 .drawio + 导出 PNG）
│   └── 调研报告.md
└── figures/
```

---

## 2. 状态文件 `runs/<项目名>/work/state.json`

首次创建时写入以下骨架（此后每阶段更新）：

```json
{
  "version": "1.0",
  "poweredBy": "gary",
  "createdAt": "<ISO8601>",
  "updatedAt": "<ISO8601>",
  "topic": "<研究主题>",
  "projectTitle": "<拟定题目>",
  "researchAttribute": { "type": null, "rationaleDraft": "", "confirmed": false },
  "scope": { "objective": "", "targetLevel": "", "duration": "", "applyCode": "", "deliverable": "" },
  "pageBudget": { "total": 30, "part1": 9, "part2": 17, "part3": 3, "references": 1 },
  "currentStage": 0,
  "stages": {
    "0": { "status": "not_started", "gate": "not_checked", "grade": null, "artifact": null }
  },
  "sourceStatus": {},
  "aiDisclosure": { "used": false, "sections": [], "statement": "" },
  "degraded": false,
  "degradedReason": "",
  "degradedReach": { "canReachWritingCluster": null, "blockingReason": "", "action": "" }
}
```

**状态取值**：`not_started` | `in_progress` | `draft_done` | `revised` | `finalized`
**门控取值**：`not_checked` | `pass` | `fail` | `skipped`
**评级取值**：`优` | `良` | `中` | `差` | `null`

---

## 3. 阶段总览与依赖

```
阶段 0　环境与定位          ← 阻塞全部后续阶段（含 doctor 自检）
    ↓
阶段 1　检索计划            ← 确定性模板，无需网络
    ↓
阶段 2　多源检索与入库      ← 唯一需要网络的阶段
    ↓
阶段 3　筛选、核验与打标
    ↓
阶段 4　精读与证据提取
    ↓
阶段 5　缺口综合            ← 产出 GAP-MAP.md【交接物】
    ↓
阶段 6　（一）立项依据
    ↓
阶段 7　（二）研究内容      ← 含技术路线图与验证方案
    ↓
阶段 8　（三）研究基础 +（四）其他需要说明的情况   ← 可与 6/7 并行
    ↓
阶段 9　出稿与终检          ← 生成 LaTeX → PDF，跑双校验
```

**可并行**：阶段 8 与阶段 6/7 无依赖关系。
**必须串行**：0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 9。

---

## 4. 编排逻辑（每阶段执行循环）

```
1. 读取 pipeline/stages/<NN>-<名称>.md
2. 检查前置阶段的门控状态；未通过则回到前置阶段
3. 执行手册中的步骤，产出该阶段文件
4. 逐条核对手册末尾的「完成判据」
5. 写入 state.json：status / gate / grade / artifact
6. 若 gate = fail → 列出未达标项 → 修复 → 回到第 4 步
   （同一阶段连续 3 轮 fail → 停止并提示用户：可能是研究设计本身需要调整）
7. 若 gate = pass → 进入下一阶段
```

---

## 5. 门控评级标准

评级采用基金委官方对综合评价等级的定义（见 `docs/官方评判据.md`）：

| 等级 | 官方定义 |
|---|---|
| **优** | 创新性强，有重要科学研究价值或应用前景，总体研究方案合理可行 |
| **良** | 立意新颖，有较重要的科学研究价值或应用前景，总体研究方案较好 |
| **中** | 有一定的科学研究价值或应用前景，总体研究方案尚可，某些关键方面存在不足 |
| **差** | 某些关键方面有明显缺陷 |

映射规则：

- **优**：全部硬判据通过，软判据满足 ≥90%
- **良**：全部硬判据通过，软判据满足 ≥70%
- **中**：全部硬判据通过，软判据满足 <70%
- **差**：存在硬判据未通过

各阶段硬/软判据见对应 stage 文件末尾。

---

## 6. 阶段 0 的特殊地位

**阶段 0 决定后续全部论证策略，绝不可跳过。** 它包含两件事：

### 6.1 环境就绪

```bash
node bin/doctor.mjs
```

若报缺环境，运行 `node bin/setup.mjs`。**TeX Live 未就绪不阻塞前 8 个阶段**——检索、写作、校验、Markdown/HTML 出稿都不依赖它；只有阶段 9 的 PDF 出稿需要。若确实装不上，阶段 9 降级为输出 Markdown + HTML，并明确告知用户。

### 6.2 研究属性判定

国自然自 2024 年起把科学问题属性简化为**两类**，选择不同属性会导致立项依据的写法完全不同：

| 属性 | 官方定义 | 论证策略 |
|---|---|---|
| **自由探索类基础研究** | 选题源于好奇心或创新性学术灵感，**不以满足现阶段应用需求为目的**的原创性、前沿性基础研究 | 不论证应用需求；侧重原创性与前沿性；**对预实验基础要求更高** |
| **目标导向类基础研究** | 以**经济社会发展需要或国家需求**为牵引的基础研究 | 必须论证需求真实性与"科学问题—应用需求"通路；纯理论或离转化远的项目不予资助 |

判定法：

1. 该方向的问题是否源于**明确的外部需求或工程瓶颈**？是 → 倾向目标导向
2. 该方向的答案形态是否为"**某机制 / 某界限 / 某条件**"？是 → 倾向自由探索
3. 参考 `docs/NSFC2026要求.md` 的属性说明

判定后**必须让用户确认**，不可代用户决定。

---

## 7. 网络失败的处理策略

**源不可达是常态，不是异常。** 实测同一会话内可用性会分钟级反转。

```
对每条检索式：
  运行 node bin/cli.mjs search --fallback --query "..." --out work/library.json
  --fallback 会按优先级依次尝试 7 个源，并自动择优
  若全部失败 → 记录到 state.json.sourceStatus，标记该检索式为 unresolved
```

**禁止**：因某源失败而静默跳过检索式；**禁止**用记忆编造文献。

全部源不可用时提示用户三选一：

1. 稍后重试（网络抖动常见）
2. 由用户提供 RIS/BibTeX，执行 `node bin/cli.mjs import --ris refs.ris --out work/library.json`
3. 降级为纯人工模式（`state.json` 记 `degraded: true`）

**降级边界**：导入的文献库若缺 DOI/页码，将无法生成合规 GB/T 7714 条目，进而无法通过引用校验。选降级路径时**立即**检查 `stats` 输出的 `withDoi/total`，并填写 `state.json.degradedReach` 写明能否走到写作阶段。

---

## 8. 交接物：GAP-MAP.md

阶段 5 产出，是调研簇与写作簇之间的**唯一接口**：

```markdown
# 缺口地图

## 1. 研究属性
## 2. 研究主线划分（3-4 条，含演进脉络与能力边界）
## 3. 结构性不足（每条：已有工作的假设 → 该假设何时失效 → 因此未被覆盖的问题）
## 4. 候选科学问题（1-2 个，含限定条件 / 机理猜想 / 可观测推论 / 否定条件）
## 5. 证据索引（不足 → 文献映射）
## 6. 检索覆盖度自评（含如实报告的局限）
## 7. 待用户确认事项
```

写作簇的每个阶段都必须**引用 GAP-MAP 的条目编号**，保证可追溯。

---

## 9. 阶段 9：出稿与终检

先设好路径变量（**替换 `<项目名>` 为实际项目目录名**），后续命令即可直接照抄：

```bash
# Windows PowerShell —— 在技能包根目录执行
$RUN = "runs/<项目名>/deliverables"     # 交付目录
$TEX = "$RUN/申请书正文.tex"
$PDF = "$RUN/申请书正文.pdf"
$MD  = "$RUN/申请书正文.md"
$TRACK = "youth"                        # 或 "general"（面上项目）；**必须与申报类型一致**
```

```powershell
# 1. 官方模板逐字合规校验（必须通过）
node bin/check-template.mjs $MD --track $TRACK

# 2. 引用双向一致校验（必须退出码 0）
node bin/cli.mjs validate --manuscript $MD `
  --lib "runs/<项目名>/work/library.json" --min-citations 15 --strict

# 2b. 一致性校验：术语混用 / 图号冲突 / 错字 / 自我宣称大词 / 占位符残留
node bin/check-consistency.mjs $MD --strict

# 3. 技术路线图（推荐纯 TikZ，在出稿前放好）
#    模板复制到 .tex 同目录并改名即可；正文里照常写 ![...](图1-技术路线图.png)
Copy-Item pipeline/templates/technical-roadmap.tikz "$RUN/图1-技术路线图.tikz"

# 4. Markdown → LaTeX → PDF（编译脚本内置 PDF 内容自检）
node bin/md2tex.mjs $MD $TEX --track $TRACK
& 'bin/compile-tex.ps1' -TexPath $TEX

# 5. LaTeX 质量检查 + 独立复核图是否真的嵌入
node bin/check-tex.mjs $TEX
node bin/pdf-probe.mjs $PDF --expect-figure
```

> **`$TRACK` 必须与申报类型一致。** 青年C类用 `youth`，面上项目用 `general`。
> 两者的**实质差异只有 4 处**：（三）3 与（四）2/3/4 在面上项目下含"主要参与者"
> （另有 4 处标点差异，校验器已归一化）。用错会让校验器报出 4 处"未通过"，
> 或反过来**漏掉**本该发现的措辞问题。两类的其它差异（资助年限 3 年 vs 4 年、
> 预算制度、合作单位上限、简历范围）见 `AGENTS.md` 第 4 节。

> macOS / Linux 上把 `Copy-Item` 换成 `cp`、`& 'bin/compile-tex.ps1' -TexPath $TEX`
> 换成手动跑两遍 `xelatex -halt-on-error`，其余命令一致。

**任一步失败则回到对应阶段修复，不得跳过。**

### 为什么必须单独跑一致性校验

有三类缺陷**不会**被编译、模板校验或引用校验拦住，但评审一眼能看出来。
它们全部来自对一份**已获批**申请书的实测（见 `docs/获批本解剖.md` 第 8.4 节）：

| 缺陷 | 实测案例 | 为什么脚本才能发现 |
|---|---|---|
| **术语混用** | 「半监督」18 处 vs 「弱监督」2 处 | 两处分散在相隔数千字的位置，通读时注意力在内容上，不在用词一致性上 |
| **图号冲突** | 正文引「图3」，图注写「图 1」，且「图1」重复 | 要同时记住"引用过的编号"和"图注编号"两个集合才能发现 |
| **同音错字** | 「事件分辨率可达**微妙**级」（应为微秒） | 字形差异极小，且"微妙"本身是合法词，编辑器拼写检查不会报 |

`check-consistency.mjs` 同时检查占位符残留（`〔待补〕`/`TODO` 等）。
**这三类问题的共同点是：靠人眼通读的漏检率极高。** 不要指望"再读一遍"能发现。

### ⚠️ 出稿阶段最隐蔽的坑：编译"假成功"

有一类故障对编译链路**完全静默**——`xelatex` 退出码 `0`、日志含 `Output written`、
无 `^!` 错误、PDF 也照常生成，**但图根本没进去**。触发方式：图片路径写错、
`\IfFileExists` 走了占位分支、TikZ 片段引用了不存在的节点等。

因此阶段 9 必须确证以下四条，缺一不可：

| 判据 | 检查方式 |
|---|---|
| 本轮**新生成**了 PDF | `compile-tex.ps1` 每次使用全新构建目录，旧产物不可能被误判 |
| TeX 未中途出错 | `-halt-on-error` + 日志 `^!` 计数为 0 |
| 确实产出了页面 | 日志含 `Output written on ... (N pages)` |
| **图真的嵌进去了** | `node bin/pdf-probe.mjs <pdf> --expect-figure` |

最后一条是唯一能识破"假成功"的手段，因为退出码、日志、文件大小三者都看不出来。
`compile-tex.ps1` 已自动执行该检查并打印绘图算子数量；若正文含图而绘图算子为 0，
必须回去修图，**不得直接交付**。

> **为什么推荐 TikZ 而不是 drawio/PNG**：矢量输出打印不失真；不需要任何外部绘图软件；
> 整份稿件可由单一 `.tex` 源文件复现，便于版本管理；agent 能纯文本生成与修改。

---

## 10. 完成判据（全流程）

- [ ] `state.json` 中阶段 0–9 全部 `status = finalized` 或 `revised`
- [ ] `work/GAP-MAP.md` 存在，候选科学问题含**否定条件**
- [ ] `deliverables/申请书正文.md` 存在，四部分结构与官方提纲逐字一致
- [ ] `bin/check-template.mjs` 全部通过
- [ ] `bin/cli.mjs validate --strict` 退出码为 0
- [ ] `bin/check-consistency.mjs --strict` 退出码为 0（术语/图号/错字/占位符）
- [ ] `deliverables/申请书正文.pdf` 生成，页数 ≤ 30
- [ ] `node bin/pdf-probe.mjs <pdf> --expect-figure` 通过（**若正文含图，绘图算子必须 > 0**）
- [ ] `state.json.aiDisclosure` 已如实填写，且（四）第 5 项已写入正文
- [ ] 所有 `〔待补〕` 占位符已由用户补全或明确标注为待补

---

*OpenNFSC · powered by gary*
