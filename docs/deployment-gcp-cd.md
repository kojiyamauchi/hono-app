# GCP devの自動配備

mainへのマージをdevへの配備判断とし、追加承認なしで配備します。初回の認証・権限構築とCD有効化は、通常配備とは別にユーザーが内容を確認してから実施します。このPRや手順の追加だけではクラウド設定を変更しません。

## 実行範囲

- `ci.yml` は `pull_request` と `workflow_call` を受け付ける検査専用workflowです。PRのChecksにはCIの7項目だけを表示し、CDジョブは定義しません。
- `cd-gcp.yml` はmainへのpushで起動し、先に `ci.yml` を呼び出します。全検査成功後に配備ジョブを実行します。mainへの直接pushも同じ起動条件です。
- repository variable `GCP_DEV_CD_ENABLED` が文字列 `true` の場合だけ配備ジョブを実行します。未設定・falseでもCIは実行しますが、配備用認証・Dockerビルド・イメージpush・migration・applyは行いません。
- 対象は `hono-app-dev-512908-f3`、`asia-northeast1`、Terraform workspace `dev`、既存サービス `hono-app-dev` です。AWS用CD、prod用CD、一般公開への変更は含みません。
- CIは各pushで実行し、配備待ちで止めません。配備ジョブだけを `gcp-dev-deployment` concurrency groupで直列化し、新しいpushで実行中のmigration・applyをキャンセルしません。待機後の配備ジョブはmainのSHAと照合し、古い対象を省略します。
- devのGitHub Environment `gcp-dev` はmainだけを許可し、required reviewersを設定しません。将来prodを作る場合は別Environmentでmigration前の承認を設け、DB・Secret・state・サービスも分離します。prodブランチやprodリソースは今回作りません。

CIとCDの入口を分ける理由は、PRのChecksへ配備ジョブのskip項目を出さず、レビュー時の検査とマージ後の配備を区別するためです。`cd-gcp.yml` から共通CIを呼ぶことで検査定義を重複させず、`main.yml` も追加しません。mainへの直接pushは既存のPR必須・承認・必須CIのルールで制限し、CDではmainへのpushを起点として維持します。

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

他のリソースの作成・更新・削除・置換、後述の例外以外の実環境のdrift、未確定の設定属性、不完全・遅延・未対応形式のplanも拒否します。配備後の再planはイメージ更新を含めて設定差分なしが必須です。

初回試行では、イメージ登録によって対象Registryの `update_time` だけが変わることを実測しました。このため `resource_drift` のうち、`google_artifact_registry_repository.app` のmanagedなupdateで、変更前後の `update_time` が文字列、他の全属性が同一、未確定値がない場合だけ許容します。この例外は配備前と配備後の検査の両方へ適用します。

Registryのcleanup設定・IAM・他の属性の変更や、`resource_changes` に現れるRegistryの更新は許容しません。etagや別リソースの更新日時も引き続き停止対象です。検査を無効化したり、計算属性を全リソースへ一律に除外したりせず、追加の例外が必要な場合は実測と回帰テストを別PRでレビューします。

インフラ設定を変える場合は、PRでレビューした変更を別途確認して手動適用し、その後に通常CDを再実行します。承認待ちへ自動移行して残りの変更をapplyする機能は設けません。

## 認証と権限

