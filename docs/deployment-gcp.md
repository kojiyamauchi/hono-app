# GCPの無料枠を優先した公開準備

Bun / HonoをCloud Run、DBとSupabase Authをクラウド版Supabase Freeで動かします。AWSは `infra/aws/`、GCPは `infra/gcp/` で別々に管理します。Dockerfileは共用します。

この変更だけではGCPリソースは作成されません。前半のローカル検証と、後半の実環境を変更する操作を分けて進めてください。

## 管理範囲とアクセス制限

- 既存の課金設定済みGCPプロジェクトを入力します。プロジェクトとstate保存用GCSバケットはTerraform管理外の前提リソースです。
- Terraformは必要なAPI、Artifact Registry、6つのSecret Managerの入れ物、アプリ用サービスアカウント、Cloud Run、呼び出し権限を管理します。
- Supabaseプロジェクトは管理画面でFreeを選択します。APIとDBのリージョンは可能な限り近づけます。
- APIは `run.app` のHTTPS URLを使い、IAM認証を必須にします。`invoker_members` へ指定した利用者だけが呼び出せます。不特定多数への公開権限は作成しません。
- Basic認証・IAPは今回導入しません。Googleアカウントでブラウザから直接ログインするIAPが必要な場合は、OAuth設定と許可対象を決めて追加します。
- シークレットの実値とversionの作成はTerraform管理外とし、stateへ保存しません。Supabaseのanonキーは公開設定で扱い、service roleキーは使用しません。
- 通常起動ではmigrationを実行しません。既存Dockerfileの `migration` ターゲットをローカルで実行してからCloud Runを更新します。
- AWS用CDは引き続きECRへの登録だけを行います。GCPへの自動push・自動デプロイは追加しません。

## 無料枠と費用の前提

Cloud Runは最小0・最大1インスタンス、1 vCPU / 512 MiB、リクエスト単位課金、起動時CPU boost無効です。アクセスがない間の常時稼働を避け、外部trace送信も無効にします。VPC、NAT、ロードバランサー、Cloud SQLは作りません。

無料枠内に収まりやすい設定ですが、月額0円を保証する構成ではありません。Cloud Runの処理・起動時間とリクエスト数、東京からの外向き通信、Artifact Registryの保存容量、GCSのstateと過去バージョン、ログが課金対象になり得ます。最大インスタンス数は金額の上限ではなく、更新時などには一時的な超過もあります。

