import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../../../infrastructure/database/config/database.config';
import appConfig from '../../../config/app.config';
import { TypeOrmConfigService } from '../../../infrastructure/database/typeorm-config.service';
import { dataSourceFactory } from '../../../infrastructure/database/data-source.factory';
import { RelationalExamPersistenceModule } from '../infrastructure/persistence/relational/relational-persistence.module';
import { KnowledgePointQuestionCountService } from '../knowledge-point-question-count.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig, appConfig], envFilePath: ['.env'] }),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService, dataSourceFactory }),
    RelationalExamPersistenceModule,
  ],
  providers: [KnowledgePointQuestionCountService],
})
class RecountKnowledgePointQuestionsModule {}

const recount = async (): Promise<void> => {
  const app = await NestFactory.createApplicationContext(RecountKnowledgePointQuestionsModule, {
    logger: ['error', 'warn', 'log'],
  });
  const changed = await app.get(KnowledgePointQuestionCountService).recount(process.argv[2]);
  new Logger('RecountKnowledgePointQuestions').log(`Updated questionCount of ${changed} knowledge points`);
  await app.close();
};

void recount();
