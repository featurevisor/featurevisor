// React server components cannot create a context, so this runs on the client.
"use client";

import * as React from "react";

/**
 * How hooks below a provider update. Not set, a hook renders again only when its
 * own value changes. `"every"` keeps the behaviour from before: hooks evaluate on
 * every render and refresh on every context and sticky change.
 */
export type FeaturevisorUpdates = "every";

export const UpdatesContext = React.createContext<FeaturevisorUpdates | undefined>(undefined);
