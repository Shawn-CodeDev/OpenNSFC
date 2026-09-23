# 运行时产出目录

每个项目一个子目录：

```
runs/<项目名>/
├── work/          state.json / library.json / GAP-MAP.md / notes/
└── deliverables/  申请书正文.md / .tex / .pdf / 图1-技术路线图.tikz
```

---

## ⚠️ 分发前必须清理本目录

**正式分发的包里 `runs/` 只应含本文件（作为占位）。**

运行产生的子目录属于**申请人材料**，含未公开的研究构思、科学假说、文献清单与正文草稿。
把技能包转给别人时若一并带出，等于泄露选题。打包前执行：

```powershell
cd OpenNFSC
Get-ChildItem runs -Directory | Remove-Item -Recurse -Force
```

```bash
# macOS / Linux
cd OpenNFSC && rm -rf runs/*/
```

*OpenNFSC · powered by gary*
