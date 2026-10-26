# Honoの公開準備とデプロイ

この手順はAWS ECS/Fargateとクラウド版Supabaseを使う構成を対象とします。準備中はAWSへのapply、イメージのpush、クラウドDBへのmigrationを実行しません。最後の「公開を決めた後の操作」だけが外部環境を変更します。

## 配線と管理範囲

- TerraformはECSのタスク定義・サービスを管理し、Honoの3000番ポートへALBから転送します。ヘルスチェックは既存の `/health` を使います。
- クライアントIPはALBが `X-Forwarded-For` の末尾へ追記した有効なIPだけを使います。ALBはappend・クライアントポート非付与に固定し、タスクのSGはALBからの接続だけを許可します。タスクを直接公開したり、ALBの前にCDN等を追加したりする場合は、この信頼境界を見直してください。[ALBの転送ヘッダー](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)
- イメージはECRの `sha256:...` ダイジェストで指定します。新しいリリースもロールバックも、この値を変更してplan・applyします。ECSだけを手動更新してTerraformとの不一致を作らないでください。
- 公開設定は `app_environment`、機密値は `app_secret_parameter_arns` のSSM参照で渡します。Terraformは機密値を読み取りません。
- タスク実行ロールは指定されたSSMパラメーターへの `ssm:GetParameters` だけを追加で持ちます。SSMはStandardのSecureStringと既定の `alias/aws/ssm` キーを使用します。カスタマー管理KMSキーを使う場合の復号権限は含みません。
- アプリの通常起動ではmigrationを実行しません。同じソースからビルドしたDockerの `migration` ターゲットを、サービス更新前に別プロセスで実行します。
- GitHub ActionsのCDはビルド・ECR登録・ダイジェストの記録までです。ECS更新やTerraform applyは自動実行しません。

OpenTelemetryの外部送信は全環境で既定無効です。stg/prodを含め、必要な環境のtfvarsで `otel_traces.enabled = true` と `headers_parameter_arn` を指定して有効化できます。ヘッダーは `api-key=...` 形式の実値をSSM SecureStringへ登録し、そのARNだけを渡します。送信先とサンプリング比率も `otel_traces.endpoint` / `sampling_ratio` で指定でき、既定はNew RelicのOTLP endpoint・0.1です。無効時はヘッダーの取得権限も追加しません。

## 公開前に入力する情報

以下のコピーはローカルのファイル操作だけです。コピー先はGit管理から除外しています。

```bash
cp infra/env/dev.application.tfvars.example infra/env/dev.application.local.tfvars
cp .env.deployment.local.example .env.deployment.local
chmod 600 .env.deployment.local
```

`dev.application.local.tfvars` に公開設定・実際のAWSアカウントのSSM ARN・登録済みイメージのダイジェストを記載します。サンプルのドメイン、アカウントID、ゼロだけのダイジェストは実際の値へ置き換えます。秘密の接続文字列や署名鍵をtfvarsへ書かないでください。

`.env.deployment.local` はmigrationコンテナ専用で、必要な `DATABASE_URL` だけを保持します。アプリの公開設定はtfvars、その他の機密値はSSMで管理し、このファイルへ重複して記載しません。`docker --env-file` は値の引用符を除去しないため、値を引用符で囲みません。

