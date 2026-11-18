# Cloudflare検証Workerの配備

既存GCPと同じSupabaseを使用する、互換性検証専用Workerの配備手順です。[ローカル検証の結果](cloudflare-compatibility.md)を前提とします。アプリ全体のWorkers移植・自動配備は、実Hyperdrive経由の検証後に行います。

## 現在の準備状況

2026-11-17にWranglerのログインと既存Hyperdriveを読み取り確認しました。Hyperdriveはキャッシュ無効、SSL mode `verify-full`、CA証明書指定あり、origin connection limit `5` です。配備先は既存GCPと同じSupabaseです。

Terraform用APIトークンとAccessサービストークンをGit管理外の環境ファイルへ保存し、Worker全体のAccess保護をTerraformで構成済みです。2026-11-18に無料のSQLite型Durable Objectsを追加しました。入口Workerは認証・転送を担当し、既存ハッシュとPrismaの処理は内部のDurable Objectで実行します。同じSupabaseへの接続を保ち、ハッシュ4ケースの相互互換性、Prismaのtransaction・一意制約、ハッシュ・DBの並行リクエストが実Cloudflareで一括成功しました。課金プラン・既存GCP・DBスキーマは変更していません。詳細は[検証結果](cloudflare-compatibility.md)を参照してください。

## 管理範囲

| 対象                                                                 | 管理元                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------- |
| Worker本体・workers.devの有効化・preview無効化・ログ設定             | Terraform                                                  |
| Accessアプリ、メール許可リスト、8時間のセッション、自動検証ポリシー  | Terraform                                                  |
| One-time PIN                                                         | Terraform。既存のものがあればIDを参照して再利用            |
| Workerのコード・Hyperdrive binding・Durable Objectのclassとnamespace | Terraform出力から生成したconfigを使ってWranglerで配備      |
| 検証Workerの `SPIKE_TOKEN`                                           | ローカルで生成し、WranglerのSecretとしてコードと一緒に配備 |
| Terraform用APIトークン・Accessサービストークンの実値                 | 手動作成してGit管理外の環境ファイルへ保存                  |
| HyperdriveのDB資格情報とCA                                           | 既存の手動設定を利用                                       |

Cloudflare用rootは `infra/cloudflare/`、workspaceは `dev`、GCS backendのprefixは `hono-app/cloudflare` です。既存GCP用の `hono-app/gcp` とは共有しません。今回の検証構成は `dev` 以外のworkspaceへの適用を拒否します。

`enable_worker_url` とログ設定はTerraformを正本とし、配備用configにも同じ設定を出力します。Wranglerの設定を手作業で有効化したり、管理画面でAccessポリシーを別途追加したりしません。配備前にはAPIでAccessの保護対象・ポリシーの紐付けを確認します。ポリシー内容も含むドリフトはTerraformのplanで確認します。

## 1. 初期アカウント設定と秘密値の準備

Zero Trustの初期登録・Freeプラン選択は管理画面で完了します。WranglerのOAuth認証とは別に、Terraform用APIトークンを作成します。

