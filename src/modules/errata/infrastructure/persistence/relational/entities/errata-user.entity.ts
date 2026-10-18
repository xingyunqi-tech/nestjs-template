import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
import { ErrataEntity } from './errata.entity';

/** 勘误任务已处理的用户，完成后据此发通知 */
@Entity({ name: 'errata_user' })
export class ErrataUserEntity extends EntityRelationalHelper {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_errata_user' })
  errataId: string;

  @PrimaryColumn({ type: 'int', primaryKeyConstraintName: 'PK_errata_user' })
  userId: number;

  @ManyToOne(() => ErrataEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'errataId', foreignKeyConstraintName: 'FK_errata_user_errata' })
  errata?: ErrataEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_errata_user_user' })
  user?: UserEntity;

  @Column({ type: 'boolean', default: false })
  notified: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
