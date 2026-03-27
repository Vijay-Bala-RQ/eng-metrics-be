import { db } from "../services/firestore";
import { handleCors } from "../services/cors";
import { getGithubPRs, getGithubCommits } from "../services/github";
import axios from "axios";

function getPipelinesHeaders(req: any): Record<string, string> {
  const pat =
    req.headers["x-ado-pipelines-pat"] ||
    req.headers["x-ado-pat"] ||
    process.env.ADO_PAT;
  if (!pat) throw new Error("NO_PAT");
  return {
    Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

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

function getRepoHeaders(req: any): Record<string, string> {
  const pat =
    req.headers["x-ado-repo-pat"] ||
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

function safeStr(v: any): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

export default async function handler(req: any, res: any) {
  if (handleCors(req, res)) return;
  console.log(
    "[collectMetrics] method:",
    req.method,
    "query:",
    JSON.stringify(req.query),
  );

  try {
    const org: string = req.query.org || process.env.ADO_ORG || "";
    const workItemsOrg: string = (req.query.workItemsOrg as string) || org;
    const pipelinesOrg: string = (req.query.pipelinesOrg as string) || org;
    const rawAdoProject: string =
      req.query.adoProject || process.env.ADO_PROJECT || "";
    const adoProject: string = decodeURIComponent(
      rawAdoProject.replace(/\+/g, " "),
    );
    const rawReposAdoProject: string = (req.query.reposAdoProject as string) || rawAdoProject;
    const reposAdoProject: string = decodeURIComponent(
      rawReposAdoProject.replace(/\+/g, " "),
    );
    const rawPipelinesAdoProject: string = (req.query.pipelinesAdoProject as string) || rawAdoProject;
    const pipelinesAdoProject: string = decodeURIComponent(
      rawPipelinesAdoProject.replace(/\+/g, " "),
    );
    const repoId: string = (req.query.repoId || "").toString().trim();
    const pipelineId: string =
      req.query.pipelineId || process.env.ADO_PIPELINE || "";
    const docId: string = req.query.docId || `default_${repoId}_${pipelineId}`;
    const repoSource: string = req.query.repoSource || "azure";
    const githubFullName: string = req.query.githubFullName || "";
    const githubPat: string = (req.headers["x-github-pat"] as string) || "";
    const fromDate: string = req.query.fromDate || "";
    const toDate: string = req.query.toDate || "";

    const rawOpenBugStates: string = req.query.openBugStates || "";
    const openBugStates: string[] = rawOpenBugStates
      ? rawOpenBugStates
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
      : [];

    console.log(
      `[collectMetrics] repoSource=${repoSource} fromDate=${fromDate || "all"} toDate=${toDate || "now"} openBugStates=${openBugStates.join(",") || "default"}`,
    );

    const dateOnly = (iso: string) => iso.split("T")[0];

    const dateFilterPR = fromDate ? `&searchCriteria.minTime=${fromDate}` : "";
    const dateFilterCommit = fromDate
      ? `&searchCriteria.fromDate=${fromDate}`
      : "";
    const dateFilterBuild = fromDate ? `&minTime=${fromDate}` : "";
    const wiqlDateFilter = fromDate
      ? ` AND [System.CreatedDate] >= '${dateOnly(fromDate)}'${toDate && toDate !== "now" ? ` AND [System.CreatedDate] <= '${dateOnly(toDate)}'` : ""}`
      : "";

    if (repoSource === "github") {
      return await handleGithubRepo(req, res, {
        docId,
        githubFullName,
        githubPat,
        pipelineId,
        org,
        pipelinesOrg,
        workItemsOrg,
        adoProject,
        pipelinesAdoProject,
        fromDate,
        toDate,
        headers: req,
        openBugStates,
      });
    }

    if (!org || !adoProject) {
      return res
        .status(400)
        .json({
          error: `Missing params. org="${org}" adoProject="${adoProject}"`,
        });
    }

    const reposOrg: string = (req.query.reposOrg as string) || org;

    // Each PAT is optional — only throw if the specific feature is actually used.
    // Wrapping here prevents one missing PAT from blocking all other metrics.
    let pipelinesHeaders: Record<string, string>;
    let workItemsHeaders: Record<string, string>;
    let repoHeaders: Record<string, string>;
    try { pipelinesHeaders = getPipelinesHeaders(req); } catch (_) {
      try { pipelinesHeaders = getWorkItemsHeaders(req); } catch (_) {
        try { pipelinesHeaders = getRepoHeaders(req); } catch (_) {
          pipelinesHeaders = {};
        }
      }
    }
    try { workItemsHeaders = getWorkItemsHeaders(req); } catch (_) {
      try { workItemsHeaders = getPipelinesHeaders(req); } catch (_) {
        try { workItemsHeaders = getRepoHeaders(req); } catch (_) {
          workItemsHeaders = {};
        }
      }
    }
    try { repoHeaders = getRepoHeaders(req); } catch (_) {
      try { repoHeaders = getPipelinesHeaders(req); } catch (_) {
        try { repoHeaders = getWorkItemsHeaders(req); } catch (_) {
          repoHeaders = {};
        }
      }
    }

    const base = `https://dev.azure.com/${reposOrg}/${encodeURIComponent(reposAdoProject)}`;
    const workItemsBase = `https://dev.azure.com/${workItemsOrg}/${encodeURIComponent(adoProject)}`;
    const pipelinesBase = `https://dev.azure.com/${pipelinesOrg}/${encodeURIComponent(pipelinesAdoProject)}`;
    const gitNameToDisplay: Record<string, string> = {};

    if (repoId && repoId !== "none") {
      try {
        const memberRes = await axios.get(
          `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(adoProject)}/teams?api-version=7.1&$top=100`,
          { headers: repoHeaders },
        );
        const teams: any[] = memberRes.data.value || [];
        for (const team of teams) {
          try {
            let memberPage = 1;
            while (true) {
              const membersRes = await axios.get(
                `https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(adoProject)}/teams/${team.id}/members?api-version=7.1&$top=100&$skip=${(memberPage - 1) * 100}`,
                { headers: repoHeaders },
              );
              const members: any[] = membersRes.data.value || [];
              for (const m of members) {
                const displayName: string = m.identity?.displayName || "";
                const uniqueName: string = m.identity?.uniqueName || "";
                if (!displayName) continue;
                const parts = uniqueName.split("\\");
                const shortName = parts[parts.length - 1];
                const emailLocal = uniqueName.includes("@")
                  ? uniqueName.split("@")[0]
                  : shortName;
                for (const key of [
                  displayName,
                  displayName.toLowerCase(),
                  uniqueName,
                  uniqueName.toLowerCase(),
                  shortName,
                  shortName.toLowerCase(),
                  emailLocal,
                  emailLocal.toLowerCase(),
                ]) {
                  if (key) gitNameToDisplay[key] = displayName;
                }
              }
              if (members.length < 100) break;
              memberPage++;
            }
          } catch (e) { }
        }
      } catch (e: any) {
        console.log("[collectMetrics] teams error:", e?.message);
      }
    }

    const resolveToDisplay = (raw: string): string =>
      gitNameToDisplay[raw] ||
      gitNameToDisplay[raw.toLowerCase()] ||
      gitNameToDisplay[raw.split("@")[0]] ||
      gitNameToDisplay[raw.split("@")[0]?.toLowerCase()] ||
      raw;

    try {
      const aliasDoc = await db.collection("config").doc("nameAliases").get();
      if (aliasDoc.exists) {
        const aliasData = aliasDoc.data() || {};
        for (const [displayName, gitNames] of Object.entries(aliasData)) {
          for (const gitName of gitNames as string[]) {
            gitNameToDisplay[gitName] = displayName;
            gitNameToDisplay[gitName.toLowerCase()] = displayName;
          }
        }
      }
    } catch (e: any) {
      console.log("[collectMetrics] alias load error:", e?.message);
    }

    let avgReviewTimeHours = 0,
      prCount = 0,
      avgCommentsPerPr = 0,
      avgPrPickupHours = 0,
      totalPrComments = 0;
    const prLog: any[] = [];
    const developerPrMap: Record<string, any> = {};

    if (repoId && repoId !== "none") {
      try {
        const [completedRes, activeRes] = await Promise.all([
          axios.get(
            `${base}/_apis/git/repositories/${repoId}/pullrequests?searchCriteria.status=completed&$top=500${dateFilterPR}&api-version=7.1`,
            { headers: repoHeaders },
          ),
          axios.get(
            `${base}/_apis/git/repositories/${repoId}/pullrequests?searchCriteria.status=active&$top=100&api-version=7.1`,
            { headers: repoHeaders },
          ).catch(() => ({ data: { value: [] } })),
        ]);

        const completedPRs: any[] = completedRes.data.value || [];
        const activePRs: any[] = activeRes.data.value || [];
        const prs = [...completedPRs, ...activePRs];
        prCount = completedPRs.length;
        console.log(`[collectMetrics] PRs: completed=${completedPRs.length} active=${activePRs.length}`);
        let totalHours = 0,
          totalComments = 0,
          totalPickupHours = 0,
          pickupCount = 0;
        for (const pr of prs) {
          const isActive = pr.status === "active";
          const created = new Date(pr.creationDate).getTime();
          let hrs = 0;
          if (pr.closedDate) {
            hrs = (new Date(pr.closedDate).getTime() - created) / 3600000;
            totalHours += hrs;
          }
          const author: string = resolveToDisplay(
            pr.createdBy?.displayName || "Unknown",
          );
          if (!developerPrMap[author])
            developerPrMap[author] = {
              prCount: 0,
              totalReviewHours: 0,
              comments: 0,
            };
          if (!isActive) {
            developerPrMap[author].prCount++;
            developerPrMap[author].totalReviewHours += hrs;
          }
          let commentCount = 0,
            firstCommentTime: number | null = null;
          try {
            const threadRes = await axios.get(
              `${base}/_apis/git/repositories/${repoId}/pullRequests/${pr.pullRequestId}/threads?api-version=7.1`,
              { headers: repoHeaders },
            );
            for (const t of threadRes.data.value || []) {
              if (t.isDeleted || !t.comments?.length) continue;
              commentCount++;
              const firstComment = t.comments[0];
              const ct = new Date(
                firstComment?.publishedDate || t.publishedDate,
              ).getTime();
              if (!isNaN(ct) && firstComment?.author?.id !== pr.createdBy?.id) {
                if (firstCommentTime === null || ct < firstCommentTime)
                  firstCommentTime = ct;
              }
            }
            totalComments += commentCount;
          } catch (e) { }
          if (firstCommentTime !== null) {
            totalPickupHours += (firstCommentTime - created) / 3600000;
            pickupCount++;
          }
          developerPrMap[author].comments += commentCount;
          prLog.push({
            id: pr.pullRequestId,
            title: pr.title,
            status: isActive ? "active" : pr.status,
            author,
            reviewTimeHours: pr.closedDate ? Math.round(hrs * 10) / 10 : null,
            comments: commentCount,
            createdDate: pr.creationDate,
            closedDate: pr.closedDate || null,
            isDraft: pr.isDraft || false,
            targetBranch: pr.targetRefName?.replace("refs/heads/", "") || "",
          });
        }
        if (prCount > 0 && totalHours > 0)
          avgReviewTimeHours = Math.round((totalHours / prCount) * 10) / 10;
        if (prCount > 0) {
          avgCommentsPerPr = Math.round(totalComments / prCount);
          totalPrComments = totalComments;
        }
        if (pickupCount > 0)
          avgPrPickupHours =
            Math.round((totalPickupHours / pickupCount) * 10) / 10;
      } catch (e: any) {
        console.log("[collectMetrics] PR error:", e?.message);
      }
    }

    let totalCommits = 0,
      uniqueContributors = 0;
    const commitsByAuthor: Record<string, number> = {};

    if (repoId && repoId !== "none") {
      try {
        const commitRes = await axios.get(
          `${base}/_apis/git/repositories/${repoId}/commits?$top=5000${dateFilterCommit}&api-version=7.1`,
          { headers: repoHeaders },
        );
        const commits: any[] = commitRes.data.value || [];
        totalCommits = commits.length;
        for (const c of commits) {
          const rawName: string =
            c.author?.name || c.committer?.name || "Unknown";
          const email: string = c.author?.email || c.committer?.email || "";
          const emailLocal = email ? email.split("@")[0] : "";
          const resolved =
            resolveToDisplay(rawName) ||
            (emailLocal ? resolveToDisplay(emailLocal) : rawName);
          commitsByAuthor[resolved] = (commitsByAuthor[resolved] || 0) + 1;
        }
        uniqueContributors = Object.keys(commitsByAuthor).length;
      } catch (e: any) {
        console.log("[collectMetrics] commit error:", e?.message);
      }
    }

    let successRate = 0,
      avgBuildTime = 0,
      coverage: number | null = null;
    let longestBuildMins = 0,
      shortestBuildMins = Infinity;
    let avgTestExecutionMins: number | null = null;
    const buildLog: any[] = [];
    const buildsByResult: Record<string, number> = {};

    if (pipelineId && pipelineId !== "none") {
      try {
        const buildRes = await axios.get(
          `${pipelinesBase}/_apis/build/builds?definitions=${pipelineId}&$top=50${dateFilterBuild}&api-version=7.1`,
          { headers: pipelinesHeaders },
        );
        const builds: any[] = buildRes.data.value || [];
        console.log(`[collectMetrics] Builds: ${builds.length}`);
        let totalTime = 0,
          success = 0;
        for (const b of builds) {
          const result = b.result || "unknown";
          buildsByResult[result] = (buildsByResult[result] || 0) + 1;
          if (result === "succeeded") success++;
          let durationMins = 0;
          if (b.startTime && b.finishTime) {
            durationMins =
              (new Date(b.finishTime).getTime() -
                new Date(b.startTime).getTime()) /
              60000;
            // Only use successful builds for time-based metrics so cancelled/failed
            // runs don't skew average, fastest, and slowest build times.
            if (result === "succeeded") {
              totalTime += durationMins;
              if (durationMins > longestBuildMins)
                longestBuildMins = durationMins;
              if (durationMins < shortestBuildMins)
                shortestBuildMins = durationMins;
            }
          }
          buildLog.push({
            id: b.id,
            buildNumber: b.buildNumber,
            result,
            status: b.status,
            startTime: safeStr(b.startTime),
            finishTime: safeStr(b.finishTime),
            durationMins: Math.round(durationMins * 10) / 10,
            requestedBy: b.requestedBy?.displayName || "",
            sourceBranch: b.sourceBranch?.replace("refs/heads/", "") || "",
            reason: b.reason || "",
            stages: [],
            testExecutionMins: null,
          });
        }
        if (builds.length > 0) {
          successRate = Math.round((success / builds.length) * 100);
          avgBuildTime = success > 0 ? Math.round((totalTime / success) * 10) / 10 : 0;
          if (shortestBuildMins === Infinity) shortestBuildMins = 0;
        }

        let totalTestMins = 0,
          testBuildCount = 0;
        for (let i = 0; i < buildLog.length; i++) {
          const buildEntry = buildLog[i];
          try {
            const tlRes = await axios.get(
              `${pipelinesBase}/_apis/build/builds/${buildEntry.id}/timeline?api-version=7.1`,
              { headers: pipelinesHeaders },
            );
            const records: any[] = tlRes.data.records || [];
            buildEntry.stages = records
              .filter(
                (r: any) =>
                  r.type === "Stage" || r.type === "Phase" || r.type === "Job",
              )
              .map((r: any) => ({
                name: r.name,
                state: r.state,
                result: r.result,
                durationSecs:
                  r.startTime && r.finishTime
                    ? (new Date(r.finishTime).getTime() -
                      new Date(r.startTime).getTime()) /
                    1000
                    : null,
              }));
            const testStage = records.find(
              (r: any) =>
                r.startTime &&
                r.finishTime &&
                (/test/i.test(r.name) ||
                  (r.type === "Task" &&
                    /VsTest|DotNetCoreCLI|Maven|Gradle|pytest|jest|mocha|xunit|nunit/i.test(
                      r.task?.name || "",
                    ))),
            );
            if (testStage && testStage.startTime && testStage.finishTime) {
              const testMins =
                (new Date(testStage.finishTime).getTime() -
                  new Date(testStage.startTime).getTime()) /
                60000;
              buildEntry.testExecutionMins = Math.round(testMins * 10) / 10;
              totalTestMins += testMins;
              testBuildCount++;
            } else {
              const testRun = await fetchTestRunForBuild(
                buildEntry.id,
                pipelinesBase,
                pipelinesHeaders,
              );
              if (testRun !== null) {
                buildEntry.testExecutionMins = testRun;
                totalTestMins += testRun;
                testBuildCount++;
              }
            }
          } catch (e) { }
        }
        if (testBuildCount > 0)
          avgTestExecutionMins =
            Math.round((totalTestMins / testBuildCount) * 10) / 10;

        for (const b of builds.slice(0, 5)) {
          try {
            const covRes = await axios.get(
              `${pipelinesBase}/_apis/test/codecoverage?buildId=${b.id}&api-version=7.1-preview.1`,
              { headers: pipelinesHeaders },
            );
            for (const stat of covRes.data?.coverageData?.[0]?.coverageStats ||
              []) {
              if (stat.label === "Lines" && stat.total > 0) {
                coverage = Math.round((stat.covered / stat.total) * 100);
                break;
              }
            }
            if (coverage !== null) break;
          } catch (e) { }
        }
      } catch (e: any) {
        console.log("[collectMetrics] build error:", e?.message);
      }
    }

    let bugCount = 0,
      bugsOpen = 0,
      storiesCompleted = 0,
      tasksCompleted = 0,
      avgCycleTimeDays = 0;
    let _totalCycleDaysAll = 0, _cycleCountAll = 0;
    const workItemsByDev: Record<string, any> = {};

    try {
      const bugRes = await axios.post(
        `${workItemsBase}/_apis/wit/wiql?api-version=7.1`,
        {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND [System.WorkItemType] = 'Bug'${wiqlDateFilter}`,
        },
        { headers: workItemsHeaders },
      );
      bugCount = (bugRes.data.workItems || []).length;

      const openStateFilter = buildOpenBugStateFilter(openBugStates);
      const openBugRes = await axios.post(
        `${workItemsBase}/_apis/wit/wiql?api-version=7.1`,
        {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND [System.WorkItemType] = 'Bug'${openStateFilter}${wiqlDateFilter}`,
        },
        { headers: workItemsHeaders },
      );
      bugsOpen = (openBugRes.data.workItems || []).length;

      const allItemsRes = await axios.post(
        `${workItemsBase}/_apis/wit/wiql?api-version=7.1`,
        {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND ([System.WorkItemType] = 'User Story' OR [System.WorkItemType] = 'Task' OR [System.WorkItemType] = 'Bug') AND ([System.State] = 'Closed' OR [System.State] = 'Done' OR [System.State] = 'Resolved')${wiqlDateFilter} ORDER BY [Microsoft.VSTS.Common.ClosedDate] DESC`,
        },
        { headers: workItemsHeaders },
      );
      const allItemIds: any[] = allItemsRes.data.workItems || [];
      console.log(
        `[collectMetrics] Work items: bugs=${bugCount} open=${bugsOpen} closedItems=${allItemIds.length}`,
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
            const rawAssignee: string =
              f["System.AssignedTo"]?.displayName || "Unassigned";
            const assignee = resolveToDisplay(rawAssignee);
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
            if (workItemType === "Bug") workItemsByDev[assignee].bugs++;
            else if (workItemType === "User Story") {
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
              _totalCycleDaysAll += days;
              _cycleCountAll++;
              workItemsByDev[assignee].totalCycleDays += days;
            }
          }
          if (_cycleCountAll > 0)
            avgCycleTimeDays =
              Math.round((_totalCycleDaysAll / _cycleCountAll) * 10) / 10;
        } catch (e: any) {
          console.log("[collectMetrics] work items batch error:", e?.message);
        }
      }
    } catch (e: any) {
      console.log("[collectMetrics] work items error:", e?.message);
    }

    const mergedDevs: Record<string, any> = {};
    const resolveKey = (raw: string): string =>
      gitNameToDisplay[raw] || gitNameToDisplay[raw.toLowerCase()] || raw;

    for (const [k, v] of Object.entries(developerPrMap)) {
      const n = resolveKey(k);
      if (!mergedDevs[n])
        mergedDevs[n] = {
          prCount: 0,
          totalReviewHours: 0,
          comments: 0,
          commits: 0,
          completed: 0,
          totalCycleDays: 0,
          bugs: 0,
          stories: 0,
          tasks: 0,
        };
      mergedDevs[n].prCount += v.prCount;
      mergedDevs[n].totalReviewHours += v.totalReviewHours;
      mergedDevs[n].comments += v.comments;
    }
    for (const [k, v] of Object.entries(commitsByAuthor)) {
      const n = resolveKey(k);
      if (!mergedDevs[n])
        mergedDevs[n] = {
          prCount: 0,
          totalReviewHours: 0,
          comments: 0,
          commits: 0,
          completed: 0,
          totalCycleDays: 0,
          bugs: 0,
          stories: 0,
          tasks: 0,
        };
      mergedDevs[n].commits += v as number;
    }
    for (const [k, v] of Object.entries(workItemsByDev)) {
      const n = resolveKey(k);
      if (!mergedDevs[n])
        mergedDevs[n] = {
          prCount: 0,
          totalReviewHours: 0,
          comments: 0,
          commits: 0,
          completed: 0,
          totalCycleDays: 0,
          bugs: 0,
          stories: 0,
          tasks: 0,
        };
      mergedDevs[n].completed += (v as any).completed;
      mergedDevs[n].totalCycleDays += (v as any).totalCycleDays;
      mergedDevs[n].bugs += (v as any).bugs;
      mergedDevs[n].stories += (v as any).stories;
      mergedDevs[n].tasks += (v as any).tasks;
    }

    const developerMetrics = Object.entries(mergedDevs)
      .map(([name, d]) => ({
        name,
        prCount: d.prCount,
        avgPrReviewHours:
          d.prCount > 0
            ? Math.round((d.totalReviewHours / d.prCount) * 10) / 10
            : 0,
        avgCommentsPer: d.prCount > 0 ? Math.round(d.comments / d.prCount) : 0,
        totalComments: d.comments,
        commits: d.commits,
        workItemsCompleted: d.completed,
        bugsFixed: d.bugs,
        storiesCompleted: d.stories,
        tasksCompleted: d.tasks,
        avgCycleDays:
          d.completed > 0
            ? Math.round((d.totalCycleDays / d.completed) * 10) / 10
            : 0,
      }))
      .sort(
        (a, b) =>
          b.commits +
          b.prCount +
          b.workItemsCompleted -
          (a.commits + a.prCount + a.workItemsCompleted),
      );

    const deploymentsLast30 = buildLog.filter(
      (b) =>
        b.result === "succeeded" &&
        b.startTime &&
        Date.now() - new Date(b.startTime).getTime() < 30 * 86400000,
    ).length;
    const deployFrequencyPerDay =
      Math.round((deploymentsLast30 / 30) * 100) / 100;

    const payload: any = {
      avgReviewTimeHours,
      prCount,
      avgCommentsPerPr,
      totalPrComments,
      avgPrPickupHours,
      successRate,
      avgBuildTime,
      coverage,
      bugCount,
      bugsOpen,
      totalCommits,
      uniqueContributors,
      commitsByAuthor,
      longestBuildMins: Math.round(longestBuildMins * 10) / 10,
      shortestBuildMins:
        shortestBuildMins === Infinity
          ? 0
          : Math.round(shortestBuildMins * 10) / 10,
      buildsByResult,
      storiesCompleted,
      tasksCompleted,
      avgCycleTimeDays,
      deploymentsLast30,
      deployFrequencyPerDay,
      buildLog,
      prLog,
      developerMetrics,
      openBugStates,
      updatedAt: new Date(),
    };

    if (avgTestExecutionMins !== null)
      payload.avgTestExecutionMins = avgTestExecutionMins;

    await db.collection("metrics").doc(docId).set(payload);
    console.log("[collectMetrics] saved:", docId);

    res.status(200).json({
      message: "metrics updated",
      docId,
      summary: {
        prCount,
        successRate,
        avgBuildTime,
        coverage,
        bugCount,
        bugsOpen,
        totalCommits,
        avgTestExecutionMins,
        developerCount: developerMetrics.length,
      },
    });
  } catch (err: any) {
    console.error("[collectMetrics] error:", err?.message || err);
    res.status(500).json({ error: String(err?.message || err) });
  }
}

async function fetchTestRunForBuild(
  buildId: number,
  base: string,
  headers: Record<string, string>,
): Promise<number | null> {
  try {
    const runsRes = await axios.get(
      `${base}/_apis/test/runs?buildId=${buildId}&api-version=7.1`,
      { headers },
    );
    const runs: any[] = runsRes.data.value || [];
    if (runs.length === 0) return null;
    let totalMins = 0,
      count = 0;
    for (const run of runs) {
      if (run.startedDate && run.completedDate) {
        const mins =
          (new Date(run.completedDate).getTime() -
            new Date(run.startedDate).getTime()) /
          60000;
        totalMins += mins;
        count++;
      }
    }
    if (count === 0) return null;
    return Math.round((totalMins / count) * 10) / 10;
  } catch (e) {
    return null;
  }
}

async function handleGithubRepo(
  req: any,
  res: any,
  opts: {
    docId: string;
    githubFullName: string;
    githubPat: string;
    pipelineId?: string;
    org?: string;
    pipelinesOrg?: string;
    workItemsOrg?: string;
    adoProject?: string;
    pipelinesAdoProject?: string;
    headers?: any;
    fromDate?: string;
    toDate?: string;
    openBugStates?: string[];
  },
) {
  const { docId, githubFullName, githubPat, pipelineId, fromDate, toDate } =
    opts;
  const org = opts.org || "";
  const pipelinesOrg = opts.pipelinesOrg || org;
  const workItemsOrg = opts.workItemsOrg || org;
  const adoProject = opts.adoProject
    ? decodeURIComponent(opts.adoProject.replace(/\+/g, " "))
    : "";
  const pipelinesAdoProject = opts.pipelinesAdoProject
    ? decodeURIComponent(opts.pipelinesAdoProject.replace(/\+/g, " "))
    : adoProject;
  const openBugStates = opts.openBugStates || [];

  let adoHeaders: Record<string, string> | null = null;
  if (org && adoProject && opts.headers) {
    try {
      adoHeaders = getPipelinesHeaders(opts.headers);
    } catch (_) {
      try {
        adoHeaders = getWorkItemsHeaders(opts.headers);
      } catch (_) {
        try {
          adoHeaders = getRepoHeaders(opts.headers);
        } catch (_) {
          adoHeaders = null;
        }
      }
    }
  }

  if (!githubFullName || !githubPat) {
    return res
      .status(400)
      .json({
        error: `GitHub repo requires githubFullName and x-github-pat. fullName="${githubFullName}"`,
      });
  }

  console.log(
    `[collectMetrics/github] fetching PRs+commits for ${githubFullName}`,
  );
  const [prs, commits] = await Promise.all([
    getGithubPRs(githubFullName, githubPat),
    getGithubCommits(githubFullName, githubPat),
  ]);
  console.log(
    `[collectMetrics/github] PRs=${prs.length} commits=${commits.length}`,
  );

  const fromMs = fromDate ? new Date(fromDate).getTime() : 0;
  const toMs =
    toDate && toDate !== "now" ? new Date(toDate).getTime() : Date.now();

  let totalReviewHours = 0;
  const prLog: any[] = [];
  const developerPrMap: Record<string, any> = {};

  for (const pr of prs) {
    const relevantDate = new Date(
      pr.merged_at || pr.closed_at || pr.created_at,
    ).getTime();
    if (fromMs && relevantDate < fromMs) continue;
    if (toMs && relevantDate > toMs) continue;
    const created = new Date(pr.created_at).getTime();
    const closedAt = pr.merged_at || pr.closed_at;
    const hrs = closedAt
      ? (new Date(closedAt).getTime() - created) / 3600000
      : (Date.now() - created) / 3600000;
    if (closedAt) totalReviewHours += hrs;
    const author: string = pr.user?.login || "Unknown";
    if (!developerPrMap[author])
      developerPrMap[author] = { prCount: 0, totalReviewHours: 0 };
    if (closedAt) {
      developerPrMap[author].prCount++;
      developerPrMap[author].totalReviewHours += hrs;
    }
    prLog.push({
      id: pr.number,
      title: pr.title,
      author,
      reviewTimeHours: closedAt ? Math.round(hrs * 10) / 10 : null,
      comments: (pr.comments || 0) + (pr.review_comments || 0),
      createdDate: pr.created_at,
      closedDate: closedAt || null,
      targetBranch: pr.base?.ref || "",
      status: pr.merged_at ? "merged" : closedAt ? "closed" : "open",
    });
  }

  const closedPrCount = prLog.filter((p) => p.closedDate !== null).length;
  const avgReviewTimeHours =
    closedPrCount > 0
      ? Math.round((totalReviewHours / closedPrCount) * 10) / 10
      : 0;
  const totalPrComments = prLog.reduce(
    (sum, pr) => sum + (pr.comments || 0),
    0,
  );

  const commitsByAuthor: Record<string, number> = {};
  for (const c of commits) {
    const commitDate = new Date(
      c.commit?.author?.date || c.commit?.committer?.date || 0,
    ).getTime();
    if (fromMs && commitDate < fromMs) continue;
    if (toMs && commitDate > toMs) continue;
    const author: string =
      c.author?.login || c.commit?.author?.name || "Unknown";
    commitsByAuthor[author] = (commitsByAuthor[author] || 0) + 1;
  }

  let successRate = 0,
    avgBuildTime = 0,
    coverage: number | null = null;
  let longestBuildMins = 0,
    shortestBuildMins = Infinity;
  let avgTestExecutionMins: number | null = null;
  const buildLog: any[] = [];
  const buildsByResult: Record<string, number> = {};
  let deploymentsLast30 = 0,
    deployFrequencyPerDay = 0;

  if (pipelineId && pipelineId !== "none" && adoHeaders && pipelinesOrg && pipelinesAdoProject) {
    const adoBase = `https://dev.azure.com/${pipelinesOrg}/${encodeURIComponent(pipelinesAdoProject)}`;
    try {
      const buildRes = await axios.get(
        `${adoBase}/_apis/build/builds?definitions=${pipelineId}&$top=50${fromDate ? `&minTime=${fromDate}` : ""}&api-version=7.1`,
        { headers: adoHeaders },
      );
      const builds: any[] = buildRes.data.value || [];
      let totalTime = 0,
        success = 0;
      for (const b of builds) {
        const result = b.result || "unknown";
        buildsByResult[result] = (buildsByResult[result] || 0) + 1;
        if (result === "succeeded") success++;
        let durationMins = 0;
        if (b.startTime && b.finishTime) {
          durationMins =
            (new Date(b.finishTime).getTime() -
              new Date(b.startTime).getTime()) /
            60000;
          // Only use successful builds for time-based metrics.
          if (result === "succeeded") {
            totalTime += durationMins;
            if (durationMins > longestBuildMins) longestBuildMins = durationMins;
            if (durationMins < shortestBuildMins)
              shortestBuildMins = durationMins;
          }
        }
        buildLog.push({
          id: b.id,
          buildNumber: b.buildNumber,
          result,
          status: b.status,
          startTime: safeStr(b.startTime),
          finishTime: safeStr(b.finishTime),
          durationMins: Math.round(durationMins * 10) / 10,
          requestedBy: b.requestedBy?.displayName || "",
          sourceBranch: b.sourceBranch?.replace("refs/heads/", "") || "",
          reason: b.reason || "",
          stages: [],
          testExecutionMins: null,
        });
      }
      if (builds.length > 0) {
        successRate = Math.round((success / builds.length) * 100);
        avgBuildTime = success > 0 ? Math.round((totalTime / success) * 10) / 10 : 0;
        shortestBuildMins =
          shortestBuildMins === Infinity
            ? 0
            : Math.round(shortestBuildMins * 10) / 10;
        longestBuildMins = Math.round(longestBuildMins * 10) / 10;
      }

      let totalTestMins = 0,
        testBuildCount = 0;
      for (let i = 0; i < buildLog.length; i++) {
        const buildEntry = buildLog[i];
        try {
          const tlRes = await axios.get(
            `${adoBase}/_apis/build/builds/${buildEntry.id}/timeline?api-version=7.1`,
            { headers: adoHeaders },
          );
          const records: any[] = tlRes.data.records || [];
          buildEntry.stages = records
            .filter(
              (r: any) =>
                r.type === "Stage" || r.type === "Phase" || r.type === "Job",
            )
            .map((r: any) => ({
              name: r.name,
              state: r.state,
              result: r.result,
              durationSecs:
                r.startTime && r.finishTime
                  ? (new Date(r.finishTime).getTime() -
                    new Date(r.startTime).getTime()) /
                  1000
                  : null,
            }));
          const testStage = records.find(
            (r: any) =>
              r.startTime &&
              r.finishTime &&
              (/test/i.test(r.name) ||
                (r.type === "Task" &&
                  /VsTest|DotNetCoreCLI|Maven|Gradle|pytest|jest|mocha|xunit|nunit/i.test(
                    r.task?.name || "",
                  ))),
          );
          if (testStage && testStage.startTime && testStage.finishTime) {
            const testMins =
              (new Date(testStage.finishTime).getTime() -
                new Date(testStage.startTime).getTime()) /
              60000;
            buildEntry.testExecutionMins = Math.round(testMins * 10) / 10;
            totalTestMins += testMins;
            testBuildCount++;
          } else {
            const testRun = await fetchTestRunForBuild(
              buildEntry.id,
              adoBase,
              adoHeaders,
            );
            if (testRun !== null) {
              buildEntry.testExecutionMins = testRun;
              totalTestMins += testRun;
              testBuildCount++;
            }
          }
        } catch (e) { }
      }
      if (testBuildCount > 0)
        avgTestExecutionMins =
          Math.round((totalTestMins / testBuildCount) * 10) / 10;

      deploymentsLast30 = buildLog.filter(
        (b) =>
          b.result === "succeeded" &&
          b.startTime &&
          Date.now() - new Date(b.startTime).getTime() < 30 * 86400000,
      ).length;
      deployFrequencyPerDay = Math.round((deploymentsLast30 / 30) * 100) / 100;

      for (const b of builds.slice(0, 5)) {
        try {
          const covRes = await axios.get(
            `${adoBase}/_apis/test/codecoverage?buildId=${b.id}&api-version=7.1-preview.1`,
            { headers: adoHeaders },
          );
          for (const stat of covRes.data?.coverageData?.[0]?.coverageStats ||
            []) {
            if (stat.label === "Lines" && stat.total > 0) {
              coverage = Math.round((stat.covered / stat.total) * 100);
              break;
            }
          }
          if (coverage !== null) break;
        } catch (e) { }
      }
    } catch (e: any) {
      console.log("[collectMetrics/github] ADO pipeline error:", e?.message);
    }
  }

  let bugCount = 0,
    bugsOpen = 0,
    storiesCompleted = 0,
    tasksCompleted = 0,
    avgCycleTimeDays = 0;

  if (adoHeaders && workItemsOrg && adoProject) {
    const adoBase = `https://dev.azure.com/${workItemsOrg}/${encodeURIComponent(adoProject)}`;
    const wiqlDateFilter = fromDate
      ? ` AND [System.CreatedDate] >= '${fromDate.split("T")[0]}'${toDate && toDate !== "now" ? ` AND [System.CreatedDate] <= '${toDate.split("T")[0]}'` : ""}`
      : "";
    let workItemsHeaders: Record<string, string>;
    try {
      workItemsHeaders = getWorkItemsHeaders(opts.headers);
    } catch (_) {
      workItemsHeaders = adoHeaders;
    }

    try {
      const bugRes = await axios.post(
        `${adoBase}/_apis/wit/wiql?api-version=7.1`,
        {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND [System.WorkItemType] = 'Bug'${wiqlDateFilter}`,
        },
        { headers: workItemsHeaders },
      );
      bugCount = (bugRes.data.workItems || []).length;

      const openStateFilter = buildOpenBugStateFilter(openBugStates);
      const openBugRes = await axios.post(
        `${adoBase}/_apis/wit/wiql?api-version=7.1`,
        {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND [System.WorkItemType] = 'Bug'${openStateFilter}${wiqlDateFilter}`,
        },
        { headers: workItemsHeaders },
      );
      bugsOpen = (openBugRes.data.workItems || []).length;

      const allItemsRes = await axios.post(
        `${adoBase}/_apis/wit/wiql?api-version=7.1`,
        {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${adoProject}' AND ([System.WorkItemType] = 'User Story' OR [System.WorkItemType] = 'Task' OR [System.WorkItemType] = 'Bug') AND ([System.State] = 'Closed' OR [System.State] = 'Done' OR [System.State] = 'Resolved')${wiqlDateFilter}`,
        },
        { headers: workItemsHeaders },
      );
      const allItemIds: any[] = allItemsRes.data.workItems || [];
      const workItemsByDev: Record<string, any> = {};
      let _ghTotalCycleDays = 0, _ghCycleCount = 0;
      for (let i = 0; i < allItemIds.length; i += 200) {
        const batchIds = allItemIds
          .slice(i, i + 200)
          .map((w: any) => w.id)
          .join(",");
        try {
          const detailRes = await axios.get(
            `${adoBase}/_apis/wit/workitems?ids=${batchIds}&fields=System.Id,System.WorkItemType,System.AssignedTo,System.CreatedDate,Microsoft.VSTS.Common.ClosedDate&api-version=7.1`,
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
            if (workItemType === "Bug") workItemsByDev[assignee].bugs++;
            else if (workItemType === "User Story") {
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
              _ghTotalCycleDays += days;
              _ghCycleCount++;
              workItemsByDev[assignee].totalCycleDays += days;
            }
          }
          if (_ghCycleCount > 0)
            avgCycleTimeDays =
              Math.round((_ghTotalCycleDays / _ghCycleCount) * 10) / 10;
        } catch (e) { }
      }
      console.log(
        `[collectMetrics/github] work items: bugs=${bugCount} open=${bugsOpen}`,
      );
    } catch (e: any) {
      console.log("[collectMetrics/github] work items error:", e?.message);
    }
  }

  const mergedDevs: Record<string, any> = {};
  for (const [k, v] of Object.entries(developerPrMap)) {
    if (!mergedDevs[k])
      mergedDevs[k] = { prCount: 0, totalReviewHours: 0, commits: 0, workItemsCompleted: 0, bugsFixed: 0, storiesCompleted: 0, tasksCompleted: 0, avgCycleDays: 0 };
    mergedDevs[k].prCount += v.prCount;
    mergedDevs[k].totalReviewHours += v.totalReviewHours;
  }
  for (const [k, v] of Object.entries(commitsByAuthor)) {
    if (!mergedDevs[k])
      mergedDevs[k] = { prCount: 0, totalReviewHours: 0, commits: 0, workItemsCompleted: 0, bugsFixed: 0, storiesCompleted: 0, tasksCompleted: 0, avgCycleDays: 0 };
    mergedDevs[k].commits += v as number;
  }

  const developerMetrics = Object.entries(mergedDevs)
    .map(([name, d]) => ({
      name,
      prCount: d.prCount,
      avgPrReviewHours:
        d.prCount > 0
          ? Math.round((d.totalReviewHours / d.prCount) * 10) / 10
          : 0,
      avgCommentsPer: 0,
      totalComments: 0,
      commits: d.commits,
      workItemsCompleted: d.workItemsCompleted || 0,
      bugsFixed: d.bugsFixed || 0,
      storiesCompleted: d.storiesCompleted || 0,
      tasksCompleted: d.tasksCompleted || 0,
      avgCycleDays: d.avgCycleDays || 0,
    }))
    .sort((a, b) => b.commits + b.prCount - (a.commits + a.prCount));

  const payload: any = {
    prCount: closedPrCount,
    avgReviewTimeHours,
    avgCommentsPerPr: closedPrCount > 0 ? Math.round(totalPrComments / closedPrCount) : 0,
    totalPrComments,
    avgPrPickupHours: 0,
    successRate,
    avgBuildTime,
    coverage,
    bugCount,
    bugsOpen,
    storiesCompleted,
    tasksCompleted,
    avgCycleTimeDays,
    totalCommits: Object.values(commitsByAuthor).reduce((a: number, b) => a + (b as number), 0),
    uniqueContributors: Object.keys(commitsByAuthor).length,
    commitsByAuthor,
    longestBuildMins,
    shortestBuildMins,
    buildsByResult,
    deploymentsLast30,
    deployFrequencyPerDay,
    buildLog,
    prLog,
    developerMetrics,
    openBugStates,
    updatedAt: new Date(),
    source: "github",
  };

  if (avgTestExecutionMins !== null)
    payload.avgTestExecutionMins = avgTestExecutionMins;

  await db.collection("metrics").doc(docId).set(payload);
  console.log(`[collectMetrics/github] saved: ${docId}`);
  return res.status(200).json({
    message: "github metrics updated",
    docId,
    summary: {
      prCount: closedPrCount,
      totalCommits: payload.totalCommits,
      builds: buildLog.length,
      avgTestExecutionMins,
    },
  });
}
