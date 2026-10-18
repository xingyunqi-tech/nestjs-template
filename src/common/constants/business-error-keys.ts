import { HttpStatus } from '@nestjs/common';

export const BUSINESS_ERRORS = {
  sessionTakenOver: HttpStatus.CONFLICT,
  sessionClosed: HttpStatus.CONFLICT,
  questionInMockInProgress: HttpStatus.CONFLICT,
  answerHidden: HttpStatus.FORBIDDEN,
  selfAssessmentNotAllowed: HttpStatus.CONFLICT,
  questionNotAccessible: HttpStatus.FORBIDDEN,
  noQuestionsAvailable: HttpStatus.UNPROCESSABLE_ENTITY,
  generateLimitExceeded: HttpStatus.TOO_MANY_REQUESTS,
  mockSessionBusy: HttpStatus.CONFLICT,
  paperRequired: HttpStatus.UNPROCESSABLE_ENTITY,
  reportNotAvailable: HttpStatus.CONFLICT,
  dailySessionCannotFinish: HttpStatus.CONFLICT,
  dailySessionCannotAbandon: HttpStatus.CONFLICT,
  aiUnavailable: HttpStatus.SERVICE_UNAVAILABLE,
  aiQuotaExceeded: HttpStatus.TOO_MANY_REQUESTS,
  aiRateLimited: HttpStatus.TOO_MANY_REQUESTS,
  aiConsentRequired: HttpStatus.FORBIDDEN,
  wechatBindingRequired: HttpStatus.FORBIDDEN,
  contentBlocked: HttpStatus.UNPROCESSABLE_ENTITY,
  errataInProgress: HttpStatus.CONFLICT,
  answerChangeNotAllowed: HttpStatus.UNPROCESSABLE_ENTITY,
} as const satisfies Record<string, HttpStatus>;

export type BusinessErrorKey = keyof typeof BUSINESS_ERRORS;

export const BUSINESS_ERROR_KEY_FIELD = 'errorKey';
