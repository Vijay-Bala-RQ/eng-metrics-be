import axios from "axios";
import { handleCors } from "../services/cors";
import { getAuthHeader } from "../services/auth";

export default async function handler(req: any, res: any) {
  if (handleCors(req, res)) return;

  try {
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