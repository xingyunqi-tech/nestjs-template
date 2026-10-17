export enum ContentStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  OFFLINE = 'OFFLINE',
}

export const CONTENT_STATUS_SOURCES: Record<ContentStatus.PUBLISHED | ContentStatus.OFFLINE, ContentStatus[]> = {
  [ContentStatus.PUBLISHED]: [ContentStatus.DRAFT, ContentStatus.OFFLINE],
  [ContentStatus.OFFLINE]: [ContentStatus.PUBLISHED],
};
