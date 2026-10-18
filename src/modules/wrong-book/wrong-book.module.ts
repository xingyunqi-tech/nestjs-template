import { Module } from '@nestjs/common';
import { RelationalWrongBookPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { AppConfigModule } from '../config/config.module';
import { WrongBookService } from './wrong-book.service';
import { WrongBookAccountCleaner } from './wrong-book-account.cleaner';

@Module({
  imports: [RelationalWrongBookPersistenceModule, AppConfigModule],
  providers: [WrongBookAccountCleaner, WrongBookService],
  exports: [WrongBookService],
})
export class WrongBookModule {}
