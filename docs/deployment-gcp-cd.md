# GCP devの自動配備

mainへのマージをdevへの配備判断とし、追加承認なしで配備します。2026-10-30にCDの有効化と初回CD検証が完了しました。文書だけの変更もmainへのマージ後は通常CDの対象です。初回の認証・権限構築とCD有効化は、通常配備とは別にユーザーが内容を確認してから実施します。

## 実行範囲

- `ci.yml` は `pull_request` と `workflow_call` を受け付ける検査専用workflowです。共通のコード検査・ビルドと、AWS・GCP・CloudflareのTerraform検査を実行し、CDジョブは定義しません。3つのTerraformジョブは互いに依存させず並列実行します。
- `cd.yml` はmainへのpushで共通CIを呼び、全検査成功後にAWSのECR公開と共有DBを使うdevリリースを開始します。
- `GCP_DEV_CD_ENABLED=true` の場合は、コンテナ検証・候補イメージ公開・Terraform planの検査後に共有DBのmigrationを実行します。GCPが無効でもCloudflareが有効なら、共有DBのmigrationを実行します。
- 共有DBを使うリリースは、最新SHAの確認から配備完了まで直列です。migration成功後、GCPとCloudflareは同じリリース内で並列に配備します。新しいpushで実行中のリリースは中断しません。待機中の実行は置き換わる場合があるため、最新SHAの成功runと稼働状態を照合してください。
- devのGitHub Environment `gcp-dev` はmainだけを許可し、required reviewersを設定しません。将来prodを作る場合は別Environmentでmigration前の承認を設け、DB・Secret・state・サービスも分離します。prodブランチやprodリソースは今回作りません。

CIとCDの入口を分ける理由は、PRのChecksへ配備ジョブのskip項目を出さず、レビュー時の検査とマージ後の配備を区別するためです。`cd.yml` から同じ共通CIを呼びます。mainへの直接pushは既存のPR必須・承認・必須CIのルールで制限し、CDではmainへのpushを起点として維持します。

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

WIFはGitHub issuerに対し、repository ID `1251281818`、owner ID `13247377`、`refs/heads/main`、pushイベント、Environment `gcp-dev` を検査します。起動元の `workflow_ref` は `cd.yml` のmainだけを許可し、`job_workflow_ref` の存在と、`cd-gcp.yml` または `cd-migration.yml` のmainであることを要求します。旧 `cd-gcp.yml` の直接起動は許可しません。`cd-gcp.yml` 自体は再利用workflowとして残します。長期鍵は保存しません。CI・ビルドの後、用途ごとに短命認証を取り直します。

GitHub Environment `gcp-dev` の `GCP_CD_PLAN_KEY` には、ランダムな32バイト以上をエンコードした値を登録します。事前検証ジョブは保存planと配備記録を暗号化し、同じrun・試行の配備ジョブだけが取得します。成果物の保持期間は1日です。失敗時は最新mainに対して全ジョブを再実行し、planを作り直します。

### 共通CDへの切り替え記録（2026-11-19）

