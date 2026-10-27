import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';
import { GamePlatform } from '../../../../domain/game-player';

@Entity({ name: 'game_player' })
@Index('UQ_game_player_platform_openId', ['platform', 'openId'], { unique: true })
export class GamePlayerEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_game_player' })
  id: number;

  @Column({ type: 'varchar', length: 20 })
  platform: GamePlatform;

  @Column({ type: 'varchar', length: 64 })
  openId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  unionId: string | null;

  @Column({ type: 'varchar', length: 64 })
  refreshHash: string;

  @Column({ type: 'timestamptz' })
  lastLoginAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
