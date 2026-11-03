import type { Category } from './types.js';

export const guideStates = ['draft', 'published', 'archived'] as const;
export type GuideState = (typeof guideStates)[number];
export interface GuideSummary {
  id: string;
  title: string;
  summary: string;
  category: Category;
  state: GuideState;
  version: number;
  updatedAt: string;
}
export interface KnowledgeGuide extends GuideSummary {
  body: string;
}
export interface GuideInput {
  title: string;
  summary: string;
  category: Category;
  body: string;
}
export interface GuidePage {
  guides: GuideSummary[];
  total: number;
  page: number;
  pages: number;
}
export interface GuideEvent {
  version: number;
  action: 'created' | 'edited' | 'state_changed';
  state: GuideState;
  actorName: string;
  createdAt: string;
}
