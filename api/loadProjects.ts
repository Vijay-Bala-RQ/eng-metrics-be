import axios from "axios";
import { handleCors } from "../services/cors";
import { getAuthHeader } from "../services/auth";

export default async function handler(req: any, res: any) {
  if (handleCors(req, res)) return;

  try {
    const org: string = req.query.org || "";

    if (!org || org === "-") {
      return res.status(200).json([]);
    }

    const headers = getAuthHeader(req);
    const url = `https://dev.azure.com/${org}/_apis/projects?api-version=7.1`;
    const response = await axios.get(url, { headers });

    res.status(200).json(response.data.value);
  } catch (err: any) {
    console.error("loadProjects error:", err?.message);
    if (err.message === "NO_PAT") {
      return res.status(401).json({ error: "NO_PAT" });
    }
    res.status(500).json({ error: err?.message || String(err) });
  }
}