# Cloudflare devの自動配備

本体専用の `hono-app-dev` を、共通CI全件成功後に配備します。Access → 入口Worker → SQLite型DO → Prisma/Hyperdrive → 既存Supabaseという[本体構成](cloudflare-app.md)を維持します。検証用の `hono-app-dev-compatibility` は引き続き手動配備です。

## 起動と成功条件

`main` へのpushで既存の `cd-gcp.yml` が共通 `ci.yml` を一度呼び出します。Terraform AWS/GCP/Cloudflareの3ジョブは独立した並列検査のままです。Cloudflare Runtime Testを含む全9ジョブ成功が、GCPとCloudflareの両CDの前提です。PRから配備しません。

Cloudflareの追加ジョブは共通CIとGCP配備の終了を待ちます。GCP CDが有効ならその配備成功が必要です。無効ならGCPジョブのスキップだけを許容し、失敗・キャンセルは許容しません。Repository variable `CLOUDFLARE_DEV_CD_ENABLED=true` のときだけ `cd-cloudflare.yml` を呼び出します。未設定・falseでは本体基盤もSecretも不要です。

`cloudflare-dev` Environmentを使い、配備から検証まで `cloudflare-dev-deployment` のconcurrency groupで直列化します。新しいpushは実行中の配備をキャンセルしません。待機順には依存せず、開始時とバンドル生成後にGitHubのmain SHAを確認し、古いSHAはクラウドを更新せず省略します。更新開始後にmainが進んだ場合は現在の配備・検証を終え、次の配備へ進みます。手動配備・復旧中は先にフラグをfalseにし、進行中の配備の終了を待ってください。

## 管理境界と共有DB

| 対象                                                                 | 管理元                                     |
| -------------------------------------------------------------------- | ------------------------------------------ |
| 本体Workerの存在・workers.dev有効化・preview無効化・ログ無効化       | Terraform `infra/cloudflare/app.tf`        |
| 本体専用Access Applicationとメール/サービスのポリシー                | 同じTerraform root。既存OTPだけを共有      |
| コード・SQLite型DO class/migration・Hyperdrive binding・アプリSecret | Wrangler/CD                                |
| Hyperdrive・DB資格情報・CA・Freeプラン                               | 既存の手動管理。CDは参照・検査のみ         |
| Supabaseのmigration                                                  | 既存GCP CDの適用処理、または既存の手動運用 |

CD自身はTerraform apply、Hyperdrive変更、DB migration、DB reset、課金変更を行いません。Terraform出力をEnvironment Secretへ登録し、CDはAPIの現在値と照合します。インフラ変更時は手動plan/apply後に出力を更新してください。APIでAccessのWorker全体保護、AUD、チームissuer、ポリシー内容、専用サービストークン、OPTIONS保護、workers.dev/preview、実サブドメインを確認します。AuthorizationヘッダーをAccessサービス認証へ転用しません。

DB履歴確認用の資格情報は、Hyperdriveと同じhost/port/databaseへの直接接続を使います。専用の読み取り用DBロールに `public._prisma_migrations` のSELECTだけを付与することを推奨します。`sslmode=verify-full`、リポジトリのSupabase CAと標準CA、接続/SQLタイムアウト、`default_transaction_read_only=on` を指定します。アプリのDB接続資格情報をWorkerへbindingしません。

ローカルの全migration名とSHA-256が適用済み履歴と完全一致し、失敗中・未適用・余分な履歴がない場合だけ配備します。GCP CDが無効のときは、先に既存の手動運用でmigrationを適用してください。GCPとの別runの競合で未適用/実行中を検出した場合も停止するので、適用完了後に最新mainのrunを再実行します。既存のBun用招待outbox配信ワーカーは継続利用します。

## 必要なGitHub設定

Repository variable:

- `CLOUDFLARE_DEV_CD_ENABLED`: 初回構築・検証後にだけ `true`。

Environment `cloudflare-dev` は配備元をmainに制限し、以下のSecretsを登録します。既存GCPのSecretsや検証Workerの設定を上書きしません。

