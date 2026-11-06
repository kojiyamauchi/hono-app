# Observability

このドキュメントでは、OpenTelemetryで作成したtraceをNew Relicへ送信するための環境変数、secret管理、環境別の有効化方針、New Relic UIでの確認手順を整理します。

## 方針

- New Relic Node.js AgentはBun + Hono構成では使わず、OpenTelemetry + OTLP/HTTP protobuf exporterでtraceを送信します。
- 初期導入対象はtracesのみです。Datadog、logs、metrics、alert、dashboard、SLO設計は初期導入の対象外です。
- HTTP request spanは `@hono/otel` で作成します。
- DB spanは `@opentelemetry/instrumentation-pg` で作成します。Prismaは `@prisma/adapter-pg` 経由で `pg` を使うため、実アプリのDBアクセスもpg instrumentationで追跡します。
- 外部API spanは自動計装ではなく、serviceやmiddlewareの境界で手動作成します。対象はResendのメール送信とSupabase Auth呼び出しです。
- traceはhead-based samplingで送信量を制御します。既定ではroot traceの約10%を送信し、子spanは親traceのsampling判断に従います。

## 環境変数

`.env.example` には実値ではなく設定例だけを置きます。New Relic license keyはsecretとして扱い、リポジトリ、PR本文、テスト出力、ログに残さないでください。

推奨設定はtrace専用の `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_HEADERS` です。`.env.example` には推奨のtrace専用変数だけを記載し、fallback用の共通OTLP変数は下表で挙動だけを説明します。

`OTEL_TRACES_SAMPLER_RATIO` はこのアプリケーションがOpenTelemetry providerへ手動で渡す独自設定です。OpenTelemetry SDKの自動設定で使う標準の `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` とは別の設定として扱ってください。

