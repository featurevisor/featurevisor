import * as path from "path";

import { Dependencies } from "../dependencies";
import { setApiRoutes } from "./setApiRoutes";

const Fastify = require("fastify");
const fastifyStatic = require("@fastify/static");

export async function openGui(deps: Dependencies) {
  const { projectConfig } = deps;

  const guiPackagePath = path.dirname(require.resolve("@featurevisor/gui/package.json"));
  const guiDistPath = path.join(guiPackagePath, "dist");

  // server
  const fastify = Fastify({
    logger: true,
  });

  // static
  fastify.register(fastifyStatic, {
    root: guiDistPath,
    prefix: "/",
  });

  // /api routes
  setApiRoutes(deps, fastify);

  // run
  fastify.listen({ port: 3000 }, (err, address) => {
    if (err) {
      throw err;
    }

    console.log(`Server is now listening on ${address}`);
  });
}