| SA                          | 直接付与する権限                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono-app-dev-cd-deploy`    | 対象Registryのwriterとタグ削除のみのcustom role、対象Cloud Runのget/updateと状態確認、runtime SAのactAs、既存stateバケットのobjectAdmin、project単位のoperation読み取りと全体refreshに必要な設定・IAMの読み取り |
| `hono-app-dev-cd-migration` | 対象DATABASE_URLシークレットの読み取りのみ                                                                                                                                                                      |
| `hono-app-dev-cd-verify`    | 対象サービスのIAP accessorのみ                                                                                                                                                                                  |

Cloud Runの作成・削除・IAM変更、WIF変更、Secret値の更新権限はCDへ渡しません。Cloud Runの更新権限はフィールド単位にimageだけへ限定できず、任意コードをruntime SAで動かせる権限でもあるため、mainのレビューとplan検査も信頼境界になります。SAの切り替えは完全な信頼分離ではなく、直接取得する権限とログ誤出力の範囲を減らすためのものです。

WIFはGitHub issuerに対し、repository ID `1251281818`、owner ID `13247377`、`refs/heads/main`、pushイベント、起動元workflow（`workflow_ref`）`kojiyamauchi/hono-app/.github/workflows/cd-gcp.yml@refs/heads/main`、Environment `gcp-dev` をすべて検査します。長期鍵は保存しません。CI・ビルドの後、用途ごとに短命認証を取り直します。

IAP検証には検証用SAの `openid` / `userinfo.email` scope付きアクセストークンを使います。既存のユーザー用アクセストークンやCloud Run URL向けIDトークンでの成功を前提にしません。プログラム用OAuth client allowlistをCDが書き換えることもありません。[IAPのサービスアカウント認証](https://docs.cloud.google.com/iap/docs/authentication-howto#authenticate_with_a_service_account_access_token)

固定provider 7.46.2でWIF poolをrefreshする際は、`iam.workloadIdentityPools.get` に加えて `iam.workloadIdentityPools.getAttestationRules` が必要です。後者は初回試行で403となったため、project単位の読み取りroleへ追加します。`setAttestationRules` は付与せず、attestation rules自体を変更する設定も追加しません。[Google公式のIAM権限リファレンス](https://docs.cloud.google.com/iam/docs/roles-permissions/iam)

Cloud Runのoperationはサービス配下ではないため、`run.operations.get` はproject単位の読み取りroleへ付けます。初回適用ではoperation pollingの完了と、検証後のタグ削除まで実測します。

初回にこの認証方式を実環境で検証し、成功するまでCDの有効化を完了扱いにしません。拒否された場合もIAPの解除や一般公開で回避せず、応答層と認証条件を確認します。

## 初回構築と有効化（実行前にユーザー確認）

`github_cd` の既定値は `null` で、この入力を省略した構成ではCD用リソースは作成されません。`env/dev.cd.tfvars.json` は公開設定・数値Secret参照・GitHub識別情報だけを含むCD用の正本で、秘密値や固定のリリースdigestは含みません。

1. マージ済みmainと稼働中digestを確認し、ユーザーへ初回変更のplanを提示します。実環境では必ず `gcloud --configuration=hono-app-dev` を使います。
2. `bun run tf:gcp:init` 後にworkspaceがdevであることを確認し、次のplanを作ります。`<現在のdigest>` はReady revisionを照会した実値で置き換え、過去のtfvarsの値を流用しません。

   ```bash
   TF_WORKSPACE=dev bun run tf:gcp:plan -var-file=env/dev.cd.tfvars.json -var='app_image_digest=<現在のdigest>' -out=cd-bootstrap.tfplan
   ```

3. 追加するのはAPI、3つのSA、WIF pool/provider、用途ごとのIAM・custom roleです。既存IAP利用者bindingには検証用SAだけを追加します。Cloud Runのimage・URL・公開範囲・既存6つのSecret参照が変わらないことを確認します。
4. ユーザーがそのplanを確認した後にだけ、保存planをapplyします。この文書の追加や通常CDの承認省略を、初回IAM変更への承認として扱いません。
5. IAP検証用SAの短命認証と、固定Originの未認証拒否・認証付きhealthを実測します。トークンは保護された一時ファイルまたはプロセス内だけで扱い、コマンド引数・ログへ出しません。
6. GitHub側の変更も内容を提示して確認後、`gcp-dev` Environmentを作り、mainだけを許可・required reviewersなしとします。repository variable `GCP_DEV_CD_ENABLED=true` を設定します。
7. 最新mainへのpushで起動した `GCP dev CD` workflowを再実行します。全CIとCDが成功したこと、revision・digest・再plan・IAP・イメージ保持を記録します。実クラウドでの初回CD成功は、ローカル検証の成功とは分けて記録します。

手動のインフラ変更・復旧時も `dev.cd.tfvars.json` を使い、現在のdigestまたは明示した復旧digestを引数で渡します。古い `dev.local.tfvars` のdigestを不用意にapplyして、アプリを巻き戻さないでください。

## 初回試行後の修正と再開

2026-10-30の初回試行では、CD用基盤とGitHub Environmentの構築、WIF認証、runtime登録まで成功しました。WIF pool読み取りの403は `getAttestationRules` の追加後、配備用SAのinit・planで解消を確認しています。イメージ登録後のRegistry更新日時も、前述の限定条件で許容します。

その後の再試行では、Linux/AMD64の `init -lockfile=readonly` 後のplanでproviderのチェックサム不一致を再現しました。Mac用の `h1` しか記録されておらず、通常のCIは初期化時にLinux用のハッシュを補っていました。CDはlockfileを書き換えないため失敗します。providerを更新したり検証を無効化したりせず、公式Registryの署名済み配布物からLinux用のハッシュを記録します。

調査に使ったOwnerユーザーへの期限付きTokenCreator権限は削除済みで、通常運用の前提にはしません。読み取りroleの修正は適用済みですが、調査終了時点では `GCP_DEV_CD_ENABLED=false` として停止しています。migration・Cloud Run更新には進んでおらず、初回CD全体はまだ未検証です。

1. 修正をマージした最新mainで、現在のReady revisionのdigestを取得し、`dev.cd.tfvars.json` を使って全体planを作ります。上の初回構築用コマンドと同じ入力を使い、保存先は `cd-resume.tfplan` などで区別します。
2. 読み取りroleの修正を適用済みのdevでは、設定変更なしを想定します。未適用の環境では `google_project_iam_custom_role.cd_read[0]` のpermissionsへの `iam.workloadIdentityPools.getAttestationRules` 追加だけかを確認し、ユーザーへplanを提示します。lockfileのハッシュ追加自体にクラウド設定の適用は不要です。
3. 設定変更がある場合はユーザー確認後にその保存planを手動適用します。配備用SAによるplanは、次のActions実行でWIF経由の認証を使って確認します。承認済みIAM操作に伴うetagなどをstateへ同期する場合も、差分を個別確認してから行い、未確認のdriftを一括で取り込まないでください。
4. ユーザー確認後にrepository variableを `GCP_DEV_CD_ENABLED=true` に戻し、最新mainの `GCP dev CD` workflowを再実行します。
5. CI・migration・配備・IAP・再plan・保持タグ整理の成功と、SHA・revision・配備/復旧用digestを記録します。権限不足やハッシュ不足を解消しただけで初回CDの完了とは扱いません。

## providerのlockfile管理

GCPの `.terraform.lock.hcl` は、ローカルのMac/ARM64とActionsのLinux/AMD64を両方対象にします。providerの更新やplatform追加を行う場合は、公式Registryで署名を確認し、対象platformのハッシュをまとめて記録してレビューします。

```bash
terraform -chdir=infra/gcp providers lock -platform=darwin_arm64 -platform=linux_amd64
```

このコマンドは既存の選択済みバージョンを使ってハッシュを補います。バージョン更新を意図しない修正に `init -upgrade` は使いません。CIもCDと同じ `-lockfile=readonly` で初期化し、その後のvalidate・モックテストまで通してハッシュの記録漏れを検出します。別のplatformを使う場合も、必要な `-platform` を追加してlockfileを更新します。[HashiCorp公式のproviders lock手順](https://developer.hashicorp.com/terraform/cli/commands/providers/lock)

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
