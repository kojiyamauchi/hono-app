# Observability

このドキュメントでは、OpenTelemetryで作成したtraceをNew Relicへ送信するための環境変数、secret管理、環境別の有効化方針、New Relic UIでの確認手順を整理します。

## 方針

- New Relic Node.js AgentはBun + Hono構成では使わず、OpenTelemetry + OTLP/HTTP protobuf exporterでtraceを送信します。
- 初期導入対象はtracesのみです。Datadog、logs、metrics、alert、dashboard、SLO設計は初期導入の対象外です。
- HTTP request spanは `@hono/otel` で作成します。
- DB spanは `@opentelemetry/instrumentation-pg` で作成します。Prismaは `@prisma/adapter-pg` 経由で `pg` を使うため、実アプリのDBアクセスもpg instrumentationで追跡します。
- 外部API spanは自動計装ではなく、serviceやmiddlewareの境界で手動作成します。対象はResendのメール送信とSupabase Auth呼び出しです。

## 環境変数

`.env.example` には実値ではなく設定例だけを置きます。New Relic license keyはsecretとして扱い、リポジトリ、PR本文、テスト出力、ログに残さないでください。

| 環境変数                             | 必須 | 説明                                                                                                               |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `OTEL_TRACES_ENABLED`                | はい | `true` のときだけtrace exporterを初期化します。未設定または `false` では外部送信しません。                         |
| `OTEL_SDK_DISABLED`                  | 任意 | `true` の場合は `OTEL_TRACES_ENABLED=true` でもOpenTelemetry SDK全体を初期化しません。                             |
| `OTEL_SERVICE_NAME`                  | 任意 | New Relic上の `service.name` です。未設定時は `hono-app` を使います。                                              |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | はい | New Relicのtrace送信用OTLP endpointです。US regionは `https://otlp.nr-data.net:4318/v1/traces` を使います。        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`        | 任意 | base endpointだけを指定したい場合に使います。`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` がある場合はそちらを優先します。 |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS`  | はい | trace送信用headerです。New Relicでは `api-key=<license key>` を指定します。                                        |
| `OTEL_EXPORTER_OTLP_HEADERS`         | 任意 | 共通OTLP headerです。trace専用の `OTEL_EXPORTER_OTLP_TRACES_HEADERS` がある場合はそちらを優先します。              |

設定例:

```txt
OTEL_TRACES_ENABLED="true"
OTEL_SDK_DISABLED="false"
OTEL_SERVICE_NAME="hono-app-local"
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

DB spanはHTTP request spanの子spanとして表示されることを確認します。DB spanではSQL本文属性（`db.statement` または `db.query.text`）が送信される可能性があるため、SQLに個人情報やsecretを直接埋め込まないでください。

## 確認時の注意

- `OTEL_TRACES_ENABLED` が `true` でも、endpointまたはheadersが不足している場合は初期化せず外部送信しません。
- `OTEL_SDK_DISABLED=true` の場合は、他の設定が揃っていてもOpenTelemetryを無効化します。
- `SIGTERM` / `SIGINT` を受けたときは、未送信spanをflushしてからサーバーを停止します。
- テストでは外部送信を発生させず、in-memory exporterやmockで確認します。
