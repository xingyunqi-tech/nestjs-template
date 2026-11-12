/**
 * 导出 class-validator / class-transformer 运行时元数据为 JSON，供其它语言的后端模板对齐 422 校验行为。
 *
 * 用法：pnpm exec ts-node -P tsconfig.app.json -O '{"rootDir":"."}' scripts/export-validation.ts > validation.json
 * validations 为 MetadataStorage 注册顺序，key 为错误消息对象的键。
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { getFromContainer, getMetadataStorage, ValidationTypes } from 'class-validator';
import type { ValidationArguments } from 'class-validator';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Constructor = abstract new (...args: never[]) => unknown;

interface ValidationMetadataLike {
  type: string;
  name?: string;
  target: Constructor | string;
  propertyName: string;
  constraints?: unknown[];
  constraintCls?: Constructor;
  validationTypeOptions?: unknown;
  message?: string | ((args: ValidationArguments) => string);
  groups?: string[];
  always?: boolean;
  each?: boolean;
  context?: unknown;
  validateIf?: (...args: unknown[]) => boolean;
}

interface ConstraintInstance {
  defaultMessage?: (args: ValidationArguments) => string;
}

interface TransformerMetadataStorage {
  _transformMetadatas: Map<Constructor, Map<string, TransformMetadataLike[]>>;
  _typeMetadatas: Map<Constructor, Map<string, TypeMetadataLike>>;
  _exposeMetadatas: Map<Constructor, Map<string, ExposeMetadataLike>>;
  _excludeMetadatas: Map<Constructor, Map<string, ExcludeMetadataLike>>;
  findTransformMetadatas(
    target: Constructor,
    propertyName: string,
    transformationType: number,
  ): TransformMetadataLike[];
  findTypeMetadata(target: Constructor, propertyName: string): TypeMetadataLike | undefined;
  findExposeMetadata(target: Constructor, propertyName: string): ExposeMetadataLike | undefined;
  findExcludeMetadata(target: Constructor, propertyName: string): ExcludeMetadataLike | undefined;
}

const PLAIN_TO_CLASS = 0;
const CLASS_TO_PLAIN = 1;

interface TransformMetadataLike {
  target: Constructor;
  propertyName: string;
  transformFn: (...args: unknown[]) => unknown;
  options: { toClassOnly?: boolean; toPlainOnly?: boolean; groups?: string[] };
}

interface TypeMetadataLike {
  target: Constructor;
  propertyName: string;
  reflectedType: unknown;
  typeFunction: () => unknown;
  options: unknown;
}

interface ExposeMetadataLike {
  target: Constructor;
  propertyName: string;
  options: { name?: string; groups?: string[]; toClassOnly?: boolean; toPlainOnly?: boolean };
}

interface ExcludeMetadataLike {
  target: Constructor;
  propertyName: string;
  options: { toClassOnly?: boolean; toPlainOnly?: boolean };
}

const load = createRequire(__filename);

const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');

function loadSources(): void {
  loadEnv({ path: join(ROOT, 'env-example-relational'), quiet: true });
  process.env.NODE_ENV = 'development';
  process.env.FILE_DRIVER = 'local';
  load(join(SRC, 'app.module'));
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.dto\.ts$/.test(entry.name) || (/[\\/]dto[\\/]/.test(path) && entry.name.endsWith('.ts'))) {
        if (!entry.name.endsWith('.spec.ts')) {
          load(path);
        }
      }
    }
  };
  walk(SRC);
}

function sourceIndex(): Map<unknown, string> {
  const index = new Map<unknown, string>();
  for (const [file, mod] of Object.entries(require.cache)) {
    if (!mod || !file.startsWith(SRC)) {
      continue;
    }
    for (const value of Object.values(mod.exports as Record<string, unknown>)) {
      if (typeof value === 'function' && !index.has(value)) {
        index.set(value, relative(ROOT, file));
      }
    }
  }
  return index;
}

function functionName(fn: { name: string }): string | null {
  return fn.name ? fn.name : null;
}

function serialize(value: unknown, sources: Map<unknown, string>): Json {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof RegExp) {
    return { regex: value.source, flags: value.flags };
  }
  if (value instanceof Date) {
    return { date: value.toISOString() };
  }
  if (typeof value === 'function') {
    const name = functionName(value);
    if (sources.has(value) || /^[A-Z]/.test(name ?? '')) {
      return { class: name };
    }
    return { function: name, source: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serialize(item, sources));
  }
  if (typeof value === 'object') {
    const result: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = serialize(item, sources);
    }
    return result;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return value.toString();
  }
  return value as Json;
}

function designType(target: Constructor, property: string): string | null {
  const type: unknown = Reflect.getMetadata('design:type', (target as { prototype: object }).prototype, property);
  return typeof type === 'function' ? type.name : null;
}

function defaultMessage(metadata: ValidationMetadataLike): string | null {
  if (!metadata.constraintCls) {
    return null;
  }
  const instance = getFromContainer(metadata.constraintCls as new () => ConstraintInstance);
  if (typeof instance.defaultMessage !== 'function') {
    return null;
  }
  return instance.defaultMessage({
    value: '$value',
    constraints: metadata.constraints ?? [],
    targetName: '$target',
    object: {},
    property: '$property',
  });
}

function constraintKey(metadata: ValidationMetadataLike): string {
  if (metadata.type === ValidationTypes.CUSTOM_VALIDATION && metadata.constraintCls) {
    const [constraint] = getMetadataStorage().getTargetValidatorConstraints(metadata.constraintCls);
    if (constraint?.name) {
      return constraint.name;
    }
  }
  return metadata.type;
}

function exportValidation(metadata: ValidationMetadataLike, sources: Map<unknown, string>): Json {
  const message = metadata.message;
  return {
    type: metadata.type,
    key: constraintKey(metadata),
    name: metadata.name ?? null,
    constraints: serialize(metadata.constraints ?? [], sources),
    message: typeof message === 'string' ? message : null,
    messageFunction: typeof message === 'function' ? message.toString() : null,
    defaultMessage: defaultMessage(metadata),
    each: metadata.each ?? false,
    groups: metadata.groups ?? [],
    always: metadata.always ?? null,
    context: serialize(metadata.context, sources),
    validateIf: metadata.validateIf ? metadata.validateIf.toString() : null,
    validationTypeOptions: serialize(metadata.validationTypeOptions, sources),
  };
}

function initialValues(target: Constructor): Record<string, unknown> {
  try {
    return { ...(new (target as unknown as new () => object)() as Record<string, unknown>) };
  } catch {
    return {};
  }
}

function ancestors(target: Constructor): Constructor[] {
  const chain: Constructor[] = [];
  let current: unknown = Object.getPrototypeOf(target);
  while (typeof current === 'function' && current !== Function.prototype) {
    chain.unshift(current as Constructor);
    current = Object.getPrototypeOf(current);
  }
  return chain;
}

function transformerProperties(map: Map<Constructor, Map<string, unknown>>, target: Constructor): string[] {
  return [...ancestors(target), target].flatMap((cls) => [...(map.get(cls)?.keys() ?? [])]);
}

function exportTransforms(metadatas: TransformMetadataLike[], sources: Map<unknown, string>): Json[] {
  return metadatas.map((metadata) => ({
    function: functionName(metadata.transformFn),
    source: metadata.transformFn.toString(),
    options: serialize(metadata.options, sources),
  }));
}

function main(): void {
  loadSources();
  const sources = sourceIndex();
  const validator = getMetadataStorage() as unknown as { validationMetadatas: Map<Constructor, unknown[]> };
  const transformer = (load('class-transformer/cjs/storage') as { defaultMetadataStorage: TransformerMetadataStorage })
    .defaultMetadataStorage;

  const targets = new Set<Constructor>();
  for (const map of [
    validator.validationMetadatas,
    transformer._transformMetadatas,
    transformer._typeMetadatas,
    transformer._exposeMetadatas,
    transformer._excludeMetadatas,
  ] as Map<unknown, unknown>[]) {
    for (const key of map.keys()) {
      if (typeof key === 'function' && sources.has(key)) {
        targets.add(key as Constructor);
      }
    }
  }

  const byName = new Map<string, Constructor>();
  for (const target of targets) {
    const existing = byName.get(target.name);
    if (existing && existing !== target) {
      throw new Error(`Duplicate class name ${target.name}: ${sources.get(existing)} / ${sources.get(target)}`);
    }
    byName.set(target.name, target);
  }

  const classes: Record<string, Json> = {};
  for (const name of [...byName.keys()].sort()) {
    const target = byName.get(name)!;
    const metadataList = getMetadataStorage().getTargetValidationMetadatas(
      target,
      '',
      false,
      false,
    ) as unknown as ValidationMetadataLike[];

    const propertyNames: string[] = [];
    const addProperty = (property: string): void => {
      if (property && !propertyNames.includes(property)) {
        propertyNames.push(property);
      }
    };
    metadataList.forEach((metadata) => addProperty(metadata.propertyName));
    [
      transformer._transformMetadatas,
      transformer._typeMetadatas,
      transformer._exposeMetadatas,
      transformer._excludeMetadatas,
    ].forEach((map) => transformerProperties(map, target).forEach(addProperty));
    const initial = initialValues(target);

    const properties: Record<string, Json> = {};
    for (const property of propertyNames) {
      const type = transformer.findTypeMetadata(target, property);
      const expose = transformer.findExposeMetadata(target, property);
      const exclude = transformer.findExcludeMetadata(target, property);
      let typeTarget: Json = null;
      if (type) {
        const resolved = type.typeFunction();
        typeTarget = {
          target: typeof resolved === 'function' ? resolved.name : serialize(resolved, sources),
          options: serialize(type.options, sources),
        };
      }
      properties[property] = {
        designType: designType(target, property),
        transforms: exportTransforms(transformer.findTransformMetadatas(target, property, PLAIN_TO_CLASS), sources),
        transformsToPlain: exportTransforms(
          transformer.findTransformMetadatas(target, property, CLASS_TO_PLAIN),
          sources,
        ),
        type: typeTarget,
        expose: expose ? serialize(expose.options, sources) : null,
        exclude: exclude ? serialize(exclude.options, sources) : null,
        validations: metadataList
          .filter((metadata) => metadata.propertyName === property)
          .map((metadata) => exportValidation(metadata, sources)),
      };
    }

    const parent = ancestors(target).at(-1);
    classes[name] = {
      source: sources.get(target) ?? null,
      extends: parent && sources.has(parent) ? parent.name : null,
      initialValues: serialize(initial, sources),
      properties,
    };
  }

  const pkg = load(join(ROOT, 'package.json')) as { dependencies: Record<string, string> };
  const pipeOptions = (load(join(SRC, 'common', 'validation-options')) as { default: Record<string, unknown> }).default;
  const transformOptions = (pipeOptions.transformOptions ?? {}) as { enableImplicitConversion?: boolean };
  const output = {
    generator: 'scripts/export-validation.ts',
    classValidator: pkg.dependencies['class-validator'],
    classTransformer: pkg.dependencies['class-transformer'],
    pipe: {
      whitelist: pipeOptions.whitelist ?? false,
      forbidNonWhitelisted: pipeOptions.forbidNonWhitelisted ?? false,
      forbidUnknownValues: pipeOptions.forbidUnknownValues ?? false,
      transform: pipeOptions.transform ?? false,
      enableImplicitConversion: transformOptions.enableImplicitConversion ?? false,
      errorHttpStatusCode: pipeOptions.errorHttpStatusCode ?? 400,
    },
    classes,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
