# 技术路线图模板（三格式）

> 本文件提供技术路线图的三种可编辑格式模板。把方括号内容替换为你的项目信息即可。
> 对应正文位置：**（二）研究内容 → 3.5.2 技术路线图**
>
> *OpenNFSC · powered by gary*

---

## 图形必备要素（评审可读性要求）

1. **顶部写明科学问题** —— 评审第一眼看到研究要回答什么
2. **研究内容作为模块** —— 3-4 项，顺序即研究推进顺序
3. **模块间箭头标注输入输出关系** —— 不能只有并列方块
4. **每模块标注可检验产出与验证方式**
5. **右侧或下方独立列出验证手段**（数据集 / 基准 / 基线 / 消融）
6. **底部可单列假说否定条件检验** —— 体现可证伪设计

---

## 格式一：Mermaid（最快，可在线预览）

粘贴到 https://mermaid.live 即可预览并导出 PNG/SVG。

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'13px'}}}%%
flowchart TB
    Q["<b>科学问题</b><br/>〔在此写明本项目要回答的科学问题〕<br/>〔含限定条件与可观测推论〕"]

    subgraph CONTENT["研究内容（按研究工作自身逻辑推进）"]
        C1["<b>研究内容一</b>　〔名称〕<br/>方法：〔…〕<br/>产出：〔可检验的中间产出〕<br/>验证：〔…〕"]
        C2["<b>研究内容二</b>　〔名称〕<br/>方法：〔…〕<br/>产出：〔…〕<br/>验证：〔…〕"]
        C3["<b>研究内容三</b>　〔名称〕<br/>方法：〔…〕<br/>产出：〔…〕"]
        C4["<b>研究内容四</b>　〔名称〕<br/>方法：〔…〕<br/>产出：〔…〕"]
    end

    subgraph VERIFY["验证手段"]
        V1["〔数据集 / 受控实验〕"]
        V2["〔真实数据基准〕"]
        V3["〔基线三类：必含最强〕"]
        V4["〔消融 A1–An〕"]
    end

    NEG["<b>假说否定条件检验</b>（主动搜索反例）<br/>〔写明什么结果会推翻假说〕<br/>→ 若找到，假说被推翻；该结果本身具有独立价值"]

    Q --> C1
    C1 -->|提供〔自变量/前提〕| C2
    C2 -->|提供〔关系/证据〕| C3
    C3 -->|提供〔判据/方法〕| C4
    C4 --> NEG
    V1 -.-> C2
    V3 -.-> C2
    V4 -.-> C3
    V2 -.-> C4

    style Q fill:#DAE8FC,stroke:#6C8EBF,stroke-width:2px
    style C1 fill:#D5E8D4,stroke:#82B366,stroke-width:2px
    style C2 fill:#D5E8D4,stroke:#82B366,stroke-width:2px
    style C3 fill:#D5E8D4,stroke:#82B366,stroke-width:2px
    style C4 fill:#D5E8D4,stroke:#82B366,stroke-width:2px
    style NEG fill:#F8CECC,stroke:#B85450,stroke-width:2px
    style V1 fill:#FFE6CC,stroke:#D79B00
    style V2 fill:#FFE6CC,stroke:#D79B00
    style V3 fill:#FFE6CC,stroke:#D79B00
    style V4 fill:#FFE6CC,stroke:#D79B00
