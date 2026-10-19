import { ConfigModule } from '@nestjs/config';

/** 导入应用模块前加载 .env，ConditionalModule.registerWhen 求值时环境变量已就绪 */
await ConfigModule.forRoot({ envFilePath: ['.env'] });