[PR #228](https://github.com/kojiyamauchi/hono-app/pull/228)で共通CDへ切り替え、[PR #229](https://github.com/kojiyamauchi/hono-app/pull/229)でplan暗号化Secretの連携を修正しました。[Main CD run 44498986380](https://github.com/kojiyamauchi/hono-app/actions/runs/44498986380)は、mainの `0fb1115ca9f3adfe7dfe177eab663fad04468a29` へのpushを起点として、2026-11-19 18:49 JSTに成功しました。

- GCPの事前検証・配備・IAP検証用のWIF認証と、保存planの暗号化・復元が成功しました。
- 共有DBのmigration用WIF認証、未適用migrationの適用工程、DB履歴・チェックサム・読み取りの検証が成功しました。
- Cloud Runの保存plan適用・revision検証・未認証拒否・IAP認証付きhealthと、Cloudflare Workerの配備・SHA検証・Access保護検証が成功しました。
- 2026-11-19 18:52 JSTのActions照会では、旧直接起動の最新run [44301595360](https://github.com/kojiyamauchi/hono-app/actions/runs/44301595360)は完了済みで、実行中・キュー待ちのrunはありませんでした。配備フラグはGCP・Cloudflareともに `true` でした。手動適用前には再照会が必要です。

### 旧起動元許可の削除を手動適用する手順

リポジトリの条件変更だけでは実環境のWIFは更新されません。以下はPRレビュー後の別作業として実施します。新経路の成功証跡を確認してから旧 `workflow_ref` 許可を削除し、通常CDと重ねず、WIF providerの条件だけを手動適用します。

1. [インフラ変更の手動適用](#インフラ変更の手動適用)に従い、利用中の両配備フラグを記録して一時停止し、通常PRのマージと過去のCDの再実行を止めます。`Main CD` と旧 `GCP dev CD` の実行中・待機中のrunがすべて完了したことを確認します。キュー待ちだけでなくEnvironment待ちなども確認し、実行中のmigration・applyを強制停止しません。
2. 対象PRをマージし、マージ済みmainを取得します。`gcloud --configuration=hono-app-dev` の対象アカウント・projectとGCS backend・dev workspaceを確認し、現在のReady revisionのdigestと `env/dev.cd.tfvars.json` を明示して全体planを保存します。コマンドは[手動適用手順のステップ2・3](#インフラ変更の手動適用)と同じです。`-target` で差分を隠しません。
3. managed resourceの変更が `google_iam_workload_identity_pool_provider.github[0]` の `attribute_condition` のupdate 1件だけであり、旧起動元のOR許可だけを削除することを確認します。`cd.yml` 起点・両 `job_workflow_ref`・数値repository ID・owner ID・main・push・`gcp-dev` の制約は維持します。Cloud Runのimage、IAM、Secret、他リソースの作成・削除・置換・設定変更があれば中止し、別件として確認します。
4. ユーザーがplanを確認した後に同じ保存planだけを手動applyし、稼働中digestで全体再planの設定差分なしを確認します。WIF更新権限をCD用SAへ追加せず、旧workflowの再実行による動作確認も行いません。
5. 記録した配備フラグを戻し、最新mainの `Main CD` を全ジョブ再実行します。共有migrationのWIF認証・DB検証、GCPのWIF認証・Cloud RunのdigestとIAP health、WorkerのSHAとAccess保護の成功を記録してから、次の通常PRへ進みます。旧構成への復旧が必要な場合も、両配備を停止して実行完了を待ち、レビューしたWIF復旧planを手動適用する必要があります。

IAP検証には検証用SAの `openid` / `userinfo.email` scope付きアクセストークンを使います。既存のユーザー用アクセストークンやCloud Run URL向けIDトークンでの成功を前提にしません。プログラム用OAuth client allowlistをCDが書き換えることもありません。[IAPのサービスアカウント認証](https://docs.cloud.google.com/iap/docs/authentication-howto#authenticate_with_a_service_account_access_token)

固定provider 7.46.2でWIF poolをrefreshする際は、`iam.workloadIdentityPools.get` に加えて `iam.workloadIdentityPools.getAttestationRules` が必要です。後者は初回試行で403となったため、project単位の読み取りroleへ追加済みです。`setAttestationRules` は付与せず、attestation rules自体を変更する設定も追加しません。[Google公式のIAM権限リファレンス](https://docs.cloud.google.com/iam/docs/roles-permissions/iam)

Cloud Runのoperationはサービス配下ではないため、`run.operations.get` はproject単位の読み取りroleへ付けます。2026-10-30の初回CDではoperation pollingの完了と、検証後のタグ削除まで実測済みです。

初回にこの認証方式を実環境で検証し、成功するまでCDの有効化を完了扱いにしません。2026-10-30には検証用SAの認証付きhealth成功を確認しました。拒否された場合もIAPの解除や一般公開で回避せず、応答層と認証条件を確認します。

## 初回構築と有効化（実行前にユーザー確認）

`github_cd` の既定値は `null` で、この入力を省略した構成ではCD用リソースは作成されません。`env/dev.cd.tfvars.json` は公開設定・数値Secret参照・GitHub識別情報だけを含むCD用の正本で、秘密値やServiceのリリースdigestは含みません。招待メールJobの固定digestは[招待メールの配備手順](invitation-email.md#gcp-devへの手動配備)に従って管理します。

1. マージ済みmainと稼働中digestを確認し、ユーザーへ初回変更のplanを提示します。実環境では必ず `gcloud --configuration=hono-app-dev` を使います。
2. `bun run tf:gcp:init` 後にworkspaceがdevであることを確認し、次のplanを作ります。`<現在のdigest>` はReady revisionを照会した実値で置き換え、過去のtfvarsの値を流用しません。

   ```bash
   TF_WORKSPACE=dev bun run tf:gcp:plan -var-file=env/dev.cd.tfvars.json -var='app_image_digest=<現在のdigest>' -out=cd-bootstrap.tfplan
   ```

3. 追加するのはAPI、3つのSA、WIF pool/provider、用途ごとのIAM・custom roleです。既存IAP利用者bindingには検証用SAだけを追加します。Cloud Runのimage・URL・公開範囲・現在のSecret参照が変わらないことを確認します。
4. ユーザーがそのplanを確認した後にだけ、保存planをapplyします。この文書の追加や通常CDの承認省略を、初回IAM変更への承認として扱いません。
5. IAP検証用SAの短命認証と、固定Originの未認証拒否・認証付きhealthを実測します。トークンは保護された一時ファイルまたはプロセス内だけで扱い、コマンド引数・ログへ出しません。
6. GitHub側の変更も内容を提示して確認後、`gcp-dev` Environmentを作り、mainだけを許可・required reviewersなしとします。repository variable `GCP_DEV_CD_ENABLED=true` を設定します。
7. 最新mainへのpushで起動した `Main CD` を全ジョブ再実行します。全CIとCDが成功したこと、revision・digest・再plan・IAP・イメージ保持を記録します。実クラウドでの初回CD成功は、ローカル検証の成功とは分けて記録します。

手動のインフラ変更・復旧時も `dev.cd.tfvars.json` を使い、現在のdigestまたは明示した復旧digestを引数で渡します。古い `dev.local.tfvars` のdigestを不用意にapplyして、アプリを巻き戻さないでください。

## 初回CDの検証記録（2026-10-30）

以下は特定のソースとworkflowに紐づく初回配備時の記録です。以後の配備でrevision・digest・保持タグは変わるため、最新状態は [Main CDのActions一覧](https://github.com/kojiyamauchi/hono-app/actions/workflows/cd.yml)の成功run・配備サマリーとCloud RunのReady revisionで確認してください。API・Scalarへのアクセス先は[dev環境の案内](deployment-gcp.md#dev環境のアクセス先)を参照してください。

- 対象: project `hono-app-dev-512908-f3`、`asia-northeast1`、Terraform workspace `dev`、Cloud Run `hono-app-dev`。
- 検証日時: 2026-10-30 19:41 JST。
- ソースSHA: `5515a1c1adac0974830abcc3d0cb929f637e97e1`。
- workflow: [41040643533 / attempt 2](https://github.com/kojiyamauchi/hono-app/actions/runs/41040643533/attempts/2)。CI7項目とdeployの全8ジョブが成功。
- Ready revision: `hono-app-dev-00002-pj4`、このrevisionへ100%配信。
- 配備digest: `sha256:4f96d162a3ed60f9cb99264b29c29934dbb5376814af5dcf5ba2f8b7da024a06`。
- 復旧用digest: `sha256:d55f2b2bede8df884f4619c074cedb92d6426c4717ad1e01b249d43a793a3fb2`。
- 有効化時のGitHub設定: repository variable `GCP_DEV_CD_ENABLED=true`、Environment `gcp-dev` はmainブランチのみ許可、required reviewersなし。

確認した結果:

- 同じソースのruntime / migrationビルド、クラウド認証前の使い捨てDB検証、WIF認証、runtimeのイメージ登録、全体plan検査が成功しました。
- 実DBのmigration履歴・SQLチェックサム・読み取りを確認し、migration工程の成功後に検査済みの保存planを適用しました。
- Ready revision・実digest・100%配信をActionsと独立したGCPの読み取りで照合しました。IAPは有効で、未認証healthは302でIAPに拒否され、検証用SAの認証付きhealthはworkflowで200・`ok: true`を確認しました。
- workflow内の再planに加え、独立した配備後の全体planでも設定変更なしを確認しました。独立planの `resource_drift` には対象Registryの `update_time` だけが残り、`assertDeploymentPlan(noChanges=true)` で許容範囲外のdriftがないことを確認しました。
- 配備digestと直前の復旧用digestの `release-` 保護タグを独立して確認しました。当該runのcandidateタグは削除済みで、認証・一時ファイルのcleanupまでジョブが成功しました。
- 調査用の期限付きTokenCreator権限は削除済みで、配備用SAのpolicyは既存WIF用bindingのみでした。

この記録の検証範囲は上記のCD工程です。ブラウザでの全ユーザーフロー、メール配達、保存容量・課金の確認まで完了したものではありません。証跡は公開可能な結果を要約し、plan・state・認証ファイル・生ログはGitへ追加しません。

### 初回試行と修正の経緯

同日の初回試行では、CD用基盤とGitHub Environmentの構築、WIF認証、runtime登録まで成功しました。WIF pool読み取りの403は `getAttestationRules` の追加後、配備用SAのinit・planで解消を確認しました。イメージ登録後のRegistry更新日時も、前述の限定条件で許容するようにしました（[PR #174](https://github.com/kojiyamauchi/hono-app/pull/174)・[PR #175](https://github.com/kojiyamauchi/hono-app/pull/175)）。

その後の再試行では、Linux/AMD64の `init -lockfile=readonly` 後のplanでproviderのチェックサム不一致を再現しました。Mac用の `h1` しか記録されておらず、当時のCIは初期化時にLinux用のハッシュを補っていました。CDはlockfileを書き換えないため失敗しました。調査中は `GCP_DEV_CD_ENABLED=false` として停止し、この時点ではmigration・Cloud Run更新へ進んでいませんでした。

[PR #176](https://github.com/kojiyamauchi/hono-app/pull/176)で、providerを更新したり検証を無効化したりせず、公式Registryの署名済み配布物からLinux用のハッシュを記録し、CIもreadonly初期化へ揃えました。修正のマージ後にCDを再有効化し、上記のattempt 2で初回CD全体の検証が完了しました。

## 停止後の再開手順

1. 停止原因に対する修正をマージした最新mainで、現在のReady revisionのdigestを取得し、`dev.cd.tfvars.json` を使って全体planを作ります。上の初回構築用コマンドと同じ入力を使い、保存先は `cd-resume.tfplan` などで区別します。
2. インフラ修正がなければ設定変更なしを確認します。設定変更が必要なら、レビュー済みの修正に対応する差分だけかを確認し、ユーザーへplanを提示します。初回の読み取りrole修正では `google_project_iam_custom_role.cd_read[0]` のpermissionsへの `iam.workloadIdentityPools.getAttestationRules` 追加が対象でした。lockfileのハッシュ追加自体にクラウド設定の適用は不要です。
3. 設定変更がある場合はユーザー確認後にその保存planを手動適用します。配備用SAによるplanは、次のActions実行でWIF経由の認証を使って確認します。承認済みIAM操作に伴うetagなどをstateへ同期する場合も、差分を個別確認してから行い、未確認のdriftを一括で取り込まないでください。
4. ユーザー確認後にrepository variableを `GCP_DEV_CD_ENABLED=true` に戻し、最新mainの `Main CD` を全ジョブ再実行します。
5. CI・migration・配備・IAP・再plan・保持タグ整理の成功と、SHA・revision・配備/復旧用digestを記録します。権限不足やハッシュ不足を解消しただけで再開後のCD検証を完了とは扱いません。

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
- 共有DBへの自動migrationも含めてCDを一時停止する場合は、`GCP_DEV_CD_ENABLED=false` と `CLOUDFLARE_DEV_CD_ENABLED=false` を設定します。実行中のmigration・applyを強制停止する操作ではありません。インフラ手動変更も実行中CDと重ねません。手順は[インフラ変更の手動適用](#インフラ変更の手動適用)に従います。

## インフラ変更の手動適用

通常CDが自動適用するのは既存Cloud Runのイメージ差し替えだけです。監視リソース・IAM・環境変数・Secret参照などの差分を含む変更は、PRでレビューしたうえで1件ずつ手動適用します。複数のインフラ変更を同時に適用せず、1件ごとに次の手順を最後まで通します。配備ジョブの一時停止から通常CDの成功確認までを一連の作業として扱い、この適用ウィンドウ中は対象外の通常PRのマージも重ねません。再開後の最初のCDが複数コミットをまとめて配備すると、インフラ適用の検証と切り分けられなくなるためです。

招待メールJobの実行回数と直近実行の参照は、配信のたびにGCPが更新する属性です。通常CDのrefreshでは、この2項目だけが変わる場合を許容します。Jobのイメージ、実行設定、Schedulerの設定、IAMの差分は手動適用の対象です。

1. マージ前に `GCP_DEV_CD_ENABLED=false` と `CLOUDFLARE_DEV_CD_ENABLED=false` を設定し、実行中・待機中の共有DBリリースが終了したことを確認します。その後に対象の変更をmainへマージします。
2. マージ済みmainで対象プロジェクトと、Git管理外の `infra/gcp/env/backend.local.hcl` の接続先を確認します。リポジトリルートから `bun run tf:gcp:init` でGCS backendを初期化し、`bun run tf:gcp:workspace:dev` でdev workspaceを選びます。`terraform -chdir=infra/gcp workspace show` の出力が `dev` であることを確認し、現在のReady revisionのdigestを取得します。
3. `<現在のdigest>` を取得した `sha256:...` に、`<保存先の絶対パス>` をGit管理外のplanファイルパスへ置き換えて、リポジトリルートで全体planを作ります。`bun run tf:gcp:plan` / `tf:gcp:apply` は変数を渡さないため、そのままでは使いません。

   ```bash
   TF_WORKSPACE=dev terraform -chdir=infra/gcp plan \
     -var-file=env/dev.cd.tfvars.json \
     -var='app_image_digest=<現在のdigest>' \
     -out='<保存先の絶対パス>'
   ```

   既定値のままplanを作るとCloud RunやCD関連リソースが削除対象になり得るため、CDと同じtfvarsと稼働中のdigestを必ず明示します。Cloud Run・IAP・WIF・CD用SAなどに意図しない削除・置換があれば適用を中止します。

4. 差分を確認した後、同じ保存済みplanを適用します。別のplanへ差し替えません。

   ```bash
   TF_WORKSPACE=dev terraform -chdir=infra/gcp apply '<保存先の絶対パス>'
   ```

5. 追加したリソースを配備用SAが全体planでrefreshできることを確認します。読み取り権限が不足する場合は読み取りroleへ参照権限だけを追加し、同じ手順で適用します。
6. 稼働中のdigestを使った全体再planで設定差分がないことを確認し、利用していた配備フラグを元に戻します。最新mainの `Main CD` で配備ジョブまで成功したことを確認してから、次の変更へ進みます。

## 秘密値と費用

Cloud Runに注入する数値Secret参照は、OTLP無効時は既存の6件、有効時は `OTEL_EXPORTER_OTLP_TRACES_HEADERS` を加えた7件です。Git管理の `env/dev.cd.tfvars.json` は送信無効と6件の参照を保持します。OTLP用の入れ物と実行用SAの参照権限を先に手動適用し、実値とversionをSecret Managerで登録した後、別の保存planでCloud Runの参照と送信を有効にします。検証時の一時設定と通常CDに戻す手順は[GCP devでの実送信検証](observability.md#gcp-devでの実送信検証)を参照してください。

秘密値・認証レスポンス・外部CLIの生出力は表示しません。DB値は権限700の一時ディレクトリ内の600ファイルを経由し、migrationの成否にかかわらず削除します。Actions artifactには保存planと配備記録を暗号化して渡します。stateや認証ファイルは成果物に含めず、runnerの一時領域を終了時に削除します。認証Actionの `gha-creds-*.json` はGitとDockerの対象から除外します。

現行と直前digestは `release-<digestの64桁>` で保護します。検証成功時だけ、それ以外の既知の保護タグを外します。既存の短いSHAのreleaseタグも、同じdigestが稼働・復旧対象なら維持します。cleanup policyによる削除には時間差があり、候補・失敗run・削除待ちイメージや共有レイヤーも含めた実容量で無料枠0.5 GBを確認します。容量の上限を保証する処理ではありません。

通常CDではCloud Build・Cloud Deploy・migration用Cloud Run Job・VPC・NAT・LBを使いません。招待メールJobとSchedulerの費用は[招待メールの運用手順](invitation-email.md#費用)を参照してください。GitHub Actionsのビルド/cache、Registry保存・通信、Secretアクセス、GCSのstate履歴、配備後検証のリクエストを費用に含めます。既存の月100円予算通知を維持します。

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
