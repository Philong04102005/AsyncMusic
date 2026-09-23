import Fastify from "fastify";
import { readConfig } from "./config";
import { buildServer, serverOptions } from "./build-server";
const config = readConfig();
const app = Fastify(serverOptions(config));
await buildServer(config, undefined, app);
await app.listen({ port: config.PORT, host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
