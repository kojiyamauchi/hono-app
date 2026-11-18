import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, '../..')

/** 同じschemaからWorkers専用クライアントを生成し、Bun用生成物を保持する。 */
export const prepareClient = async () => {
  assert(process.versions.bun, 'Prisma生成にはBunを使用してください')
  const schema = await readFile(resolve(root, 'prisma/schema.prisma'), 'utf8')
  const generator = /generator client\s*\{[^}]*\}/
  assert(generator.test(schema), 'Prisma generatorが見つかりません')
  const generatedDirectory = resolve(directory, '.wrangler')
  const user = /model User \{([\s\S]*?)^\}/m.exec(schema)
  assert(user, '読み取り用のUserモデルが見つかりません')
  const scalarLines = user[1].split('\n').filter((line) => /^\s*\w+\s+(Int|String|DateTime|Boolean|BigInt|Decimal|Json|Bytes|Float)\??\s/.test(line))
  assert(
    scalarLines.some((line) => /^\s*email\s+String\s+@unique/.test(line)),
    'Userの一意検索の定義を確認してください',
  )
  // 読み取り専用の比較用スキーマ。実DBのDDLや元のモデル定義は変更しない。
  const leanSchema = `generator client {}\n\ndatasource db {\n  provider = "postgresql"\n}\n\nmodel User {\n${scalarLines.join('\n')}\n}\n`
  for (const [output, build] of [
    ['prisma', 'fast'],
    ['prisma-small', 'small'],
    ['prisma-lean', 'fast'],
    ['prisma-lean-small', 'small'],
  ]) {
    const workerSchema = (output.startsWith('prisma-lean') ? leanSchema : schema).replace(
      generator,
      `generator client {\n  provider = "prisma-client"\n  output = "./${output}"\n  runtime = "workerd"\n  compilerBuild = "${build}"\n}`,
    )
    await mkdir(resolve(generatedDirectory, output), { recursive: true })
    const schemaPath = resolve(generatedDirectory, `${output}.schema.prisma`)
    await writeFile(schemaPath, workerSchema)
    const generated = spawnSync(process.execPath, ['x', '--no-install', 'prisma', 'generate', '--schema', schemaPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/unused' },
    })
    assert.equal(generated.status, 0, `Workers用Prismaクライアント(${build})の生成に失敗しました`)
  }
}
