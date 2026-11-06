# GCPの無料枠を優先した公開準備

Bun / HonoをCloud Run、DBとSupabase Authをクラウド版Supabase Freeで動かします。AWSは `infra/aws/`、GCPは `infra/gcp/` で別々に管理します。Dockerfileは共用します。

devでは2026-10-30に初回CDが成功し、mainへのマージ後の自動配備を有効化済みです。初回構築を行う場合は、前半のローカル検証と、後半の実環境を変更する操作を分けて進めてください。

## dev環境のアクセス先

利用にはIAPで許可済みのGoogleアカウントが必要です。ブラウザで開くと、必要に応じてGoogle認証へ進みます。

- API: [https://hono-app-dev-669070496198.asia-northeast1.run.app](https://hono-app-dev-669070496198.asia-northeast1.run.app)
- Scalar: [APIリファレンスを開く](https://hono-app-dev-669070496198.asia-northeast1.run.app/open-api/scalar)
- health: [稼働確認](https://hono-app-dev-669070496198.asia-northeast1.run.app/health)

上記はメール・Supabaseの転送先や `ALLOWED_ORIGINS` と合わせた採用済みOriginです。Terraformの `service_url` が別形式の有効なOriginを返す場合があるため、その出力で案内URLを置き換えません。

初回CDのSHA・workflow・revision・digestと検証範囲は[初回CDの検証記録](deployment-gcp-cd.md#初回cdの検証記録2026-10-30)を参照してください。最新の配備状況は [GCP dev CDのActions一覧](https://github.com/kojiyamauchi/hono-app/actions/workflows/cd-gcp.yml)で確認できます。認証付きhealthの成功は、ブラウザの全ユーザーフローやメール配達まで検証済みという意味ではありません。

## 管理範囲とアクセス制限

- 既存の課金設定済みGCPプロジェクトを入力します。プロジェクトとstate保存用GCSバケットはTerraform管理外の前提リソースです。
- Terraformは必要なAPI、Artifact Registry、6つのSecret Managerの入れ物、アプリ用サービスアカウント、IAPサービスエージェント、Cloud Run、呼び出し権限を管理します。
- Cloud Monitoringの5xxアラートポリシーもTerraformで管理します。メール通知チャネルはConsoleで作成・管理し、Terraformはチャネルのリソース名だけを参照します。条件・しきい値・通知後のログ確認手順は[5xxアラートと通知後のログ確認](#5xxアラートと通知後のログ確認)を参照してください。
- Supabaseプロジェクトは管理画面でFreeを選択します。APIとDBのリージョンは可能な限り近づけます。
- APIは `run.app` のHTTPS URLを使い、Cloud Runへ直接IAPを設定します。ブラウザでURLを開くと必要に応じてGoogle認証へ進み、許可したアカウントだけがScalar・APIへアクセスできます。Basic認証は追加しません。
- `roles/run.invoker` はIAPサービスエージェントだけへ付けます。利用者はサービス単位の `roles/iap.httpsResourceAccessor` で管理し、`invoker_members` をIAPの許可対象の正本にします。両方をbindingで一括管理し、手動で追加された権限もplanへ反映します。プロジェクト・組織から継承する権限は別途確認します。
- 個人Gmail・組織外ユーザーの利用には、初回だけカスタムOAuthクライアントの準備が必要です。OAuthクライアントの作成・同意画面の設定はTerraform管理外とし、クライアントシークレットをtfvars・state・PRへ書きません。[Cloud Run直接IAPの設定](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run)
- シークレットの実値とversionの作成はTerraform管理外とし、stateへ保存しません。Supabaseは `SUPABASE_PUBLISHABLE_KEY` にPublishable keyを設定します。管理権限を持つSecret key・service roleキーは使いません。既存ローカル・AWS用の `SUPABASE_ANON_KEY` は互換設定として利用できます。
- GCPではPublishable keyを公開設定（tfvars・state）で扱い、Secret Managerの無料枠である有効6 versionをDB接続情報・4種類の鍵・Resend APIキーに割り当てます。
- dev環境では `enable_api_docs = true` により、IAPの内側にOpenAPIとScalarを公開します。staging / prodでは公開しません。ScalarのAPI呼び出しは同じOriginへ送り、外部のAPIプロキシは使いません。
- 通常起動ではmigrationを実行しません。初回手動配備ではDockerfileの `migration` ターゲットをローカルで実行し、devの通常CDでは同じターゲットをActions runnerで実行してからCloud Runを更新します。
- AWS用CDは引き続きECRへの登録だけを行います。GCP devの自動配備は2026-10-30に有効化済みです。通常配備・初回認証構築・有効化条件・停止と復旧は[自動配備の手順](deployment-gcp-cd.md)を参照してください。新しい環境では明示的に有効化するまでCDは動きません。

## 無料枠と費用の前提

Cloud Runは最小0・最大1インスタンス、1 vCPU / 512 MiB、リクエスト単位課金、起動時CPU boost無効です。アクセスがない間の常時稼働を避け、外部trace送信も無効にします。VPC、NAT、ロードバランサー、Cloud SQLは作りません。

無料枠内に収まりやすい設定ですが、月額0円を保証する構成ではありません。Cloud Runの処理・起動時間とリクエスト数、東京からの外向き通信、Artifact Registryの保存容量、GCSのstateと過去バージョン、ログが課金対象になり得ます。最大インスタンス数は金額の上限ではなく、更新時などには一時的な超過もあります。

- Cloud Runの無料枠は請求先アカウント全体で共有します。通信にも別の課金があり、東京からの通信をすべて無料とは扱いません。[Cloud Run料金](https://cloud.google.com/run/pricing)
- Artifact Registryの無料保存枠は0.5 GBです。登録するのはruntimeイメージだけとし、migrationイメージは登録しません。古い通常タグのイメージは1日後から削除対象になります。`release-` タグは保護するため、稼働中・復旧用だけを残して容量を確認します。削除は即時ではありません。[保存料金](https://cloud.google.com/artifact-registry/pricing)
- Secret Managerは6つの有効なversionまで無料です。各シークレットを1 versionで運用すればこの枠に収まります。古いversionは無効化だけでも課金対象のため、ローテーション後に参照・復旧方針を確認して不要なversionを破棄します。[Secret Manager料金](https://cloud.google.com/secret-manager/pricing)
- Supabase FreeはDB容量500 MBで、1週間利用がないと一時停止します。定期アクセスで停止を回避する前提にはしません。[Supabase料金](https://supabase.com/pricing)
- 公開前にGCPのBilling画面で少額の予算とメール通知を設定し、公開後は費用レポートを確認します。予算通知は自動停止や課金の上限ではありません。

メールの無料枠、送信ドメイン、フロントエンドのホスティング、有料監視は別途確認します。

既存の予算通知がある場合は重複作成せず、期間・対象プロジェクト・金額・実績か予測か・通知先を確認して記録します。今回のdevでは月100円、実績50%・90%・100%、Gmail宛ての既存通知を使用します。クレジット適用後の費用を対象とする予算は、無料トライアル中のリソース使用量そのものを通知する設定とは異なります。

## 5xxアラートと通知後のログ確認

Cloud Monitoringで、dev環境のCloud Runが返したHTTP 5xxの増加をメール通知します。対象は `hono-app-dev` が返した応答だけです。IAPが未認証リクエストを拒否した場合やサービスへ到達できない場合はCloud Runの `request_count` に現れないため、このアラートの対象外です。

通知チャネル（メール）はGCP Consoleで作成・管理し、Terraformはチャネルのリソース名だけを参照します。`infra/gcp/env/dev.cd.tfvars.json` の `alert_notification_channel` に `projects/<プロジェクトID>/notificationChannels/<チャネルID>` を記載し、メールアドレスはリポジトリとTerraform stateへ載せません。この入力を省略した構成では、通知先のないアラートポリシーを作りません。差し替え前のプレースホルダ（`REPLACE_ME` を含む値）は入力検証で拒否するため、チャネルを作成してリソース名を記載するまでplanは通りません。

### 初期条件としきい値の考え方

| 項目         | 初期値                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| 指標         | `run.googleapis.com/request_count` の `response_code_class = "5xx"`       |
| 対象         | `resource.type = "cloud_run_revision"` と対象サービス名。リビジョンは合算 |
| 集計         | 5分間（`300s`）の合計（`ALIGN_SUM` / `REDUCE_SUM`）                       |
| 条件         | 合計が2件を超過（3件以上）で発報                                          |
| 再テスト期間 | `duration = "60s"`（しきい値超過が1分続いたら発報）                       |
| 欠損データ   | `EVALUATION_MISSING_DATA_INACTIVE`                                        |
| 自動クローズ | 30分（`1800s`）                                                           |

しきい値を件数で評価するのは、devの低トラフィックでは5xxの比率が1件で100%になり得て、割合では安定して判断できないためです。最小0インスタンスのためアクセス間隔が空くと毎回コールドスタートになり、起動遅延や30秒のリクエストタイムアウトに起因する単発の5xxが混ざり得ます。そのため1件では発報させません。一方で最大1インスタンス・リクエスト同時実行8の構成では、実際に壊れている場合は短時間に複数の5xxが並ぶため、5分間で3件以上を異常として扱います。

リクエストがない時間帯は系列自体が欠損します。欠損を異常と扱わない設定にして、アクセスのない夜間などに発報しないようにしています。この欠損データの扱いは `duration` が60秒以上のときだけ有効になり、即時評価（`0s`）では無視されます。そのため `duration` は最小の60秒とし、5xxの後にアクセスが途絶えた場合も、自動クローズ待ちにせずincidentを閉じられるようにしています。[欠損データの仕様](https://docs.cloud.google.com/monitoring/alerts/concepts-indepth#partial-metric-data)

`duration = "60s"` では、5分間の合計がしきい値を超えた状態が1分続いたときに発報します。検知は即時評価より約1分遅くなりますが、5分間の合計は直近のバーストを含み続けるため、短時間に集中した5xxも取りこぼしません。

この値は実データに基づく確定値ではありません。運用開始後に、誤報（コールドスタート起因の単発5xx）と見逃し（短時間に収まる障害）の実績を見て、しきい値・集計期間・再テスト期間・自動クローズ時間を見直す前提です。見直した場合は、このセクションの初期値と根拠も更新してください。リクエスト数とp95応答時間は、発報時の切り分け用にCloud Monitoringのメトリクスエクスプローラーで確認します。

アラートポリシーの対象・集計条件・通知先の参照は `TF_WORKSPACE=dev bun run tf:gcp:test` のモックテストで検証します。実環境での発報とメール受信の確認は、Terraformの適用後に別途行います。

### 通知を起点にログを特定する

1. 通知メールのサービス名と発生時刻（incidentの開始時刻）を確認します。Cloud Monitoringのincident画面では、発報した条件と対象サービスを確認できます。
2. Cloud Loggingのログエクスプローラーで、通知時刻の前後に絞って該当リクエストを探します。`timestamp` は通知時刻の前後10分程度から始めます。

   ```txt
   resource.type="cloud_run_revision"
   resource.labels.service_name="hono-app-dev"
   httpRequest.status>=500
   ```

3. 該当リクエストログの `resource.labels.revision_name` で、5xxを返したリビジョンを特定します。配備直後であれば、そのrevisionのdigestを[GCP dev CDのActions一覧](https://github.com/kojiyamauchi/hono-app/actions/workflows/cd-gcp.yml)の配備サマリーと照合します。
4. 特定したリビジョンのアプリ側ログを確認します。Honoの `onError` が返す500は、リクエストログだけでは原因が分からないため、同じrevisionの標準出力・標準エラーを合わせて読みます。

   ```txt
   resource.type="cloud_run_revision"
   resource.labels.service_name="hono-app-dev"
   resource.labels.revision_name="<手順3で特定したrevision>"
   severity>=ERROR
   ```

5. 起動に失敗している場合は、`/health` のstartup probeの失敗やコンテナ起動ログも確認します。リビジョン単位で切り分けたうえで、復旧が必要なら[更新・ロールバック・利用終了](#更新ロールバック利用終了)に従って直前のdigestへ戻します。

ログの保存・取り込みにも無料枠を超えた分の課金があります。調査用のログ保持期間やログベースの指標を追加する場合は、費用を別途確認してください。

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

`test:container` はDocker Desktop・Bun・OpenSSLを使用します。両イメージの公開CA同梱と未知のCA・異なるホスト名の拒否を確認し、使い捨てPostgreSQLでmigrationと認証の動作を検証します。GCPやクラウド版Supabaseへは接続しません。既存DBはresetしません。

## 初回構築・手動配備の操作

ここからはプロジェクト・リソース作成、イメージのpush、クラウドDBへの書き込みを行います。対象アカウント・プロジェクトを確認してから実施してください。構築済みdevの通常更新は[自動配備の手順](deployment-gcp-cd.md)を使います。手動変更は実行中CDと重ねず、CD構築済み環境では `dev.cd.tfvars.json` と現在または復旧対象のdigestを使ってCD用リソースもplanへ含めます。

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

クラウド版SupabaseでFreeプロジェクトを作成します。Connect画面の **Session pooler / 5432番** の接続文字列を使用し、`sslmode=verify-full` を付けます。ホストを推測せず画面の値を使い、パスワードをURLエンコードします。IPv6専用の直接接続を使う構成にはしません。[Supabaseの接続方式](https://supabase.com/docs/guides/database/connecting-to-postgres)

runtimeとmigrationにはSupabaseの公開CAを同梱し、`NODE_EXTRA_CA_CERTS` でBunの既定CAへ追加しています。`verify-full` で接続先の証明書とホスト名を検証します。追加の証明書マウントやSecret ManagerへのCA登録は不要です。公開CAの取得元・有効期限・更新手順は[証明書の管理手順](../certificates/README.md)を参照してください。

Data APIは無効にし、Prismaが作る認証・ユーザーテーブルを公開しません。Supabase AuthのSite URL・Redirect URLsは実際に利用する画面へ設定します。今回のdevでは後述のScalarを使います。DBの接続元IP制限を使用している場合は、今回のCloud Run構成には固定送信元IPがないことを考慮してください。固定IPが必要ならNATなどの費用を含めて別途設計します。

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

既存ドメインを使う場合は、送信専用サブドメインをResendへ登録し、表示されたDNSレコードだけを追加します。既存サイト・メールのレコードと重複しないことを確認し、受信メールの設定は変更しません。今回のdevは `notify.kojiyamauchi.com` / `noreply@notify.kojiyamauchi.com` を使用します。DNS値はResendが実際に表示する値を使い、過去の手順から推測しません。

Supabase Authでは確認メールを有効にし、ResendのカスタムSMTPを設定します。SMTPのホスト・ポート・認証情報は[Resend公式手順](https://resend.com/docs/send-with-supabase-smtp)を確認します。SMTPパスワードに使うAPIキーはSupabaseの設定へ直接入力し、ログやPRに残しません。独自認証のResend API送信とは別に、Supabase側の設定・配達を検証します。

Supabase AuthのSite URL・Redirect URLsには今回のScalarのHTTPS URLを設定します。確認メールの標準リンクはSupabase側で検証してからScalarへ戻します。Hono側の既存3APIは登録・ログイン・本人取得であり、独自認証の確認APIへSupabaseのトークンを渡しません。Supabase Authには今回パスワード再設定・refresh等の新規APIを追加しません。

#### IAPの初回OAuth設定

Google Auth Platformで外部向けの同意画面とウェブアプリケーション用OAuthクライアントを作成します。テスト中のアプリでは、利用するGmailをテストユーザーへ追加します。クライアントの承認済みリダイレクトURIには `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect` を登録します。これはIAPのコールバックであり、ScalarのURLではありません。

IAP APIの有効化後、公式手順の `access_settings.oauth_settings.client_id` / `client_secret` を含むYAMLをGit管理外へ作成し、権限を600にします。`gcloud --configuration=hono-app-dev iap settings set <保護したYAMLのパス> --project=<対象プロジェクト>` でプロジェクトへ設定し、使用後に一時ファイルを削除します。秘密値を含み得る設定全体の出力はログへ残しません。OAuthクライアントの用意だけではIAPの設定は完了せず、この設定とTerraformによるIAP有効化・利用者権限の適用まで必要です。[カスタムOAuthの公式手順](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run#configure-custom-oauth)

### 3. 同じソースからビルドし、migrationを実行する

リリースするコミットへ揃えたcleanなcheckoutで実行します。migration用環境ファイルは既存の `.env.deployment.local.example` をコピーし、実際の `DATABASE_URL` だけを引用符なしで記載します。

`git status --porcelain` が空であることを確認し、`git rev-parse HEAD` の完全なSHAを記録します。両イメージは同じcheckoutからビルドし、過去のローカルタグを再利用しません。

```bash
cp .env.deployment.local.example .env.deployment.local
chmod 600 .env.deployment.local
docker build --platform linux/amd64 --target runtime -t hono-app:gcp-release .
docker build --platform linux/amd64 --target migration -t hono-app:gcp-migration .
docker run --rm --platform linux/amd64 --env-file .env.deployment.local hono-app:gcp-migration bunx --no-install prisma migrate status
docker run --rm --platform linux/amd64 --env-file .env.deployment.local hono-app:gcp-migration
```

接続先が今回のSupabaseであることを確認します。未適用のmigrationがある場合に `prisma migrate deploy` を実行します。同じmigration群の適用成功・チェックサム確認を記録済みで、今回のstatusもup to dateなら、再適用やresetは不要です。通常起動用イメージにはPrisma CLIやmigrationファイルがないため、runtimeイメージのコマンド上書きでmigrationを実行しません。接続情報の一時ファイルは使用後に削除します。

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

gcloud設定を複数使う環境では、認証・登録確認・トークン取得を含む各gcloudコマンドへ `--configuration=<対象の設定名>` を明示します。今回のdevでは `--configuration=hono-app-dev` を使用します。

### 5. API設定を入力して配備する

`dev.local.tfvars` のコメント付きサンプルを使い、`app_image_digest`、`invoker_members`、公開設定、6つすべての `secret_versions` を追記します。シークレットは登録した数値versionに固定し、`latest` は使いません。

CookieはSecureを強制します。cross-siteのフロントエンドでCookieを使う場合は `COOKIE_SAMESITE = "None"` が必要ですが、ブラウザ側のthird-party Cookie制限も受けます。IAM認証付きAPIを別Originのブラウザから使う構成は、CORSのpreflightとGoogle認証の扱いも設計が必要です。

今回のdevは同じOriginのScalarを使い、`COOKIE_SAMESITE = "Lax"`、`AUTH_EMAIL_MODE = "scalar"`、`enable_api_docs = true` にします。`ALLOWED_ORIGINS` はScalarを開くサービスのOriginとします。CORSとは別にOrigin検証もあるため、同じOriginからのPOSTでも許可設定が必要です。

独自認証の `PASSWORD_RESET_URL_BASE` / `EMAIL_VERIFICATION_URL_BASE` はScalarの固定URLとします。scalar形式のメールはURLへトークンを付けず、本文にトークンと対象APIを案内します。メール確認は `POST /auth/email-verification/confirm` の `token`、パスワード再設定は `POST /auth/password-reset/confirm` の `token` / `password` をScalarへ入力して実行します。link形式を使う既存のメール動作は維持します。

サービス作成前にURLが必要な場合は、短いサービス名で利用できる `https://<サービス名>-<プロジェクト番号>.<リージョン>.run.app` の形式を使います。apply後に実際の出力URLとも照合します。[標準URLの仕様](https://docs.cloud.google.com/run/docs/triggering/https-request#service_url)

devのScalarは、メールとSupabaseの転送先に設定した[採用済みURL](https://hono-app-dev-669070496198.asia-northeast1.run.app/open-api/scalar)で開きます。Terraformの `service_url` は別形式の有効な標準URLを返す場合があるため、その出力URLをScalarの案内へそのまま置き換えません。別のOriginでも利用する場合は、先に `ALLOWED_ORIGINS` へそのOriginを明示的に追加して配備し、ブラウザでPOSTの成功を確認します。

```bash
terraform -chdir=infra/gcp workspace show
bun run tf:gcp:plan -var-file=env/dev.local.tfvars -out=release.tfplan
bun run tf:gcp:apply release.tfplan
gcp_service_url="$(terraform -chdir=infra/gcp output -raw service_url)"
curl --silent --output /dev/null --write-out '%{http_code}\n' "$gcp_service_url/health"
```

最後の認証なしの呼び出しは、Google認証へのリダイレクトまたはアクセス拒否となり、アプリのhealth本文を返さないことを確認します。ブラウザではメールと同じURLの `/open-api/scalar` を開き、許可済みGoogleアカウントでログインして確認します。プログラムからの検証にはIAPのプログラム用認証を使用します。

プログラム用のトークンはIAP向けに取得し、許可するOAuthクライアントとaudienceも事前に確認します。値はログやコマンド履歴へ残さず、curlで使う場合は保護した設定ファイルからヘッダーを読み込みます。

アプリ自身のJWTは `Authorization`、ブラウザのIAP認証はセッションCookieを使う想定です。初回配備直後、同じOriginのScalarから独自認証でログインして `/auth/me` を呼び、CookieとBearerトークンが併用できることを最初に実測します。Supabase Authは確認メール完了後の既存3API検証で `/supabase-auth/me` も同様に確認します。各JWTを付けたリクエストの成功を確認するまでは、その併用を検証済みと扱いません。

401・403の場合は、`X-Goog-IAP-Generated-Response` の有無とアプリ側の応答を確認して、拒否した層を切り分けます。IAPで拒否される場合は後続の動作検証を中断し、認証方式の調整をレビューします。プログラム用の確認では、Google用トークンを `Proxy-Authorization` に渡してアプリの `Authorization` と分離できます。IAPへ許可するOAuthクライアント・audienceを確認し、サービスURL向けのGoogle IDトークンだけで通過できるとは扱いません。[IAPのプログラム認証](https://docs.cloud.google.com/iap/docs/authentication-howto)、[IAP応答の識別](https://docs.cloud.google.com/iap/docs/query-parameters-and-headers-howto)

`/health` はプロセスの稼働確認であり、DB接続は保証しません。検証専用アカウントで登録・ログイン・本人取得・refreshを確認し、検証データを削除します。メールの配達とSupabase Authはそれぞれ別途確認します。

ブラウザのScalarでも登録・ログイン・本人取得・refresh・メール内トークンによる確認を行います。Resendの送信受付だけで配達成功とは扱わず、配達イベントまたは本人の受信を確認します。Supabase Authは既存の登録・ログイン・本人取得と確認メールを検証し、作成した検証ユーザーを削除します。

初回構築や手動配備に必要な変更と配備前の確認はPRへまとめ、Claudeとユーザーのレビュー後にマージします。手動配備はマージ済みソースからビルドし、最終リリースplanを確認してapplyします。実施した配備後の結果・稼働revision・実イメージのダイジェスト・再plan・検証データ削除・容量と費用の確認結果を記録します。devの通常更新は導入済みのCDがmigration・保存planの検査と適用・IAP付きhealth・再planを実行します。文書だけの変更もmainへマージすると通常CDが起動します。

Cloud Run標準URLへ直接接続する構成だけを対象とし、IP単位のレート制限は `X-Forwarded-For` の末尾を使います。公開前に、偽の先頭IPを変えても制限を回避できないことを確認します。追加のロードバランサー・CDN・プロキシを導入する場合は、この信頼境界を見直してください。

### 更新・ロールバック・利用終了

devの通常更新は[自動配備の手順](deployment-gcp-cd.md)に従い、mainへのマージとCI成功後に追加承認なしで配備します。手動更新時も同じソースでビルドしたmigrationを先に実行し、登録済みイメージのダイジェストと数値シークレット参照を明示してplan・applyします。Cloud Runを直接更新してTerraformと不一致を作らないでください。

ロールバックは前の保護されたイメージのダイジェストへ戻してplan・applyします。DBの変更は戻らないため、migrationは旧アプリと互換性を維持します。不要な `release-` タグは稼働・復旧対象でないことを確認して整理します。

利用終了時は、Cloud Runの `deletion_protection` をfalseに変更して一度applyした後、削除planを確認します。シークレットやイメージの削除も含むため、必要な値と復旧用イメージを保全してください。GCSバケットとSupabaseはTerraform管理外なので別途整理します。API自体は他の利用者への影響を避けるため無効化しません。
