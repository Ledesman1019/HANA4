/** Contratos entre el shell (barra superior) y sus endpoints /api/alerts y /api/search. */
export type AlertItem = { id: string; tone: "red" | "amber" | "blue"; title: string; detail: string; href: string };

export type SearchItem = { title: string; subtitle: string; href: string };
export type SearchGroup = { label: string; items: SearchItem[] };
