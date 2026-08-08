#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildOpenApiDocument } from '../openapi';

const output = process.argv[2] ?? resolve(__dirname, '..', '..', '..', '..', 'docs', 'api', 'openapi.json');

const document = buildOpenApiDocument();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const paths = document['paths'] as Record<string, Record<string, unknown>>;
const operationCount = Object.values(paths).reduce((sum, item) => sum + Object.keys(item).length, 0);
console.log(`wrote ${output} (${Object.keys(paths).length} paths, ${operationCount} operations)`);
