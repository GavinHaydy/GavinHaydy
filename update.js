import fs from 'fs';
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GH_TOKEN });
const username = process.env.GITHUB_REPOSITORY_OWNER || 'gavinhaydy';

async function getPrivateRepoStats() {
  const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    visibility: 'private',
    affiliation: 'owner',
    per_page: 100,
  });

  let totalCommits = 0;
  const langStats = {};

  for (const repo of repos) {
    try {
      // 统计语言
      const langs = await octokit.repos.listLanguages({
        owner: username,
        repo: repo.name,
      });
      for (const [lang, bytes] of Object.entries(langs.data)) {
        langStats[lang] = (langStats[lang] || 0) + bytes;
      }

      // 统计 commit 数（只统计默认分支的提交数）
      const defaultBranch = repo.default_branch;
      const commits = await octokit.repos.listCommits({
        owner: username,
        repo: repo.name,
        sha: defaultBranch,
        per_page: 1,
      });
      // 利用响应头 link 获取commit总数分页信息
      const commitCount = await getCommitCount(octokit, username, repo.name, defaultBranch);
      totalCommits += commitCount;

    } catch (error) {
      console.warn(`跳过仓库 ${repo.name}，错误: ${error.message}`);
    }
  }

  return { langStats, totalCommits };
}

// 通过GitHub API分页计算commit总数
async function getCommitCount(octokit, owner, repo, branch) {
  try {
    // 请求第一页commit，per_page=1，拿link头里的last页数
    const res = await octokit.request('GET /repos/{owner}/{repo}/commits', {
      owner,
      repo,
      sha: branch,
      per_page: 1,
    });
    const link = res.headers.link;
    if (!link) return res.data.length;

    // 解析 last 页数
    const match = link.match(/&page=(\d+)>; rel="last"/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return res.data.length;
  } catch {
    return 0;
  }
}

function generateSVG(langStats, totalCommits) {
  const width = 460;
  const lineHeight = 30;
  const paddingTop = 40;
  const barHeight = 16;
  const barMaxWidth = 300;
  const fontFamily = 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif';

  // GitHub常用语言颜色简表（可扩展）
  const langColors = {
    JavaScript: '#f1e05a',
    TypeScript: '#2b7489',
    Python: '#3572A5',
    Java: '#b07219',
    HTML: '#e34c26',
    CSS: '#563d7c',
    Go: '#00ADD8',
    Rust: '#dea584',
    Shell: '#89e051',
    // 不在表里的用灰色
    default: '#6e6e6e'
  };

  // 计算总字节数
  const totalBytes = Object.values(langStats).reduce((a, b) => a + b, 0);

  // 按字节数排序，降序
  const sortedLangs = Object.entries(langStats)
    .sort(([, a], [, b]) => b - a);

  const height = paddingTop + sortedLangs.length * lineHeight + 50;

  const langLines = sortedLangs.map(([lang, bytes], i) => {
    const percent = (bytes / totalBytes) * 100;
    const barWidth = (percent / 100) * barMaxWidth;
    const color = langColors[lang] || langColors.default;
    const yPos = paddingTop + i * lineHeight;

    return `
      <text x="20" y="${yPos - 6}" font-size="16" fill="#cdd9e5" font-family="${fontFamily}" font-weight="600">${lang}</text>
      <text x="${20 + barMaxWidth + 10}" y="${yPos - 6}" font-size="16" fill="#8b949e" font-family="${fontFamily}">${percent.toFixed(1)}%</text>
      <rect x="20" y="${yPos}" width="${barMaxWidth}" height="${barHeight}" fill="#30363d" rx="8" ry="8" />
      <rect x="20" y="${yPos}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="8" ry="8" />
    `;
  }).join('\n');

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="私有仓库语言占比统计卡片">
  <rect width="100%" height="100%" fill="#0d1117" rx="20" ry="20"/>
  <text x="20" y="28" font-size="24" fill="#58a6ff" font-weight="bold" font-family="${fontFamily}">
    私有仓库语言占比
  </text>
  ${langLines}
  <text x="20" y="${paddingTop + sortedLangs.length * lineHeight + 30}" font-size="20" fill="#79c0ff" font-weight="bold" font-family="${fontFamily}">
    总提交数: ${totalCommits.toLocaleString()}
  </text>
</svg>
  `;
}


async function updateReadmeAndSvg() {
  const { langStats, totalCommits } = await getPrivateRepoStats();

  const svgContent = generateSVG(langStats, totalCommits);
  fs.writeFileSync('.github/private-stats.svg', svgContent, 'utf-8');
  console.log('✅ SVG卡片生成成功');

  const readmePath = 'README.md';
  let readme = fs.readFileSync(readmePath, 'utf-8');

  const startTag = '<!-- PRIVATE_STATS_START -->';
  const endTag = '<!-- PRIVATE_STATS_END -->';

  const newSection = `
${startTag}
![私有仓库统计](./.github/private-stats.svg)
${endTag}
`;

  const regex = new RegExp(`${startTag}[\\s\\S]*${endTag}`);
  if (regex.test(readme)) {
    readme = readme.replace(regex, newSection);
  } else {
    readme += '\n' + newSection;
  }

  fs.writeFileSync(readmePath, readme, 'utf-8');
  console.log('✅ README.md 更新成功');
}

updateReadmeAndSvg().catch(err => {
  console.error('❌ 脚本执行错误:', err);
  process.exit(1);
});
