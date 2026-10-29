# GCP devの自動配備

mainへのマージをdevへの配備判断とし、追加承認なしで配備します。初回の認証・権限構築とCD有効化は、通常配備とは別にユーザーが内容を確認してから実施します。このPRや手順の追加だけではクラウド設定を変更しません。

## 実行範囲

- `ci.yml` はPRに加えてmainへのpushでもアプリ・AWS/GCP Terraformの検査を実行します。全検査成功後に `cd-gcp.yml` を呼び出します。
- repository variable `GCP_DEV_CD_ENABLED` が文字列 `true` の場合だけCDを実行します。未設定・falseでは認証・ビルド・push・migration・applyを行いません。
- 対象は `hono-app-dev-512908-f3`、`asia-northeast1`、Terraform workspace `dev`、既存サービス `hono-app-dev` です。AWS用CD、prod用CD、一般公開への変更は含みません。
- 配備全体を `gcp-dev-deployment` concurrency groupで直列化します。新しいpushで実行中のmigration・applyをキャンセルしません。古い待機runはmainのSHAと照合して省略します。
- devのGitHub Environment `gcp-dev` はmainだけを許可し、required reviewersを設定しません。将来prodを作る場合は別Environmentでmigration前の承認を設け、DB・Secret・state・サービスも分離します。prodブランチやprodリソースは今回作りません。

## 配備の順序

1. CIと同じ完全なcommit SHAをcheckoutします。runtime / migrationを同じソースからlinux/amd64でビルドし、revisionラベルへSHAを記録します。
2. クラウド認証前に、そのイメージを `test:container` で検証します。使い捨てPostgreSQLを使用し、実Supabaseへの接続や実メール送信はしません。
3. WIFで配備用SAを使用し、runtimeだけをArtifact Registryへ登録します。候補タグはSHA・run ID・attemptを含め、別のrunと衝突させません。migrationイメージはrunner内だけで使います。
4. Registryの確定digestと現在のReady revisionのdigestを記録します。現在のサービスがIAP有効・Ready revisionへ100%配信中であることも確認します。
5. GCS backendとdev workspaceで全体planを保存し、`gcp-cd-policy.mjs` でJSONを検査します。`-target` や `ignore_changes` で差分を隠しません。
6. DB用SAへ切り替え、固定Secret ID `hono-app-dev-database-url` の設定済み数値versionを取得します。現在の参照はversion 2です。既存versionの作成・変更・破棄は行いません。
7. 同じソースのmigrationコンテナからDB履歴とSQLのSHA-256を比較します。適用済み履歴がローカルmigrationの接頭辞であり、失敗済み・未解決・改変されたmigrationがない場合だけ未適用分を適用します。適用後にも履歴・チェックサム・読み取りを確認します。
8. 配備用認証を更新し、migration成功印・保存plan・直前digestを再確認します。現行と復旧用digestに保護タグを付けてから、検査した同じplanをapplyします。古いplanや更新競合では停止し、別のplanへ自動差し替えしません。
9. 最新Ready revision・実digest・100%トラフィック・再planの差分なしを確認します。
10. 検証用SAへ切り替え、採用済みOriginの未認証拒否とIAP認証付き `/health` の200・`ok: true`を確認します。Google認証は `Proxy-Authorization` へ渡し、リダイレクトを追跡しません。
11. 検証成功後だけ、現行と直前digest以外の既知の `release-` 保護タグを外します。イメージ自体は削除せず、既存のcleanup policyへ委ねます。未知の手動タグは触りません。

`prisma migrate status` の終了コード1は未適用と障害の両方を含むため、`|| true` で無視したり、すべてを未適用と判定したりしません。DB履歴とファイルを比較して区別します。`migrate deploy` 自体はschema drift全般を検出するものではないため、手動DDLを許可する運用にはしません。

通常runtimeではmigrationを実行しません。migrationは公開CAと `NODE_EXTRA_CA_CERTS` を使い、接続URLへ5432番と `sslmode=verify-full` を要求します。DB接続先や資格情報は推測せず、確認済みのSecretを使用します。

