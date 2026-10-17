import { Permission } from '../../../../../core/permissions/permission.enum';

export interface PermissionData {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export const EXAM_PREP_PERMISSIONS: PermissionData[] = [
  {
    id: Permission.PRACTICE_WRITE,
    name: 'Write Practice',
    description: 'Create practice sessions and submit answers',
    resource: 'practice',
    action: 'write',
  },
  { id: Permission.AI_CHAT, name: 'AI Chat', description: 'Chat with the AI tutor', resource: 'ai', action: 'chat' },
  {
    id: Permission.AI_GRADING,
    name: 'AI Grading',
    description: 'Submit answers for AI grading',
    resource: 'ai',
    action: 'grading',
  },
  {
    id: Permission.CONTENT_MANAGE,
    name: 'Manage Content',
    description: 'Manage exams, subjects, knowledge points, questions, papers and imports',
    resource: 'content',
    action: 'manage',
  },
  {
    id: Permission.CONTENT_REVIEW,
    name: 'Review Content',
    description: 'Review, publish and take down questions; handle errata and reports',
    resource: 'content',
    action: 'review',
  },
  {
    id: Permission.AI_GENERATE,
    name: 'AI Generate',
    description: 'Generate questions with AI',
    resource: 'ai',
    action: 'generate',
  },
  { id: Permission.AI_ADMIN, name: 'AI Admin', description: 'View AI usage and cost', resource: 'ai', action: 'admin' },
];
