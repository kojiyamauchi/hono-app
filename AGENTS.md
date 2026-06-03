# AGENTS.md

このファイルは、このリポジトリで作業する際に Codex に対してガイダンスを提供します。

## 言語に関する重要な注意事項

**このプロジェクトでは、すべてのコミュニケーションとドキュメントを日本語で行うことを必須とします。**

- コードコメントは日本語で記述すること
- コミットメッセージは英語の接頭辞と日本語の説明で記述すること
- ドキュメント（README、コメント等）は日本語で記述すること
- Codex とのやり取りは日本語で行うこと
- 変数名や関数名は英語でも構いませんが、JSDocやコメントは必ず日本語で記述すること

## プロジェクト概要

Bun上で動作するHono.js APIアプリケーションです。TypeScriptを使用し、ORMとしてPrisma、データベースとしてSupabase（PostgreSQL）を採用しています。モダンなESMセットアップと厳格なTypeScript設定を使用しています。

## 主要なアーキテクチャ

### アプリケーション構造

- **エントリーポイント**: [src/server.ts](src/server.ts) - `Bun.serve()`を使用してHonoサーバーを起動
- **アプリインスタンス**: [src/app.ts](src/app.ts) - Honoインスタンスを作成し、ルートを登録
- **ルート登録**: [src/routes/index.ts](src/routes/index.ts) - `registerRoutes(app)`による一元的なルート登録パターン
- **データベースクライアント**: [src/libs/prisma.ts](src/libs/prisma.ts) - PostgreSQL用の`@prisma/adapter-pg`を使用した設定済みPrismaクライアントをエクスポート

### データベース設定

- Prismaスキーマ: [prisma/schema.prisma](prisma/schema.prisma)
- マイグレーション: `prisma/migrations/`
- 生成されたクライアント: `src/generated/prisma/`（このディレクトリは自動生成され、ESLintで無視されます）
- カスタムPrisma設定: [prisma.config.ts](prisma.config.ts) - トップレベルのPrismaスキーマ/マイグレーションパスを使用

### ローカル開発用データベース

ローカルPostgreSQLインスタンスにSupabase CLIを使用:

- 起動: `bun run db:start`
- 停止: `bun run db:stop`
- リセット: `bun run db:reset`
- ステータス確認: `bun run db:status`
- デフォルト接続: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

## 開発コマンド

### アプリケーションの実行

```bash
bun run dev          # 開発モード（ホットリロード付き）
bun run start        # 本番モード
```

### コード品質

```bash
bun run typecheck    # ファイル出力なしの型チェック
bun run build        # typecheckのエイリアス
bun run lint         # ESLintによる自動修正（max-warnings 0）
bun run format       # Prettierによるフォーマット
bun run spellcheck   # CSpellによるスペルチェック
bun test             # Bun Testによるテストの実行
```

### データベース操作

```bash
bun run prisma:generate      # Prismaクライアントの生成
bun run prisma:migrate:dev   # マイグレーションの作成と適用
bun run prisma:validate      # スキーマの検証
bun run prisma:format        # スキーマファイルのフォーマット
bun run prisma:studio        # Prisma Studioを開く
```

### プレコミットフック

Husky + lint-stagedがコミット時に実行されるよう設定されています:

```bash
bun run lint-staged  # ステージングされたファイルのチェックを手動実行
```

## 重要な設定の詳細

### ESLintルール

- **インポートのソート**: `eslint-plugin-simple-import-sort`を使用した自動インポート整理
- **コンソール使用**: `console.info`と`console.error`のみ許可（`console.log`は警告）
- **明示的な戻り値の型**: 関数には明示的な戻り値の型が必要（不足している場合は警告）
- **未使用変数**: `_`プレフィックスを付けない限り、未使用変数はエラー
- **無視パス**: `src/generated/**`はリント対象から除外

### TypeScript設定

