export default {
  './**/*.{ts,mjs}': ['bunx prettier --write', 'bunx eslint --fix --no-warn-ignored --max-warnings 0'],
  './**/*.js': 'bunx prettier --write',
  './prisma/schema.prisma': ['bun run prisma:validate', 'bun run prisma:format'],
  './infra/**/*.{tf,tfvars}': [
    /** Terraformと変数ファイルを再帰的にフォーマットする。 */
    () => 'bun run tf:fmt',
    /** TerraformファイルへTFLintを実行する。 */
    () => 'bun run tf:lint',
    /** Terraform構成を検証する。 */
    () => 'bun run tf:validate',
  ],
  './**/*': 'bunx cspell --dot --no-must-find-files',
}
