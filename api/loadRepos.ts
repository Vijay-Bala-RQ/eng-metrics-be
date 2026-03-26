import { getAuthHeader } from "../services/auth";
import { handleCors } from "../services/cors";
import { getGithubRepos } from "../services/github";
import axios from "axios";

export default async function handler(req: any, res: any) {
  if (handleCors(req, res)) return;

  try {
    const org: string = req.query.org || "";
    const rawProject: string = Array.isArray(req.query.project)
      ? req.query.project[0]
      : req.query.project || "";
    const project = decodeURIComponent(rawProject.replace(/\+/g, " "));
    const githubOrg: string = req.query.githubOrg || "";
    const githubPat = req.headers["x-github-pat"] as string | undefined;

    let azureRepos: any[] = [];
    let githubRepos: any[] = [];

    if (org && project) {
      const headers = getAuthHeader(req);
      const url = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1`;
      const response = await axios.get(url, { headers });
      azureRepos = (response.data.value || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        source: "azure",
      }));
    }

    if (githubPat && githubPat.trim() !== "") {
      try {
        githubRepos = await getGithubRepos(
          githubOrg.trim() || undefined,
          githubPat
        );
      } catch (ghErr: any) {
        console.error("GitHub repos error:", ghErr?.message);
      }
    }

    res.status(200).json({ azureRepos, githubRepos });
  } catch (err: any) {
    console.error("loadRepos error:", err?.message);
    if (err.message === "NO_PAT") {
      return res.status(401).json({ error: "NO_PAT" });
    }
    res.status(500).json({ error: err?.message || String(err) });
  }
}