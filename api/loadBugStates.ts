import { handleCors } from "../services/cors";
import axios from "axios";

export default async function handler(req: any, res: any) {
    if (handleCors(req, res)) return;

    try {
        const org: string = req.query.org || "";
        const adoProject: string = decodeURIComponent(
            (req.query.project || "").replace(/\+/g, " ")
        );

        if (!org || !adoProject) {
            return res.status(400).json({ error: "Missing org or project param." });
        }

        const pat =
            req.headers["x-ado-workitems-pat"] ||
            req.headers["x-ado-pat"] ||
            process.env.ADO_PAT;

        if (!pat) return res.status(401).json({ error: "NO_PAT" });

        const headers = {
            Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
            "Content-Type": "application/json",
        };

        const url = `https://dev.azure.com/${org}/${encodeURIComponent(
            adoProject
        )}/_apis/wit/workitemtypes/Bug/states?api-version=7.1`;

        const statesRes = await axios.get(url, { headers });
        const states: string[] = (statesRes.data.value || []).map(
            (s: any) => s.name as string
        );

        return res.status(200).json({ states });
    } catch (e: any) {
        console.error("[loadBugStates] error:", e?.message);
        return res.status(500).json({ error: e?.message || "Unknown error" });
    }
}