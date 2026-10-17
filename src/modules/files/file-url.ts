import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fileConfig from './config/file.config';
import { FileConfig, FileDriver } from './config/file-config.type';
import { createS3Client } from './config/s3-client.factory';
import { FileVisibility } from './domain/file-visibility';
import { AppConfig } from '../../config/app-config.type';
import appConfig from '../../config/app.config';

export const SIGNED_URL_EXPIRES_IN = 3600;

let signingClient: S3Client | undefined;

function getSigningClient(config: FileConfig): S3Client {
  signingClient ??= createS3Client(config);
  return signingClient;
}

export function privateFileApiPath(id: string): string {
  const { apiPrefix } = appConfig() as AppConfig;
  return `/${apiPrefix}/v1/files/private/${id}`;
}

export function buildFileUrl(file: {
  id: string;
  path: string;
  visibility?: FileVisibility;
}): string | Promise<string> {
  const config = fileConfig() as FileConfig;
  if (config.driver === FileDriver.LOCAL) {
    const { backendDomain } = appConfig() as AppConfig;
    return backendDomain + (file.visibility === FileVisibility.PRIVATE ? privateFileApiPath(file.id) : file.path);
  }
  if ([FileDriver.S3_PRESIGNED, FileDriver.S3].includes(config.driver)) {
    const command = new GetObjectCommand({
      Bucket: config.awsDefaultS3Bucket ?? '',
      Key: file.path,
    });
    return getSignedUrl(getSigningClient(config), command, { expiresIn: SIGNED_URL_EXPIRES_IN });
  }
  return file.path;
}
