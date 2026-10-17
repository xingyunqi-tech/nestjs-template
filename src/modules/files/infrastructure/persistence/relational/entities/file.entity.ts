import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { FileVisibility } from '../../../../domain/file-visibility';

@Entity({ name: 'file' })
export class FileEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_file_path')
  @Column()
  path: string;

  @Index('IDX_file_ownerUserId')
  @Column({ type: 'int', nullable: true })
  ownerUserId: number | null;

  @Column({ type: 'varchar', length: 10, default: FileVisibility.PUBLIC })
  visibility: FileVisibility;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ type: 'int', nullable: true })
  size: number | null;

  @Index('IDX_file_sha256')
  @Column({ type: 'varchar', length: 64, nullable: true })
  sha256: string | null;
}
