import dotenv from "dotenv";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import app from "./app";
import { logger } from "./lib/logger";
import { attachMediaStreamServer } from "./services/mediaStreams";

// Resolve credentials relative to the API package so starting the server from
// the workspace root and from this package behave identically.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachMediaStreamServer(server);

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
