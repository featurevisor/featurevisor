import { Navigate } from "react-router-dom";

import { useCatalog } from "../context/CatalogContext";
import { encodeRouteSegment } from "../entityTypes";

export function HomePage() {
  const { manifest } = useCatalog();

  if (!manifest.sets) {
    return <Navigate to="/features" replace />;
  }

  const firstSetKey = manifest.setKeys[0];

  return (
    <Navigate
      to={firstSetKey ? `/sets/${encodeRouteSegment(firstSetKey)}/features` : "/history"}
      replace
    />
  );
}