- モジュール解決: `bundler`
- ターゲット: `ES2023`
- strictモード有効
- emit無し（ビルドステップは型チェックのみ）

### テスト

- Bunに組み込まれた`bun test`を使用
- テストファイル: `**/*.test.ts`または`**/*.test.js`
- テストがない場合は失敗するため、最低限の動作確認テストを維持

### 環境変数

`.env.example`を`.env`にコピー:

- `PORT`: サーバーポート（デフォルト: 3000）
- `DATABASE_URL`: PostgreSQL接続文字列

## コードパターン

### 新しいルートの追加

[src/routes/index.ts](src/routes/index.ts)の`registerRoutes`関数を使用してルートを追加します。渡された`app`インスタンスにルートを登録する既存のパターンに従ってください。

### データベースアクセス

[src/libs/prisma.ts](src/libs/prisma.ts)からPrismaクライアントをインポート:

```typescript
import { prisma } from '../libs/prisma'
```

### ルートハンドラー

リクエスト/レスポンス処理にはHonoのコンテキスト（`c`）を使用します。例については[src/routes/index.ts](src/routes/index.ts)の既存ルートを参照してください。

## コーディング規約

### コメントとドキュメント

- すべてのコメントは日本語で記述すること
- 複雑なロジックには必ずコメントを付けること
- 関数やクラスにはJSDocコメント（日本語）を記述すること

### コミットメッセージ

英語の接頭辞と日本語の説明で記述し、以下の形式に従うこと:

- `add: 新機能の説明`
- `fix: バグ修正の説明`
- `modify: 既存機能の改善`
- `remove: 不要なコードの削除`
- `refactor: コードの整理`

AIエージェントがコミットする場合は、誰が作業したか分かるようにコミットメッセージ本文の末尾に以下のトレーラーを付与すること:

- Claude がコミットする場合: `Co-authored-by: Claude <claude@anthropic.com>`
- Codex がコミットする場合: `Co-authored-by: Codex <codex@openai.com>`

### ブランチ命名

ブランチ名は作業種別と関心事が分かるように、以下の形式に従うこと:

- 新規機能・追加機能開発: `feature/作業の関心事`
- 既存機能や設定の修正・改善: `modify/作業の関心事`
- 機能や設定の削除: `remove/作業の関心事`

ブランチの接頭辞は、PRや作業全体の主目的で決めること。コミットメッセージの接頭辞は、ブランチ名とは独立して、そのコミット単体の変更内容で決めること。

- `feature/` ブランチでも、既存実装の変更を含むコミットには `modify:`、不具合修正には `fix:`、整理には `refactor:`、削除には `remove:` を使ってよい
- `modify/` ブランチでも、修正に必要な補助的な追加があれば `add:` を使ってよい
- `remove/` ブランチでも、削除に伴う設定変更やテスト更新があれば `modify:` や `fix:` を使ってよい
- ブランチ名はコミット接頭辞の一覧ではなく、PR全体でユーザーに伝えたい主目的を優先して決めること

このルールは、本ルール追加後に新しく作成するブランチから適用すること。

作業の関心事は英語のケバブケースで簡潔に記述すること。例:

- `feature/auth`
- `feature/users-crud`
- `modify/branch-rules`
- `modify/ci-workflow`
- `remove/legacy-config`

### PRタイトル

PRのタイトルは、作業者と関心事が分かるように以下の形式で記述すること:

`[作業者]: 関心事`

- `作業者` には作業した主体を記述する:
  - ユーザー（リポジトリ所有者）が作業した場合: `me`
  - Codex が作業した場合: `codex`
  - Claude が作業した場合: `claude`
- `関心事` にはPRの主目的を日本語で簡潔に記述する
- 例:
  - `[me]: ユーザー認証機能の追加`
  - `[codex]: CIワークフローの改善`
  - `[claude]: PRテンプレートの追加`

### PR作成時の最初のコミット

PRを作成する際、最初のコミットは以下の空コミットにすること:

