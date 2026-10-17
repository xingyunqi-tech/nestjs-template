import { FilePurpose } from '../domain/file-purpose';

export enum FileDriver {
  LOCAL = 'local',
  S3 = 's3',
  S3_PRESIGNED = 's3-presigned',
}

export type FileConfig = {
  driver: FileDriver;
  accessKeyId?: string;
  secretAccessKey?: string;
  awsDefaultS3Bucket?: string;
  awsS3Region?: string;
  awsS3Endpoint?: string; // Custom endpoint for S3-compatible services (e.g., Aliyun OSS)
  /** 仅在配置了 awsS3Endpoint 时生效；MinIO 需要 true，阿里云 OSS 需要 false */
  awsS3ForcePathStyle: boolean;
  /** 各用途的大小上限（字节） */
  maxSizes: Record<FilePurpose, number>;
  maxFileSize: number;
};