```

---

## 格式二：Graphviz DOT（自动化排版）

安装 Graphviz 后：`dot -Tpng 技术路线图.dot -o 图1-技术路线图.png`

```dot
digraph TechRoadmap {
  rankdir=TB;
  graph [fontname="SimSun", fontsize=11, splines=ortho, nodesep=0.5, ranksep=0.5, bgcolor="white"];
  node  [fontname="SimSun", fontsize=11, shape=box, style="rounded,filled", penwidth=2];
  edge  [fontname="SimSun", fontsize=10, penwidth=2, arrowsize=0.8];

  q [label="科学问题：〔…〕", fillcolor="#DAE8FC", color="#6C8EBF", width=9];

  subgraph cluster_content {
    label="研究内容（按研究工作自身逻辑推进）";
    fontsize=12; color="#82B366"; style="rounded";
    c1 [label="研究内容一　〔名称〕\n方法：〔…〕\n产出：〔…〕", fillcolor="#D5E8D4", color="#82B366", width=8];
    c2 [label="研究内容二　〔名称〕\n方法：〔…〕\n产出：〔…〕", fillcolor="#D5E8D4", color="#82B366", width=8];
    c3 [label="研究内容三　〔名称〕\n方法：〔…〕\n产出：〔…〕", fillcolor="#D5E8D4", color="#82B366", width=8];
    c4 [label="研究内容四　〔名称〕\n方法：〔…〕\n产出：〔…〕", fillcolor="#D5E8D4", color="#82B366", width=8];
  }

  subgraph cluster_verify {
    label="验证手段"; fontsize=12; color="#D79B00"; style="rounded";
    v1 [label="〔受控分布族 / 数据集〕", fillcolor="#FFE6CC", color="#D79B00"];
    v2 [label="〔真实数据基准〕", fillcolor="#FFE6CC", color="#D79B00"];
    v3 [label="〔基线三类：必含最强〕", fillcolor="#FFE6CC", color="#D79B00"];
    v4 [label="〔消融 A1–An〕", fillcolor="#FFE6CC", color="#D79B00"];
  }

  neg [label="假说否定条件检验（主动搜索反例）\n〔什么结果会推翻假说〕", fillcolor="#F8CECC", color="#B85450", width=9];

  q  -> c1;
  c1 -> c2 [label="提供自变量"];
  c2 -> c3 [label="提供关系与反例"];
  c3 -> c4 [label="提供判据"];
  c4 -> neg;
  v1 -> c2 [style=dashed];
  v3 -> c2 [style=dashed];
  v4 -> c3 [style=dashed];
  v2 -> c4 [style=dashed];
}
```

---

## 格式三：draw.io（**推荐**，可直接拖拽调整）

`bin/md2tex.mjs` 与 `bin/cli.mjs` 都不直接生成 drawio；请用以下步骤：

1. 打开 https://app.diagrams.net （无需注册）
2. **Create New Diagram** → 空白图
3. 按 Mermaid 版本的结构手工摆放 6 类方框（科学问题 / 4 个研究内容 / 验证手段 / 否定条件）
4. 配色建议（与上面两种格式一致）：
   - 科学问题：填充 `#DAE8FC`，边框 `#6C8EBF`
   - 研究内容：填充 `#D5E8D4`，边框 `#82B366`
   - 验证手段：填充 `#FFE6CC`，边框 `#D79B00`
   - 否定条件：填充 `#F8CECC`，边框 `#B85450`
5. 导出：**File → Export as → PNG**，宽度设为 1600 px 以上
6. 命名为 `图1-技术路线图.png`，放到 `deliverables/` 下与 `.tex` 同目录
7. 重跑出稿脚本，图片会自动插入

---

## 插入正文的方式

在 `deliverables/申请书正文.md` 的（二）3.5.2 处写：

```markdown
##### 3.5.2　技术路线图

![图1　技术路线图](图1-技术路线图.png)

**图1　项目技术路线图**

图形说明：〔一段话说明图的层次与各模块关系〕
```

`bin/md2tex.mjs` 会把它转成：

```latex
\IfFileExists{图1-技术路线图.png}{\begin{center}\includegraphics[width=\linewidth]{图1-技术路线图.png}\end{center}}{...占位框...}
```

**PNG 不存在时自动回退为占位框，不会导致编译失败。**

---

## 排版建议

| 项 | 建议 |
|---|---|
| 图幅 | A4 横向或半页 A4（约 1100 × 860 px 起） |
| 字号 | 框内正文缩放后不小于 9 pt |
| 颜色 | 用四色区分层次（蓝=问题 / 绿=研究内容 / 橙=验证 / 红=否定条件） |
| 位置 | 置于（二）3.5.2，或按申报习惯置于（二）开头 |
| 一致性 | 图中模块名须与正文标题**逐字对应**；正文改动后同步更新图 |
