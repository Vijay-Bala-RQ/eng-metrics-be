import { db } from "../services/firestore";
import { handleCors } from "../services/cors";
import axios from "axios";

function getWorkItemsHeaders(req: any): Record<string, string> {
    const pat =
        req.headers["x-ado-workitems-pat"] ||
        req.headers["x-ado-pat"] ||
        process.env.ADO_PAT;
    if (!pat) throw new Error("NO_PAT");
    return {
        Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
        "Content-Type": "application/json",
    };
}

function buildOpenBugStateFilter(openBugStates: string[]): string {
    if (openBugStates.length > 0) {
        const conditions = openBugStates
            .map((s) => `[System.State] = '${s}'`)
            .join(" OR ");
        return ` AND (${conditions})`;
    }
    return " AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved'";
}

/**
 * POST /api/collectWorkItems
 *
 * Fetches work-item metrics (bugs, stories, tasks, cycle time, developer
 * breakdown) from Azure DevOps and writes them to a dedicated Firestore doc:
 *
 *   metrics/{projectId}_workitems
 *
 * This endpoint is intentionally decoupled from pipelines and repos.
 * It only needs:
 *   - x-ado-workitems-pat header  (or x-ado-pat as fallback)
 *   - org, adoProject query params
 *   - docId query param  (should be "{projectId}_workitems")
 */
