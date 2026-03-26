import axios from "axios";

export async function getProjects(org: string, headers: any) {
  const url = `https://dev.azure.com/${org}/_apis/projects?api-version=7.1`;

  const res = await axios.get(url, {
    headers,
  });

  return res.data.value;
}