| 機密環境変数                      | 用途                                                  |
| --------------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`                    | Supabase PostgreSQLの接続文字列                       |
| `SUPABASE_ANON_KEY`               | Supabase Auth用の公開キー。service roleキーは使わない |
| `JWT_SECRET`                      | 独自認証のアクセストークン署名                        |
| `REFRESH_TOKEN_SECRET`            | リフレッシュトークンのハッシュ                        |
| `PASSWORD_RESET_TOKEN_SECRET`     | パスワード再設定トークンの署名                        |
| `EMAIL_VERIFICATION_TOKEN_SECRET` | メールアドレス検証トークンの署名                      |
| `RESEND_API_KEY`                  | 独自認証のメール送信                                  |

署名鍵はそれぞれ独立した十分に長いランダム値にします。メール送信元にはResendで検証済みのドメインを設定し、再設定・メール検証URLには実際のフロントエンドの対応ページを設定します。

### Supabaseの接続設定

このVPCはIPv4構成です。SupabaseのConnect画面から **Session pooler、5432番** の接続文字列をコピーし、SSLを必須にします。poolerホストは推測せず、画面に表示された値を使ってください。

```text
postgresql://postgres.<project-ref>:<URLエンコード済みパスワード>@<実際のpoolerホスト>:5432/postgres?sslmode=require
```

通常の直接接続はIPv6のみの場合があり、transaction poolerの6543番はsession単位の動作が異なります。本手順ではアプリとmigrationの両方をSession poolerへ接続します。[Supabaseの接続方式](https://supabase.com/docs/guides/database/connecting-to-postgres)

このアプリはPrismaでDBへアクセスし、Supabase SDKはAuthだけに使います。Supabase側のData APIは無効にして、Prismaが作成する認証・ユーザーテーブルをData APIへ公開しない構成にします。Supabase AuthのSite URL・Redirect URLsには実際のフロントエンドを設定してください。[SupabaseとPrismaの設定](https://supabase.com/docs/guides/database/prisma)

### HTTPSとCookie

HTTPのALB DNS名はcurlでの疎通確認に使用できます。ブラウザーで認証を使う公開環境には、東京リージョンの発行済みACM証明書・公開ドメイン・既存Route53 publicホストゾーンを設定してください。証明書指定時はHTTPからHTTPSへリダイレクトし、Secure Cookieを有効にします。

`ALLOWED_ORIGINS` は実際のフロントエンドのOriginを指定します。フロントエンドとAPIがcross-siteなら `COOKIE_SAMESITE = "None"` とHTTPSの両方が必要です。`stg/prod` では常にSecure Cookieを使います。

## 外部環境を変更しない検証

```bash
bun run typecheck
bun run lint:check
bun test --isolate
bun run tf:fmt:check
bun run tf:lint
bun run tf:validate
TF_WORKSPACE=dev bun run tf:test
bun run test:container
```

TerraformのモックテストはAWSリソースを作りません。コンテナ検証はDocker DesktopとBunを使用し、linux/amd64でビルドした非rootの本番イメージを0.25 vCPU・512 MBで起動します。使い捨てPostgreSQLへmigrationを2回適用し、登録・ログイン・本人取得・Cookieの更新、APIドキュメントの非公開を確認します。外部メールは送らず、検証後に自分で作成したコンテナ・匿名ボリューム・ネットワーク・イメージタグを削除します。既存のSupabaseやDBは操作しません。

## 公開を決めた後の操作

ここからはAWSの作成・課金、イメージ登録、クラウドDBへの書き込みが発生します。準備中は実行しません。

### 1. アカウント・前提リソース・機密値を確認する

```bash
aws sts get-caller-identity
terraform -chdir=infra workspace show
```

対象アカウントと `dev` workspaceを確認します。state用S3とアカウント共通OIDCプロバイダーは作成済みであることを前提とします。新しいアカウントへ構築する場合の初期化はREADMEのTerraform手順に従います。

`hono-app-dev-web` ECRリポジトリが未作成の場合は、初回だけリポジトリを先行作成します。公開設定のtfvarsを用意し、次のtarget付きplanでECRリポジトリとライフサイクルポリシーだけが対象であることを確認してから適用します。この操作もAWSへのapplyなので、公開準備中は実行しません。

```bash
terraform -chdir=infra plan -var-file=env/dev.tfvars \
  -var-file=env/dev.application.local.tfvars \
  -var='app_image_digest=sha256:1111111111111111111111111111111111111111111111111111111111111111' \
  -target=module.ecr_web -out=ecr-bootstrap.tfplan
