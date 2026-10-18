export enum PracticeMode {
  CHAPTER = 'CHAPTER',
  RANDOM = 'RANDOM',
  TYPE = 'TYPE',
  SMART = 'SMART',
  DAILY = 'DAILY',
  WRONG = 'WRONG',
  FAVORITE = 'FAVORITE',
  MOCK = 'MOCK',
  MEMORIZE = 'MEMORIZE',
}

export function isImmediateMode(mode: PracticeMode): boolean {
  return mode !== PracticeMode.MOCK && mode !== PracticeMode.MEMORIZE;
}
