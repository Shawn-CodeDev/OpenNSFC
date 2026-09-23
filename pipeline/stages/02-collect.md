# 阶段 2 — 多源检索与入库

> **目标**：执行检索计划，把结果累积进文献库。
> **前置**：阶段 1 通过
> **产出**：`work/library.json`、`state.json.sourceStatus`
> **需要网络**：**是**（本流程唯一依赖外部网络的阶段）

---

## 核心纪律

1. **每条检索式都必须执行并留痕**。源失败 → `--fallback` 自动换源 → 在 `sourceStatus` 记录。**禁止静默跳过。**
2. **禁止用记忆编造文献**。检索失败的检索式记为 `unresolved`，交用户补充。
3. **入库即去重**。`search` 每次调用自动去重合并。

---

## 步骤

### 1. 工具自检

```bash
node bin/cli.mjs self-test
```

必须全通过。失败说明工具链损坏，停止并报告。

### 2. 逐条执行检索（**必须加 `--fallback`**）

```bash
node bin/cli.mjs search --fallback \
  --query "<检索式>" \
  --limit 30 \
  --out runs/<项目名>/work/library.json
```

**为什么必须加 `--fallback`**：源可用性会**分钟级反转**。实测同一会话内观测到 arXiv 的 https/http 可用性相反、Crossref 间歇超时、OpenReview 时而可用、OpenAlex 持续 429、DBLP 被反爬拦截。手工挑源既低效又不可靠。

`--fallback` 的行为：
1. 按优先级依次尝试 7 个源
2. 每个源的结果先经**内容质量过滤**（剔除同行评审记录、决定信、空标题等非文献条目）
3. **择优**：保留有效条数最多的源，而非"先到先得"
4. 全部失败时列出每个源的真实状态

**输出字段解读**：

| 字段 | 含义 | 异常处理 |
|---|---|---|
| `fetched` | 本次新增条数 | 为 0 且全 ok → 检索式太窄，改写重试 |
| `sources[].status` | 各源状态 | `error` → 记录；全 error → 该式记 unresolved |
| `sources[].kept` / `dropped` | 质量过滤后保留/剔除数 | `kept` 为 0 说明该源结果全是非文献记录 |
| `libraryAfter` | 库中总条数 | 监控增长，停滞说明需换检索式 |

### 3. 处理源失败

记录到 `state.json.sourceStatus`：

```json
"sourceStatus": {
  "crossref": { "ok": 24, "error": 0, "lastError": null },
  "arxiv":    { "ok": 6,  "error": 3, "lastError": "UND_ERR_CONNECT_TIMEOUT" }
}
```

**全部源不可用**时提示用户三选一（见 Runbook §7），并**立即**填写 `state.json.degradedReach`。

### 4. 补已知文献：两条可靠路径

**路径 A：按 arXiv ID 走网页路径（最可靠）**

```bash
node bin/cli.mjs arxiv-fetch --ids 2303.01469,2310.04378 \
  --out runs/<项目名>/work/library.json --pdfDir runs/<项目名>/work/pdfs
```

> **绝不要凭记忆填 ID。** 实测：凭记忆写下的 `2303.04947` 自以为是某篇工作，实际返回的是完全无关的另一篇。**必须先检索确认标题，再按 ID 精确取回。**

**路径 B：从会议官方源取权威元数据（计算机学科首选）**

```bash
node bin/cli.mjs search --source openreview --query "<论文标题>" --out runs/<项目名>/work/library.json
```

OpenReview 提供会议官方 BibTeX（含完整作者、会议全称、年份、官方链接），权威性高于任何第三方 API。实测对 ICLR/CVPR 2026 oral 论文命中率 16/16、标题相似度全部为 1.00。

### 5. 导入用户已有文献（可选但推荐）

```bash
node bin/cli.mjs import --ris refs.ris --bib refs.bib --out runs/<项目名>/work/library.json
```

### 6. 补齐元数据

```bash
node bin/cli.mjs enrich --lib runs/<项目名>/work/library.json --mailto you@example.org
```

对含 DOI 但缺卷期页、或类型仍为 `preprint` 的记录补齐正式发表信息。

### 7. 统计与告警

```bash
node bin/cli.mjs stats --lib runs/<项目名>/work/library.json
```

| 告警 | 阈值 | 处理 |
|---|---|---|
| `preprintRatioWarning` | >0.15 | 用 `enrich` 升级或补正式版本 |
| `withDoi / total` | <0.7 | 元数据质量差，影响参考文献生成 |
| `withAbstract / total` | <0.5 | 无摘要 → 阶段 4 无法做证据提取 |
| `recent5yRatio` | <0.6 | 追加近年检索式 |

### 8. 覆盖度自评

按子方向统计条数，识别薄弱方向并追加检索。**目标**：每个子方向至少 5 条相关文献。

---

## 完成判据

### 硬判据

- **H1**：`work/library.json` 合法且 `records` 非空
- **H2**：`records.length ≥ 25`
- **H3**：`withAbstract / total ≥ 0.5`
- **H4**：`plan.json` 中的检索式**全部**有执行记录（成功入库或已记 unresolved）
- **H5**：每个研究子方向至少 3 条相关文献

### 软判据

- **S1**：`preprintRatio ≤ 0.15`
- **S2**：`recent5yRatio ≥ 0.6`
- **S3**：已执行 `enrich`
- **S4**：`withDoi / total ≥ 0.7`
- **S5**：已导入用户已有文献（若用户有）

### 评级

- **优**：H1–H5 + S1–S3
- **良**：H1–H5 + S1–S2
- **中**：H1–H5
- **差**：任一 H 不满足

---

## 陷阱

| 陷阱 | 后果 |
|---|---|
| **不加 `--fallback`** | 单一源失败就中断，白跑 |
| **把 HTTP 200 当作成功** | DBLP 等站点返回反爬验证页也是 200。工具已做内容校验，不要绕过 |
| **凭记忆填 arXiv ID** | 会引入完全不相关的文献 |
| **检索式自由文本化** | `consistency models song` 会返回音乐论文（"song" 被当普通词）。用 `--raw-query 'ti:"consistency models"'` |
| **不管 DOI 覆盖率就进写作阶段** | 阶段 6 的参考文献判据必然失败 |

---

## 下一步

进入 `pipeline/stages/03-screen.md`。

---

*OpenNFSC · powered by gary*
