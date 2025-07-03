import fetch from "node-fetch";

const token = process.env.GH_TOKEN;
const username = "GavinHaydy";

const headers = {
  Authorization: `token ${token}`,
  "User-Agent": username,
};

async function fetchRepos() {
  let page = 1;
  const repos = [];
  while (true) {
    const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&type=owner`, { headers });
    const data = await res.json();
    repos.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return repos;
}

async function fetchCommitCount(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors`, { headers });
  const data = await res.json();
  const me = data.find(c => c.login === username);
  return me ? me.contributions : 0;
}

async function main() {
  const repos = await fetchRepos();
  const languagesCount = {};
  let totalCommits = 0;

  for (const repo of repos) {
    const { language, name } = repo;
    if (language) {
      languagesCount[language] = (languagesCount[language] || 0) + 1;
    }
    const commits = await fetchCommitCount(username, name);
    totalCommits += commits;
    console.log(`Repo ${name} 贡献：${commits}`);
  }

  const content = `
# 👋 Hi, I'm GavinHaydy

这里是我的 GitHub 活动统计：

- **总提交**: ${totalCommits}
- **语言分布**:
${Object.entries(languagesCount).map(([lang, count]) => `  - ${lang}: ${count} 个仓库`).join("\n")}

> 更新时间: ${new Date().toISOString()}
`;

  await Bun.write("README.md", content);
}

main().catch(console.error);
