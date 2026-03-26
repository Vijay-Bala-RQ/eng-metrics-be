import axios from "axios";

export async function getPipelines(org: string, project: string, headers: any) {
  const projectName = decodeURIComponent(project.replace(/\+/g, " "));

  const url = `https://dev.azure.com/${org}/${encodeURIComponent(
    projectName,
  )}/_apis/build/definitions?api-version=7.1`;

  const res = await axios.get(url, {
    headers,
  });

  return res.data.value;
}
