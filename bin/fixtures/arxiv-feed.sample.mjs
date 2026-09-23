// 测试用的 arXiv Atom 响应样本（取自真实响应结构，用于离线验证解析逻辑）
export const ARXIV_FEED_SAMPLE = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query?search_query=ti:%22consistency+models%22&amp;id_list=&amp;start=0&amp;max_results=2" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=ti:"consistency models"</title>
  <updated>2026-09-22T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">2</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2303.01469v2</id>
    <updated>2023-05-30T17:59:58Z</updated>
    <published>2023-03-02T18:57:06Z</published>
    <title>Consistency Models</title>
    <summary>Diffusion models have made significant breakthroughs in image, audio, and video
generation, but their iterative generation process is slow.</summary>
    <author><name>Yang Song</name></author>
    <author><name>Prafulla Dhariwal</name></author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">ICML 2023</arxiv:comment>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2310.04378v3</id>
    <updated>2024-03-20T08:31:03Z</updated>
    <published>2023-10-06T17:55:40Z</published>
    <title>Latent Consistency Models: Synthesizing High-Resolution Images with Few-Step Inference</title>
    <summary>Latent Consistency Models (LCMs) enable high-quality image synthesis in few steps.</summary>
    <author><name>Simian Luo</name></author>
    <author><name>Yiqin Tan</name></author>
    <arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">arXiv preprint</arxiv:journal_ref>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;
