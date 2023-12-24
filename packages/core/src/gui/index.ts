import * as path from "path";

import { Dependencies } from "../dependencies";
import { setApiRoutes } from "./setApiRoutes";

const express = require("express");

export async function openGui(deps: Dependencies) {
  const guiPackagePath = path.dirname(require.resolve("@featurevisor/gui/package.json"));
  const guiDistPath = path.join(guiPackagePath, "dist");

  const app = express();

  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.use(express.json());

  // routes
  setApiRoutes(deps, app);
  app.use(express.static(guiDistPath));

  // run
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`GUI running at http://localhost:${port}`);
  });
}
