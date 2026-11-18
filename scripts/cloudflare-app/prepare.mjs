import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../..')

/** 既存schema全体を使い、Bun用生成物と分離したworkerd用クライアントを作る。 */
export const prepareCloudflareClient = async () => {
  const schema = await readFile(resolve(root, 'prisma/schema.prisma'), 'utf8')
  const generator = /generator client\s*\{[^}]*\}/
  assert(generator.test(schema), 'Prisma generatorが見つかりません')
  const output = resolve(directory, '.wrangler')
  await mkdir(output, { recursive: true })
  const path = resolve(output, 'schema.prisma')
  await writeFile(path, schema.replace(generator, 'generator client {\n  provider = "prisma-client"\n  output = "./prisma"\n  runtime = "workerd"\n}'))
  const generated = spawnSync(process.execPath, ['x', '--no-install', 'prisma', 'generate', '--schema', path], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/unused' },
  })
  assert.equal(generated.status, 0, 'Workers用Prismaクライアントの生成に失敗しました')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareCloudflareClient()
