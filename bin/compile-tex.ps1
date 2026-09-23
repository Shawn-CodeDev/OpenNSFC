# XeLaTeX 编译申请书正文 → PDF
# ─────────────────────────────────────────────────────────────
#   & 'bin/compile-tex.ps1'                       # 自动查找 deliverables 下的 .tex
#   & 'bin/compile-tex.ps1' -TexPath <文件.tex>   # 指定源文件
#   & 'bin/compile-tex.ps1' -TexPath <文件.tex> -KeepWork   # 保留构建目录以便排查
#
# 会做的事：
#   1. 自动定位 TeX 二进制（PATH 或常见安装目录）
#   2. 把 .tex 与同目录图片/TikZ 片段复制到**全新**临时构建目录（避免污染交付目录）
#   3. XeLaTeX 连续编译两遍（生成交叉引用与页码），全程 -halt-on-error
#   4. 多证据交叉验证确实产出了新 PDF，再把 PDF 复制回 .tex 同目录
#
# 关于"假成功"（本脚本历史上踩过的坑，务必保留这些检查）：
#   · 输出目录若复用旧构建目录，上一轮残留的 PDF 会被误判为"本轮成功"；
#   · 不加 -halt-on-error 时 TeX 出错后仍可能返回退出码 0；
#   · stdout 一旦被丢弃，日志里的 `! ...` 与 `No pages of output` 就无从发现。
#   因此本脚本要求同时满足：本轮新生成 PDF + 日志含 Output written + 0 个 `^!` 错误。
#
# powered by gary
param(
    [string]$TexPath = '',
    [switch]$KeepWork
)

$ErrorActionPreference = 'Continue'

function Find-TeXBin {
    $x = Get-Command 'xelatex.exe' -ErrorAction SilentlyContinue
    if ($x) { return (Split-Path $x.Source -Parent) }
    $roots = @('C:\texlive', 'D:\texlive', 'E:\texlive',
               "$env:LOCALAPPDATA\Programs\MiKTeX", 'C:\Program Files\MiKTeX',
               "$env:USERPROFILE\.TinyTeX", 'C:\TinyTeX')
    $subs = @('bin\windows', '2026\bin\windows', '2025\bin\windows', '2024\bin\windows', 'bin')
    foreach ($r in $roots) {
        if (-not (Test-Path $r)) { continue }
        foreach ($s in $subs) {
            $d = Join-Path $r $s
            if (Test-Path (Join-Path $d 'xelatex.exe')) { return $d }
        }
    }
    return $null
}

if (-not $TexPath) {
    $found = Get-ChildItem -Path (Get-Location) -Recurse -Filter '*.tex' -ErrorAction SilentlyContinue |
             Sort-Object { if ($_.FullName -match 'deliverables') { 0 } else { 1 } } |
             Select-Object -First 1
    if (-not $found) { Write-Host "未找到 .tex 文件。请用 -TexPath 指定" -ForegroundColor Red; exit 1 }
    $TexPath = $found.FullName
}
$TexPath = (Resolve-Path $TexPath).Path
$srcDir  = Split-Path $TexPath -Parent
$base    = [System.IO.Path]::GetFileNameWithoutExtension($TexPath)

Write-Host "源文件: $TexPath" -ForegroundColor Cyan

$bin = Find-TeXBin
if (-not $bin) {
    Write-Host "未找到 XeLaTeX。请先运行：node bin/setup.mjs" -ForegroundColor Red
    exit 1
}
Write-Host "TeX    : $bin" -ForegroundColor DarkGray

