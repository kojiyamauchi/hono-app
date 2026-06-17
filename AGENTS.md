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

### features設計

このリポジトリでは、公開ルーティングのトップレベルを機能境界として扱うfeatures設計に従うこと。

- `src/routes/` 配下には、公開URLのトップレベルroutingを定義すること
  - 例: `/auth`、`/supabase-auth`、`/users`
  - `src/routes/index.ts` はトップレベルroutingの集約とHonoアプリへの登録に責務を限定すること
- `src/routes/` 配下に定義したトップレベルrouting単位で、`src/features/` 配下に対応するfeatureディレクトリを定義すること
  - 例: `/auth` は `src/features/auth/`、`/supabase-auth` は `src/features/supabaseAuth/`
  - URLはkebab-case、featureディレクトリ名はTypeScriptの命名に合わせてcamelCaseを許容する
- routingのサブディレクトリや詳細なルート定義は、対応する `src/features/<feature>/routes/` 配下に置くこと
  - `src/routes/` はトップレベルの入口、`src/features/<feature>/routes/` はfeature内部のルート詳細という役割分担にする
- features間の相互importは禁止すること
  - `src/features/auth` から `src/features/supabaseAuth` をimportするような、featureを跨ぐ依存は禁止する
  - feature間で共有したい処理・型・ドメイン概念は、直接importせず `src/shared/` に切り出すこと
- 複数featuresで使う機能は `src/shared/` 配下に定義すること
  - 例: 複数featureで使うUserドメイン、DTO、mapper、repositoryなど
- `src/shared/` 配下から `src/features/` 配下をimportすることは禁止する
  - 依存方向は `features -> shared` の一方向に保つこと
- `src/features/<feature>/` と `src/shared/<domain>/` 配下の構成は、以下の標準ディレクトリに揃えること
  - `controllers/`
  - `dtos/`
  - `entities/`
  - `mappers/`
  - `repositories/`
  - `routes/`
  - `schemas/`
  - `services/`
- 新しい責務名のディレクトリは原則として増やさないこと
  - 例: `tokens/`、`handlers/`、`clients/` のような新しい概念を個別判断で追加しない
  - 新しい処理を置く場合は、まず既存の標準ディレクトリのどれに属するかを判断すること
  - 標準ディレクトリでは表現しづらい責務が出た場合は、実装前に設計方針を確認し、必要に応じてREADME/AGENTS/CLAUDEを更新してから追加すること
- 現時点で実装がない標準ディレクトリには `.gitkeep` を置き、構成の一貫性を保つこと

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

### エンドポイント一覧

公開APIの一覧は [docs/endpoints.md](docs/endpoints.md) を正本とすること。

APIの追加・変更・削除を行う場合は、実装と同じPRで `docs/endpoints.md` も更新すること。

READMEには詳細なエンドポイント一覧を重複して記載せず、`docs/endpoints.md` への導線のみを置くこと。

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

### Zod schema と型定義の命名

`src/features/**/schemas/` および `src/shared/**/schemas/` 配下で定義するZod schemaと、そのschemaからexportする型は以下の命名に揃えること:

- Zod schemaは `***Schema` として定義すること
  - 例: `signupSchema`、`updateMeSchema`、`userIdParamSchema`
- schemaから `z.infer` でexportする型は、対応するschema名に `Type` を付与した `***SchemaType` とすること
  - 例: `SignupSchemaType`、`UpdateMeSchemaType`
- param系schemaの型も同じ規則に従い、`***ParamSchemaType` とすること
  - 例: `UserIdParamSchemaType`、`OrganizationIdParamSchemaType`
- schema由来の型に `***Input` や `***Param` のような別接尾語を使わないこと
- repository内部など、`schemas/` 配下のZod schema由来ではない入出力型はこの規則の対象外とする

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

### コミットの粒度

コミットは、変更内容を追いやすくするため細かい粒度で分割すること:

- 1つの作業 = 1コミットの粒度で分割すること（PR本文の作業項目リストの1項目が、おおむね1コミットの目安）
- テストは、対応する実装コミットの直後にコミットすること
  - 例: スキーマ実装 → スキーマテスト → サービス実装 → サービステスト
  - 「実装 → そのテスト → 次の実装 → そのテスト」とレイヤーごとにペアで刻むこと
- 各コミット時点で `typecheck` が完全に通らなくてもよい（ファイル間の参照のため一時的に通らない瞬間が出るため）。最終的にpush後のCIで全チェックを通すこと
- 各コミット時点でも、プレコミットフック（lint-staged の prettier / eslint / cspell）は通すこと

#### feature実装時の標準コミット粒度

feature配下にAPIやユースケースを追加する場合は、原則としてレイヤー単位で実装とテストを分けること。1コミット内で複数レイヤーの実装を混ぜないこと。

標準的な順序:

1. DTO追加
2. mapper追加
3. mapperテスト追加
4. repository追加
5. repositoryテスト追加
6. service追加
7. serviceテスト追加
8. schema追加
9. schemaテスト追加
10. controller追加
11. controllerテスト追加
12. routes追加
13. routesテスト追加
14. top-level route登録
15. route統合テスト追加

この順序は依存関係に沿っている。`service` はリクエストスキーマに依存せず素の値（id・token等）で入力を受けるため、`schema` より先に実装・テストできる。`schema`（zod）はHTTP入力バリデーションで `routes`（`zValidator`）と `controller`（`***SchemaType` の型注釈）が使うHTTPエッジの関心事のため、`controller`/`routes` の直前に置く。「実装 → そのテスト」は必ず隣接させ、間に別レイヤーのコミットを挟まないこと。

