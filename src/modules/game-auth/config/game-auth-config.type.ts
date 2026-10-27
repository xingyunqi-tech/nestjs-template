import ms from 'ms';

export type GameAuthConfig = {
  secret?: string;
  expires: ms.StringValue;
  refreshSecret?: string;
  refreshExpires: ms.StringValue;
};