# 每次都用全新构建目录：旧产物绝无可能被误判为本轮结果
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("opennfsc-tex-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
Copy-Item $TexPath (Join-Path $work "$base.tex") -Force
# 连同位图与 TikZ 片段一起复制（.tikz 由 \input 引入，缺了会直接编译失败）
Get-ChildItem $srcDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.png','.jpg','.jpeg','.tikz','.pdf','.eps' } |
    Copy-Item -Destination $work -Force -ErrorAction SilentlyContinue

$env:PATH = "$bin;$env:PATH"
Push-Location $work
$exitCode = 1
try {
    $rawLog = Join-Path $work 'xelatex-stdout.log'
    foreach ($i in 1,2) {
        Write-Host "XeLaTeX 第 $i 遍…" -ForegroundColor Cyan
        # -halt-on-error：出错立刻停，避免"报错但退出码 0"
        & (Join-Path $bin 'xelatex.exe') -interaction=nonstopmode -halt-on-error -file-line-error "$base.tex" *> $rawLog
    }

    $pdf = Join-Path $work "$base.pdf"
    $log = Join-Path $work "$base.log"

    # ---- 证据 1：本轮构建目录里是否确有 PDF ----
    if (-not (Test-Path $pdf)) {
        Write-Host ""
        Write-Host "编译失败：未生成 PDF" -ForegroundColor Red
        if (Test-Path $log) {
            Write-Host "日志中的错误：" -ForegroundColor Yellow
            Get-Content $log -Encoding UTF8 | Select-String -Pattern '^!' -Context 0,3 |
                Select-Object -First 8 | ForEach-Object { Write-Host "  $_" }
        }
        if ($KeepWork) { Write-Host "构建目录已保留: $work" -ForegroundColor DarkGray }
        exit 1
    }

    # ---- 证据 2/3：日志必须含 Output written，且不得有任何 `^!` 错误 ----
    $pages = 0; $errs = 0; $overfull = 0; $errLines = @()
    if (Test-Path $log) {
        $lg = Get-Content $log -Raw -Encoding UTF8
        if ($lg -match 'Output written on .*?\((\d+) pages?') { $pages = [int]$Matches[1] }
        $m = [regex]::Matches($lg, '(?m)^!.*$')
        $errs = $m.Count
        if ($errs -gt 0) { $errLines = $m | Select-Object -First 6 | ForEach-Object { $_.Value } }
        $overfull = ([regex]::Matches($lg, 'Overfull \\hbox')).Count
    }

    if ($pages -le 0) {
        Write-Host ""
        Write-Host "编译失败：日志中没有 'Output written'——说明 TeX 中止，未产出任何页面" -ForegroundColor Red
        if (Test-Path $log) {
            Get-Content $log -Encoding UTF8 | Select-String -Pattern '^!|No pages of output|Fatal error' -Context 0,3 |
                Select-Object -First 8 | ForEach-Object { Write-Host "  $_" }
        }
        if ($KeepWork) { Write-Host "构建目录已保留: $work" -ForegroundColor DarkGray }
        exit 1
    }

    if ($errs -gt 0) {
        Write-Host ""
        Write-Host "编译失败：日志中存在 $errs 处错误（尽管生成了 PDF，也视为未通过）" -ForegroundColor Red
        $errLines | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
        Write-Host "  完整日志: $(if ($KeepWork) { $log } else { '加 -KeepWork 可保留构建目录查看' })" -ForegroundColor DarkGray
        if ($KeepWork) { Write-Host "构建目录已保留: $work" -ForegroundColor DarkGray }
        exit 1
    }

    # ---- 三条证据齐备，才认定为成功 ----
    $dest = Join-Path $srcDir "$base.pdf"
    Copy-Item $pdf $dest -Force
    $size = [math]::Round((Get-Item $dest).Length / 1KB, 1)

    Write-Host ""
    Write-Host "编译成功" -ForegroundColor Green
    Write-Host ("  PDF    : {0}  ({1} KB, {2} 页)" -f $dest, $size, $pages)
    Write-Host "  错误   : 0"
    if ($overfull -lt 40) { Write-Host ("  Overfull hbox: {0} 处（可接受，多为长 URL 换行）" -f $overfull) -ForegroundColor DarkGray }
    else { Write-Host ("  Overfull hbox: {0} 处（偏多，建议检查）" -f $overfull) -ForegroundColor Yellow }
    if ($pages -gt 30) {
        Write-Host ("  页数 {0} 超过 30 页上限（NSFC 正文含图表不超过 30 页）" -f $pages) -ForegroundColor Yellow
    }

    # ---- 证据 4：PDF 内容自检 ----
    # 编译成功 ≠ 图进去了。\IfFileExists 走了占位分支、图片路径写错等情况
    # 对编译链路完全静默（退出码 0、日志无错误、PDF 也生成了）。
    # 这里直接解析 PDF 内容流来确认。
    $probe = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin\pdf-probe.mjs'
    if (Test-Path $probe) {
        $raw = & node $probe $dest --quiet 2>$null
        try {
            $pr = $raw | ConvertFrom-Json
            if ($pr.textOps -lt 1) {
                Write-Host "  PDF 自检: 失败——没有文本绘制算子，正文可能为空" -ForegroundColor Red
                exit 1
            }
            elseif ($pr.drawingOps -lt 1) {
                # 不直接判失败：并非所有申请书都必须含图。但必须明确提示。
                Write-Host "  PDF 自检: 未检出矢量绘图——若正文含技术路线图，说明图未真正嵌入（编译对此不报错）" -ForegroundColor Yellow
            }
            else {
                Write-Host ("  PDF 自检: 绘图算子 {0} / 文本绘制 {1} / 嵌入字体 {2}" -f $pr.drawingOps, $pr.textOps, $pr.fonts) -ForegroundColor DarkGray
            }
        }
        catch {
            Write-Host "  PDF 自检: 解析失败（不影响出稿；可手动运行 node bin/pdf-probe.mjs <pdf>）" -ForegroundColor DarkGray
        }
    }

    Write-Host ""
    Write-Host "  OpenNFSC · powered by gary" -ForegroundColor DarkGray
    $exitCode = 0
}
finally {
    Pop-Location
    if (-not $KeepWork) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}
exit $exitCode
