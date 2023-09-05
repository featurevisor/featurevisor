import * as React from "react";

import { isEnabledInAnyEnvironment, isEnabledInEnvironment } from "../utils";

interface EnvironmentDotProps {
  feature: any;
  className?: string;
  animate?: boolean;
}

export function EnvironmentDot(props: EnvironmentDotProps) {
  const enabledInProduction = isEnabledInEnvironment(props.feature, "production");

  if (enabledInProduction) {
    return (
      <div className={props.className || ""}>
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>

          <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500"></span>
        </span>
      </div>
    );
  }

  const enabledInOtherEnvironments = isEnabledInAnyEnvironment(props.feature);

  if (enabledInOtherEnvironments) {
    return (
      <div className={props.className || ""}>
        <span className="relative flex h-3 w-3">
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500"></span>
        </span>
      </div>
    );
  }

  return (
    <div className={props.className || ""}>
      <span className="relative flex h-3 w-3">
        <span className="relative inline-flex h-3 w-3 rounded-full bg-slate-300"></span>
      </span>
    </div>
  );
}
