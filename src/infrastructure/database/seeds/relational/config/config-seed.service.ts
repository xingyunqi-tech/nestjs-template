import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ConfigEntity } from '../../../../../modules/config/infrastructure/persistence/relational/entities/config.entity';
import { CONFIG_DEFINITIONS, ConfigDefinition } from '../../../../../modules/config/config-definitions';

/** 已存在的配置不覆盖 */
@Injectable()
export class ConfigSeedService {
  private readonly logger = new Logger(ConfigSeedService.name);

  constructor(
    @InjectRepository(ConfigEntity)
    private readonly repository: Repository<ConfigEntity>,
  ) {}

  async run(): Promise<void> {
    const definitions = (CONFIG_DEFINITIONS as readonly ConfigDefinition[]).filter(
      (definition) => definition.defaultValue !== undefined,
    );
    await this.repository
      .createQueryBuilder()
      .insert()
      .into(ConfigEntity)
      .values(
        definitions.map(
          (definition) =>
            ({
              key: definition.key,
              value: { value: definition.defaultValue },
              isPublic: definition.isPublic,
            }) as QueryDeepPartialEntity<ConfigEntity>,
        ),
      )
      .orIgnore()
      .execute();
    this.logger.log(`Ensured ${definitions.length} default configs`);
  }
}
