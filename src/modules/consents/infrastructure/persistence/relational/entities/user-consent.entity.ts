import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { UserEntity } from '../../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
import { ConsentType } from '../../../../domain/consent-type';

@Entity({ name: 'user_consent' })
@Index('UQ_user_consent_userId_type_version', ['userId', 'type', 'version'], { unique: true })
export class UserConsentEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_user_consent' })
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_user_consent_user' })
  user?: UserEntity;

  @Column({ type: 'varchar', length: 20 })
  type: ConsentType;

  @Column({ type: 'varchar', length: 50 })
  version: string;

  @CreateDateColumn()
  agreedAt: Date;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;
}
