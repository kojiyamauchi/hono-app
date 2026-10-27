export default {
  './**/*.{ts,mjs}': ['bunx prettier --write', 'bunx eslint --fix --no-warn-ignored --max-warnings 0'],
  './**/*.js': 'bunx prettier --write',
  './prisma/schema.prisma': ['bun run prisma:validate', 'bun run prisma:format'],
  './infra/aws/**/*.{tf,tfvars}': [
    /** Terraformと変数ファイルを再帰的にフォーマットする。 */
    () => 'bun run tf:fmt',
    /** TerraformファイルへTFLintを実行する。 */
    () => 'bun run tf:aws:lint',
    /** Terraform構成を検証する。 */
    () => 'bun run tf:aws:validate',
  ],
  './infra/gcp/**/*.{tf,tfvars}': [
    /** GCP変更時はGCP rootだけを検証し、AWSの認証・初期化を要求しない。 */
    () => 'bun run tf:fmt',
    () => 'bun run tf:gcp:lint',
    () => 'bun run tf:gcp:validate',
  ],
  './**/*': 'bunx cspell --dot --no-must-find-files',
}
