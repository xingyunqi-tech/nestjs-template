export enum PaperType {
  REAL = 'REAL',
  MOCK = 'MOCK',
  SPECIAL = 'SPECIAL',
  GENERATED = 'GENERATED',
}

export const CATALOG_PAPER_TYPES = [PaperType.REAL, PaperType.MOCK, PaperType.SPECIAL] as const;

export type CatalogPaperType = (typeof CATALOG_PAPER_TYPES)[number];
