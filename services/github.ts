import axios from "axios";

export async function getGithubRepos(org: string | undefined, pat?: string) {
  if (!pat) return [];

  const headers: any = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${pat}`,
  };

  const repoMap = new Map<string, any>();

  if (org && org.trim() !== "") {
    let fetchedFromOrg = false;
    try {
      let page = 1;
      while (true) {
        const res = await axios.get(
          `https://api.github.com/orgs/${org.trim()}/repos`,
          { headers, params: { type: "all", per_page: 100, page } }
        );
        const repos: any[] = res.data || [];
        repos.forEach((r) => repoMap.set(r.full_name, r));
        fetchedFromOrg = repos.length > 0;
        if (repos.length < 100) break;
        page++;
      }
    } catch (err: any) {
      console.log(`[GitHub] orgs/${org} error: ${err.response?.status}`);
    }

    if (!fetchedFromOrg || repoMap.size === 0) {
      try {
        let page = 1;
        while (true) {
          const res = await axios.get(`https://api.github.com/user/repos`, {
            headers,
            params: { type: "all", per_page: 100, page, sort: "updated" },
          });
          const repos: any[] = res.data || [];
          repos.forEach((r) => repoMap.set(r.full_name, r));
          if (repos.length < 100) break;
          page++;
        }
      } catch (err: any) {
        console.log(`[GitHub] user/repos fallback error: ${err.response?.status}`);
      }
    }

    if (repoMap.size === 0) {
      try {
        const res = await axios.get(
          `https://api.github.com/orgs/${org.trim()}/repos`,
          { headers, params: { type: "public", per_page: 100 } }
        );
        (res.data || []).forEach((r: any) => repoMap.set(r.full_name, r));
      } catch (_) { }
    }
  } else {
    try {
      let page = 1;
      while (true) {
        const res = await axios.get(`https://api.github.com/user/repos`, {
          headers,
          params: { type: "all", per_page: 100, page, sort: "updated" },
        });
        const repos: any[] = res.data || [];
        repos.forEach((r) => repoMap.set(r.full_name, r));
        if (repos.length < 100) break;
        page++;
      }
    } catch (err: any) {
      console.log(`[GitHub] user/repos error: ${err.response?.status}`);
    }
  }

  return Array.from(repoMap.values()).map((r: any) => ({
    id: r.id.toString(),
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    source: "github",
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at,
  }));
}

export async function getGithubPRs(fullName: string, pat: string): Promise<any[]> {
  const headers: any = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${pat}`,
  };
  const all: any[] = [];
  try {
    for (const state of ["closed", "open"]) {
      let page = 1;
      while (true) {
        const res = await axios.get(
          `https://api.github.com/repos/${fullName}/pulls`,
          { headers, params: { state, per_page: 100, page, sort: "updated", direction: "desc" } }
        );
        const prs: any[] = res.data || [];
        all.push(...prs);
        if (prs.length < 100) break;
        page++;
      }
    }
    console.log(`[GitHub] getGithubPRs ${fullName}: total=${all.length}`);
  } catch (err: any) {
    console.log(`[GitHub] PRs error for ${fullName}: ${err.response?.status} ${err.message}`);
  }
  return all;
}

/**
 * Fetch the real comment count for a single PR using both official GitHub endpoints:
 *  - GET /repos/{fullName}/issues/{prNumber}/comments  → general discussion comments
 *  - GET /repos/{fullName}/pulls/{prNumber}/comments   → inline diff/review comments
 *
 * The `comments` and `review_comments` fields on the PR list response are stale
 * cached integers and are often wrong. This function fetches the actual counts.
 */
export async function getGithubPRCommentCount(
  fullName: string,
  prNumber: number,
  pat: string
): Promise<number> {
  const headers: any = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${pat}`,
  };

  let issueCommentCount = 0;
  let reviewCommentCount = 0;

  try {
    let page = 1;
    while (true) {
      const res = await axios.get(
        `https://api.github.com/repos/${fullName}/issues/${prNumber}/comments`,
        { headers, params: { per_page: 100, page } }
      );
      const comments: any[] = res.data || [];
      issueCommentCount += comments.length;
      if (comments.length < 100) break;
      page++;
    }
  } catch (err: any) {
    console.log(`[GitHub] issue comments error for PR #${prNumber}: ${err.response?.status}`);
  }

  try {
    let page = 1;
    while (true) {
      const res = await axios.get(
        `https://api.github.com/repos/${fullName}/pulls/${prNumber}/comments`,
        { headers, params: { per_page: 100, page } }
      );
      const comments: any[] = res.data || [];
      reviewCommentCount += comments.length;
      if (comments.length < 100) break;
      page++;
    }
  } catch (err: any) {
    console.log(`[GitHub] review comments error for PR #${prNumber}: ${err.response?.status}`);
  }

  return issueCommentCount + reviewCommentCount;
}

export async function getGithubCommits(fullName: string, pat: string): Promise<any[]> {
  const headers: any = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${pat}`,
  };
  const all: any[] = [];
  try {
    let page = 1;
    while (true) {
      const res = await axios.get(
        `https://api.github.com/repos/${fullName}/commits`,
        { headers, params: { per_page: 100, page } }
      );
      const commits: any[] = res.data || [];
      all.push(...commits);
      if (commits.length < 100) break;
      page++;
      if (page > 10) break;
    }
    console.log(`[GitHub] getGithubCommits ${fullName}: total=${all.length}`);
  } catch (err: any) {
    console.log(`[GitHub] commits error for ${fullName}: ${err.response?.status} ${err.message}`);
  }
  return all;
}