export default async function handler(req: any, res: any) {
    if (handleCors(req, res)) return;
    console.log(
        "[collectWorkItems] method:",
        req.method,
        "query:",
        JSON.stringify(req.query),
    );

    try {
        const org: string = req.query.org || process.env.ADO_ORG || "";
        const workItemsOrg: string = (req.query.workItemsOrg as string) || org;
        const rawAdoProject: string =
            req.query.adoProject || process.env.ADO_PROJECT || "";
        const adoProject: string = decodeURIComponent(
            rawAdoProject.replace(/\+/g, " "),
        );
        const docId: string = req.query.docId || `${org}_${adoProject}_workitems`;
        const fromDate: string = req.query.fromDate || "";
        const toDate: string = req.query.toDate || "";

        const rawOpenBugStates: string = req.query.openBugStates || "";
        const openBugStates: string[] = rawOpenBugStates
            ? rawOpenBugStates
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [];

        if (!org || !adoProject) {
            return res.status(400).json({
                error: `Missing required params. org="${org}" adoProject="${adoProject}"`,
            });
        }

        let workItemsHeaders: Record<string, string>;
        try {
            workItemsHeaders = getWorkItemsHeaders(req);
        } catch (_) {
            return res.status(401).json({ error: "NO_PAT" });
        }

        const dateOnly = (iso: string) => iso.split("T")[0];


        const wiqlCreatedDateFilter = fromDate
            ? ` AND [System.CreatedDate] >= '${dateOnly(fromDate)}'${toDate && toDate !== "now"
                ? ` AND [System.CreatedDate] <= '${dateOnly(toDate)}'`
                : ""
            }`
            : "";


        const wiqlClosedDateFilter = fromDate
            ? ` AND [Microsoft.VSTS.Common.ClosedDate] >= '${dateOnly(fromDate)}'${toDate && toDate !== "now"
                ? ` AND [Microsoft.VSTS.Common.ClosedDate] <= '${dateOnly(toDate)}'`
                : ""
            }`
            : "";

        const workItemsBase = `https://dev.azure.com/${workItemsOrg}/${encodeURIComponent(adoProject)}`;

        console.log(
            `[collectWorkItems] org=${workItemsOrg} project=${adoProject} fromDate=${fromDate || "all"}`,
        );



        let bugCount = 0;
        let bugsOpen = 0;

        const bugRes = await axios.post(
            `${workItemsBase}/_apis/wit/wiql?api-version=7.1`,
            {
                query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND [System.WorkItemType] = 'Bug'${wiqlCreatedDateFilter}`,
            },
            { headers: workItemsHeaders },
        );
        bugCount = (bugRes.data.workItems || []).length;


        const openStateFilter = buildOpenBugStateFilter(openBugStates);
        const openBugRes = await axios.post(
            `${workItemsBase}/_apis/wit/wiql?api-version=7.1`,
            {
                query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND [System.WorkItemType] = 'Bug'${wiqlCreatedDateFilter}${openStateFilter}`,
            },
            { headers: workItemsHeaders },
        );
        bugsOpen = (openBugRes.data.workItems || []).length;




        let storiesCompleted = 0;
        let tasksCompleted = 0;
        let avgCycleTimeDays = 0;
        let _totalCycleDays = 0;
        let _cycleCount = 0;
        const workItemsByDev: Record<string, any> = {};

        const allItemsRes = await axios.post(
            `${workItemsBase}/_apis/wit/wiql?api-version=7.1`,
            {
                query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND ([System.WorkItemType] = 'User Story' OR [System.WorkItemType] = 'Task' OR [System.WorkItemType] = 'Bug') AND ([System.State] = 'Closed' OR [System.State] = 'Done' OR [System.State] = 'Resolved')${wiqlClosedDateFilter} ORDER BY [Microsoft.VSTS.Common.ClosedDate] DESC`,
            },
            { headers: workItemsHeaders },
        );
        const allItemIds: any[] = allItemsRes.data.workItems || [];
        console.log(
            `[collectWorkItems] bugs=${bugCount} open=${bugsOpen} closedItems=${allItemIds.length}`,
        );

        for (let i = 0; i < allItemIds.length; i += 200) {
            const batchIds = allItemIds
                .slice(i, i + 200)
                .map((w: any) => w.id)
                .join(",");
            try {
                const detailRes = await axios.get(
                    `${workItemsBase}/_apis/wit/workitems?ids=${batchIds}&fields=System.Id,System.WorkItemType,System.AssignedTo,System.CreatedDate,Microsoft.VSTS.Common.ClosedDate&api-version=7.1`,
                    { headers: workItemsHeaders },
                );
                for (const item of detailRes.data.value || []) {
                    const f = item.fields;
                    const assignee: string =
                        f["System.AssignedTo"]?.displayName || "Unassigned";
                    const workItemType: string = f["System.WorkItemType"] || "Unknown";
                    const created = f["System.CreatedDate"];
                    const closed = f["Microsoft.VSTS.Common.ClosedDate"];

                    if (!workItemsByDev[assignee])
                        workItemsByDev[assignee] = {
                            completed: 0,
                            totalCycleDays: 0,
                            bugs: 0,
                            stories: 0,
                            tasks: 0,
                        };

                    workItemsByDev[assignee].completed++;

                    if (workItemType === "Bug") {
                        workItemsByDev[assignee].bugs++;
                    } else if (workItemType === "User Story") {
                        workItemsByDev[assignee].stories++;
                        storiesCompleted++;
                    } else if (workItemType === "Task") {
                        workItemsByDev[assignee].tasks++;
                        tasksCompleted++;
                    }

                    if (created && closed) {
                        const days =
                            (new Date(closed).getTime() - new Date(created).getTime()) /
                            86400000;
                        _totalCycleDays += days;
                        _cycleCount++;
                        workItemsByDev[assignee].totalCycleDays += days;
                    }
                }
            } catch (e: any) {
                console.log("[collectWorkItems] batch error:", e?.message);
            }
        }

        if (_cycleCount > 0) {
            avgCycleTimeDays =
                Math.round((_totalCycleDays / _cycleCount) * 10) / 10;
        }

        const developerWorkItems = Object.entries(workItemsByDev).map(
            ([name, d]) => ({
                name,
                workItemsCompleted: d.completed,
                bugsFixed: d.bugs,
                storiesCompleted: d.stories,
                tasksCompleted: d.tasks,
                avgCycleDays:
                    d.completed > 0
                        ? Math.round((d.totalCycleDays / d.completed) * 10) / 10
                        : 0,
            }),
        );

        const payload = {
            bugCount,
            bugsOpen,
            storiesCompleted,
            tasksCompleted,
            avgCycleTimeDays,
            developerWorkItems,
            openBugStates,
            updatedAt: new Date(),
        };

        await db.collection("metrics").doc(docId).set(payload, { merge: true });
        console.log("[collectWorkItems] saved:", docId);

        return res.status(200).json({
            message: "work items updated",
            docId,
            summary: { bugCount, bugsOpen, storiesCompleted, tasksCompleted },
        });
    } catch (err: any) {
        console.error("[collectWorkItems] error:", err?.message || err);
        res.status(500).json({ error: String(err?.message || err) });
    }
}
