import type { DatafileContent } from "@featurevisor/types";

import type { Dependencies } from "../dependencies";
import { resolveTargets } from "../targeting";
import { buildDatafile } from "./buildDatafile";
import { buildTargetDatafile } from "./buildProject";

export interface RuntimeDatafile {
  target?: string;
  datafile: DatafileContent;
}

export async function buildRuntimeDatafiles(
  deps: Dependencies,
  options: {
    environment: string | false;
    target?: string | string[];
    revision: string;
    inflate?: number;
  },
): Promise<RuntimeDatafile[]> {
  const { projectConfig, datasource } = deps;
  const existingState = await datasource.readState(options.environment);
  const targets = await resolveTargets(datasource, options.target, {
    defaultToAll: false,
    requireTargets: false,
  });

  if (targets.length === 0) {
    const datafile = await buildDatafile(
      projectConfig,
      datasource,
      {
        revision: options.revision,
        environment: options.environment,
        inflate: options.inflate,
      },
      existingState,
    );
    return [{ datafile }];
  }

  return Promise.all(
    targets.map(async (target) => ({
      target: target.key,
      datafile: await buildTargetDatafile({
        projectConfig,
        datasource,
        target,
        environment: options.environment,
        existingState,
        revision: options.revision,
        inflate: options.inflate,
      }),
    })),
  );
}
