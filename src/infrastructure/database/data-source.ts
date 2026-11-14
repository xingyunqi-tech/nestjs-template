import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DATABASE_CONSTANTS } from '../../common/constants/app.constants';
import { positiveInteger } from '../../common/utils/number.utils';

export const AppDataSource = new DataSource({
  type: process.env.DATABASE_TYPE,
  url: process.env.DATABASE_URL,
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT, 10) : 5432,
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  synchronize: process.env.DATABASE_SYNCHRONIZE === 'true',
  dropSchema: false,
  keepConnectionAlive: true,
  logging: process.env.NODE_ENV !== 'production',
  entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
  migrations: [
    process.env.NODE_ENV === 'production' ? __dirname + '/migrations/**/*.js' : __dirname + '/migrations/**/*{.ts,.js}',
  ],
  cli: {
    entitiesDir: 'src',

    subscribersDir: 'subscriber',
  },
  extra: {
    // based on https://node-postgres.com/api/pool
    // max connection pool size
    max: process.env.DATABASE_MAX_CONNECTIONS
      ? parseInt(process.env.DATABASE_MAX_CONNECTIONS, 10)
      : DATABASE_CONSTANTS.MAX_CONNECTIONS,
    connectionTimeoutMillis: positiveInteger(
      Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS),
      DATABASE_CONSTANTS.CONNECTION_TIMEOUT_MS,
    ),
    ssl:
      process.env.DATABASE_SSL_ENABLED === 'true'
        ? {
            rejectUnauthorized: process.env.DATABASE_REJECT_UNAUTHORIZED !== 'false',
            ca: process.env.DATABASE_CA ?? undefined,
            key: process.env.DATABASE_KEY ?? undefined,
            cert: process.env.DATABASE_CERT ?? undefined,
          }
        : undefined,
  },
} as DataSourceOptions);
