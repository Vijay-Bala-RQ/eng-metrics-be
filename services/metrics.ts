export function calculateBuildMetrics(builds: any[]) {
  let totalTime = 0;
  let success = 0;

  for (const b of builds) {
    if (b.result === "succeeded") {
      success++;
    }

    if (b.startTime && b.finishTime) {
      const mins =
        (new Date(b.finishTime).getTime() - new Date(b.startTime).getTime()) /
        60000;

      totalTime += mins;
    }
  }

  const avgBuildTime = builds.length ? totalTime / builds.length : 0;

  const successRate = builds.length ? (success / builds.length) * 100 : 0;

  return {
    avgBuildTime,
    successRate,
  };
}
