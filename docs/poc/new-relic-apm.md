<!-- cspell:ignore prebuilds armv -->

# New Relic APM 導入方針 PoC

このドキュメントは、Issue #63「New RelicによるAPM導入方針を検討する」のPoC（概念実証）結果と、それに基づく導入判断の正本です。

- 検証日: 2026-06-26
- 対象構成: Bun 1.3.14 / Hono 4.x / Prisma 7.x（`@prisma/adapter-pg`）/ Supabase PostgreSQL
- 検証対象agent: New Relic Node.js Agent（`newrelic@14.1.2`）
- 検証範囲: ローカル中心（実際のNew Relicアカウントへの接続・データ送信は対象外）

## 1. 結論（先に要点）

**現時点では、Bunランタイム上で New Relic Node.js Agent による自動計装（auto-instrumentation）は実用にならない。New Relic Node.js Agent の素の導入は見送りを推奨する。**

理由は次の2点で、いずれもローカルPoCで実機確認した（詳細は[4. 検証結果](#4-検証結果)）。

1. **デフォルト構成ではBunが起動時にクラッシュする。** New Relic Agentが依存するネイティブアドオン `@newrelic/native-metrics` をBunが読み込む際にsegmentation fault（`Trace/BPT trap: 5`）でプロセスごと落ちる。
2. **クラッシュ回避策を取っても、Honoのリクエストが Transaction として記録されない。** ネイティブモジュールを無効化すればagent自体は起動しアプリも応答するが、Honoのリクエストハンドラ内で New Relic のアクティブな Transaction を取得できない（`hasTransaction: false`）。つまりAPMの中核であるWeb Transaction計装が機能しない。

観測が必要になった場合の現実的な代替は、**OpenTelemetry（OTLP）をアプリ層で計装し、必要ならNew RelicのOTLPエンドポイントへ送る方式**である（[5. 代替方針](#5-代替方針opentelemetry)）。

## 2. PoCで確認したかった観測項目

Issue #63「確認したいこと」に対応する観測項目と、PoCでの確認状況を整理する。

| # | 観測したい項目 | PoCでの確認状況 |
| --- | --- | --- |
| 1 | Bun上で New Relic Node.js Agent が正常に起動するか | ✗ デフォルトではクラッシュ。ネイティブモジュール無効化時のみ起動 |
| 2 | HonoのリクエストがAPM上で Transaction として確認できるか | ✗ ハンドラ内でアクティブTransactionを取得できない |
| 3 | ルート名が高カーディナリティにならずAPI単位で集約できるか | — Transaction自体が生成されないため検証不能 |
| 4 | Prisma / pg 経由のDBアクセスがspanとして確認できるか | — 親Transactionが無いためspanも紐づかない（後述の計装失敗とも整合） |
| 5 | エラー・レスポンスタイム・外部API呼び出しが記録されるか | — Web Transactionが起点となるため、同上で記録されない |
| 6 | ローカル / staging / 本番の環境変数・secret管理方針を整理できるか | △ ローカルで整理（[6. 環境変数・secret方針](#6-環境変数secret管理方針)）。staging/本番は方針整理に留める |
| 7 | Bun非互換時に代替検討へ進むか／見送るか判断できるか | ✓ 見送り＋OTel代替の判断を整理（[1](#1-結論先に要点) / [5](#5-代替方針opentelemetry)） |

## 3. なぜ Bun + New Relic Node.js Agent は相性が悪いのか（懸念点の整理）

New Relic Node.js Agent は、次の2つの仕組みに強く依存している。Bunはこのどちらとも噛み合わない。

### 3-1. ネイティブアドオン（`@newrelic/native-metrics`）

- Agentはイベントループ遅延やGC統計を取るため、`.node` 形式のネイティブアドオンをロードする。
- Bunのネイティブモジュールローダーがこのprebuiltアドオンの読み込みで segfault する。これは New Relic ではなく **Bun側のネイティブモジュール互換性の問題**だが、結果としてアプリが起動できない。
- 回避策は `NEW_RELIC_NATIVE_METRICS_ENABLED=false` ＋当該パッケージを読ませないことだが、これによりGC/イベントループ系メトリクスは失われる。

### 3-2. モジュールのモンキーパッチ（shimmer）による自動計装

- Agentは `http`・`pg`・各種ライブラリの`require`時にメソッドを差し替える（monkey-patch）ことでTransactionやspanを生成する。
- Bunの組み込みモジュールは多くがread-onlyで、差し替えに失敗する。実機ログでも `Failed to instrument module crypto ... Attempted to assign to readonly property` が確認できた。
- さらに本質的な問題として、**Hono on Bun は `Bun.serve({ fetch })`（Web標準のfetchハンドラ）でリクエストを受ける**。New Relic の Web Transaction 計装は Node の `http.Server` をフックするため、`http` を経由しない `Bun.serve` のリクエストは最初からフック対象に入らない。
- このため、たとえネイティブモジュール問題を回避しても、Honoのリクエストは Transaction として認識されない。DBアクセス（Prisma/pg）も親Transactionにぶら下がらないため、APMとして意味のあるトレースにならない。

### 3-3. 運用上の懸念

- Bunが報告するNode互換バージョン（PoC時 `v24.3.0`）に対し、Agentが将来サポート外のNodeバージョンを要求した場合、警告や計装スキップが発生し得る。
- New Relic公式はBunを正式サポート対象として明記していない。Bun側 / Agent側どちらのアップデートでも挙動が変わるリスクがあり、APMのような運用基盤を非サポート構成に載せるのは中長期的に不安定。

## 4. 検証結果（実機ログ）

ローカルの使い捨てプロジェクト（リポジトリ外）に `newrelic@14.1.2` と `hono` を入れ、`import 'newrelic'` を先頭に置いた最小Honoアプリで確認した。ライセンスキーはダミー（実送信なし）。

### 4-1. デフォルト構成 → Bunがクラッシュ

```text
panic(main thread): Segmentation fault at address 0x0
Crashed while loading native module:
  .../@newrelic/native-metrics/prebuilds/darwin-arm64/@newrelic+native-metrics.abi137.uv1.armv8.glibc.node
oh no: Bun has crashed.
```

アプリは起動せず、HTTPリクエストも受け付けない。

### 4-2. ネイティブモジュール無効化 → 起動はするが計装は不十分

`NEW_RELIC_NATIVE_METRICS_ENABLED=false` ＋ `@newrelic/native-metrics` を読ませない状態にすると、agentは起動しアプリはHTTP応答を返す。ただしログに計装失敗が出る。

```text
Using New Relic for Node.js. Agent version: 14.1.2; Node version: v24.3.0.
Failed to instrument module crypto ... "Attempted to assign to readonly property."
Agent state changed from stopped to starting.
```

`GET /` と `GET /users/:id` はアプリとしては正常応答するが、ハンドラ内で New Relic のアクティブTransactionを取得すると次のとおりで、**Web Transactionが生成されていない**ことを確認した。

```json
{ "id": "42", "hasTransaction": false, "txHandle": 0 }
```

（ダミーライセンスキーのため `status code 401` も出るが、これは想定どおりでBun互換性とは別の事象。）

## 5. 代替方針（OpenTelemetry）

New Relic Node.js Agent を見送る場合、観測が必要になった時点での代替は **OpenTelemetry** を推奨する。

- OTelは**アプリ層で計装**できる。Honoのミドルウェアとして各リクエストをspan化すれば、`Bun.serve`/fetchベースでも `http` モジュールのモンキーパッチに依存せずTransaction相当のトレースを取れる。
- DBアクセスは、Prisma/pg呼び出しを明示的にspanで囲む（手動計装）か、対応するOTel instrumentationが使える範囲で利用する。
- New Relic は **OTLP（OpenTelemetry Protocol）受信**に対応しているため、「OTelで計装 → OTLPでNew Relicへ送信」という構成にすれば、ベンダーロックインを避けつつNew RelicのUIも使える。送信先をDatadog等へ差し替えることも将来的に容易。
- ただしOTelでも、ライブラリ自動計装の一部はNode前提でBun上で動かない可能性がある。採用時はOTel側でも同様のPoC（Honoミドルウェア計装＋Prisma手動span）を最小構成で確認することが前提。

### 判断

- **New Relic Node.js Agent（素の自動計装）: 見送り。** Bun非対応が実機で確認されたため。
- **観測基盤が必要になった場合: OpenTelemetry（アプリ層計装）を第一候補とし、エクスポート先としてNew RelicのOTLPを検討する。**

## 6. 環境変数・secret管理方針

PoCの実検証はローカル中心とし、staging / 本番は方針整理に留める（実反映はIssue #63の非対象）。将来導入する場合に必要となる変数を整理しておく。

| 変数 | 用途 | 管理方針 |
| --- | --- | --- |
| `NEW_RELIC_LICENSE_KEY` / OTLP用APIキー | New Relicへの送信認証 | secret扱い。`.env`（ローカル）/ 環境のsecret管理（staging・本番）。リポジトリにコミットしない |
| `NEW_RELIC_APP_NAME` 相当（OTelでは`service.name`） | アプリ識別名 | 環境ごとに `hono-app-local` / `hono-app-staging` / `hono-app-prod` などで分離 |
| 計装の有効/無効フラグ | ローカルで計装を切れるようにする | ローカルはデフォルト無効を推奨（開発時のノイズ・オーバーヘッド回避） |

- secretは `.env.example` にキー名のみ記載し、値はコミットしない。
- staging / 本番への実反映（CI/CDでのsecret注入、起動方法）は別Issueで扱う。

## 7. 導入する場合の実装Issue分割案

OpenTelemetry方式で進める場合、以下の粒度で実装Issueへ分割できる。

1. **OTel最小PoC（Bun + Hono）** — Honoミドルウェアで1リクエスト=1 spanを生成し、コンソールエクスポータでローカル可視化できることを確認する。
2. **DBアクセスのspan化** — Prisma/pg呼び出しを手動spanで囲み、HTTP spanの子として紐づくことを確認する。
3. **エラー・レスポンスタイム・外部API（Resend等）の計装** — 例外をspanに記録し、外部HTTP呼び出しをspan化する。
4. **OTLPエクスポート設定と環境変数整備** — 送信先（New Relic OTLP等）と `.env.example`・secret注入方針を整える。
5. **staging / 本番への反映** — CI/CDでのsecret注入、環境別 `service.name`、有効化フラグの運用を整備する。

各Issueは、前段がgreenであることを前提に順に着手する。実施可否・優先度は別途判断する。

## 8. Datadogを今回の検討対象から除外する判断

- Datadogは機能範囲・運用コストが、現時点のこのアプリケーションの規模に対して過大である。
- 本Issueの目的は「小さく相性を確認するPoC」であり、Datadogの比較検討まで広げるとスコープが過大になる。
- したがって**Datadogの導入検討は今回の対象外**とする。将来、OTLPでの計装が整えば、エクスポート先の一候補としてDatadogを再評価する余地は残る（OTelはベンダー非依存のため移行容易）。

## 9. 非対象（再掲）

- Datadogの導入検討 / ログ基盤全体の刷新 / SLO・on-call・incident運用の設計
- New Relicの本番導入の完了 / staging・本番環境への設定反映
