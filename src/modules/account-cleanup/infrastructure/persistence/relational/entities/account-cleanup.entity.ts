import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';

@Entity({ name: 'account_cleanup' })
export class AccountCleanupEntity extends EntityRelationalHelper {
  @PrimaryColumn({ type: 'int', primaryKeyConstraintName: 'PK_account_cleanup' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_account_cleanup_user' })
  user?: UserEntity;

  @Column({ type: 'timestamptz' })
  completedAt: Date;
}
