import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const port = Number(process.env.PORT ?? 4173);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    if (
      !(
        name === "index.html" ||
        name === "favicon.svg" ||
        /^src\/[a-z-]+\.(js|css)$/.test(name)
      )
    ) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = await readFile(path.join(root, name));
    response.writeHead(200, {
      "Content-Type": types[path.extname(name)],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 400);
    response.end("Not found");
  }
});
server.on("error", (error) => {
  console.error(`서버 시작 실패: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Mars Valley · http://127.0.0.1:${server.address().port}`),
);
