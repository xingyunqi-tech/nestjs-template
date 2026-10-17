import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
import { ImportJobStatus } from '../../../../domain/import-job-status';

@Entity({ name: 'import_job' })
export class ImportJobEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_import_job' })
  id: string;

  @Column({ type: 'uuid' })
  fileId: string;

  @ManyToOne(() => FileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fileId', foreignKeyConstraintName: 'FK_import_job_file' })
  file?: FileEntity;

  @Index('IDX_import_job_status')
  @Column({ type: 'varchar', length: 20, default: ImportJobStatus.PENDING })
  status: ImportJobStatus;

  @Column({ type: 'boolean', default: false })
  publishOnImport: boolean;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  succeeded: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  @Column({ type: 'int', default: 0 })
  skipped: number;

  @Column({ type: 'uuid', nullable: true })
  errorReportFileId: string | null;

  @ManyToOne(() => FileEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'errorReportFileId', foreignKeyConstraintName: 'FK_import_job_error_report_file' })
  errorReportFile?: FileEntity | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  failureReason: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdBy', foreignKeyConstraintName: 'FK_import_job_user' })
  creator?: UserEntity | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Index('IDX_import_job_createdAt')
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
