import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WrongQuestionEntity } from './entities/wrong-question.entity';
import { WrongQuestionRepository } from '../wrong-question.repository';
import { WrongQuestionRelationalRepository } from './repositories/wrong-question.repository';

@Module({
  imports: [TypeOrmModule.forFeature([WrongQuestionEntity])],
  providers: [{ provide: WrongQuestionRepository, useClass: WrongQuestionRelationalRepository }],
  exports: [WrongQuestionRepository],
})
export class RelationalWrongBookPersistenceModule {}
