# 端到端实测样例（真人可验证的走通记录）

> *OpenNFSC · powered by gary*

这个目录**不是模板**，而是一次完整跑通全流程后留下的原始产物，用途有两个：

1. **给 agent 当参照物** —— 各阶段到底该产出什么形状的东西，看实物比看描述准。
2. **给出稿质量一个下限基准** —— 若你的产出明显不如它，说明流程没走完。

---

## 本次运行的信息

| 项 | 值 |
|---|---|
| 研究方向 | 扩散模型一致性生成（consistency models / few-step generation） |
| 申报级别 | 青年科学基金项目（C 类） |
| 文献库 | 18 条，全部经官方来源核验（OpenReview 官方 BibTeX 16 条 + arXiv 官方页面 2 条） |
| 正文篇幅 | 22,680 字（不含空白），LaTeX 实际排为 26 页（≤ 30 页上限） |
| 引用校验 | `validate --strict` 退出码 0，正文 18 处引用 ↔ 文献列表 18 条，双向一致 |
| 模板校验 | `check-template.mjs` 23/23 项通过 |
| PDF 内容自检 | 绘图算子 9741 / 文本绘制 2483 / 嵌入字体 14 |

## 文件说明

```
examples/test-run/
├── deliverables/
│   ├── 申请书正文.md            最终稿（Markdown 源）
│   ├── 申请书正文.tex           md2tex.mjs 生成
│   ├── 申请书正文.pdf           XeLaTeX 出稿，26 页
│   └── 图1-技术路线图.drawio    技术路线图源文件
└── work/
    ├── library.json             文献库（含核验标注）
    └── validate.json            引用校验结果
```

---

## ⚠️ 重要：这份样例**不可直接提交**

- 正文中的**研究基础、前期成果、预研数据**来自流程演示，**不是某位申请人的真实履历**。
  正式申请必须换成申请人本人的真实材料——这是官方评审明确考察的内容，也是本技能包
  明确声明**不予代写**的部分（见 `AGENTS.md` 第 8 节）。
- 申请人个人信息（姓名、单位、申请代码等）在样例中为脱敏状态。
- 正式提交前，请以 ISIS 系统下载的当年官方模板为准，并用 `check-template.mjs` 再校验一次。

## 复现这份样例

```bash
cd OpenNFSC
node bin/check-template.mjs examples/test-run/deliverables/申请书正文.md
node bin/cli.mjs validate --manuscript examples/test-run/deliverables/申请书正文.md \
  --lib examples/test-run/work/library.json --min-citations 15 --strict
node bin/md2tex.mjs examples/test-run/deliverables/申请书正文.md /tmp/check.tex
node bin/compile-tex.ps1 -TexPath /tmp/check.tex
```

技术路线图源文件是 `.drawio` 格式。想改成**纯 TikZ**（免外部图片、矢量、单文件可复现）：
把 `pipeline/templates/technical-roadmap.tikz` 复制到 `.tex` 同目录并改名为
`图1-技术路线图.tikz`，重新编译即自动优先嵌入。

---

*OpenNFSC · powered by gary*
