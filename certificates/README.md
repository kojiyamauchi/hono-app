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
bun run test:container
```

更新時は `scripts/verify-container-tls.mjs` の期待するフィンガープリントも更新します。この検証は有効期限の90日前から失敗し、更新を促します。実際のSupabaseへのruntime接続とmigrationの履歴取得も、証明書と接続先ホスト名の検証を有効にした状態で確認してください。