特に `DTO + mapper + repository` や `service + schema + controller + routes` のように、役割の異なる変更を1コミットへまとめないこと。

薄いcontrollerや単純なrepositoryなど、単体テストの効果が低い場合はテストを省略してよい。ただし、省略した場合でもserviceテストまたはroute統合テストで振る舞いを担保すること。

review対応コミットは、指摘ごと、または関心事ごとに分けること。

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

### Issue作成時の記載者表記

Issueを作成・整理する場合は、本文を誰が記載したか分かるように、本文末尾に以下の形式で記載者を明記すること:

```md
## 記載者

Created by: 記載者
```

- ユーザー本人が本文を記載したIssueは `Created by: me` とする
- Codex が本文を記載したIssueは `Created by: Codex <codex@openai.com>` とする
- Claude が本文を記載したIssueは `Created by: Claude <claude@anthropic.com>` とする
- AIエージェントが既存Issueを大きく整理・統合した場合は、必要に応じて `Updated by: エージェント名 <メールアドレス>` を追記する
- 過去Issueへの一括適用は必須にせず、新しく作成・整理するIssueから適用する

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
- Claude がレビュー結果を投稿する場合は、コメント冒頭に`## レビュー結果（Claude）`を記載すること
- 問題がない場合は、レビュー結果とは別の通常コメントとして`Approve by エージェント名 <メールアドレス> :octocat:`を投稿すること
- 修正コミット追加後は、過去の承認に依存せず最新HEADを確認して再レビューすること
- 指摘事項が残っている場合は、重大度に応じて`COMMENT`または`REQUEST_CHANGES`を投稿すること

#### inline suggestion comment の運用

レビューで指摘を行う際、変更内容が明確で、該当箇所へ直接適用できるものについては、可能な範囲で inline suggestion comment を併用すること。

- 変更内容が明確で、その場で置き換え案を提示できる場合は、先に該当箇所へ inline suggestion comment を投稿すること
- inline suggestion comment では、必要に応じて GitHub の suggestion ブロックで変更案を提示すること
- inline suggestion comment は対象PRのdiffに含まれる行にのみ投稿できる。差分外の既存行に対する指摘は、suggestionを付けず通常のレビュー本文で行うこと
- 発行された inline suggestion comment のURLを取得し、レビュー本文の該当指摘に `comment: コメントURL` の形式で記載すること
- `comment:` が指すのは inline suggestion comment（`#discussion_r...` のレビューコメント）のURLであり、そのコメント本文に含める GitHub の suggestion ブロックとは別物として扱うこと
- suggestion は、そのまま適用しても意図が崩れない最小単位にすること
- suggestion を出した場合でも、レビュー本文側には問題の内容・影響・修正方針を残すこと
- 複数ファイルにまたがる修正、設計判断、テスト追加、責務分離など、単一suggestionで表現しづらい内容は無理に suggestion 化しないこと
- GitHub APIやツール制約で inline suggestion comment のURL取得が難しい場合は、通常のレビュー本文のみで指摘してよい

Codex が `Findings` に指摘を記載する場合、該当Findingに対して inline suggestion comment がある場合は、以下の形式でリンクを記載すること:

```md
[P1] 指摘内容

`path/to/file.ts:123`

問題の内容、影響、修正方針を記載する。

comment: https://github.com/owner/repo/pull/xx#discussion_rxxxxxxxx
```

Claude が `Suggestions` または `Issues` に指摘を記載する場合、該当指摘に対して inline suggestion comment がある場合は、各指摘の本文内に以下の形式でリンクを記載すること:

```md
### 指摘内容

問題の内容、影響、修正方針を記載する。

comment: https://github.com/owner/repo/pull/xx#discussion_rxxxxxxxx
```

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

#### レビュー対応時のPR本文更新

レビュー指摘へ対応する追加コミットを行った場合は、PR本文も最新状態へ更新すること。

このルールはレビュー対応時のPR本文更新に関する正本とし、Claude側のレビュー対応Skillはこのセクションを参照すること。

レビュー対応時は、push前またはpush直後にPR本文を読み直し、少なくとも以下を確認すること:

- `概要` が現在のPR内容と一致していること
- `変更内容` がレビュー対応分を含めて最新であること
- `コミット構成` が現在のPRの状態を正しく説明していること
- `確認内容` のチェック状態が最新であること
- レビュー指摘への対応内容がある場合、必要に応じて `レビュー対応` セクションを追加すること
- PR本文と実際の差分・コミット履歴にズレがないこと

`コミット構成` は、マージ方式によって最終的なコミット数が変わる可能性があるため、厳密な最終履歴との一致よりも、レビュー時点のPRの状態を正しく説明していることを優先すること。

PR本文の整合性を確認する際は、必要に応じて以下を使うこと:

```bash
gh pr diff <PR番号>
gh pr view <PR番号> --json commits
```

PR本文の更新は、コード修正とは別の補助作業ではなく、レビュー対応フローの一部として扱うこと。

### Codex Skill

- PRレビューの詳細な手順は [`.codex/skills/pr-review/SKILL.md`](.codex/skills/pr-review/SKILL.md) を参照すること
- Codex 用のプロジェクト内Skillは `.codex/skills/` に置くこと

### 変数名と関数名

- 英語のキャメルケースまたはパスカルケースを使用
- 日本語のローマ字表記は避けること
- 意味のある名前を使用すること
