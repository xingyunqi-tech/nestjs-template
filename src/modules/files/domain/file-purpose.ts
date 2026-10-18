export enum FilePurpose {
  /** 头像、反馈、题目图片等公开图片 */
  IMAGE = 'image',
  /** 手写作答照片等仅本人可读的图片 */
  PRIVATE_IMAGE = 'private-image',
  /** 题目等内容素材图片，上传者不作为文件归属 */
  CONTENT_IMAGE = 'content-image',
  AUDIO = 'audio',
  IMPORT = 'import',
  EXPORT = 'export',
}
