# Database

## Table of Contents <!-- omit in toc -->

- [About databases](#about-databases)
- [Working with database schema (TypeORM)](#working-with-database-schema-typeorm)
  - [Generate migration](#generate-migration)
  - [Run migration](#run-migration)
  - [Revert migration](#revert-migration)
  - [Drop all tables in database](#drop-all-tables-in-database)
- [Seeding (TypeORM)](#seeding-typeorm)
  - [Creating seeds (TypeORM)](#creating-seeds-typeorm)
  - [Run seed (TypeORM)](#run-seed-typeorm)
  - [Factory and Faker (TypeORM)](#factory-and-faker-typeorm)
- [Performance optimization (PostgreSQL + TypeORM)](#performance-optimization-postgresql--typeorm)
  - [Indexes and Foreign Keys](#indexes-and-foreign-keys)
  - [Max connections](#max-connections)
- [Switch PostgreSQL to MySQL](#switch-postgresql-to-mysql)

---

## About databases

This boilerplate uses PostgreSQL with TypeORM as the database solution. TypeORM provides a powerful ORM layer with support for migrations, seeding, and type-safe queries.

## Working with database schema (TypeORM)

### Generate migration

1. Create entity file with extension `.entity.ts`. For example `post.entity.ts`:

   ```ts
   // /src/modules/posts/infrastructure/persistence/relational/entities/post.entity.ts

   import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
   import { EntityRelationalHelper } from '../../../../../../common/relational-entity-helper';

   @Entity()
   export class Post extends EntityRelationalHelper {
     @PrimaryGeneratedColumn()
     id: number;

     @Column()
     title: string;

     @Column()
     body: string;

     // Here any fields that you need
   }
   ```

1. Next, generate migration file:

   ```bash
   pnpm migration:generate src/infrastructure/database/migrations/CreatePostTable
   ```

1. Apply this migration to database via [pnpm migration:run](#run-migration).

### Run migration

```bash
pnpm migration:run
```

### Revert migration

```bash
pnpm migration:revert
```

### Check entities against the database

Fails when the entities differ from the current database schema. CI runs it on an empty database after applying all migrations, so every entity change must come with a migration.

```bash
pnpm migration:check
```

### Drop all tables in database

```bash
pnpm schema:drop
```

---

## Seeding (TypeORM)

### Creating seeds (TypeORM)

1. Create seed file with `pnpm seed:create:relational --name Post`. Where `Post` is name of entity.
1. Go to `src/infrastructure/database/seeds/relational/post/post-seed.service.ts`.
1. In `run` method extend your logic.
1. Run [pnpm seed:run:relational](#run-seed-typeorm)

### Run seed (TypeORM)

```bash
pnpm seed:run:relational
```

### Factory and Faker (TypeORM)

1. Install faker:

   ```bash
   pnpm add -D @faker-js/faker
   ```

1. Create `src/infrastructure/database/seeds/relational/user/user.factory.ts`:

   ```ts
   import { faker } from '@faker-js/faker';
   import { RoleEnum } from '../../../../../common/enums/roles/roles.enum';
   import { StatusEnum } from '../../../../../common/enums/statuses/statuses.enum';
   import { Injectable } from '@nestjs/common';
   import { InjectRepository } from '@nestjs/typeorm';
   import { Repository } from 'typeorm';
   import { RoleEntity } from '../../../../../common/enums/roles/role.entity';
   import { UserEntity } from '../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
   import { StatusEntity } from '../../../../../common/enums/statuses/status.entity';

   @Injectable()
   export class UserFactory {
     constructor(
       @InjectRepository(UserEntity)
       private repositoryUser: Repository<UserEntity>,
       @InjectRepository(RoleEntity)
       private repositoryRole: Repository<RoleEntity>,
       @InjectRepository(StatusEntity)
       private repositoryStatus: Repository<StatusEntity>,
     ) {}

     createRandomUser() {
       // Need for saving "this" context
       return () => {
         return this.repositoryUser.create({
           firstName: faker.person.firstName(),
           lastName: faker.person.lastName(),
           email: faker.internet.email(),
           password: faker.internet.password(),
           role: this.repositoryRole.create({
             id: RoleEnum.user,
             name: 'User',
           }),
           status: this.repositoryStatus.create({
             id: StatusEnum.active,
             name: 'Active',
           }),
         });
       };
     }
   }
   ```

1. Make changes in `src/infrastructure/database/seeds/relational/user/user-seed.service.ts`:

   ```ts
   // Some code here...
   import { UserFactory } from './user.factory';
   import { faker } from '@faker-js/faker';

   @Injectable()
   export class UserSeedService {
     constructor(
       // Some code here...
       private userFactory: UserFactory,
     ) {}

     async run() {
       // Some code here...

       await this.repository.save(
         faker.helpers.multiple(this.userFactory.createRandomUser(), {
           count: 5,
         }),
       );
     }
   }
   ```

1. Make changes in `src/infrastructure/database/seeds/relational/user/user-seed.module.ts`:

   ```ts
   import { Module } from '@nestjs/common';
   import { TypeOrmModule } from '@nestjs/typeorm';

   import { UserSeedService } from './user-seed.service';
   import { UserFactory } from './user.factory';

   import { UserEntity } from '../../../../../core/users/infrastructure/persistence/relational/entities/user.entity';
   import { RoleEntity } from '../../../../../common/enums/roles/role.entity';
   import { StatusEntity } from '../../../../../common/enums/statuses/status.entity';

   @Module({
     imports: [TypeOrmModule.forFeature([UserEntity, Role, Status])],
     providers: [UserSeedService, UserFactory],
     exports: [UserSeedService, UserFactory],
   })
   export class UserSeedModule {}
   ```

1. Run seed:

   ```bash
   pnpm seed:run:relational
   ```

---

## Performance optimization (PostgreSQL + TypeORM)

### Indexes and Foreign Keys

Don't forget to create `indexes` on the Foreign Keys (FK) columns (if needed), because by default PostgreSQL [does not automatically add indexes to FK](https://stackoverflow.com/a/970605/18140714).

### Max connections

Set the optimal number of [max connections](https://node-postgres.com/apis/pool) to database for your application in `/.env`:

```txt
DATABASE_MAX_CONNECTIONS=80
DATABASE_CONNECTION_TIMEOUT_MS=10000
```

| Variable                         | Default | Description                                                                                                    |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_MAX_CONNECTIONS`       | `80`    | Max size of the API connection pool                                                                            |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `10000` | Timeout for acquiring a connection from the pool, including establishing a new one; must be a positive integer |

You can think of `DATABASE_MAX_CONNECTIONS` as how many concurrent database connections your application can handle.
The API pool plus the connections of every other process (migrations, seeds, scripts, other API instances) must not exceed PostgreSQL `max_connections` (default `100`).

## Switch PostgreSQL to MySQL

If you want to use `MySQL` instead of `PostgreSQL`, you can make the changes after following the [installation guide](installing-and-running.md).

Once you have completed all the steps, you should have a running app.
![image](https://github.com/user-attachments/assets/ec60b61a-65e6-43e2-9bcf-72dad4c8a9fa)

If you've made it this far, it only requires a few changes to switch from `PostgreSQL` to `MySQL`.

**Change the `.env` file to the following:**

```env
DATABASE_TYPE=mysql
# set "localhost" if you are running app on local machine
# set "mysql" if you are running app on docker
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USERNAME=root
DATABASE_PASSWORD=secret
DATABASE_NAME=app
```

**Change the `docker-compose.yml` to the following:**

```yml
services:
  mysql:
    image: mysql:9.2.0
    ports:
      - ${DATABASE_PORT}:3306
    volumes:
      - mysql-boilerplate-db:/var/lib/mysql
    environment:
      MYSQL_USER: ${DATABASE_USERNAME}
      MYSQL_PASSWORD: ${DATABASE_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${DATABASE_PASSWORD}
      MYSQL_DATABASE: ${DATABASE_NAME}

  # other services here...

volumes:
  # other volumes here...
  mysql-boilerplate-db:
```

After completing the above setup, run Docker with the following command:

```bash
docker compose up -d mysql adminer maildev
```

All three services should be running as shown below:

![image](https://github.com/user-attachments/assets/73e10325-66ed-46ca-a0c5-45791ef0750f)

Once your services are up and running, you're almost halfway through.

Now install the MySQL client:

```bash
pnpm add mysql2
```

**Delete the existing migration file and generate a new one with the following script:**

```bash
pnpm migration:generate src/infrastructure/database/migrations/newMigration --pretty=true
```

Run migrations:

```bash
pnpm migration:run
```

Run seeds:

```bash
pnpm seed:run:relational
```

Run the app in dev mode:

```bash
pnpm start:dev
```

Open <http://localhost:3000>

To set up Adminer:

Open the running port in your browser.
Open <http://localhost:8080>

![image](https://github.com/user-attachments/assets/f4b86daa-d93f-4ae9-a9e3-3c29bb3bba9d)

Running App:
![image](https://github.com/user-attachments/assets/5dc0609d-5f6d-4176-918d-1744906f4f88)
![image](https://github.com/user-attachments/assets/ff2201a6-d834-4c8b-9ab7-b9413a0a95c1)

---

Previous: [Command Line Interface](cli.md)

Next: [Auth](auth.md)