| 環境変数                             | 必須 | 説明                                                                                                               |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `OTEL_TRACES_ENABLED`                | はい | `true` のときだけtrace exporterを初期化します。未設定または `false` では外部送信しません。                         |
| `OTEL_SDK_DISABLED`                  | 任意 | `true` の場合は `OTEL_TRACES_ENABLED=true` でもOpenTelemetry SDK全体を初期化しません。                             |
| `OTEL_SERVICE_NAME`                  | 任意 | New Relic上の `service.name` です。未設定時は `hono-app` を使います。                                              |
| `OTEL_TRACES_SAMPLER_RATIO`          | 任意 | root traceのhead-based sampling ratioです。未設定時は `0.1` です。`0` は送信なし、`1` は全送信として扱います。     |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | はい | New Relicのtrace送信用OTLP endpointです。US regionは `https://otlp.nr-data.net:4318/v1/traces` を使います。        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | 任意 | base endpointだけを指定したい場合に使います。`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` がある場合はそちらを優先します。 |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS`  | はい | trace送信用headerです。New Relicでは `api-key=<license key>` を指定します。                                        |
| `OTEL_EXPORTER_OTLP_HEADERS`         | 任意 | 共通OTLP headerです。trace専用の `OTEL_EXPORTER_OTLP_TRACES_HEADERS` がある場合はそちらを優先します。              |

設定例:

```txt
OTEL_TRACES_ENABLED="true"
OTEL_SDK_DISABLED="false"
OTEL_SERVICE_NAME="hono-app-local"
OTEL_TRACES_SAMPLER_RATIO="0.1"
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://otlp.nr-data.net:4318/v1/traces"
OTEL_EXPORTER_OTLP_TRACES_HEADERS="api-key=your-new-relic-license-key"
```

`NEW_RELIC_LICENSE_KEY` はアプリケーションから直接読みません。New Relic license keyは、起動環境のsecret managerで保持し、起動時に `OTEL_EXPORTER_OTLP_TRACES_HEADERS=api-key=<license key>` として注入してください。

## 環境別の有効化

### Local

- 既定では `OTEL_TRACES_ENABLED=false` のままにし、外部送信を発生させません。
- New Relic送信を確認するときだけ、ローカルの `.env` に `OTEL_TRACES_ENABLED=true` と `OTEL_EXPORTER_OTLP_TRACES_HEADERS` を設定します。
- `.env` はコミットしません。画面共有、ログ、PR本文にもlicense keyを貼らないでください。

### Staging

- deployment platformやsecret managerにNew Relic license keyを登録し、環境変数として注入します。
- `OTEL_SERVICE_NAME` は本番と区別できる値にします。例: `hono-app-staging`
- trace送信を有効化した後、New Relic UIでservice名、route、外部API span、DB spanが期待どおり見えることを確認します。

### Production

- license keyはsecret managerからのみ注入します。
- `OTEL_SERVICE_NAME` は本番用に固定します。例: `hono-app-production`
- 継続的に有効化する前に、#78で扱うsamplingと送信量制御の方針を確認します。
- SQL文字列やspan属性に個人情報、secret、Authorization header、Cookie、メール本文、リセットトークン、パスワードを含めない前提を守ります。

## New Relic UIでの確認

New Relic UIでは、まずservice名で対象traceを絞り込みます。

```txt
service.name = 'hono-app-local'
```

HTTP request spanは、route templateで確認します。実ID値ではなく `/users/:id` のような低カーディナリティの値になる前提です。

```txt
http.route = '/users/:id'
http.request.method = 'GET'
http.response.status_code = 200
```

外部API spanは、依存先名と操作名で確認します。

```txt
external.system = 'resend'
external.operation = 'emails.send'
external.success = true
```

Supabase Auth呼び出しは以下のような属性で確認できます。

```txt
external.system = 'supabase'
server.address = '<your-project>.supabase.co'
```

DB spanはHTTP request spanの子spanとして表示されることを確認します。OTLP送信前に完全なURL、DB接続文字列とDBユーザー、SQL本文、例外メッセージとスタックトレースを除きます。DBのホスト名・ポート・DB名は残ります。DBの失敗は、処理時間とステータスに加え、`error.type` に残るSQLSTATEや既知の接続エラーコードから確認します。

## GCP devでの実送信検証

Git管理のCD用設定は `enable_otel_traces = false` です。有効にすると `hono-app-dev` のトレースを既存のUS向けOTLPエンドポイントへ送ります。事前にNew Relicの対象アカウントがUSリージョンであることを確認します。[New RelicのOTLPエンドポイント](https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/)

### Secretの準備と手動適用

1. [インフラ変更の手動適用](deployment-gcp-cd.md#インフラ変更の手動適用)に従ってCDを停止し、PRをマージします。Git管理の `env/dev.cd.tfvars.json` と稼働中digestで全体planを作り、OTLP用Secretの入れ物 `hono-app-dev-otel-exporter-otlp-traces-headers` と実行用SAの参照権限だけを追加します。この段階のCloud Runは既存の6件を参照し、送信は無効です。全体再planに差分がないことを確認して通常CDでこのPRのイメージを配備し、機微情報を除外する実装を含むrevisionがReadyになったことを確認します。
2. Secret ManagerのConsoleで `api-key=<license key>` を値とするversionを登録し、数値versionを控えます。実値はtfvars、state、コマンド引数、ログに残しません。
3. 通常CDを再度停止し、他のインフラ変更と作業期間が重ならないようにします。Git管理のCD用tfvarsを元に、`enable_otel_traces` を `true`、`otel_traces_sampler_ratio` を `1` にした検証用tfvarsをGit管理外に用意します。`secret_versions` は既存6件を維持し、`OTEL_EXPORTER_OTLP_TRACES_HEADERS` に登録済みの数値versionを文字列で追加します。
4. 検証用tfvarsと現在のReady revisionのdigestを指定して全体planを保存します。Cloud Runの送信用環境変数と7件目のSecret参照だけが変わることを確認し、同じ保存planを手動適用します。通常CDは検証後の復帰まで停止したままにします。

### リクエストとトレースの確認

IAP内のScalarで、独自認証の確認済みアカウントとSupabase Authの検証用アカウントを用意します。Resendの送信先には管理下の検証用アドレスを使います。

| リクエスト                             | 確認する子span                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| 独自認証でログイン後の `GET /users/me` | `db.system = 'postgresql'` の `pg.query:SELECT` で始まるspan                           |
| `POST /supabase-auth/login`            | `supabase.auth.signInWithPassword`                                                     |
| `POST /auth/password-reset/request`    | `resend.emails.send`。HTTP 202と合わせて子spanの `external.success` と実際の受信を確認 |

New Relicの分散トレーシングで、検証時刻と `service.name = 'hono-app-dev'` で絞ります。各HTTP spanから同じtrace内の子spanを開き、処理時間、HTTPステータス、DBや外部APIの結果を確認します。認証情報、トークン、メール本文・アドレスなどの個人情報がspan属性とイベントにないことを確認します。記録には操作名、結果、所要時間だけを使います。

Cloud Runのリクエスト単位課金では、アイドル中にバッチ送信が遅れる場合があります。反映が遅ければ、IAP経由の `/health` を短時間呼び出して送信を確認します。`/health` は既定のHTTPトレース対象外で、#180の定期チェックもトレース量に算入しません。[Cloud RunのCPU割り当て](https://docs.cloud.google.com/run/docs/configuring/billing-settings#cpu_allocation_impact)

### 送信量と復帰

<!-- cspell:words bytecountestimate SQLSTATE -->

検証期間の `Span` を `service.name` で絞り、`count(*)` と `bytecountestimate()` で件数と概算バイト数を記録します。同じ操作の構成とリクエスト数なら、継続時の比率 `0.1` では `1` の約10分の1が目安です。継続月の対象リクエスト数 × 検証時の1リクエストあたり概算バイト数 × 継続時の比率で月間量を見積もり、実際の請求対象の取り込み量はNew Relicのアカウント使用量で確認します。[New Relicの使用量確認](https://docs.newrelic.com/docs/accounts/accounts-billing/new-relic-one-pricing-billing/usage-queries-alerts/)

- New Relic Original Dataの公開料金は月100 GBの無料枠と超過1 GBあたり0.40米ドルです。実際のプランと他サービスを含む使用量で見積もります。[New Relicの料金](https://newrelic.com/pricing)
- Secret Managerは既存の6件に各1 version、OTLPに1 versionを月を通じて保持する場合、保管料は無料枠超過1件分の月0.06米ドルが目安です。検証期間だけの保管料は保持時間に応じ、月10,000回を超えるアクセスは10,000回あたり0.03米ドルです。他のversionやプロジェクト分も請求先アカウント単位で確認します。[Secret Managerの料金](https://cloud.google.com/secret-manager/pricing)

継続設定の既定は無効です。検証後はGit管理のCD用tfvarsに戻し、比率を既定の `0.1` に戻した入力で、送信の無効化と7件目の参照解除を同じ保存planで適用します。参照中のrevisionと復旧方針を確認してから、不要になった検証用versionをSecret Managerで破棄します。最終構成の全体再planに差分がないことを確認して通常CDを再開し、配備ジョブまで成功したことをPR本文に記録します。継続有効化を選ぶ場合は実測量、費用、機微情報の確認結果を記録し、比率と数値参照をCDの正本へ反映する別の変更として扱います。

### 2026-11-07の実測

[PR #184](https://github.com/kojiyamauchi/hono-app/pull/184)の配備後、`hono-app-dev` のサンプリング比率を `1` にして、00:16〜00:25 JSTのトレースをNew Relicで確認しました。各HTTP spanのIDと子spanの親IDを照合しました。

| リクエスト                          | HTTPステータス・処理時間 | 子span・処理時間                        |
| ----------------------------------- | ------------------------ | --------------------------------------- |
| `GET /users/me`                     | 200、63.9 ms             | PostgreSQLのSELECT 2件、5.7 msと10.0 ms |
| `POST /supabase-auth/login`         | 200、1,023.0 ms          | Supabase Auth、1,017.3 ms、成功         |
| `POST /auth/password-reset/request` | 202、1,012.6 ms          | Resend、459.8 ms、送信API成功           |

- 検証時間帯の取り込みは42 span、概算30,103バイトでした。表の3リクエストに限ると15 span、概算10,680バイトです。`/health` のspanは0件でした。確認したspan属性とイベントに認証情報、メール本文、個人情報は含まれていませんでした。
- 表の3経路と同じ平均データ量を仮定すると、継続比率 `0.1` では対象リクエスト1万件あたり約3.56 MBです。New Relicの取り込み費用は、この量を他サービスの利用量と合わせて月100 GBの無料枠に収まる場合は0米ドルです。Secret Managerで7件目のversionを継続保持する場合、既存6件に各1 versionを保持する前提では月約0.06米ドルの増分です。いずれも公開料金と実測からの概算です。
- 今回は実送信を検証したため、継続送信は無効に戻しました。検証用の比率指定を外して既定の `0.1` に戻し、Cloud Runの7件目の参照を解除したうえで、検証用Secret versionとアカウント2件を削除しました。

## Samplingと送信量制御

`OTEL_TRACES_SAMPLER_RATIO` はroot traceに対するhead-based sampling ratioです。`0.1` なら約10%のtraceを送信します。DB spanと外部API spanはHTTP request spanの子spanとして作られるため、親traceがsampledになった場合だけ同じtraceとして送信されます。

初期導入では以下を推奨します。

- local: 通常は `OTEL_TRACES_ENABLED=false` のままにし、New Relic確認時だけ `OTEL_TRACES_SAMPLER_RATIO=1` で短時間確認する
- staging: `OTEL_TRACES_SAMPLER_RATIO=1` で疎通確認後、継続確認では `0.1` へ下げる
- production: 継続有効化の開始時は `0.1` を基準にし、New Relic上のingest量を見て調整する

`/health` は高頻度かつ低価値なendpointのため、既定でHTTP request spanの作成対象から除外しています。現時点で他に除外するendpointはありません。外部API spanとDB spanは、HTTP request spanの配下で必要最小限の属性だけを送る方針です。

error traceも初期導入では同じhead-based samplingに従います。errorを必ず保存するtail-based sampling、alert、logs連携は初期導入の非対象です。障害調査で一時的にerror traceを厚く見たい場合は、対象環境の `OTEL_TRACES_SAMPLER_RATIO` を短時間だけ `1` に上げ、確認後に戻してください。

New Relic無料枠を意識した送信量確認では、以下をservice名で絞り込んで確認します。

- `service.name` ごとのtrace ingest量
- `http.route` ごとのtrace件数と高頻度endpoint
- `external.system` ごとの外部API span件数
- DB spanの件数と、送信された属性やイベントに機微情報が含まれていないこと

## 確認時の注意

- `OTEL_TRACES_ENABLED` が `true` でも、endpointまたはheadersが不足している場合は初期化せず外部送信しません。
- `OTEL_SDK_DISABLED=true` の場合は、他の設定が揃っていてもOpenTelemetryを無効化します。
- `SIGTERM` / `SIGINT` を受けたときは、未送信spanをflushしてからサーバーを停止します。
- テストでは外部送信を発生させず、in-memory exporterやmockで確認します。
