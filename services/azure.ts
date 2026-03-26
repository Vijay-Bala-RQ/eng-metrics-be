import axios from "axios";

export async function getBuilds(
  org: string,
  project: string,
  pipelineId: number,
) {
  const pat = process.env.ADO_PAT as string;

  const auth = Buffer.from(":" + pat).toString("base64");

  const url =
    `https://dev.azure.com/${org}/${project}/_apis/build/builds` +
    `?definitions=${pipelineId}&$top=10&api-version=7.1`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  return res.data.value;
}
