import * as React from "react";

/** Sets the browser tab title, most specific part first, ending with the Catalog name. */
export function useDocumentTitle(...parts: Array<string | undefined | false>) {
  const title = [...parts.filter(Boolean), "Featurevisor Catalog"].join(" · ");

  React.useEffect(() => {
    document.title = title;
  }, [title]);
}
