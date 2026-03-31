import axios from "axios";
import { handleCors } from "../services/cors";
import { getAuthHeader } from "../services/auth";

export default async function handler(req: any, res: any) {
  if (handleCors(req, res)) return;

  try {
    const source: string = req.query.source || "ado";

    if (source === "github") {
      const githubPat: string = req.headers["x-github-pat"] as string || "";
      const org: string = req.query.org || "";
      const reposParam: string = req.query.repos || "";

      if (!githubPat) {
        return res.status(401).json({ error: "NO_PAT" });
      }

      const ghHeaders: any = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubPat}`,
      };

      const repoFullNames: string[] = reposParam
        ? reposParam.split(",").map((r: string) => r.trim()).filter(Boolean)
        : [];

      if (repoFullNames.length === 0 && org) {
        try {
          const repoRes = await axios.get(
            `https://api.github.com/orgs/${org}/repos`,
            { headers: ghHeaders, params: { per_page: 100, type: "all" } }
          );
          for (const r of repoRes.data || []) {
            repoFullNames.push(r.full_name);
          }
        } catch (_) {
          const repoRes = await axios.get(
            `https://api.github.com/user/repos`,
            { headers: ghHeaders, params: { per_page: 100, type: "all" } }
          );
          for (const r of repoRes.data || []) {
            repoFullNames.push(r.full_name);
          }
        }
      }

      const workflows: any[] = [];
      for (const fullName of repoFullNames) {
        try {
          const wfRes = await axios.get(
            `https://api.github.com/repos/${fullName}/actions/workflows`,
            { headers: ghHeaders, params: { per_page: 100 } }
          );
          for (const wf of wfRes.data?.workflows || []) {
            workflows.push({
              id: wf.id.toString(),
              name: wf.name,
              repoId: fullName,
              fullName,
              path: wf.path,
              state: wf.state,
              source: "github",
            });
          }
        } catch (e: any) {
          console.log(`[loadPipelines/github] ${fullName}: ${e?.message}`);
        }
      }

      return res.status(200).json(workflows);
    }

    const org: string = req.query.org || "";
    const rawProject: string = Array.isArray(req.query.project)
      ? req.query.project[0]
      : req.query.project || "";

    const project = decodeURIComponent(rawProject.replace(/\+/g, " "));

    if (!org || !project) {
      return res.status(400).json({ error: "ORG_PROJECT_REQUIRED" });
    }

    const headers = getAuthHeader(req);
    const url = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/build/definitions?api-version=7.1`;
    const response = await axios.get(url, { headers });

    res.status(200).json(response.data.value);
  } catch (err: any) {
    console.error("loadPipelines error:", err?.message);
    if (err.message === "NO_PAT") {
      return res.status(401).json({ error: "NO_PAT" });
    }
    res.status(500).json({ error: err?.message || String(err) });
  }
}