| Secret                            | 内容                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`            | 対象アカウント限定の本体CD用APIトークン                          |
| `CLOUDFLARE_CD_CONFIG`            | 適用済みTerraformの `app_cd_config` のJSON全体                   |
| `CLOUDFLARE_APP_SECRETS`          | アプリ設定のJSON。以下の許可リストだけを受け取る                 |
| `CLOUDFLARE_ACCESS_CLIENT_ID`     | 本体専用AccessサービストークンのClient ID                        |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | 同じトークンのClient Secret                                      |
| `CLOUDFLARE_DATABASE_URL`         | 同じSupabaseのDB履歴確認用接続URL。5432番、`sslmode=verify-full` |

APIトークンにはAccountの `Workers Scripts: Edit`、`Access: Apps: Read`、`Access: Policies: Read`、`Access: Organizations: Read`、`Hyperdrive: Read` を付けます。Terraform用は[既存の構築用権限](deployment-cloudflare.md)も必要です。検証Worker向けの既存TerraformトークンにはHyperdrive/Organizationsの読み取り権限がない場合があり、そのままCD用に転用しません。トークンの有効期限・ローテーションは手動管理し、読み取りで403になる場合も保護検査を省略しません。Workers Scriptsの権限は同じアカウントの他Workerにも作用するため、対象固定・Environment保護・main限定を合わせて使います。

アプリJSONの必須キー:

- `JWT_SECRET` / `REFRESH_TOKEN_SECRET` / `PASSWORD_RESET_TOKEN_SECRET` / `EMAIL_VERIFICATION_TOKEN_SECRET`
- `RESEND_API_KEY` / `PASSWORD_RESET_FROM_EMAIL` / `PASSWORD_RESET_URL_BASE`
- `EMAIL_VERIFICATION_FROM_EMAIL` / `EMAIL_VERIFICATION_URL_BASE`
- `SUPABASE_URL` / `ALLOWED_ORIGINS`
- `SUPABASE_PUBLISHABLE_KEY` または `SUPABASE_ANON_KEY` の少なくとも一方

任意キーは `AUTH_EMAIL_MODE`、`COOKIE_SAMESITE`、`ENABLE_API_DOCS`、`ENABLE_INVITATION_EMAIL`、`INVITATION_EMAIL_FROM`、`INVITATION_EMAIL_SCALAR_URL` です。設定の意味・組合せは `.env.example` と各機能の文書に従います。Supabase URLは既存クラウドのHTTPS Originを指定します。JWT/HMACは既存Bunと同じ値を使い、両認証方式の意味を維持します。Cookie Secureはtrue、Node telemetryは無効へ固定します。`DATABASE_URL`、Access設定、CD資格情報、`SPIKE_TOKEN` など未知キーは拒否します。

Secret JSONは環境変数から読み、runnerの所有者限定一時ファイルにだけ保存します。Wranglerの生出力・API本文・SQL例外はログへ出しません。コードとSecretは `wrangler deploy --secrets-file` で同じversionへ配備します。Secretを含むartifactはアップロードしません。成功/失敗にかかわらずSecretファイルとrunnerの生成物・Wranglerログを削除します。

## 安全な初回構築

このPRでは実Cloudflareの本体作成、公開URL有効化、本体Secrets登録、CDフラグ有効化を行っていません。ローカル・CIとモックでレビュー可能な実装を揃え、実環境の初回構築は以下で行います。アカウントのFreeプランを維持し、有料化をしません。

1. CDフラグをfalseのまま、本体専用のAccessサービストークンを手動発行します。検証用の管理ID/Client ID/Secretを流用しません。
2. Git管理外の `infra/cloudflare/env/dev.local.tfvars` へ下記 `app_config` を追加します。`enable_worker_url=false` のまま、Cloudflare専用backend・dev workspaceの新しいplanで追加範囲を確認してapplyします。本体のWorker・Access・ポリシーの追加だけであること、既存検証Worker/GCP/共有DBの変更・削除がないことを確認します。

```hcl
app_config = {
  workers_subdomain = "REPLACE_WITH_WORKERS_SUBDOMAIN"
  access_issuer     = "https://REPLACE_WITH_TEAM.cloudflareaccess.com"
  service_token_id  = "REPLACE_WITH_DEDICATED_TOKEN_UUID"
  enable_worker_url = false
}
```

```bash
TF_WORKSPACE=dev bun run tf:cloudflare:init
TF_WORKSPACE=dev bun --env-file=.env.cloudflare.local run tf:cloudflare:plan -out=app-bootstrap.tfplan
TF_WORKSPACE=dev bun --env-file=.env.cloudflare.local run tf:cloudflare:apply app-bootstrap.tfplan
```

Worker作成直後のAccess反映待ちの場合はURL無効を維持して新しいplanで再実行します。適用済みWorker/Accessを削除してやり直しません。

3. `terraform -chdir=infra/cloudflare output -json app_cd_config` を所有者限定ファイルへ保存し、Git管理外の環境ファイルへJSONとして設定します。上表の同名環境変数に実値を準備します。`CLOUDFLARE_CD_DIR` は所有者限定の一時ディレクトリ、`GITHUB_SHA` は配備するcheckoutの完全SHAです。アプリJSONは `.env.example` から必要なキーだけを選びます。既存 `.env.cloudflare.local` をコピーで上書きしません。
4. 依存を固定インストールした後、URL無効の本体だけへ初回コード・DO・Secretを配備します。APIのAccess保護確認とDB履歴照合は通常配備と同じです。

```bash
bun install --frozen-lockfile --ignore-scripts
bun --env-file=.env.cloudflare-app.local scripts/cloudflare-cd.mjs bootstrap
```

5. 初回配備成功後、tfvarsの本体 `app_config.enable_worker_url` だけをtrueへ変え、新しいplanでAccessの置換・削除がないことを確認してapplyします。Access保護は既に存在し、previewは無効のままです。TLS証明書の反映を待ち、検証を無効化して進めません。
6. Terraform出力を再取得し、本体の `CLOUDFLARE_CD_CONFIG` を更新します。最新mainのcheckout・SHAで通常の `deploy` を実行すると、同じコードの配備を含めてAccessなしの代表パス拒否、Access付き `/health` の `{ok:true}`、アプリBearerなしの `/users/me` の401を確認します。Access資格情報は `CF-Access-Client-Id` / `CF-Access-Client-Secret` のみに渡します。
7. 上記Secretsを `gh secret set --env cloudflare-dev <名前> < <所有者限定ファイル>` などで登録します。実値をコマンド引数・PR・チャットへ貼りません。Environmentのmain制限と全Secretsを確認してからCDフラグをtrueへ設定します。設定だけではpushを発生させないので、最新mainのCD runの再実行または次のmain pushで開始します。

## 失敗時と復旧

配備前の確認失敗はクラウドを変更せず停止します。配備開始直前に、SHAと復旧用の現行version IDをActions Summaryへ記録します。配備後は100%単一versionのSHAタグ、保護設定、HTTPを確認し、検証済みversion IDを追記します。HTTP成功はDBへの業務書き込み・メール実配達・全ルート負荷の確認を意味しません。

Wrangler失敗は一部反映の可能性があるため、成功とも未変更とも断定しません。フラグをfalseにして進行中runを確認し、Cloudflareの稼働DeploymentとSummaryのversionを照合します。認証保護の異常ならAccessを外さず、Terraformの本体 `enable_worker_url=false` で入口を閉じます。API/HTTP失敗後の自動rollbackやDBの巻き戻しは行いません。

コード障害で旧versionへ戻す場合は、共有DBの現在のschemaと旧コードの互換性、旧versionのSecret/DO migrationとの整合を確認して、元のcheckout/configで `bunx --no-install wrangler rollback <復旧用version> --config <本体設定ファイル>` を実行します。既存DO class/namespaceを削除せず、migration tagを巻き戻したコードを再deployしてnamespaceを作り直しません。破壊的DB変更がある場合は旧コードへ機械的に戻さず修正版を配備します。復旧後も同じAccess・HTTP検証を行い、設定を同期してからフラグを再有効化します。

## 検証と制約

```bash
bun test --isolate scripts/test/cloudflare-cd*.test.js
TF_WORKSPACE=dev bun run tf:cloudflare:test
bun run cloudflare:build
bun run test:cloudflare
```

テストは実workflowの成功条件、API保護の不一致、Secretの許可リスト、DB履歴/チェックサム、古いSHA、省略/停止の順序、配備後失敗とSecret削除を確認します。通常PR CIはクラウド資格情報不要です。本体実機のCPU・最大メモリ・ピーク負荷・全外部サービス通信は未測定であり、Workers Freeへの全面適合を断定しません。64MiBのArgon2id強度、Prisma/transaction/行ロックの意味は変更しません。

公式仕様: [コードとSecretの同時配備](https://developers.cloudflare.com/workers/configuration/secrets/)、[versionとdeployment](https://developers.cloudflare.com/workers/versions-and-deployments/)、[Hyperdriveの参照](https://developers.cloudflare.com/api/resources/hyperdrive/subresources/configs/methods/get/)。
