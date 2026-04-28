"use strict";

const fs = require("fs-extra");
const path = require("path");
const { runSilent } = require("../../core/runCommand");

async function generate({ name, template, targetDir, onStep }) {
  const parentDir = path.dirname(targetDir);

  const isCrud = template.includes("crud");
  const isGraphql = template.includes("graphql");
  const isMicro = template.includes("micro");

  // ── 1. Scaffold ────────────────────────────────────────────────────────────
  onStep("Scaffolding NestJS project");

  await runSilent(
    `npx @nestjs/cli@latest new "${name}" --package-manager npm --skip-git`,
    { cwd: parentDir }
  );

  if (!(await fs.pathExists(targetDir))) {
    throw new Error("NestJS scaffold failed");
  }

  // ── 2. Install base deps ───────────────────────────────────────────────────
  onStep("Installing dependencies");
  await runSilent("npm install", { cwd: targetDir });

  // ── 3. CRUD ────────────────────────────────────────────────────────────────
  if (isCrud) {
    onStep("Generating CRUD resource");

    const itemsDir = path.join(targetDir, "src", "items");
    await fs.ensureDir(itemsDir);

    // item.dto.ts — class (not interface) so emitDecoratorMetadata can emit
    // runtime type metadata for decorated method signatures (fixes TS1272)
    await fs.writeFile(
      path.join(itemsDir, "item.dto.ts"),
      `export class ItemDto {
  id!: number;
  name!: string;
  description?: string;
}
`
    );

    await fs.writeFile(
      path.join(itemsDir, "items.service.ts"),
      `import { Injectable, NotFoundException } from '@nestjs/common';
import { ItemDto } from './item.dto';

@Injectable()
export class ItemsService {
  private items: ItemDto[] = [];
  private nextId = 1;

  findAll(): ItemDto[] {
    return this.items;
  }

  findOne(id: number): ItemDto {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new NotFoundException(\`Item #\${id} not found\`);
    return item;
  }

  create(dto: Partial<ItemDto>): ItemDto {
    const item: ItemDto = {
      id:          this.nextId++,
      name:        dto.name ?? 'Unnamed',
      description: dto.description,
    };
    this.items.push(item);
    return item;
  }

  update(id: number, dto: Partial<ItemDto>): ItemDto {
    const item = this.findOne(id);
    Object.assign(item, dto);
    return item;
  }

  remove(id: number): void {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new NotFoundException(\`Item #\${id} not found\`);
    this.items.splice(idx, 1);
  }
}
`
    );

    await fs.writeFile(
      path.join(itemsDir, "items.controller.ts"),
      `import { Controller, Get, Post, Put, Delete, Param, Body, ParseIntPipe, HttpCode } from '@nestjs/common';
import { ItemsService } from './items.service';
import { ItemDto } from './item.dto';

@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  findAll(): ItemDto[] {
    return this.itemsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): ItemDto {
    return this.itemsService.findOne(id);
  }

  @Post()
  create(@Body() body: Partial<ItemDto>): ItemDto {
    return this.itemsService.create(body);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<ItemDto>,
  ): ItemDto {
    return this.itemsService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): void {
    this.itemsService.remove(id);
  }
}
`
    );

    await fs.writeFile(
      path.join(itemsDir, "items.module.ts"),
      `import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  controllers: [ItemsController],
  providers:   [ItemsService],
})
export class ItemsModule {}
`
    );

    // Wire ItemsModule into app.module.ts
    const appModulePath = path.join(targetDir, "src", "app.module.ts");
    let appModule = await fs.readFile(appModulePath, "utf-8");

    if (!appModule.includes("ItemsModule")) {
      appModule =
        `import { ItemsModule } from './items/items.module';\n` + appModule;
      appModule = appModule.replace(/imports:\s*\[/, "imports: [ItemsModule, ");
      await fs.writeFile(appModulePath, appModule);
    }
  }

  // ── 4. GraphQL ─────────────────────────────────────────────────────────────
  if (isGraphql) {
    onStep("Adding GraphQL");

    // @as-integrations/express5 bridges Apollo Server 4 with Express 5.
    // The NestJS CLI scaffolds with Express 5 by default; without this package
    // @nestjs/apollo throws "The @as-integrations/express5 package is missing"
    // at startup and the server never starts.
    await runSilent(
      "npm install @nestjs/graphql @nestjs/apollo @apollo/server @as-integrations/express5 graphql",
      { cwd: targetDir }
    );

    // Minimal resolver — Apollo crashes on an empty schema
    const helloDir = path.join(targetDir, "src", "hello");
    await fs.ensureDir(helloDir);

    await fs.writeFile(
      path.join(helloDir, "hello.resolver.ts"),
      `import { Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class HelloResolver {
  @Query(() => String)
  hello(): string {
    return 'Hello from PIC-LI!';
  }
}
`
    );

    await fs.writeFile(
      path.join(helloDir, "hello.module.ts"),
      `import { Module } from '@nestjs/common';
import { HelloResolver } from './hello.resolver';

@Module({ providers: [HelloResolver] })
export class HelloModule {}
`
    );

    // Rewrite app.module.ts — ApolloDriver + ApolloDriverConfig required since
    // @nestjs/graphql v10 (the generic type param enforces config correctness)
    const appModulePath = path.join(targetDir, "src", "app.module.ts");
    await fs.writeFile(
      appModulePath,
      `import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { HelloModule } from './hello/hello.module';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver:         ApolloDriver,
      autoSchemaFile: true,   // code-first: schema built from decorators
      playground:     true,   // UI at http://localhost:3000/graphql
    }),
    HelloModule,
  ],
})
export class AppModule {}
`
    );
  }

  // ── 5. Microservice ────────────────────────────────────────────────────────
  if (isMicro) {
    onStep("Configuring microservice");

    await runSilent("npm install @nestjs/microservices", { cwd: targetDir });

    const mainPath = path.join(targetDir, "src", "main.ts");
    await fs.writeFile(
      mainPath,
      `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        host: '127.0.0.1',
        port: 3001,
      },
    },
  );
  await app.listen();
  console.log('[PIC-LI] Microservice listening on TCP port 3001');
}
bootstrap();
`
    );
  }

  // ── 6. Git ─────────────────────────────────────────────────────────────────
  onStep("Initializing Git");
  try {
    await runSilent("git init", { cwd: targetDir });
  } catch {}

  // ── 7. README ──────────────────────────────────────────────────────────────
  onStep("Writing README");

  const endpoints = isCrud
    ? `
## Endpoints

| Method | Path        | Description    |
|--------|-------------|----------------|
| GET    | /items      | List all items |
| GET    | /items/:id  | Get one item   |
| POST   | /items      | Create item    |
| PUT    | /items/:id  | Update item    |
| DELETE | /items/:id  | Delete item    |
`
    : "";

  const graphqlNote = isGraphql
    ? `
## GraphQL

Playground at http://localhost:3000/graphql

\`\`\`graphql
query {
  hello
}
\`\`\`
`
    : "";

  const microNote = isMicro
    ? `
## Microservice

Listens on TCP port **3001**.
Connect a client using \`@nestjs/microservices\` \`ClientProxy\`.
`
    : "";

  await fs.writeFile(
    path.join(targetDir, "README.md"),
    `# ${name}

Generated by **PIC-LI**

## Stack
- NestJS${isCrud ? "\n- REST CRUD (in-memory)" : ""}${
      isGraphql ? "\n- GraphQL (Apollo, code-first)" : ""
    }${isMicro ? "\n- Microservice (TCP)" : ""}

## Run

\`\`\`bash
npm run start:dev
\`\`\`

Server: http://localhost:3000
${endpoints}${graphqlNote}${microNote}`
  );
}

module.exports = { generate };