```bash
git commit --allow-empty -m "initial commit."
```

これにより、PRの起点が明確になり、以降の変更を追いやすくなる。

### GitHubへのpush

ユーザーの通常のpush方法を変えないため、`origin` のURLはSSHのまま維持すること:

```txt
git@github.com:kojiyamauchi/hono-app.git
```

AIエージェントがpushする場合は、`origin` のURLをHTTPSへ変更せず、HTTPS URLを直接指定してpushすること:

```bash
git push https://github.com/kojiyamauchi/hono-app.git main
```

これにより、ユーザーが `git push origin main` を実行する場合は引き続きSSHを使用し、AIエージェントがpushする場合だけHTTPS認証を使用する。

#### push後はリモート追跡参照を更新すること

HTTPS URLを直接指定したpushは、名前付きリモート `origin` を経由しないため、ローカルのリモート追跡参照（`refs/remotes/origin/main`）が自動更新されない。その結果、push済みにもかかわらず `git log` や `git status` 上でローカルとリモートのHEADがズレて見える。

これを防ぐため、AIエージェントはpush直後に以下のfetchを実行し、リモート追跡参照を明示的に更新すること:

```bash
git fetch https://github.com/kojiyamauchi/hono-app.git main:refs/remotes/origin/main
```

これにより `git log --oneline --decorate` で `(HEAD -> main, origin/main, origin/HEAD)` が揃った状態になる。なお、この手順はユーザーやSSH経由のpush（`git push origin main`）では不要（追跡参照が自動更新されるため）。

### AIエージェント間レビュー

- AIエージェントが実装した変更は、原則としてPRでレビューすること
- Codex が実装したPRは Claude がレビューすること
- Claude が実装したPRは Codex がレビューすること
- ユーザーが作成したPRは Claude と Codex がレビューすること
- AIエージェントが作成したPRは、他のAIエージェントに加えてユーザーもレビューすること
- レビューを開始する前に、対象PRのCIが通っていることを確認すること
- CIが未完了または失敗している場合は、レビュー結果にCI状態を明記し、問題なしの通常コメントはCI通過後に投稿すること
- レビューでは、バグ、設計リスク、テスト不足、セキュリティ、運用上の問題を優先すること
- レビュー指摘への修正は、PR上で追加コミットとして行うこと
- 初回レビュー、再レビュー、修正後レビューを問わず、レビュー結果をGitHub上へコメントとして投稿すること
- Codex がレビュー結果を投稿する場合は、コメント冒頭に`## Review by Codex`を記載すること
- 問題がない場合は、レビュー結果とは別の通常コメントとして`Approve by エージェント名 <メールアドレス> :octocat:`を投稿すること
- 修正コミット追加後は、過去の承認に依存せず最新HEADを確認して再レビューすること
- 指摘事項が残っている場合は、重大度に応じて`COMMENT`または`REQUEST_CHANGES`を投稿すること

#### レビュー指摘への対応コミット

レビュー指摘へ対応する追加コミットは、通常のコミットと区別できるように以下の形式で記述すること:

```txt
review: 作業内容

comment: レビューコメントのURL

Co-authored-by: 作業したAIエージェントの名前 <メールアドレス>
```

- `review:` の後には、対応した作業内容を日本語で簡潔に記述すること
- `comment:` には、対応元のGitHubレビューコメントまたはレビューのURLを記述すること
- AIエージェントが対応した場合は、通常のコミットと同様に`Co-authored-by`トレーラーを付与すること

### Codex Skill

- PRレビューの詳細な手順は [`.codex/skills/pr-review/SKILL.md`](.codex/skills/pr-review/SKILL.md) を参照すること
- Codex 用のプロジェクト内Skillは `.codex/skills/` に置くこと

### 変数名と関数名

- 英語のキャメルケースまたはパスカルケースを使用
- 日本語のローマ字表記は避けること
- 意味のある名前を使用すること