terraform -chdir=infra apply ecr-bootstrap.tfplan
```

仮ダイジェストはこのtarget付きplanにだけCLIから渡し、公開設定ファイルへ保存しません。ECSサービスはこの操作では作成しません。続く2節・3節でビルドとイメージ登録を行い、実際のダイジェストを設定してから4節の全体plan・applyへ進みます。すでにECRリポジトリがある場合、この先行作成は不要です。

SSM Parameter Storeへ上記7項目を `/hono-app/dev/<環境変数名>` のStandard SecureStringとして登録し、`alias/aws/ssm` を選択します。値はAWS Consoleなどで入力し、シェル履歴やTerraform stateへ残さないでください。tfvarsには実際に登録したパラメーターのARNを設定します。[ECSのSSM参照](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html)

Supabaseで接続元IPを制限している場合は、migration実行元のIPと、適用後のNAT GatewayのEIPを接続許可へ追加します。

### 2. 同じソースのイメージをビルドし、migrationを実行する

リリース対象のコミットへ揃えたcleanなcheckoutで実行します。途中でソースや依存関係を変更した場合は両方を再ビルドしてください。

```bash
docker build --platform linux/amd64 --target runtime -t hono-app:release .
docker build --platform linux/amd64 --target migration -t hono-app:migration .
docker run --rm --platform linux/amd64 --env-file .env.deployment.local hono-app:migration
```

`prisma migrate deploy` の成功を確認してから次へ進みます。接続先を確認せず既存DBをresetしたり、`migrate dev` や `db push` を本番DBへ実行したりしないでください。

### 3. ECRへ登録してダイジェストを確定する

```bash
release_tag="release-$(git rev-parse --short HEAD)"
aws_account_id="$(aws sts get-caller-identity --query Account --output text)"
ecr_registry="${aws_account_id}.dkr.ecr.ap-northeast-1.amazonaws.com"
image_uri="${ecr_registry}/hono-app-dev-web:${release_tag}"
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin "$ecr_registry"
docker tag hono-app:release "$image_uri"
docker push "$image_uri"
aws ecr describe-images --region ap-northeast-1 --repository-name hono-app-dev-web \
  --image-ids "imageTag=${release_tag}" --query 'imageDetails[0].imageDigest' --output text
```

表示された値を `app_image_digest` へ設定します。`release-*` は現在のECRライフサイクルポリシーの自動削除対象外です。稼働中・ロールバック用のイメージはこのタグで保持します。CDが登録する `main-*` は最新10件、`manual-*` は30日で削除対象になるため、そのダイジェストを使う場合もECRで `release-*` タグを付けてから配備してください。不要なリリースイメージの削除は別途管理します。

### 4. 最終planを確認してapplyする

```bash
terraform -chdir=infra plan -var-file=env/dev.tfvars \
  -var-file=env/dev.application.local.tfvars -out=dev.tfplan
terraform -chdir=infra apply dev.tfplan
terraform -chdir=infra output -raw alb_url
```

ECSサービスが安定状態となり、ALBのターゲットがHealthyになることを確認します。表示されたURLの `/health` を確認し、検証専用アカウントで認証とDB操作を確認します。Supabase Authのメール確認とResendの実配達は、それぞれ実際の設定で確認してください。`/health` はプロセスのヘルスチェックであり、DB接続の成功までは保証しません。

シークレットを変更したときは同じARNでも既存タスクの環境変数は更新されません。SSM更新後はECSサービスの再起動を別途実施してください。

### 更新失敗とロールバック

ECSサービスは更新失敗時のロールバックを有効にしています。手動で戻す場合は前の `release-*` イメージのダイジェストへ `app_image_digest` を戻し、新しいplanを確認してapplyします。初回配備には戻り先がないため、起動失敗時はログから原因を修正します。

アプリのイメージを戻してもDB migrationは戻りません。後方互換性を維持できないDB変更では、更新前にデータのバックアップと復旧方針を用意してください。
