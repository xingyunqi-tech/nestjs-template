/** 导入包整体不可用，reason 为错误键 */
export class ImportPackageError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
