# 本体アプリのCloudflare実行経路

既存のBun/GCP経路を残したまま、同じ全feature・Prismaモデル・Supabase PostgreSQLをCloudflareから利用します。検証Workerとは別のWorkerで実行し、自動配備先は `hono-app-dev` です。[Cloudflare devの自動配備](deployment-cloudflare-cd.md)に起動条件・本体基盤・初回構築・復旧をまとめています。

## 実行経路

```text
Cloudflare Access（全パス）
  → 入口Worker（転送）
  → SQLite型Durable Object AppExecutor（Access JWT検証・本体アプリ）
  → Prisma / adapter-pg → Hyperdrive → 既存Supabase PostgreSQL
```

- `src/cloudflare.ts` が配線層の入口です。業務処理・ルート・認証・組織権限・transactionはBunと共用します。`/auth` と `/supabase-auth` は両方残します。
- DOのSQLiteストレージは使用しません。ユーザー・認証情報・メール配信outboxを含む業務データの正本はSupabaseです。入口からDOへの名前は固定の `app` です。
- リクエスト全体をキューへ入れず、外部I/O待ちは並行実行します。単一ObjectでのCPU計算自体は並列になりません。
- `runCloudflareRequest` がAsyncLocalStorageで環境値・Prisma・Supabaseクライアントを注入します。Service/RepositoryへHono Contextを渡しません。`process.env` をリクエストごとに書き換えず、文字列bindingだけを当該リクエストの環境として使います。
- Prismaは全モデルを同じschemaから `runtime = "workerd"` で別途生成します。Wranglerのaliasで全importをこの生成物へ揃え、Bun用生成物を上書きしません。PrismaClient/pg poolは各リクエスト専用で `max: 1`、成功・失敗とも `finally` で `$disconnect()` します。Hyperdriveの共有poolとは別のライフサイクルです。
- Supabase Authのクライアントもリクエストごとに生成し、セッション永続化・自動更新を無効にします。Resendは当該環境のキーで呼び出します。招待メールのoutbox配信は既存のBunワーカーを継続利用します。Cloudflare Cronや新たな配信ワーカーは追加しません。

## パスワードと設定

`argon2id@1.0.1` の静的Wasmを使い、既存Bun既定のArgon2id v19・m=65536 KiB・t=2・p=1・salt32bytes・tag32bytesを維持します。Bun経路は引き続き `Bun.password` を使います。Workersで想定外のPHC形式は照合失敗にします。計算量の緩和や再ハッシュによる強度変更は行いません。

Wasmはisolateで一度だけ初期化し、初回の並行呼び出しも同じPromiseを待ちます。初期化後の計算は同期処理で、可変メモリを使う区間にawaitはありません。リクエストごとに64MiB級のインスタンスを作りません。

既存 `.env.example` にあるアプリ設定をWranglerのvars/secretへ設定します。`DATABASE_URL` はCloudflare本体では使わず、`HYPERDRIVE.connectionString` を使います。JWT/HMACの秘密値は既存Bun環境と共有することで、トークンの意味を保ちます。接続先・秘密値はGit・PR・ログに残しません。

WorkersではNode用OpenTelemetry初期化・pg自動計装・OTLP exporterを起動せず、HTTP tracing middlewareも無効にします。Bunのtelemetry初期化順は従来どおりです。Workersの想定外エラーは固定メッセージだけを記録します。Cloudflare側のログ/trace機能は設定テンプレートでは無効です。

CookieのSecure/SameSiteとCORS/Origin許可リストは既存設定を使用します。レート制限は既存のメモリ内方式で、Object/isolateの再起動で失われます。永続的な分散レート制限ではありません。IPはCloudflareの `CF-Connecting-IP` だけを信頼し、入口で `X-Forwarded-For` / `X-Real-IP` を除去します。BunのALB/GCP向けの末尾IP採用は維持します。

## ビルドと手動配備の前提

```bash
bun ci
bun run prisma:generate
bun run cloudflare:build
```

`wrangler.json` は公開URLを持たないテンプレートです。`workers_dev=false`、`preview_urls=false` を維持し、実Hyperdrive IDと公開ドメインはGit管理外の `.wrangler/app.remote.json` へ設定してください。`main` とPrisma aliasはリポジトリからの絶対パスへ直し、SQLite型DOのbindingとmigrationを保持します。検証Workerのnamespace・URL・Access Application・Terraform stateを流用して上書きしないでください。