- Cloud Runの無料枠は請求先アカウント全体で共有します。通信にも別の課金があり、東京からの通信をすべて無料とは扱いません。[Cloud Run料金](https://cloud.google.com/run/pricing)
- Artifact Registryの無料保存枠は0.5 GBです。登録するのはruntimeイメージだけとし、migrationイメージは登録しません。古い通常タグのイメージは1日後から削除対象になります。`release-` タグは保護するため、稼働中・復旧用だけを残して容量を確認します。削除は即時ではありません。[保存料金](https://cloud.google.com/artifact-registry/pricing)
- Secret Managerは6つの有効なversionまで無料です。各シークレットを1 versionで運用すればこの枠に収まります。古いversionは無効化だけでも課金対象のため、ローテーション後に参照・復旧方針を確認して不要なversionを破棄します。[Secret Manager料金](https://cloud.google.com/secret-manager/pricing)
- Supabase FreeはDB容量500 MBで、1週間利用がないと一時停止します。定期アクセスで停止を回避する前提にはしません。[Supabase料金](https://supabase.com/pricing)
- 公開前にGCPのBilling画面で少額の予算とメール通知を設定し、公開後は費用レポートを確認します。予算通知は自動停止や課金の上限ではありません。

メールの無料枠、送信ドメイン、フロントエンドのホスティング、有料監視は別途確認します。

## 外部環境を変更しない確認

Google Cloud CLIやGCP認証情報は不要です。providerの取得にはネットワークを使います。

```bash
TF_WORKSPACE=dev bun run tf:gcp:init:no-backend
bun run tf:gcp:lint:init
bun run tf:fmt:check
bun run tf:gcp:lint
bun run tf:gcp:validate
TF_WORKSPACE=dev bun run tf:gcp:test
bun run typecheck
bun run lint:check
bun test --isolate
bun run test:container
```

`test:container` はDocker Desktopで使い捨てPostgreSQLを作り、migrationと認証の動作を確認します。GCPやクラウド版Supabaseへは接続しません。既存DBはresetしません。

## 公開を決めた後の操作

ここからはプロジェクト・リソース作成、イメージのpush、クラウドDBへの書き込みを行います。対象アカウント・プロジェクトを確認してから実施してください。

### 1. プロジェクトとstateを準備する

Google Cloud CLI、Docker Desktop、Terraform、Bunを用意します。GCP Consoleでプロジェクトと課金設定を用意し、Billingで予算通知を設定します。

```bash
gcloud auth login
gcloud auth application-default login
gcloud auth list
gcloud config set project YOUR_PROJECT_ID
gcloud config get-value project
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com --project=YOUR_PROJECT_ID
```

state用GCSバケットを事前作成し、バージョニング、公開アクセス防止、均一なバケットレベルのアクセス制御を有効にします。stateを操作する利用者だけへ権限を付けます。GCSにも利用量に応じた料金が発生し得ます。

```bash
cp infra/gcp/env/backend.gcs.hcl.example infra/gcp/env/backend.local.hcl
cp infra/gcp/env/dev.tfvars.example infra/gcp/env/dev.local.tfvars
```

`backend.local.hcl` にバケット名、`dev.local.tfvars` にプロジェクトIDを入力します。この時点では `app_image_digest` 等は追記しません。`backend.local.hcl` のprefixはAWSと独立した `hono-app/gcp` とし、GCP内の環境はworkspaceで分離します。

```bash
bun run tf:gcp:init
bun run tf:gcp:workspace:dev
terraform -chdir=infra/gcp workspace show
bun run tf:gcp:plan -var-file=env/dev.local.tfvars -out=bootstrap.tfplan
bun run tf:gcp:apply bootstrap.tfplan
```

planにCloud Runサービスが含まれず、API・リポジトリ・6つのシークレット・実行用サービスアカウントとシークレット権限だけが含まれることを確認します。シークレットの値はまだ登録されません。backendなしで初期化済みの場合も、実環境では必ず上記の `tf:gcp:init` を実行します。

### 2. Supabaseと機密値を準備する

クラウド版SupabaseでFreeプロジェクトを作成します。Connect画面の **Session pooler / 5432番** の接続文字列を使用し、`sslmode=require` を付けます。ホストを推測せず画面の値を使い、パスワードをURLエンコードします。IPv6専用の直接接続を使う構成にはしません。[Supabaseの接続方式](https://supabase.com/docs/guides/database/connecting-to-postgres)

Data APIは無効にし、Prismaが作る認証・ユーザーテーブルを公開しません。Supabase AuthのSite URL・Redirect URLsは実際のフロントエンドへ設定します。DBの接続元IP制限を使用している場合は、今回のCloud Run構成には固定送信元IPがないことを考慮してください。固定IPが必要ならNATなどの費用を含めて別途設計します。

登録先IDを次のコマンドで確認し、GCP ConsoleのSecret Managerから各実値を登録します。実値をtfvarsやコマンド引数へ記載しません。

```bash
terraform -chdir=infra/gcp output -json secret_ids
```

| 環境変数                          | 登録する値                          |
| --------------------------------- | ----------------------------------- |
| `DATABASE_URL`                    | 上記のSupabase PostgreSQL接続文字列 |
| `JWT_SECRET`                      | 独立した十分に長いランダムな署名鍵  |
| `REFRESH_TOKEN_SECRET`            | 独立した十分に長いランダムな鍵      |
| `PASSWORD_RESET_TOKEN_SECRET`     | 独立した十分に長いランダムな署名鍵  |
| `EMAIL_VERIFICATION_TOKEN_SECRET` | 独立した十分に長いランダムな署名鍵  |
| `RESEND_API_KEY`                  | Resend APIキー                      |

メール機能を確認する場合はResendで送信ドメインを検証し、無料枠内の送信上限を確認します。Supabase Authの実メール配信はSupabase側のメール設定も必要です。

### 3. 同じソースからビルドし、migrationを実行する

リリースするコミットへ揃えたcleanなcheckoutで実行します。migration用環境ファイルは既存の `.env.deployment.local.example` をコピーし、実際の `DATABASE_URL` だけを引用符なしで記載します。

```bash
cp .env.deployment.local.example .env.deployment.local
chmod 600 .env.deployment.local
docker build --platform linux/amd64 --target runtime -t hono-app:gcp-release .
docker build --platform linux/amd64 --target migration -t hono-app:gcp-migration .
docker run --rm --platform linux/amd64 --env-file .env.deployment.local hono-app:gcp-migration
```

接続先が今回のSupabaseであることを確認し、`prisma migrate deploy` の成功後に次へ進みます。通常起動用イメージにはPrisma CLIやmigrationファイルがないため、runtimeイメージのコマンド上書きでmigrationを実行しません。

### 4. runtimeイメージを登録する

```bash
gcp_project_id=YOUR_PROJECT_ID
gcp_repository_url="$(terraform -chdir=infra/gcp output -raw repository_url)"
gcp_release_tag="release-$(git rev-parse --short HEAD)"
gcp_image_uri="${gcp_repository_url}/hono:${gcp_release_tag}"
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
docker tag hono-app:gcp-release "$gcp_image_uri"
docker push "$gcp_image_uri"
gcloud artifacts docker images describe "$gcp_image_uri" --project="$gcp_project_id" --format='value(image_summary.digest)'
```

リージョンを変更した場合はDocker認証先も合わせます。イメージのダイジェストを記録し、Artifact Registryの保存容量も確認します。

### 5. API設定を入力して配備する

`dev.local.tfvars` のコメント付きサンプルを使い、`app_image_digest`、`invoker_members`、公開設定、6つすべての `secret_versions` を追記します。シークレットは登録した数値versionに固定し、`latest` は使いません。

CookieはSecureを強制します。cross-siteのフロントエンドでCookieを使う場合は `COOKIE_SAMESITE = "None"` が必要ですが、ブラウザ側のthird-party Cookie制限も受けます。IAM認証付きAPIを別Originのブラウザから使う構成は、CORSのpreflightとGoogle認証の扱いも設計が必要です。初回はCLIで確認します。

```bash
terraform -chdir=infra/gcp workspace show
bun run tf:gcp:plan -var-file=env/dev.local.tfvars -out=release.tfplan
bun run tf:gcp:apply release.tfplan
gcp_service_url="$(terraform -chdir=infra/gcp output -raw service_url)"
curl --silent --output /dev/null --write-out '%{http_code}\n' "$gcp_service_url/health"
```

最後の認証なしの呼び出しは拒否されることを確認します。許可されたGoogleアカウントでの確認は次のように行います。

```bash
curl --fail --silent --show-error \
  -H "X-Serverless-Authorization: Bearer $(gcloud auth print-identity-token)" \
  "$gcp_service_url/health"
```

アプリ自身のJWTを使う場合は `Authorization: Bearer <アプリのJWT>` を別途付けます。Cloud Run用のGoogle IDトークンは `X-Serverless-Authorization` に渡し、アプリ認証と衝突させません。[Cloud Runのサービス認証](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)

`/health` はプロセスの稼働確認であり、DB接続は保証しません。検証専用アカウントで登録・ログイン・本人取得・refreshを確認し、検証データを削除します。メールの配達とSupabase Authはそれぞれ別途確認します。

Cloud Run標準URLへ直接接続する構成だけを対象とし、IP単位のレート制限は `X-Forwarded-For` の末尾を使います。公開前に、偽の先頭IPを変えても制限を回避できないことを確認します。追加のロードバランサー・CDN・プロキシを導入する場合は、この信頼境界を見直してください。

### 更新・ロールバック・利用終了

更新時も同じソースでビルドしたmigrationを先に実行し、登録済みイメージのダイジェストとシークレットversionを変更してplan・applyします。Cloud Runを直接更新してTerraformと不一致を作らないでください。

ロールバックは前の保護されたイメージのダイジェストへ戻してplan・applyします。DBの変更は戻らないため、migrationは旧アプリと互換性を維持します。不要な `release-` タグは稼働・復旧対象でないことを確認して整理します。

利用終了時は、Cloud Runの `deletion_protection` をfalseに変更して一度applyした後、削除planを確認します。シークレットやイメージの削除も含むため、必要な値と復旧用イメージを保全してください。GCSバケットとSupabaseはTerraform管理外なので別途整理します。API自体は他の利用者への影響を避けるため無効化しません。
