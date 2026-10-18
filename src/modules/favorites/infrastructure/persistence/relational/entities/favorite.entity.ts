import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Unique,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
import { FavoriteTargetType } from '../../../../domain/favorite';

@Entity({ name: 'favorite' })
@Unique('UQ_favorite_user_target', ['userId', 'targetType', 'targetId'])
@Index('IDX_favorite_userId_targetType', ['userId', 'targetType'])
@Index('IDX_favorite_userId_subjectId', ['userId', 'subjectId'])
export class FavoriteEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_favorite_userId')
  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_favorite_user' })
  user: UserEntity;

  @Index('IDX_favorite_targetType')
  @Column({ type: 'varchar', length: 20 })
  targetType: FavoriteTargetType;

  @Index('IDX_favorite_targetId')
  @Column({ type: 'varchar', length: 100 })
  targetId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  image?: string;

  @Column({ type: 'text', nullable: true })
  extra?: string;

  @Column({ type: 'uuid', nullable: true })
  subjectId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