## 自動適用するplan

自動適用を許可するのは、既存 `google_cloud_run_v2_service.app[0]` のコンテナimageを確定digestへ変更するupdateだけです。providerが再計算する出力属性は除外しますが、環境変数・Secret参照・サービスアカウント・CPU・メモリ・スケール・IAP・IAM検査・削除保護などの設定差分は拒否します。

他のリソースの作成・更新・削除・置換、実環境のdrift、未確定の設定属性、不完全・遅延・未対応形式のplanも拒否します。配備後の再planはイメージ更新を含めて差分なしが必須です。

インフラ設定を変える場合は、PRでレビューした変更を別途確認して手動適用し、その後に通常CDを再実行します。承認待ちへ自動移行して残りの変更をapplyする機能は設けません。

## 認証と権限

| SA                          | 直接付与する権限                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono-app-dev-cd-deploy`    | 対象Registryのwriterとタグ削除のみのcustom role、対象Cloud Runのget/updateと状態確認、runtime SAのactAs、既存stateバケットのobjectAdmin、project単位のoperation読み取りと全体refreshに必要な設定・IAMの読み取り |
| `hono-app-dev-cd-migration` | 対象DATABASE_URLシークレットの読み取りのみ                                                                                                                                                                      |
| `hono-app-dev-cd-verify`    | 対象サービスのIAP accessorのみ                                                                                                                                                                                  |

Cloud Runの作成・削除・IAM変更、WIF変更、Secret値の更新権限はCDへ渡しません。Cloud Runの更新権限はフィールド単位にimageだけへ限定できず、任意コードをruntime SAで動かせる権限でもあるため、mainのレビューとplan検査も信頼境界になります。SAの切り替えは完全な信頼分離ではなく、直接取得する権限とログ誤出力の範囲を減らすためのものです。

WIFはGitHub issuerに対し、repository ID `1251281818`、owner ID `13247377`、`refs/heads/main`、pushイベント、再利用workflow `kojiyamauchi/hono-app/.github/workflows/cd-gcp.yml@refs/heads/main`、Environment `gcp-dev` をすべて検査します。長期鍵は保存しません。CI・ビルドの後、用途ごとに短命認証を取り直します。

IAP検証には検証用SAの `openid` / `userinfo.email` scope付きアクセストークンを使います。既存のユーザー用アクセストークンやCloud Run URL向けIDトークンでの成功を前提にしません。プログラム用OAuth client allowlistをCDが書き換えることもありません。[IAPのサービスアカウント認証](https://docs.cloud.google.com/iap/docs/authentication-howto#authenticate_with_a_service_account_access_token)

Cloud Runのoperationはサービス配下ではないため、`run.operations.get` はproject単位の読み取りroleへ付けます。初回適用ではoperation pollingの完了と、検証後のタグ削除まで実測します。

初回にこの認証方式を実環境で検証し、成功するまでCDの有効化を完了扱いにしません。拒否された場合もIAPの解除や一般公開で回避せず、応答層と認証条件を確認します。

## 初回構築と有効化（実行前にユーザー確認）

現在の `github_cd = null` が既定の構成ではCD用リソースは作成されません。`env/dev.cd.tfvars.json` は公開設定・数値Secret参照・GitHub識別情報だけを含むCD用の正本で、秘密値や固定のリリースdigestは含みません。

1. マージ済みmainと稼働中digestを確認し、ユーザーへ初回変更のplanを提示します。実環境では必ず `gcloud --configuration=hono-app-dev` を使います。
2. `bun run tf:gcp:init` 後にworkspaceがdevであることを確認し、次のplanを作ります。`<現在のdigest>` はReady revisionを照会した実値で置き換え、過去のtfvarsの値を流用しません。

   ```bash
   TF_WORKSPACE=dev bun run tf:gcp:plan -var-file=env/dev.cd.tfvars.json -var='app_image_digest=<現在のdigest>' -out=cd-bootstrap.tfplan
   ```

3. 追加するのはAPI、3つのSA、WIF pool/provider、用途ごとのIAM・custom roleです。既存IAP利用者bindingには検証用SAだけを追加します。Cloud Runのimage・URL・公開範囲・既存6つのSecret参照が変わらないことを確認します。
4. ユーザーがそのplanを確認した後にだけ、保存planをapplyします。この文書の追加や通常CDの承認省略を、初回IAM変更への承認として扱いません。
5. IAP検証用SAの短命認証と、固定Originの未認証拒否・認証付きhealthを実測します。トークンは保護された一時ファイルまたはプロセス内だけで扱い、コマンド引数・ログへ出しません。
6. GitHub側の変更も内容を提示して確認後、`gcp-dev` Environmentを作り、mainだけを許可・required reviewersなしとします。repository variable `GCP_DEV_CD_ENABLED=true` を設定します。
7. 最新mainのpush CIを再実行します。全CIとCDが成功したこと、revision・digest・再plan・IAP・イメージ保持を記録します。実クラウドでの初回CD成功は、ローカル検証の成功とは分けて記録します。

手動のインフラ変更・復旧時も `dev.cd.tfvars.json` を使い、現在のdigestまたは明示した復旧digestを引数で渡します。古い `dev.local.tfvars` のdigestを不用意にapplyして、アプリを巻き戻さないでください。

## 失敗と復旧

- CI・ビルド・plan検査・migrationが失敗した場合はCloud Runを更新しません。migration途中の障害はDB状態を確認し、`resolve` やresetを自動実行しません。
- applyや配備後検証の失敗では新revisionがすでに配信中の場合があります。自動で成功扱いにせず、保護タグを維持して停止します。
- 復旧は、配備サマリーに記録した直前digestと現行設定からplanを作り、内容を確認して適用します。DBは戻らないため、通常CDへ載せるmigrationは旧アプリと後方互換を保つことが前提です。破壊的変更は段階的に分けるか個別手順へ切り出します。
- CDを一時停止する場合は `GCP_DEV_CD_ENABLED=false` とします。実行中のmigration・applyを強制停止する操作ではありません。インフラ手動変更も実行中CDと重ねません。

## 秘密値と費用

秘密値・認証レスポンス・外部CLIの生出力は表示しません。DB値は権限700の一時ディレクトリ内の600ファイルを経由し、migrationの成否にかかわらず削除します。plan・state・認証ファイルをActions artifactへアップロードせず、runnerの一時領域を終了時に削除します。認証Actionの `gha-creds-*.json` はGitとDockerの対象から除外します。

現行と直前digestは `release-<digestの64桁>` で保護します。検証成功時だけ、それ以外の既知の保護タグを外します。既存の短いSHAのreleaseタグも、同じdigestが稼働・復旧対象なら維持します。cleanup policyによる削除には時間差があり、候補・失敗run・削除待ちイメージや共有レイヤーも含めた実容量で無料枠0.5 GBを確認します。容量の上限を保証する処理ではありません。

Cloud Build・Cloud Deploy・migration用Cloud Run Job・VPC・NAT・LBは追加しません。GitHub Actionsのビルド/cache、Registry保存・通信、Secretアクセス、GCSのstate履歴、配備後検証のリクエストを費用に含めます。既存の月100円予算通知を維持します。

## 外部環境を変更しない検証

```bash
bun test --isolate
bun run typecheck
bun run lint:check
bun run spellcheck
bun run test:container
TF_WORKSPACE=dev bun run tf:gcp:init:no-backend
bun run tf:gcp:validate
bun run tf:gcp:lint
TF_WORKSPACE=dev bun run tf:gcp:test
```

コンテナ検証は既存12 migrationに加え、使い捨てDBだけへ追加SQLをマウントし、CD処理のverify-full接続・未適用適用・再実行・チェックサム不一致拒否を確認します。追加SQL・DB・コンテナ・証明書は終了時に削除します。PRのmigration実DB検証規約は引き続き適用され、配備時のmigration実行で代替しません。
