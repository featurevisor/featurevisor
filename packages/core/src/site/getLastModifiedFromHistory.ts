import type { HistoryEntry, LastModified } from "@featurevisor/types";

export function getLastModifiedFromHistory(
  fullHistory: HistoryEntry[],
  type,
  key,
): LastModified | undefined {
  const lastModified = fullHistory.find((entry) => {
    return entry.entities.find((entity) => {
      return entity.type === type && entity.key === key;
    });
  });

  if (lastModified) {
    return {
      commit: lastModified.commit,
      timestamp: lastModified.timestamp,
      author: lastModified.author,
    };
  }
}
