# 阶段 3 — 筛选、核验与打标

> **目标**：从文献库筛出真正有用的文献，核验元数据真实性，并写入分析标注。
> **前置**：阶段 2 通过
> **产出**：`work/screening.json`、`work/library.json`（加标注）
> **需要网络**：否（核验可选联网）

---

## 三个动作

1. **纳入/排除** —— 决定哪些文献进入精读
2. **核验** —— 确认元数据没有错误
3. **打标** —— 把 agent 的判断写回库中，供后续追溯

**关键纪律**：所有判断必须写回 `library.json`，不能只留在对话里。

---

## 步骤

### 1. 粗筛

**纳入标准**（满足其一）：
- 标题或摘要显示该工作直接研究本项目主题或其子方向
- 综述/survey 类工作（建立领域地图）
- 该方向的奠基性或高引用工作
- 国内代表性团队的相关工作

**排除标准**（满足其一即排除，**必须记录理由**）：
- 主题不相关（跨领域误检）
- 非同行评议且无预印本价值
- 重复记录未合并
- 无法获取任何内容

```bash
node bin/cli.mjs note --lib work/library.json --id <id> --exclude true --reason "主题不相关：属医学影像分割"
```

`notes` 字段约定：

| 字段 | 取值 | 含义 |
|---|---|---|
| `mainline` | 主线名称 | 归属哪条研究主线 |
| `gap` | 自由文本 | 该文献暴露的不足 |
| `relevance` | high/medium/low | 与本项目主题的相关度 |
| `role` | foundation/review/baseline/method/evidence | 在论证中的角色 |

```bash
node bin/cli.mjs note --lib work/library.json --id <id> \
  --set "mainline=主线2;gap=指出跨模态对齐缺失评估;relevance=high;role=baseline"
```

### 2. 判定"结构性不足"候选（最重要）

对每条纳入文献，读取摘要（必要时读全文），判断属于哪类：

| 类别 | 判断依据 | 用途 |
|---|---|---|
| **暴露假设** | 出现 "we assume"、"under the assumption" | 指出"该假设在何种条件下不成立" |
| **自陈局限** | "limitation"、"fails to"、"does not generalize" | 直接可用的不足证据 |
| **机理缺失** | 只报告现象/指标，未解释机制 | 指出"只知道是什么，不知道为什么" |
| **界限缺失** | 无理论刻画、无上下界 | 指出"缺乏可证明的边界" |
| **规模/条件受限** | "at scale"、"compute budget" | 指出适用条件 |

工具提供启发式筛查（**仅用于定位候选，不替代阅读**）：

```bash
node bin/cli.mjs gaps --lib work/library.json
```

> **必须做的事**：对 `gaps` 命中的每条文献**实际阅读摘要**再决定是否采信。工具只按关键词匹配，不懂语义。

### 3. 核验元数据

#### 核验分三级，不得混同

**本步骤最容易被执行得过宽**：批量导入一个现成语料库后直接把所有记录标为已核验。这不等于核验。

| 级别 | 取值 | 含义 |
|---|---|---|
| **逐条核验** | `true` | 已将元数据与**原文**逐字段比对 |
| **批量导入** | `"bulk"` | 元数据来自权威结构化来源，但**未逐条比对原文** |
| **未核验** | `false` | 默认值 |

**只有 `true` 计入核验率分子。**

核验清单：
- [ ] 标题与原文一致
- [ ] 作者列表完整且顺序正确
- [ ] 年份正确
- [ ] 会议/期刊名称正确（预印本是否已正式发表？）
- [ ] **卷、期、页码齐全**（GB/T 7714-2015 必需）
- [ ] DOI / arXiv ID 可解析

```bash
# 逐条核验通过
node bin/cli.mjs note --lib work/library.json --id <id> --verified true
# 批量导入（未逐条比对）
node bin/cli.mjs note --lib work/library.json --id <id> --set "verified=bulk"
```

### 4. 产出筛选结果

写入 `work/screening.json`：

```json
{
  "generatedAt": "<ISO8601>",
  "totalInLibrary": 120,
  "included": 42,
  "excluded": 78,
  "byMainline": { "主线1": ["<id>"], "主线2": ["<id>"] },
  "verifiedStrict": ["<id>"],
  "verifiedBulk": ["<id>"],
  "unverified": ["<id>"],
  "verificationRate": 0.31,
  "verificationRateNote": "只计入 verifiedStrict",
  "digitMissing": ["<id>"],
  "digitMissingNote": "缺卷/期/页码，无法生成合规 GB/T 7714 条目",
  "notes": "排除的 78 条中，61 条跨领域误检，17 条重复"
}
```

**`digitMissing` 很关键**：这些记录写不出合规条目，必须在阶段 6 前补齐，否则引用校验必然失败。

---

## 完成判据

### 硬判据

- **H1**：`work/screening.json` 存在且合法
- **H2**：每条记录的纳入/排除决策已写回 `library.json`
- **H3**：所有排除都有 `excludeReason`
- **H4**：**逐条核验率 ≥ 0.8**（`verified === true` 占纳入记录比例；`"bulk"` 与 `false` 均不计入分子）
- **H4b**：卷/期/页码缺失记录已列入 `digitMissing`
- **H5**：纳入文献数 ≥ 20
- **H6**：每条纳入文献都有 `mainline` 标注

### 软判据

- **S1**：`role` 标注覆盖至少 4 类
- **S2**：至少 3 条文献标注了 `gap`
- **S3**：主线数量 3-4 条
- **S4**：纳入文献含国内代表性工作
- **S5**：`verifiedBulk` 与 `verifiedStrict` 已分开统计且注明口径

### 评级

- **优**：H1–H6 + S1–S5
- **良**：H1–H6 + S1–S3
- **中**：H1–H6
- **差**：任一 H 不满足

> **降级模式约束**：若因网络不可用而无法逐条核验（H4 只能靠批量导入满足），**最高评"中"**，且必须在 `screening.json` 中明确标注。不得以"来源权威"为由放宽。

---

## 陷阱

| 陷阱 | 后果 |
|---|---|
| **只按标题筛** | 漏掉标题不含关键词但内容关键的工作 |
| **核验走过场** | 参考文献出错，正中官方负面意见第六条 |
| **采信工具 `gaps` 输出** | 把关键词命中当"结构性不足"，论证建立在虚假证据上 |
| **不记录排除理由** | 后续无法复盘 |
| **把综述当证据** | survey 可能转述有误，关键论断应回到原始文献 |

---

## 下一步

进入 `pipeline/stages/04-extract.md`。

---

*OpenNFSC · powered by gary*
