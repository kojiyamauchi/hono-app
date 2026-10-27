# コンテナで信頼する公開CA証明書

`supabase-root-2021.crt` はSupabaseが配布する公開ルートCA証明書です。秘密鍵は含みません。

- 配布元: [Supabaseの公開CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)
- 接続設定の説明: [SupabaseのSSL接続](https://supabase.com/docs/guides/database/psql)
- 発行者・主体: `Supabase Root 2021 CA`
- 有効期限: 2031年4月26日 10:56:53 UTC
- 証明書のSHA-256フィンガープリント: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Dockerfileはruntimeとmigrationへこのファイルを同梱し、`NODE_EXTRA_CA_CERTS` でBunの既定CAへ追加します。ホストOSの信頼ストアは変更しません。外部マウントや追加のシークレット登録は不要です。

証明書はレビューできるようリポジトリへ固定し、ビルド時にはダウンロードしません。更新時はSupabaseの管理画面または公式配布元から取得し、発行者・有効期限・フィンガープリントを確認して差し替えます。

```bash
openssl x509 -in certificates/supabase-root-2021.crt -noout -subject -issuer -dates -fingerprint -sha256
bun test certificates/supabase-ca.test.js
bun run test:container
```

更新時は `scripts/verify-certificate.mjs` の期待するフィンガープリントも更新します。識別情報と有効期限の検証は `bun test` を通じてCIのUnit Testでも実行し、有効期限の90日前から失敗して更新を促します。コンテナ検証も同じ関数を使い、同梱されたファイルを検証します。実際のSupabaseへのruntime接続とmigrationの履歴取得も、証明書と接続先ホスト名の検証を有効にした状態で確認してください。

## CAローテーション時の復旧

Supabaseが有効期限より前にCAを切り替えた場合も、公式配布元から新しいCAを取得し、発行者・フィンガープリント・有効期間を確認します。移行期間に必要なら旧CAも含めたPEM形式のCA束を用意し、`sslmode=verify-full` を維持して接続を検証します。

イメージの再ビルドを待たずにCloud Runを復旧する場合は、確認済みのCA束をSecret Managerへ登録し、数値versionに固定して `/run/ca/supabase-ca-bundle.pem` へ読み取り専用のシークレットボリュームとしてマウントします。実行用サービスアカウントにはそのシークレットの読み取り権限を付け、非rootの `bun` ユーザーがファイルを読めるようにします。`NODE_EXTRA_CA_CERTS` をこのパスへ上書きし、同じイメージの新revisionを起動します。CAはプロセス起動時に読み込むため、ファイルの差し替えだけで既存プロセスへ反映されることは前提にしません。[Cloud Runのシークレット設定](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

現行Terraformには緊急用CAボリュームの配線がないため、利用時はボリューム・CA用の権限・環境変数をTerraformへ追加し、planを確認してapplyします。Consoleから直接更新せず、イメージのダイジェストと既存6種の秘密値の参照は維持します。CA束を追加versionとして保存する場合は、通常構成とは別に[Secret Managerの料金](https://cloud.google.com/secret-manager/pricing)も確認してください。

migrationを実行する場合も、同じCA束をコンテナへ読み取り専用でマウントし、`NODE_EXTRA_CA_CERTS` を同じパスへ上書きして、まず `prisma migrate status` を確認します。復旧後はリポジトリの証明書と検証の期待値を更新し、CI・コンテナ検証・実DB接続を確認したイメージへ更新します。同梱CAでの接続確認後に、緊急用マウントと環境変数の上書きをTerraformから除去します。証明書やホスト名の検証を無効にする方法では復旧しません。
