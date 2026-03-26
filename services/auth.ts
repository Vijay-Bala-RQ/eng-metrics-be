export function getAuthHeader(req: any) {
  const pat = req.headers["x-ado-pat"];

  if (!pat) {
    throw new Error("NO_PAT");
  }

  const encoded = Buffer.from(":" + pat).toString("base64");

  return {
    Authorization: `Basic ${encoded}`,
  };
}
