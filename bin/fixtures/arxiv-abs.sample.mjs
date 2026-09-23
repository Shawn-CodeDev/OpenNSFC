// 测试用的 arXiv 摘要页 HTML 样本
// 结构取自真实抓取（2026-09 实测 arxiv.org/abs/2303.01469，HTTP 200，268ms）
// 保留关键区块的原始结构，去掉与本解析器无关的导航噪声
export const ARXIV_ABS_SAMPLE = `<!DOCTYPE html>
<html lang="en">
<head><title>[2303.01469] Consistency Models</title>
<link rel="stylesheet" type="text/css" href="/static/base/1.0.1/css/abs.css">
</head>
<body>
<div class="header-breadcrumbs-mobile">
      <strong>arXiv:2303.01469</strong> (cs)
    </div>
<div id="content-inner">
  <div id="abs">
    <div class="dateline">
  [Submitted on 2 Mar 2023 (<a href="https://arxiv.org/abs/2303.01469v1">v1</a>), last revised 31 May 2023 (this version, v2)]</div>
    <h1 class="title mathjax"><span class="descriptor">Title:</span>Consistency Models</h1>
    <div class="authors"><span class="descriptor">Authors:</span><a href="/a/song_y_1">Yang Song</a>, <a href="/a/dhariwal_p_1">Prafulla Dhariwal</a>, <a href="/a/chen_m_1">Mark Chen</a>, <a href="/a/sutskever_i_1">Ilya Sutskever</a></div>
    <div class="dateline">(or <a href="https://arxiv.org/abs/2303.01469v1">view preprint versions</a>)</div>
    <blockquote class="abstract mathjax">
      <span class="descriptor">Abstract:</span>Diffusion models have significantly advanced the fields of image, audio, and video generation, but they depend on an iterative sampling process that causes slow generation. To overcome this limitation, we propose consistency models, a new family of models that generate high quality samples by directly mapping noise to data. They support fast one-step generation by design, while still allowing multistep sampling to trade compute for sample quality.
    </blockquote>
    <div class="submission-history">
      <h2>Submission history</h2>
      From: Yang Song [<a href="/show-email/abc/2303.01469">view email</a>]
      <br/>
      <strong><a href="https://arxiv.org/abs/2303.01469v2">[v2]</a></strong> Tue, 30 May 2023 17:59:58 UTC (1,548 KB)<br/>
      <strong><a href="/abs/2303.01469v1">[v1]</a></strong> Thu, 2 Mar 2023 18:57:06 UTC (1,507 KB)
    </div>
  </div>
  <div class="extra-services">
    <a href="/pdf/2303.01469" class="abs-button download-pdf">View PDF</a>
  </div>
  <div class="tablecell subjects">
    <span class="descriptor">Subjects:</span>Machine Learning (cs.LG); Computer Vision and Pattern Recognition (cs.CV); Machine Learning (stat.ML)
  </div>
  <div class="tablecell comments">
    <span class="descriptor">Cite as:</span><a href="https://arxiv.org/abs/2303.01469">arXiv:2303.01469 [cs.LG]</a>
  </div>
</div>
</body>
</html>`;

// 带 journal_ref 与 DOI 的变体（模拟已正式发表的预印本页）
export const ARXIV_ABS_SAMPLE_WITH_JOURNAL = `<div id="abs">
    <div class="dateline">
  [Submitted on 6 Oct 2023 (<a href="https://arxiv.org/abs/2310.04378v1">v1</a>), last revised 20 Mar 2024 (this version, v3)]</div>
    <h1 class="title mathjax"><span class="descriptor">Title:</span>Latent Consistency Models: Synthesizing High-Resolution Images with Few-Step Inference</h1>
    <div class="authors"><span class="descriptor">Authors:</span><a href="/a/luo_s_1">Simian Luo</a>, <a href="/a/tan_y_1">Yiqin Tan</a>, <a href="/a/huang_l_1">Longbo Huang</a>, <a href="/a/li_j_1">Jian Li</a></div>
    <blockquote class="abstract mathjax">
      <span class="descriptor">Abstract:</span>Latent Consistency Models (LCMs) enable high-quality image synthesis in few steps.
    </blockquote>
    <td class="tablecell subjects"><span class="descriptor">Subjects:</span>Computer Vision and Pattern Recognition (cs.CV)</td>
    <td class="tablecell doi"><span class="descriptor">DOI:</span><a href="https://doi.org/10.48550/arXiv.2310.04378">10.48550/arXiv.2310.04378</a></td>
    <a href="/pdf/2310.04378" class="abs-button download-pdf">View PDF</a>
  </div>`;
