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
  const width = 420;
  const lineHeight = 28;
  const paddingTop = 40;
  const entries = Object.entries(langStats);
  const height = paddingTop + entries.length * lineHeight + 50;

  const langLines = entries.map(([lang, bytes], i) => `
    <text x="20" y="${paddingTop + i * lineHeight}" font-size="18" fill="#58a6ff" font-family="Segoe UI, Tahoma, Geneva, Verdana, sans-serif">
      ${lang}: ${bytes.toLocaleString()} bytes
    </text>
  `).join('\n');

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="私有仓库统计卡片">
  <rect width="100%" height="100%" fill="#0d1117" rx="20" ry="20"/>
  <text x="20" y="28" font-size="22" fill="#79c0ff" font-weight="bold" font-family="Segoe UI, Tahoma, Geneva, Verdana, sans-serif">
    私有仓库统计
  </text>
  ${langLines}
  <text x="20" y="${paddingTop + entries.length * lineHeight + 30}" font-size="20" fill="#79c0ff" font-weight="bold" font-family="Segoe UI, Tahoma, Geneva, Verdana, sans-serif">
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
