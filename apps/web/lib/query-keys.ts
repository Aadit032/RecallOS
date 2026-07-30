export const queryKeys = {
  documents: {
    all: ["documents"] as const,
    list: () => [...queryKeys.documents.all, "list"] as const,
  },
  chats: {
    all: ["chats"] as const,
    list: () => [...queryKeys.chats.all, "list"] as const,
    detail: (id: string) => [...queryKeys.chats.all, "detail", id] as const,
  },
  projects: {
    all: ["projects"] as const,
    list: () => [...queryKeys.projects.all, "list"] as const,
  },
  search: {
    all: ["search"] as const,
    results: (query: string, modality: string) =>
      [...queryKeys.search.all, query, modality] as const,
  },
  memories: {
    all: ["memories"] as const,
    list: () => [...queryKeys.memories.all, "list"] as const,
  },
  connectors: {
    all: ["connectors"] as const,
    list: () => [...queryKeys.connectors.all, "list"] as const,
  },
} as const