[CloudflareのAPIトークン画面](https://dash.cloudflare.com/profile/api-tokens)でCreate Token → Create Custom Tokenを選び、対象を今回のCloudflareアカウント1件に限定します。権限は次のとおりです。

| Accountの権限              | 操作 | 用途                                               |
| -------------------------- | ---- | -------------------------------------------------- |
| Workers Scripts            | Edit | Worker本体の作成・更新                             |
| Access: Apps               | Edit | Accessの保護対象の管理と配備前の確認               |
| Access: Policies           | Edit | 許可ポリシーの管理                                 |
| Access: Identity Providers | Edit | One-time PINの管理・既存設定の読み取り             |
| Access: Service Tokens     | Read | 手動発行したトークンの管理用ID・有効期限の読み取り |

APIトークンは `CLOUDFLARE_API_TOKEN` として `.env.cloudflare.local` へ保存します。tfvarsに書いたり、チャットへ貼ったりしません。APIトークンはCloudflare providerの環境変数認証に使い、Terraform resourceの入力へ渡しません。

AccessサービストークンはZero Trust → Access controls → Service credentials → Service Tokensで手動発行します。

- 名前: `hono-app-dev-verification`
- 有効期限: Customで720時間（30日）
- Client ID: `.env.cloudflare.local` の `CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID`
- Client Secret: 同じファイルの `CLOUDFLARE_SPIKE_ACCESS_CLIENT_SECRET`

APIトークンとAccessサービストークンは別物です。Client Secretは発行時しか表示されません。後者をTerraformで発行しないため、Secretをstateに保存しません。許可メールアドレスや各種IDなどの設定値はstateに保存されます。

`.env.cloudflare.local` はGit・Docker・スペルチェック・フォーマットから除外しています。初めて別のcheckoutで準備するときは `.env.cloudflare.local.example` をコピーし、ファイルの読み取り権限を所有者だけにします。

```bash
cp .env.cloudflare.local.example .env.cloudflare.local
chmod 600 .env.cloudflare.local
```

今回の作業ディレクトリにはAPIトークンを保存済みなので、コピーによる上書きは行いません。通常 `CLOUDFLARE_SPIKE_TOKEN` は空欄のままにします。

## 2. ローカル入力と既存Access設定の確認

今回の作業ディレクトリには、確認済みAccount ID・Hyperdrive ID・GCPのIAPと同じ許可メールを `infra/cloudflare/env/dev.local.tfvars` に設定済みです。backendにも既存GCSバケットとCloudflare専用prefixを設定済みです。これらはGit管理外です。

別checkoutの場合は `env/dev.tfvars.example` と `env/backend.gcs.hcl.example` を、それぞれ `env/dev.local.tfvars` と `env/backend.local.hcl` へコピーして実値を設定します。

秘密値を環境ファイルへ保存した後、リポジトリルートで次を実行します。

```bash
bun --env-file=.env.cloudflare.local scripts/cloudflare-compatibility/configureAccess.mjs
```

この処理はCloudflare設定を読み取り、名前とClient IDが一致する有効なトークンだけを選択します。管理用IDをローカルtfvarsへ設定し、既存One-time PINがあれば再利用します。既存OTPが複数ある場合は自動選択せず停止します。

管理画面でAccessアプリや同名Workerを先に作成済みの場合は、初回planの前に対象IDと既存設定を確認し、必要なresourceをimportします。既存設定を重複作成したり、保護を解除して作り直したりしません。

## 3. URL無効の状態でTerraformを適用する

GCSへの認証には、既存のTerraform運用で使用しているGoogle資格情報を使います。ADCが未設定の場合は `gcloud auth application-default login` で準備します。GCP用rootのapplyは実行しません。

```bash
TF_WORKSPACE=dev bun run tf:cloudflare:init
TF_WORKSPACE=dev bun --env-file=.env.cloudflare.local run tf:cloudflare:plan -out=bootstrap.tfplan
TF_WORKSPACE=dev bun --env-file=.env.cloudflare.local run tf:cloudflare:apply bootstrap.tfplan
```

初回入力は `enable_worker_url = false` です。planで検証用Worker・Access・必要なIdP／ポリシーだけが対象であることを確認します。コードのVersion／Deployment、Hyperdrive、既存GCP、DB schemaはTerraformの管理対象に含みません。

TerraformはWorker本体を作成してから、そのWorker IDへAccessを紐付けます。初回にURLを有効化しないことで、Accessの作成前にコードへ到達する時間帯を作りません。previewも無効です。

Worker作成直後は、Access APIへの情報反映待ちで `worker_id not found` が返る場合があります。URLは無効のまま、作成済みresourceがstateに記録されていることを確認し、新しいplanで残りのAccessアプリだけを作成します。最初のplanファイルは再利用しません。

## 4. 保護済みWorkerへコードとSecretを配備する

```bash
cd scripts/cloudflare-compatibility
bun --env-file=../../.env.cloudflare.local run deploy:remote
cd ../..
```

このコマンドは次を実行します。

1. Cloudflare用stateの `remote_config` とCloudflare上のAccess設定を読み取り、紐付けが一致することを確認。
2. 同じschemaからWorkers専用Prismaクライアントを生成。ハッシュ候補の静的Wasmも準備。
3. `.wrangler/wrangler.remote.json` を生成。DB接続文字列・APIトークン・Access秘密値を含めない。
4. `.wrangler/secrets.remote.json` に検証用 `SPIKE_TOKEN` を生成。既存ファイルがあれば同じ値を再利用。
5. Wranglerでコード・Secret・SQLite型Durable Objectのbindingとclassを同時に配備。初回はworkers.devを引き続き無効にし、再配備はTerraformの設定を維持。

依存を初期化していないcheckoutでは、先に検証ディレクトリで `bun install --frozen-lockfile --ignore-scripts` を実行します。生成物とSecretファイルはGit管理外で、Secretファイルは所有者のみが読み書きできます。

remote配備の既定値は `CLOUDFLARE_SPIKE_RUNTIME_PROFILE=durable`・`CLOUDFLARE_SPIKE_PASSWORD_VERIFIER=legacy` です。`new_sqlite_classes` の固定migration tagでnamespaceを作成します。SQLiteへユーザーデータは書き込みません。namespace作成後にclassを削除する配備へ切り替えず、同じclassとmigration tagを維持します。ライフサイクルの削除を、単なる比較方式の切り替えとして実行しません。

## 5. Access保護後に検証URLを有効にする

ローカルtfvarsの `enable_worker_url` を `true` に変更し、新しいplanを確認して適用します。

```bash
TF_WORKSPACE=dev bun --env-file=.env.cloudflare.local run tf:cloudflare:plan -out=expose.tfplan
TF_WORKSPACE=dev bun --env-file=.env.cloudflare.local run tf:cloudflare:apply expose.tfplan
```

このplanでは、Accessの既存保護を維持したままWorkerのworkers.dev設定を有効化します。Worker・Accessの置換や削除が出た場合は適用せず原因を確認します。後続のコード配備でもconfigを毎回Terraformから再生成し、古い公開状態で上書きしません。

Workers & Pagesで有効になった検証WorkerのHTTPS Originを確認し、`.env.cloudflare.local` の `CLOUDFLARE_SPIKE_URL` へ設定します。初回Workers利用でアカウントのworkers.devサブドメインがない場合は、Workers & Pagesのトップ画面を開くと自動作成されます。今回もこの操作で作成しました。作成直後は証明書の反映に数分かかり、TLS handshakeが失敗する場合があります。TLS検証は無効化せず、反映後に再実行します。

## 6. 実Hyperdrive経由で検証する

```bash
cd scripts/cloudflare-compatibility
bun --env-file=../../.env.cloudflare.local run verify:database --durable --concurrency
bun --env-file=../../.env.cloudflare.local run measure:cpu
cd ../..
```

検証コードはローカルのSecretファイルを読み取るため、通常 `CLOUDFLARE_SPIKE_TOKEN` の手入力は不要です。Access資格情報なしの拒否、Access通過後のWorker秘密値未指定時の401、ハッシュ相互互換性、Prisma・transaction・一意制約・並行DBリクエストを確認します。DBはハッシュより先に検証し、片方が失敗してももう片方の結果を記録します。`--concurrency` では同じDurable Objectで直列経路と並行経路を比較し、固定200msの読み取り専用待機SQLの重なり、最大4件のモデルAPI・ハッシュ・混在リクエストを追加確認します。CPU時間とは別にHTTP往復時間を記録します。

実DBにはUUID付きの検証行だけを作成し、rollbackと専用行の削除で後始末します。migrationやresetは実行しません。結果JSONはGit管理外に保存し、秘密値やユーザーデータは出力しません。

通常のWorkerはCPU 10ms、Durable Objectsは既定CPU 30秒で、両者の時間を区別します。Freeのリクエスト数・Durable Objectsの実行時間・HyperdriveのSQL数にも上限があります。詳しくは[無料枠の条件](cloudflare-compatibility.md#無料枠の条件)を参照してください。CPU診断が欠落した結果は0msとして扱いません。スクリプトはプラン変更・課金契約を自動実行しません。

検証後にURLを閉じる場合は、`enable_worker_url = false` に戻したplanを適用します。検証用Secret・トークンの再発行や削除は、利用中の配備と検証クライアントの両方を確認してから行います。

## 静的検証

```bash
TF_WORKSPACE=dev bun run tf:cloudflare:init:no-backend -lockfile=readonly
bun run tf:cloudflare:validate
bun run tf:cloudflare:lint
TF_WORKSPACE=dev bun run tf:cloudflare:test
bun test --isolate scripts/cloudflare-compatibility/test
```

Terraformはproviderをモックし、クラウド認証なしで検証します。共通の `ci.yml` で、CloudflareのTerraform検査をAWS・GCPと並列実行します。補助コード・Wasmの単体テスト、Cloudflare専用ファイルのlint・スペル検査も共通CIへ含めます。Cloudflareを含むいずれかの検査が失敗した場合は共通CIが失敗し、GCPの配備へ進みません。Cloudflare自体の配備は現在手動で、CDはまだ追加していません。検証Workerの実Workers・Hyperdrive検証はCIへ追加しません。本体アプリは別ジョブでローカルworkerdと使い捨てPostgreSQLを検証します。固定providerは `cloudflare/cloudflare 5.29.0` とし、macOS ARMとLinux AMD64のチェックサムをlockfileへ記録します。

## 本体アプリ

本体アプリの別Worker・Durable Object・設定・実DB/workerd検証は [本体アプリのCloudflare実行経路](cloudflare-app.md) を参照してください。検証Workerの配備コマンドは本体用ではありません。本体の自動配備は後続PRです。
