export function setCors(res: any) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        [
            "Content-Type",
            "Authorization",
            "x-ado-pat",
            "x-ado-pipelines-pat",
            "x-ado-workitems-pat",
            "x-ado-repo-pat",
            "x-github-pat",
        ].join(", ")
    );
    res.setHeader("Access-Control-Max-Age", "86400");
}

export function handleCors(req: any, res: any): boolean {
    setCors(res);
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return true;
    }
    return false;
}