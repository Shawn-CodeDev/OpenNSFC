// 从 bin/track-params.mjs 生成两套官方提纲基准文件到 templates/
// 单一真源：提纲原文只写在 track-params.mjs 里，避免多处副本漂移。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRACKS, renderOutline } from './track-params.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPL = join(HERE, '..', 'templates');

for (const track of Object.values(TRACKS)) {
  const path = join(TPL, track.outlineFile);
  const header = [
    `# ${track.label} · 报告正文（2026 版）撰写提纲`,
    '#',
    '# 来源：国家自然科学基金委 2026-01-05 发布的',
    `#   《${track.label}-填报说明与撰写提纲-2026》`,
    '#',
    '# 官方原文：请勿删除或改动下述提纲标题及括号中的文字。',
    `# 篇幅：申请书正文原则上不超过 30 页，鼓励简洁表达。`,
    '#',
    '# 本文件由 bin/gen-outlines.mjs 从 bin/track-params.mjs 生成，请勿手工编辑。',
    '# ---------------------------------------------------------------------------',
    '',
  ].join('\n');
  writeFileSync(path, header + renderOutline(track), 'utf8');
  console.log(`✓ ${track.outlineFile}  （${track.items.length} 项）`);
}