公開する場合は、以下の順に準備します。本PRでは公開URLの有効化・実環境への本体配備は行っていません。

1. 本体専用のAccess Applicationをホスト全体に作成します。pathを絞らず、`/health`・OpenAPI・OPTIONSを含む全パスを保護します。メール許可リストと専用サービス資格情報は[既存の運用手順](deployment-cloudflare.md)と同様に設定します。
2. AccessのチームURLを `ACCESS_ISSUER`（`https://<team>.cloudflareaccess.com`、末尾スラッシュなし）、本体Access ApplicationのAUDを `ACCESS_AUDIENCE` に設定します。DOは固定チームの `/cdn-cgi/access/certs` を参照し、RS256署名・issuer・audience・exp・iatを検証します。設定不足や不正JWTでは本体処理へ進みません。
3. ローカルremote設定へキャッシュ無効・SSL証明書検証付きの既存Hyperdrive IDを設定し、既存アプリの非秘密設定をvarsへ、JWT/HMAC・Supabase公開キー・Resendキー等をWrangler secretまたはGit管理外のsecretsファイルへ設定します。必要な設定は `.env.example` と各機能の設定ドキュメントを参照してください。`SPIKE_TOKEN` は使いません。
4. Accessが全パスを覆ったことを確認してから、同じホストのCustom Domain/routeをremote設定に追加し、手動で `wrangler deploy --config .wrangler/app.remote.json` を実行します。`workers.dev` とpreview URLを別の入口として有効にしないでください。
5. Accessなしの要求が拒否され、Accessを通った要求でも既存アプリのBearer/Cookie認証と組織権限が必要なことを確認します。

サービス間通信では `CF-Access-Client-Id` / `CF-Access-Client-Secret` を使います。`Authorization: Bearer <アプリのアクセストークン>` はアプリ用です。Accessのサービス資格情報で置き換えないでください。Accessが付与した `Cf-Access-Jwt-Assertion` はDOでも検証します。

## ローカル実DB・workerd検証

```bash
bun run test:cloudflare
```

Node 24・Bun・Dockerが必要です。スクリプトは自分で作ったPostgreSQL 17コンテナだけに既存migrationを適用し、テスト後に検証データを消してコンテナを停止します。既存ローカルDBやSupabaseへ接続しません。JWKS・Supabase Auth・Resendの外部HTTPは合成応答で確認し、実メールは配信しません。

通常の本体バンドルと、`src/test/cloudflareHarness.ts` から作る検証バンドルを分離します。検証専用APIを本体へ追加せず、本体と同じ `runCloudflareRequest` を検証します。

- Access未認証/不正JWT拒否、全feature/OpenAPI登録、アプリBearer必須、CORS/Origin
- ASCII・日本語/絵文字・256文字・NULのBun→Workers照合とWorkers→Bun照合、誤パスワード拒否
- 本体API経由のsignup/login/change-password、Cookie属性、refreshローテーションと再利用時のfamily失効
- 組織・projectのPrisma読み書き、非所属ユーザーへの情報非公開
- interactive transaction・FOR UPDATE・rollback・P2002・後片付け
- 同一Objectの4リクエストでDB固定200ms待機が重複すること、環境値と接続の分離、4ユーザーのAPI応答の分離
- 応答後に接続が残らないこと、専用DBの検証データ削除

GitHub CIの `Cloudflare Runtime Test` はこの検証を実行します。既存のTerraform 3ジョブは引き続きneedsなしで並列です。共通CIのどれかが失敗すると既存GCP CDも停止するゲートを維持します。

## 検証の限界

ローカルworkerdの成功は、実Cloudflare上の本体全ルート・外部サービス実通信・ピーク負荷・最大メモリ・入口CPU・Durable Object CPUの測定を代替しません。通常Workerの10msへ全処理を収めたという意味ではなく、CPUを使う処理はDO側で実行します。圧縮バンドルサイズはFreeの上限内でも、日次quota・メモリ・CPUの全面適合を断定しません。[①の互換性検証と証跡の範囲](cloudflare-compatibility.md)も参照してください。

実Cloudflareへの本体配備、全体負荷/CPU/最大メモリ測定、Cloudflare CDの初回実環境有効化は別途実施します。GCPのインフラ・既存CDを本体対応のために変更しません。

## 参照

- [Workersの上限](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objectsの上限](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Access JWTの検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Prisma v7のWorkers対応](https://www.prisma.io/docs/guides/v7/deployment/cloudflare-workers)
