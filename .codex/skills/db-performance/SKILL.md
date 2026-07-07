---
name: db-performance
description: Use when investigating slow or frequent SQL queries or DB-related API latency, using pg_stat_statements, OpenTelemetry / New Relic DB spans, EXPLAIN (ANALYZE, BUFFERS), and Prisma query logs. DB性能（遅い/多いSQL）調査の入口Skill。
---

# DB Performance Skill

## 概要

DBパフォーマンス（遅いクエリ・多いクエリ）を調査するための標準手順をまとめたスキルです。Codex / Claude がDB遅延調査を行うとき、同じ判断順序で動けるように正本化しています。

`pg_stat_statements`（DB全体の集計）、OpenTelemetry / New Relic trace のDB span（どのAPIリクエストで遅いか）、`EXPLAIN (ANALYZE, BUFFERS)`（対象SQLの深掘り）、Prisma query log（localでの発行SQL確認）を、状況に応じて使い分けます。

方針の確定経緯は #62、本Skillの実装追跡は #91 を参照すること。

## 正本と責務分担

- DB性能調査の手順・各手段の役割分担・local / staging / production の実行可否は、このSkillを正本とする。[CLAUDE.md](../../../CLAUDE.md) / [AGENTS.md](../../../AGENTS.md) には、このSkillへの導線だけを置く。
- index追加・カラム変更など **migrationを伴う改善へ進む場合の検証**は、migration検証Skill（[`../migration-verification/SKILL.md`](../migration-verification/SKILL.md)）を正本とする。本Skillはそこへ接続する（[後述](#6-改善migration-を伴う場合の接続)）。
- migration適用・smoke・PR検証証跡の具体ルールは、migration検証Skillに従う。本Skillでは再掲しない。

## 使用タイミング

- 「APIが遅い」「特定のエンドポイントのレスポンスが遅い」など、DBアクセスが疑われる遅延を調査するとき
- 累積で重い／頻度が高いSQLを洗い出したいとき
- index追加やクエリ改善の前に、現状のボトルネックを定量的に把握したいとき

## 調査の基本順序

最初から実行計画を読みにいかず、粗い集計 → リクエスト単位の特定 → 対象SQLの深掘り、の順に絞り込む。

1. **どのSQLが重いか／多いか**（DB全体）→ `pg_stat_statements`
2. **どのAPIリクエストで遅いDBアクセスが起きたか** → OpenTelemetry / New Relic trace のDB span
3. **対象SQLがなぜ遅いか** → `EXPLAIN (ANALYZE, BUFFERS)`
4. **repositoryが実際に何を発行しているか**（local） → Prisma query log
5. 改善方針が固まったら、index追加・migrationの **実DB検証ルール**へ接続する

1と2は補完関係（1はDB全体の累積、2はリクエスト起点）。どちらから入ってもよいが、片方だけで判断しない。

## 各環境で実行してよい確認内容

| 手段 | local | staging | production |
| --- | --- | --- | --- |
| `pg_stat_statements` の集計（SELECT） | ✅ | ✅ | ✅（読み取りのみ。`pg_stat_statements_reset()` は原則禁止） |
| New Relic trace のDB span 確認 | ✅（送信設定時） | ✅ | ✅ |
| `EXPLAIN`（ANALYZEなし） | ✅ | ✅ | ✅ |
| `EXPLAIN (ANALYZE, BUFFERS)` | ✅ | ✅（影響を理解した上で） | ⚠️ 原則避ける。実行が必要なら参照系のみ・ユーザー承認の上で |
| Prisma query log | ✅（短時間ON） | ❌ | ❌ |
| `pg_stat_statements_reset()` / 統計リセット | ✅ | ⚠️ 承認の上で | ❌ |

共通の注意:

- `EXPLAIN ANALYZE` は対象SQLを **実際に実行する**。`INSERT` / `UPDATE` / `DELETE` を `EXPLAIN ANALYZE` するとデータが変わるため、書き込み系はトランザクションで囲って `ROLLBACK` するか、production では実行しない。
- production の調査は読み取り（集計・trace閲覧・`EXPLAIN`）に限定し、状態を変える操作（reset・log有効化・書き込み系のANALYZE）はユーザー承認を必須とする。
- SQL本文やパラメータには機微情報が含まれ得る。共有・PR・Issueへ貼るときは値をマスクする（[後述](#機微情報の取り扱い)）。

## 実行手順

### 1. pg_stat_statements で重い／多いSQLを集計する

DB全体で、累積で重いSQL・頻度が高いSQLを集計する入口。

#### 1-1. 有効化前提の確認

`pg_stat_statements` は `shared_preload_libraries` に登録され、`CREATE EXTENSION` 済みであることが前提。

- **local（Supabase CLI）**: Supabaseのローカルスタックでは既定で有効。`bun run db:start` で起動後、下記の存在確認クエリで利用可否を確認する。
- **staging / production（Supabase）**: マネージドSupabaseでは `pg_stat_statements` が既定で有効。無効な場合のみ、SupabaseのDashboard（Database → Extensions）または `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` で有効化する。`shared_preload_libraries` の変更はDB再起動を伴うため、production ではユーザー承認の上で行う。

存在確認（local接続例。DBは `postgresql://postgres:postgres@127.0.0.1:54322/postgres`）:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
  "SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';"
```

行が返らない場合は有効化が必要:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

`shared_preload_libraries` の状態確認:

```sql
SHOW shared_preload_libraries;
```

#### 1-2. 集計クエリ

累積実行時間が長いSQL（1回あたり重いものと頻度が高いものを分けて見る）:

```sql
-- 累積実行時間が長い上位
SELECT
  calls,
  round(total_exec_time::numeric, 1)  AS total_ms,
  round(mean_exec_time::numeric, 2)   AS mean_ms,
  rows,
  query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

```sql
-- 1回あたりが重い上位（一定回数以上に絞る）
SELECT
  calls,
  round(mean_exec_time::numeric, 2)   AS mean_ms,
  round(total_exec_time::numeric, 1)  AS total_ms,
  rows,
  query
FROM pg_stat_statements
WHERE calls >= 10
ORDER BY mean_exec_time DESC
LIMIT 20;
```

- `total_exec_time` が大きい＝累積でDBを占有しているSQL。`mean_exec_time` が大きい＝1回あたり重いSQL。両者を分けて見る。
- `calls` と `rows` を併せ、N+1（同型クエリの大量発行）や1回で大量行を返すクエリを見分ける。
- 統計をクリーンにしてから測りたい場合は、local で `SELECT pg_stat_statements_reset();` を実行してから対象操作を流す（production では原則禁止）。
- PostgreSQLのバージョンによって列名が異なる場合がある（古い版は `total_time` / `mean_time`）。列が無い場合は `\d pg_stat_statements` で確認する。

### 2. New Relic trace（DB span）でAPIリクエストと紐づける

「どのAPIリクエストで遅いDBアクセスが発生したか」を見る。本リポジトリでは `@opentelemetry/instrumentation-pg`（[src/libs/telemetry/db.ts](../../../src/libs/telemetry/db.ts)）でPostgreSQLアクセスをDB spanとして計測し、OTLP経由でNew Relicへ送信している（[src/libs/telemetry/index.ts](../../../src/libs/telemetry/index.ts)）。

#### 2-1. trace送信の有効化前提

DB spanはroot span（HTTP request span）の子として計測される（`requireParentSpan: true`）。trace送信には以下の環境変数が必要（[.env.example](../../../.env.example) 参照）:

- `OTEL_TRACES_ENABLED="true"`（未設定・falseだとexporterを作らず外部送信しない）
- `OTEL_SDK_DISABLED` が `true` でないこと
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`（New Relic OTLP/HTTP endpoint）
- `OTEL_EXPORTER_OTLP_TRACES_HEADERS`（`api-key=<New Relic license key>`。実値はコミットしない）
- `OTEL_TRACES_SAMPLER_RATIO`（head-based sampling。既定0.1＝約10%）

local で trace を確認したい場合は一時的に `OTEL_TRACES_ENABLED=true` と endpoint/headers を設定する。サンプリングで間引かれるため、再現確認では `OTEL_TRACES_SAMPLER_RATIO=1` にすると取りこぼしを減らせる。

#### 2-2. New Relic 上での確認

- New Relic の Distributed tracing / APM で対象 `service.name`（既定 `hono-app`、`OTEL_SERVICE_NAME` で指定）を開く。
- 遅いHTTP request span（エンドポイント）を選び、子のDB span（PostgreSQL）を見て、どのDBアクセスが時間を占めているか・同型spanが何度も出ていないか（N+1）を確認する。
- DB span名・属性で対象SQLの型を特定し、手順1の集計や手順3の `EXPLAIN` につなぐ。
- 現状のDB spanは `enhancedDatabaseReporting: false` のため、span属性に詳細なSQL本文・パラメータは載らない前提。SQL本文の特定は `pg_stat_statements` / Prisma query log 側で行う。

### 3. EXPLAIN (ANALYZE, BUFFERS) で対象SQLを深掘りする

手順1・2で見つけた対象SQLの実行計画を確認する。

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ...; -- 対象SQL
```

確認するポイント:

- index利用 vs `Seq Scan`（想定したindexが効いているか）
- `rows`（推定）と `actual rows`（実測）の乖離（統計のズレ・カーディナリティ誤推定）
- `Sort` / `Hash` / `Join` のコストとメモリ（`work_mem` あふれによる外部ソート）
- `Buffers`（shared hit/read。読み取り量とキャッシュ効き）
- 本リポジトリのschema上のindex（[prisma/schema.prisma](../../../prisma/schema.prisma) の `@unique` / `@@unique` / `@@index`）が、対象クエリのWHERE/JOIN/ORDER BYに対応しているか

注意:

- `EXPLAIN ANALYZE` はSQLを実際に実行する。書き込み系（`INSERT`/`UPDATE`/`DELETE`）を計測する場合はトランザクションで囲い `ROLLBACK` する:

  ```sql
  BEGIN;
  EXPLAIN (ANALYZE, BUFFERS) UPDATE ...;
  ROLLBACK;
  ```

- production では `EXPLAIN ANALYZE`（実行を伴う）を原則避け、まず実行を伴わない `EXPLAIN` で計画だけ見る。ANALYZEが必要な場合は参照系に限定し、ユーザー承認の上で行う。
- Prismaが発行する実SQLは prepared statement のパラメータ付きであることが多い。`pg_stat_statements` の正規化済みクエリやquery logからSQL本文を取り、具体値を埋めて `EXPLAIN` する。

### 4. Prisma query log を local で短時間だけ有効化する

repositoryメソッドが実際にどのSQLを発行しているか（N+1や想定外のクエリ）を local で確認するデバッグ用途。常設の計測基盤にはしない。

本リポジトリのPrismaクライアントは [src/libs/prisma/index.ts](../../../src/libs/prisma/index.ts) で `adapter-pg` を使って生成している。query logを見たい場合は、調査時だけ一時的に `log` オプションを付ける（恒久的にコミットしない）:

```typescript
// 調査時のみ一時的に付与する。コミットしないこと。
export const prisma = new PrismaClient({
  adapter,
  log: ['query'],
})
```

注意点:

- **local 限定・短時間ON**。staging / production では有効化しない（ログ量が膨大になり、SQL本文・パラメータに機微情報が混入する）。
- 調査が終わったら `log` オプションを必ず外す。`git status` / `git diff` で `src/libs/prisma/index.ts` に変更が残っていないことを確認してからコミットする。
- query log を貼る場合はパラメータ値をマスクする。

### 5. 機微情報の取り扱い

- SQL本文・パラメータ・query log・trace属性には、email・token・個人情報が含まれ得る。
- PR・Issue・レビューコメント・チャットへ貼るときは、`WHERE email = 'xxx@example.com'` のような具体値や token を `<masked>` 等へ置き換える。
- production の license key やcredentialは貼らない（[.env.example](../../../.env.example) の `OTEL_EXPORTER_OTLP_TRACES_HEADERS` の実値など）。

### 6. 改善（migration を伴う場合）の接続

調査の結果、index追加・カラム変更・クエリ修正などで **migrationを伴う改善**へ進む場合は、ここで本Skillの調査フェーズを抜け、実DB検証ルールへ接続する。

- migrationの作成・適用・`prisma generate`・smoke・PR検証証跡は、migration検証Skill（[`../migration-verification/SKILL.md`](../migration-verification/SKILL.md)）を正本とする。
- index追加は、追加前後の `EXPLAIN (ANALYZE, BUFFERS)` を取り、`Seq Scan` → `Index Scan` への変化や実行時間・`Buffers` の改善を smoke として記録すると、検証証跡に使える。
- migrationを伴わない調査だけで完結した場合（設定変更・クエリ呼び出し側の修正のみ等）は、その旨をPR本文の `## 実DB検証` セクションへ記載する（migrationを含まない場合のリスト形式記載に従う）。

## 注意事項

- 調査用に作成したデータ・有効化した設定（query logオプション、`pg_stat_statements` のreset、一時的なtrace有効化）は、調査後に元へ戻す。
- 使い捨てスクリプトはリポジトリ直下に残さない（`/tmp` 等を使うか、終了後に `git status` で未追跡ファイルが無いことを確認する）。コミットしない。
- 推測でindexを足さない。集計・trace・`EXPLAIN` で「どのSQLが・なぜ遅いか」を定量的に示してから改善へ進む。
- このSkillは Claude版（`.claude/skills/db-performance/`）と Codex版（`.codex/skills/db-performance/`）を同期運用する。片方だけ更新しないこと。
