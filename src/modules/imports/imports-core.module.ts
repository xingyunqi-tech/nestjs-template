import { Module } from '@nestjs/common';
import { RelationalImportPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ExamsModule } from '../exams/exams.module';
import { QuestionsModule } from '../questions/questions.module';
import { PapersModule } from '../papers/papers.module';
import { FilesModule } from '../files/files.module';
import { ImportsService } from './imports.service';
import { ContentImporter } from './content-importer';

/** 导入服务本身，不含 HTTP 与队列，供命令行脚本与队列处理器复用 */
@Module({
  imports: [RelationalImportPersistenceModule, ExamsModule, QuestionsModule, PapersModule, FilesModule],
  providers: [ImportsService, ContentImporter],
  exports: [ImportsService, RelationalImportPersistenceModule],
})
export class ImportsCoreModule {}
