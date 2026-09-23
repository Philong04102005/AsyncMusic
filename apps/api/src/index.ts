import { readConfig } from "./config";
import { buildServer } from "./build-server";
const config = readConfig();
const { app } = await buildServer(config);
await app.listen({ port: config.PORT, host: "0.0.0.0" });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
