import { Module } from '@nestjs/common';
import { WrongBookModule } from './wrong-book.module';
import { QuestionsModule } from '../questions/questions.module';
import { PracticeModule } from '../practice/practice.module';
import { WrongBookBrowseService } from './wrong-book-browse.service';
import { WrongBookController } from './wrong-book.controller';

@Module({
  imports: [WrongBookModule, QuestionsModule, PracticeModule],
  controllers: [WrongBookController],
  providers: [WrongBookBrowseService],
})
export class WrongBookApiModule {}
