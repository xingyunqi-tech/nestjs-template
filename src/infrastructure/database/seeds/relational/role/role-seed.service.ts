import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleEntity } from '../../../../../common/enums/roles/role.entity';
import { RoleEnum } from '../../../../../common/enums/roles/roles.enum';

@Injectable()
export class RoleSeedService {
  constructor(
    @InjectRepository(RoleEntity)
    private repository: Repository<RoleEntity>,
  ) {}

  async run(): Promise<void> {
    const countUser = await this.repository.count({
      where: {
        id: RoleEnum.user,
      },
    });

    if (!countUser) {
      await this.repository.save(
        this.repository.create({
          id: RoleEnum.user,
          name: 'User',
        }),
      );
    }

    const countAdmin = await this.repository.count({
      where: {
        id: RoleEnum.admin,
      },
    });

    if (!countAdmin) {
      await this.repository.save(
        this.repository.create({
          id: RoleEnum.admin,
          name: 'Admin',
        }),
      );
    }

    const countEditor = await this.repository.count({
      where: {
        id: RoleEnum.editor,
      },
    });

    if (!countEditor) {
      await this.repository.save(
        this.repository.create({
          id: RoleEnum.editor,
          name: 'Editor',
        }),
      );
    }

    const countReviewer = await this.repository.count({
      where: {
        id: RoleEnum.reviewer,
      },
    });

    if (!countReviewer) {
      await this.repository.save(
        this.repository.create({
          id: RoleEnum.reviewer,
          name: 'Reviewer',
        }),
      );
    }
  }
}
