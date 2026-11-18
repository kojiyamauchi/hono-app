# Cloudflare Workersの互換性検証

既存のGCP / Bun構成を維持し、同じSupabaseを使うWorkersを追加するための初期検証です。検証コードは `scripts/cloudflare-compatibility/` に分離しています。本番アプリ、Prisma schema・migration、GCPのインフラ・CDは変更していません。

## 現在の結論（2026-11-18）

**Prismaと既存のArgon2id設定を維持したまま、Workers Freeで一括・並行検証が完了する構成を確認しました。** 通常のWorkerは入口認証と内部転送だけを行い、CPUを使う処理を無料プランのSQLite型Durable Objectsへ移します。データの保存先は既存のSupabaseのままです。

```txt
Cloudflare Access → 入口Worker → Durable Object → Prisma → Hyperdrive → 既存Supabase
```

通常のWorkerのCPU上限は10msですが、SQLite型Durable Objectsの既定CPU上限は1リクエスト30秒です。処理を10ms以内に短縮できたという結論ではなく、無料プランで使える実行場所の変更です。[Durable Objectsの制限](https://developers.cloudflare.com/durable-objects/platform/limits/)

実Cloudflareで以下を一括実行し、すべて成功しました。

- ASCII、日本語・絵文字、256文字、NUL入りの4ケースで、Bun→Workersの検証とWorkers→Bunの検証、誤ったパスワードの拒否。
- パスワードの並行2リクエスト。
- Prismaの読み書き、interactive transaction、行ロック、rollback、email重複のP2002、検証行の残存なし。
- DBの並行2リクエスト。
- Access資格情報なしの拒否と、Access通過後の検証用Bearer秘密値なしの401。

Durable ObjectのSQLiteへユーザーデータ・パスワード・検証結果を書き込みません。検証用の単一Objectへ転送します。リクエスト全体の直列キューは外し、DBなどのI/O待ちの間に別リクエストを進めます。従来のハッシュ計算は同期処理で、初期化Promiseと約65MiBのWasm領域を共有します。計算中は同じisolateの別のハッシュ計算へ切り替わりません。追加Wasm候補もハッシュ計算に限定した専用キューを維持しています。Prismaは元の全モデルを持つクライアントを使い、DB接続は各リクエストで作成・切断します。GCP、本番アプリ、Supabaseのschema・migration、ハッシュの強度は変更していません。

これは検証Workerでの結果です。アプリ全体のWorkers移植、ログイン全体の計測、ピーク負荷時の待ち行列・メモリ使用量・Objectの分散設計は別途必要です。実ユーザーのハッシュは取得せず、既存コードと同じBun既定値で生成した合成ハッシュを検証しています。

### 同じDurable Objectでの並行実行（2026-11-18）

現在の配備Versionは `25be07b6-d1d8-4592-bcab-b9c4c3204701` です。入口・内部の認証、Prismaの生成物、ハッシュ設定は維持し、リクエスト全体を待たせていたモジュール共通のPromiseキューを外しました。比較用の直列経路は、認証済みの `/measure/*` に `execution=serial` を指定したときだけ使います。通常の処理は並行実行です。

単に `Promise.all` で送ってHTTP 200になったことだけでは、内部の並行実行を証明できません。そのため、同一Objectで処理中の件数を応答ヘッダーへ付け、さらにPrisma経由の固定SQL `pg_sleep(0.2)` の開始・終了時刻をDB自身の `statement_timestamp()` / `clock_timestamp()` で取得しました。待機SQLはデータを変更せず、テーブルの行ロック・transaction・任意のSQLや待機時間の入力もありません。[PostgreSQLの時刻・待機関数](https://www.postgresql.org/docs/current/functions-datetime.html)

同じUUID付きObjectに対して1回warmupした後、直列・並行の順番を交互にして3回ずつ、2リクエストを同時送信しました。ヘッダーのObject IDが全件一致することも検証しました。

| 条件 | ローカルworkerdの2件完了時間 | 実Cloudflareの2件完了時間 | 実DB内のSQL重複時間 |
| ---- | ---------------------------- | ------------------------- | ------------------- |
| 直列 | 466 / 459 / 453ms            | 616 / 524 / 524ms         | 0 / 0 / 0ms         |
| 並行 | 239 / 237 / 247ms            | 297 / 396 / 294ms         | 167 / 167 / 182ms   |

実環境の中央値は直列524ms、並行297msでした。これは**固定200msのDB待ちを含む、合成リクエスト2件のHTTP往復時間**であり、CPU時間や本番ログイン全体の高速化率ではありません。初回の検証ではObject内の同時処理を確認できてもSQLが重ならない回がありました。接続状態・到着時刻の影響は切り分け切れていないため、重ならない回を削除せず診断に残します。最終の再実行では3回とも重なりました。Hyperdriveの接続数やキャッシュ設定は変更していません。[Hyperdriveのプール管理](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)

同じObjectで、さらに次をローカル・実Cloudflareの両方で確認しました。

- 通常のPrismaモデルAPIによる読み取り4件の同時送信。実環境では同時処理中件数が最大4。
- ASCII、日本語・絵文字、256文字、NUL入りの4ケースを同時送信し、正解は4件ともtrue、不正解は4件ともfalse。
- DB待ち2件と、正解・不正解のハッシュ検証を各1件混在させた4件の同時送信。
- 既存のハッシュ双方向互換性、Prismaのtransaction・行ロック・P2002・rollback・後始末、Accessによる入口保護。

すべて成功し、最終の実環境検証の終了コードは0でした。リクエストのCPU計算を複数コアへ分散する変更はしていません。実環境のハッシュ4件送信では、ハッシュ計算は1件ずつ進みました。DB・ハッシュ混在でも処理は成功しましたが、その回の2 SQLのDB内重複時間は0msでした。CPUの重い計算が同じObjectのイベントループを占有する影響は残ります。

最大4件までの検証であり、高負荷時の安定性・最大メモリ使用量・無制限の同時接続を保証しません。結果はGit管理外の `.wrangler/concurrency-result.local.json` と `.wrangler/concurrency-result.remote.json` に保存します。秘密値・入力パスワード・ハッシュ・実ユーザーデータは記録しません。

```bash
# ローカルworkerdと新しい使い捨てDBで確認する。
bun run verify:database --durable --concurrency

# 配備済みの実Cloudflare・同じSupabaseで確認する。
bun --env-file=../../.env.cloudflare.local run verify:database --durable --concurrency
```

### 直列版のCPU診断（並行版への変更前）

以下のCPU診断は、リクエスト全体を直列化していたVersion `b7ec0e56-e1a1-406a-9015-07f34c92971b` のものです。並行版のCPU時間を示す値ではありません。Prismaの単一検索5回と、既存互換実装のパスワード検証5回はすべてHTTP 200で完了しました。

| 計測箇所                             | 取得できたCPU時間                                      | 範囲・欠落                                                                 |
| ------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| 入口Worker                           | DB 0 / 0 / 1 / 0 / 1ms、パスワード 1 / 0 / 1 / 1 / 1ms | 10件とも取得。認証・ログ・内部転送を含む                                   |
| Durable Object内の単一パスワード検証 | 2〜5回目が174 / 216 / 144 / 207ms                      | 初回CPUは取得できず。10msまでの高速化を意味しない                          |
| Durable Object内のPrisma単一検索     | 未取得                                                 | 5件とも成功したが内部CPUログが欠落。入口の0〜1msをDB処理時間として扱わない |

CPUログの欠落を検出したため、`measure:cpu` の終了コードは1でした。ハッシュ・DBの一括／並行機能検証は、当時の配備でもすべて成功しています。欠落の原因と内部DB CPUの完全な取得は診断上の課題として残ります。結果JSONは `.wrangler/cpu-result.durable.legacy.json` に保存しています。

### 無料枠の条件

2026-11-18に公式資料で確認した上限は次のとおりです。いずれもアカウント内の利用との合計で考えます。

| 対象            | 無料プランの主な上限                                                    |
| --------------- | ----------------------------------------------------------------------- |
| 入口Worker      | 100,000リクエスト/日、CPU 10ms/リクエスト                               |
| Durable Objects | 100,000リクエスト/日、実行時間13,000 GB-s/日                            |
| Hyperdrive      | SQL文100,000回/日。1 API呼び出しの中で複数SQLを実行すれば、その分を消費 |

Durable ObjectsとHyperdriveは無料枠超過時に該当処理がエラーになります。課金プランへの変更はしていません。SQLiteの保存枠をSupabaseへの保存枠として数えず、既存Supabase・GCPの費用は従来どおり別に扱います。[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、[Durable Objects料金](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[Hyperdrive料金](https://developers.cloudflare.com/hyperdrive/platform/pricing/)

## 初期検証の結果（2026-11-17・通常のWorker）

2026-11-17に、ローカルのworkerdと実Cloudflare Workers Freeで次を確認しました。

| 確認項目                               | 結果       | 範囲                                                                                                   |
| -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| Bun生成ハッシュをWorkersで検証         | 成功       | 現在のBun既定値で新規生成した検証用ハッシュ                                                            |
| Workers生成ハッシュをBunで検証         | 成功       | ASCII、日本語・絵文字、256文字、NULを含む4ケース                                                       |
| 誤ったパスワードの拒否                 | 成功       | 両方向で確認                                                                                           |
| パスワードの並行リクエスト             | 成功       | ローカルworkerdで、初期化済みWasmを使う2リクエスト                                                     |
| PrismaからのDB読み書き                 | 成功       | 使い捨てPostgreSQL 17へ既存migrationを全件適用                                                         |
| interactive transaction・ロールバック  | 成功       | 作成・更新・読み取り後に意図的にrollback                                                               |
| 行ロックSQL                            | 成功       | 同じtransaction内で `SELECT ... FOR UPDATE` を実行。競合・待機挙動は未検証                             |
| 一意制約                               | 成功       | email重複で `P2002`、失敗transactionの行が残らないことを確認                                           |
| DBの並行リクエスト                     | 成功       | ローカルworkerdで、リクエストごとに独立したPrismaクライアントを作成して2リクエスト                     |
| 実Cloudflare Hyperdrive → 既存Supabase | 成功       | 単独リクエストで読み書き・行ロック・rollback・P2002・検証行の残存なしを確認。並行検証はCPU上限で未完了 |
| 実WorkersのCPU時間・メモリ上限         | 制限に到達 | tailで `exceededCpu` を確認。今回の診断では `exceededMemory` は検出せず、最大メモリ使用量は未測定      |

ローカルのHyperdrive bindingは `localConnectionString` でPostgreSQLへ直接接続します。このローカル経路と、後述の実Hyperdrive経由の成功は別々に確認しました。[Cloudflare公式のローカル開発説明](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)

実ユーザーのハッシュは読み取っていません。初回ローカル検証後にCloudflareのCLI認証とHyperdrive作成が完了し、2026-11-17に設定を読み取り確認しました。実配備の手順は[Cloudflare検証Workerの配備](deployment-cloudflare.md)にまとめています。

## 実Cloudflareでの結果と判断

AccessでWorker全体のAll trafficを保護し、専用サービストークンとWorkerのBearer秘密値の両方を通した検証です。資格情報なしでは302、Access通過後もBearer秘密値なしでは401でした。メール許可リストと自動検証ポリシーはTerraformで管理しています。メールのOne-time PINによる人のログイン完了は今回の自動検証には含みません。

- ハッシュはASCII・日本語と絵文字・256文字の3ケースが連続実行で成功し、NUL入りは後の単独実行で成功しました。各ケースでBun→Workers、Workers→Bun、誤ったパスワードの拒否を確認しています。実ユーザーの保存済みハッシュは取得していません。
- 実Supabaseへの単独DBリクエストは、`ping`・`transactionVerified`・`rollbackVerified`・`uniqueConstraintVerified`・`cleanupVerified` がすべてtrueでした。migration・resetは実行していません。
- 一括実行の全項目成功と、ハッシュ・DBの並行リクエストの完了は確認できていません。HTTP 503 / Error 1102が発生し、tailで `/database` は `exceededCpu`（CPU 29ms、wall 55ms）、`/password` は `exceededCpu`（CPU 10ms、wall 12ms）でした。
- NUL入りの成功リクエストは、3回のArgon2id計算を含んでCPU 639ms、wall 671msでした。これは単一ハッシュのCPU時間ではなく、将来の本番認証ルートの計測でもありません。
- 複合検証時のWorkerコードの配備Versionは `3d07e272-3317-4b2e-ab76-9cfb2030d4a5` です。リソース作成・URL有効化後の最終Terraform planは `No changes` でした。

Workers FreeのCPU上限は1リクエスト10msです。isolateには一時的な超過を許す余地があるため、単発成功だけでは無料枠内と判断できません。今回の `exceededCpu` と成功時の実CPU時間から、この検証実装をFreeで安定運用できるとは判断しません。[公式のCPU制限](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)

この時点では通常のWorkerだけで無料枠に収まる構成は未確認でした。その後のDurable Objects構成では、冒頭のとおり一括・並行検証に成功しました。

## 単一操作のCPU計測（2026-11-17）

複合検証の負荷と区別するため、実Workers Freeでパスワード検証1回とPrismaの検索1回を、それぞれ5回計測しました。Cloudflareのtailにある `cpuTime` を使用しています。HTTP往復の経過時間をCPU時間へ読み替えていません。

| 単一操作                                                                             | 当該isolateでの初回CPU | 2回目以降のCPU       | 結果                                                            |
| ------------------------------------------------------------------------------------ | ---------------------- | -------------------- | --------------------------------------------------------------- |
| Argon2idの正解検証1回                                                                | 880ms                  | 完了した2回目は772ms | 1・2回目は正解を確認。3〜5回目は `exceededCpu` / HTTP 503で中断 |
| Prisma `User.findFirst({ select: { id: true } })` 1回                                | 73ms                   | 12 / 11 / 18 / 12ms  | 5回ともHTTP 200。Userが0件だったため、いずれも取得結果はnull    |
| Prisma `User.findUnique({ where: { email: 合成メール }, select: { id: true } })` 1回 | 279ms                  | 35 / 36 / 25 / 32ms  | 5回ともHTTP 200。存在しない合成メールの検索で0件                |

パスワードと一意検索はVersion `9cb782b3-3c4c-4a55-8355-a387dbd59568`、同じisolate内で取得しました。最初の補助応答のCPUは2msでした。パスワードはBun側で事前生成した合成ハッシュに対する検証だけで、不正解の検証や新しいハッシュの生成は行っていません。3〜5回目の35 / 10 / 10msは**制限で中断するまでのCPU時間**であり、計算完了に必要な時間ではありません。

先頭1件の検索はVersion `681510eb-9034-42ca-8eb5-227b39293afe` の新しいisolateで取得しました。実値を外へ出さない構成ですが、Userが空だったため、実際に1行を取得・変換する処理のCPU時間は今回の測定に含まれません。測定のためのDB書き込み・fixture作成は行っていません。二つの検索はVersion・isolateも異なり、その差をSQLの形だけの影響とは判断しません。

CPU時間には認証ヘッダー確認、入力変換、計測IDのログ出力、単一操作、応答処理を含みます。DBはPrismaクライアントの作成・切断も各リクエスト内で行います。初回はそのisolateで当該処理を初めて呼んだ値で、Workerの起動時間そのものではありません。既存アプリ全体のログイン処理や、暗号関数内部だけの計測でもありません。

単一のハッシュ検証でもFreeの10msを大きく超える成功時CPUが記録され、継続実行は `exceededCpu` で停止しました。DB検索も今回の成功時CPUは10msを上回っています。一時的に超過を許すWorkersの挙動があるため、HTTP 200だけで無料枠への適合とは判断しません。

再実行は検証ディレクトリで次のように行います。

```bash
bun --env-file=../../.env.cloudflare.local run measure:cpu
bun --env-file=../../.env.cloudflare.local run measure:cpu --database-row-only
```

`measure:cpu` は補助応答の後、0件の一意検索を5回、パスワード検証1回を5リクエストで実行します。`--database-row-only` は先頭1件の検索だけを5回実行し、取得できたかどうかの真偽値だけを記録します。CPUログのURLクエリは `REDACTED` となるため、Worker内の計測IDで照合します。認証情報・IP・リクエスト本文を捨てた結果だけを `.wrangler/cpu-result.json` / `.wrangler/cpu-result.database-row.json` へ保存し、一時tailは終了時に停止します。

計測対象のCPU診断は全件取得できています。補助応答の一部には診断ログの欠落があったため、補助応答はCPU取得の成否判定から除外しました。欠落した値を0msとして扱いません。

## 無料枠に向けた軽量化の比較

Prismaを維持する条件で、2026-11-17にVersion `7656e281-86b2-4c3d-925d-cc46ddc7e584` を配備し、同じisolateで以下を比較しました。Argon2idのversion・メモリ・反復回数・並列度・salt長・出力長は変更していません。本番の認証方式を変更したり、Prismaを直接pgへ置き換えたりしていません。

| 比較した方式                                             | 各方式を初めて呼んだときのCPU | 2回目以降に完了したCPU | 判定                                                                                           |
| -------------------------------------------------------- | ----------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| 通常のPrismaモデルAPI（fast compiler）                   | 30ms                          | 18 / 25 / 18ms         | 10msに収まらず。HTTP 200の1件はCPUログ欠落のため集計外                                         |
| small compilerのつもりで比較したモデルAPI                | 175ms                         | 35 / 28 / 27 / 58ms    | 後述の共有キャッシュにより、small版としての比較は無効                                          |
| Prismaのパラメーター化SQL（`$queryRaw`）                 | 264ms                         | 33 / 31 / 29ms         | CPU削減は確認できず。配備反映前の404・ログ欠落1件は集計外                                      |
| C実装主体のArgon2id SIMD Wasm（`argon2-browser@1.18.0`） | 875ms                         | 完了値なし             | 次のリクエストはCPU 508msで `exceededCpu`。以後3件はHTTP 500で、0〜1msでも性能改善とは扱わない |

実行順はSQL経由→small compiler→通常モデルAPI→C実装Wasmです。「初回」は方式ごとの呼び出し回数で、通常モデルAPIの前にはPrisma共通ランタイムを使用済みです。別のVersion・isolateで取得した前節の値との比率だけで高速化の効果を断定しません。成功した全方式のCPUが10msを超えたことと、C実装でもCPU上限に到達したことを判断材料とします。DBはUserが0件の状態で、各リクエストでクライアント作成・単一検索・切断を実行し、書き込みはありません。

**比較条件の訂正:** Prisma 7.8.0のquery compilerローダーはprovider名をキーにWasmを共有します。同じisolateでfast/smallのクライアントを混在させた上記のsmall測定は、先に読み込んだfast版を再利用していました。small版の性能差を示す根拠には使いません。現在はsmall用のルートを通常Workerから削除し、別entry pointで単独配備して比較します。

`small` は生成サイズを抑える代わりに実行速度とのトレードオフがある公式の選択肢です。`$queryRaw` はクエリコンパイラーを迂回できる公式の経路ですが、今回の全体CPUでは利点を確認できませんでした。[Prismaの説明](https://www.prisma.io/changelog/2026-01-21)

この時点の通常Workerの候補だけでは、初回も含めて10ms以内に安定実行できる構成は得られませんでした。検証コストを下げる目的で既存ハッシュのパラメーターを弱める変更は行いません。モデルAPIの接続をグローバルに共有してリクエスト間でソケットを使い回す変更も行わず、各リクエスト内で生成・切断します。

### 比較候補の扱いと再実行

現在のremote配備は `durable` 構成と `PASSWORD_VERIFIER=legacy` を既定とし、比較用の `/measure/password-fast` は404にします。比較用Wasmを使う配備は、コマンドの前に `CLOUDFLARE_SPIKE_PASSWORD_VERIFIER=native` を明示します。その配備では従来Wasmを使うパスを404にし、2種類の64MiB級Wasmを同じisolateで初期化しないようにしています。比較用の値は通常のローカル環境ファイルへ保存しません。

```bash
# 検証ディレクトリで実行。明示したときだけ比較用Wasmを配備する。
CLOUDFLARE_SPIKE_RUNTIME_PROFILE=durable CLOUDFLARE_SPIKE_PASSWORD_VERIFIER=native bun --env-file=../../.env.cloudflare.local run deploy:remote
bun --env-file=../../.env.cloudflare.local run measure:cpu --optimized

# 比較後は通常配備へ戻し、比較用Wasmを無効にする。
bun --env-file=../../.env.cloudflare.local run deploy:remote
```

計測結果は `.wrangler/cpu-result.optimized.json` に保存します。`status` が200でない結果を、正常な計算完了のCPU時間として扱いません。比較時には一部ログの欠落があり、スクリプト全体の終了コードは1でした。上表は取得できた診断だけを使い、欠落値を補間していません。

比較用C実装はパッケージに含まれる静的Wasmをロードし、メモリ操作に必要な二つのimportだけを提供します。パスワードとPHC文字列の確保領域を解放前に消去し、予期しない例外時のインスタンスは再利用しません。これは検証候補であり、本番採用やWorkersの強制中断後の復旧を保証するものではありません。[パッケージ実装](https://github.com/antelle/argon2-browser)

ローカルでは、Bun生成ハッシュ4ケースの正解・不正解・異なる設定値の拒否を確認しました。さらに `bun run verify:database --optimized` で、使い捨てDBへ既存migrationを適用し、通常モデルAPI・SQL経由の読み取り、ハッシュの並行検証、既存のtransaction検証と後始末を確認しています。共通CIのUnit Testで固定済みの検証用依存も初期化し、クラウド・DBへ接続せずWasmの相互互換性を検証します。

当時の比較後の通常配備Versionは `91fed1de-aed3-4162-a745-8ca60ec57f33` でした。APIで `PASSWORD_VERIFIER=legacy`、保護された `/ready` の200、比較用パスの404を確認しました。GCPとDBスキーマは既存のままです。

## 追加の軽量化検証（2026-11-18）

### Prismaのスキーマ縮小と起動時初期化

読み取り比較用のクライアントだけにUserのscalar fieldを含める一時schemaを作成しました。元のschema・生成クライアント・DBは変更せず、この一時schemaでmigrationを実行することもありません。ダミー接続設定でソケットを作らずにPrismaのCPU初期化を起動時へ移し、実DBへ接続するクライアントはリクエストごとに作り直します。

| 独立したentry point | 初回取得のCPU | 2回目以降のCPU  | 結果                                  |
| ------------------- | ------------- | --------------- | ------------------------------------- |
| lean / fast         | 39ms          | 5 / 4 / 7ms     | 5件ともHTTP 200。うち1件はCPUログ欠落 |
| lean / small        | 48ms          | 7 / 6 / 6 / 6ms | 5件ともHTTP 200、CPUログも取得        |

fastはVersion `8a01e703-8c5b-42aa-8500-b36067a4cfb6`、smallは `453563f6-261c-4a59-85af-b3c2665fa6e9` です。別Version・isolateでの比較であり、fastのCPUログ欠落を0msとして扱いません。いずれもUserが0件の `findFirst({ select: { id: true } })` で、実際の1行の変換や関連モデルを含むAPIは未計測です。温まった状態のCPUは減りましたが、初回は10msを超えるため、これだけで通常Workerの無料枠へ適合したとは判断しません。

```bash
# ローカルの独立した比較用Workerで再検証する。
bun run verify:database --lean
bun run verify:database --lean-small
```

### 追加のArgon2id実装

`hash-wasm@4.12.0` も、Argon2idのversion・memory・iterations・parallelism・salt長・出力長を維持して比較しました。パッケージの計算実装とライセンスを保持し、実行時コンパイルだけを静的Wasm importへ置き換えています。定時間比較、正解・不正解、NULを含む入力、両方向互換性、並行入力をローカルと実Cloudflareで確認しました。

Durable Objectsでの単一検証5件はすべて成功し、内部CPUは251 / 227 / 213 / 202 / 323ms、入口Workerは0 / 0 / 0 / 1 / 1msでした（Version `65f9f991-918f-42c8-86f5-6698341ba83a`）。同じ回のDB取得5件もすべてHTTP 200でしたが、内部CPUログを取得できず、スクリプトの終了コードは1です。CPU欠落を成功値として補完しません。

この実装での複合ハッシュ検証のHTTP往復は714〜849msで、従来実装をDurable Objectsで動かした465〜580msより短くなりませんでした。環境差もあるためCPU比率は断定せず、追加実装は明示指定時だけの比較候補として残し、既定は互換性確認済みの従来実装を使います。

### Durable Objectsでの再実行

```bash
# 検証ディレクトリで実行。既定はdurable / legacy。
bun --env-file=../../.env.cloudflare.local run deploy:remote
bun --env-file=../../.env.cloudflare.local run verify:database --durable
bun --env-file=../../.env.cloudflare.local run measure:cpu

# ローカルworkerdと使い捨てDBで同じ経路を確認する場合
bun run verify:database --durable

# 追加Wasmの比較。終了後は既定のdeploy:remoteへ戻す。
CLOUDFLARE_SPIKE_PASSWORD_VERIFIER=modern bun --env-file=../../.env.cloudflare.local run deploy:remote
bun --env-file=../../.env.cloudflare.local run verify:database --durable --modern
```

入口と内部のCPU診断は同じsample IDと `scope` で照合して別々に記録します。内部時間を入口Workerの10msへ合算しません。計測ごとにUUID付きの専用Objectを使います。恒久的なユーザーデータや検証結果は保存しません。Durable ObjectのclassとSQLite型namespaceのライフサイクルは、Wranglerの固定したmigration tagで管理します。SupabaseのPrisma migrationとは別物です。

## 使用バージョンとハッシュ設定

- Bun: `1.3.14`
- Prisma Client / adapter-pg: リポジトリの既存 `7.8.0`
- pg: リポジトリの既存 `8.21.0`
- Wrangler: `4.163.0`
- workerd: `1.20261116.1`
- compatibility date: `2026-11-16`（固定したworkerdの対応日）
- Workers用Argon2id候補: `argon2id@1.0.1`（検証パッケージのdevDependency）
- Argon2id: version `19`、memory `65536 KiB`、passes `2`、parallelism `1`、salt `32 byte`、tag `32 byte`

Argon2idは配備時に静的importしたWasmを使用し、実行時にバイナリからコンパイルしません。Wasmインスタンスはisolate内で再利用し、同期的なハッシュ計算の間に同じメモリを別の計算へ貸し出しません。初回の初期化Promiseも共有します。ライブラリのWasm初期メモリは約65 MiBあり、Prismaやアプリ全体を含めた実Workers上の使用量は別途確認が必要です。[ライブラリの実装](https://github.com/openpgpjs/argon2id/blob/main/lib/setup.js)

初期のローカルDB検証では、1リクエストで3回のArgon2id計算（正解の検証・不正解の検証・新しいハッシュの生成）を行い、HTTP往復を含む経過時間は順に271 / 243 / 237 / 238 msでした。単一ハッシュのCPU時間や実Workersの性能を示す値ではありません。無料枠への適合は、このローカル計測では判断せず、前述の実Workersの結果で判断します。

## Prisma生成物の分離

現在のBun用生成物はNode.js向けのコードパスで、query compilerのWasmを動的にコンパイルする構造です。Workers用には、同じ `prisma/schema.prisma` のモデル定義からgeneratorの出力先と `runtime = "workerd"` を変えた一時schemaを生成します。比較のため `compilerBuild = "fast"` / `"small"` の2種類を生成し、元のschemaは変更しません。

生成先は検証ディレクトリの `.wrangler/prisma/` と `.wrangler/prisma-small/`、読み取り比較用の `.wrangler/prisma-lean/` と `.wrangler/prisma-lean-small/` です。`src/generated/prisma/` と元のschemaは書き換えません。生成には既存のPrisma CLIを使い、DB接続は行いません。[Prisma 7のWorkers向け手順](https://www.prisma.io/docs/guides/v7/deployment/cloudflare-workers)

DBクライアントは検証APIのリクエスト内で生成し、同じリクエストで処理と後始末を完了して `$disconnect()` します。Hyperdriveのネットワーク側プールとは別に、リクエストをまたぐソケットの共有を避ける構成です。

## ローカルで再実行する

リポジトリルートの依存がインストール済みであることと、Bun `1.3.14`・Node.js `22.12.0`以上が必要です。DB検証にはDockerも必要です。検証用依存は本番依存から分離しています。

```bash
cd scripts/cloudflare-compatibility
bun install --frozen-lockfile --ignore-scripts
bun run verify
bun run verify:database
```

- `verify`: ローカルWorkersでパスワードの相互互換性と検証用トークン未指定時の拒否を確認します。
- `verify:database`: パスワード検証に加え、新しいPostgreSQLコンテナを作成し、そのDBだけに既存migrationを適用してDB検証を実行します。
- PostgreSQLのホスト側ポートとWorkerのポートは空きポートを使用し、`127.0.0.1` だけに公開します。
- 既存 `.env` のDB接続先は、ローカルDB検証の接続先として使用しません。
- 各DB検証でUUID付きの専用emailを使います。正常・失敗transactionのrollbackを確認し、finallyでも今回のemailに一致する行だけを削除します。
- Worker・検証用コンテナは終了時に停止します。コンテナは `--rm`、永続volumeなしで起動します。正常終了時に既存DBへの変更や検証行は残しません。
- 強制終了などで後始末が動かなかった場合は、`docker ps` の `hono-cloudflare-check-` で始まる今回のコンテナ名を確認し、そのコンテナだけを停止してください。
- 結果は `.wrangler/result.json`、失敗時の診断は `.wrangler/worker.log` に保存します。これらはGit管理・静的検査の対象外です。

本検証は手動で実行します。既存のDB非依存CIへDocker・DB実行は追加していません。

## API全体の入口認証

Cloudflare側では、Basic認証のように許可した利用者だけが入口を通れる仕組みとしてCloudflare Accessを使用します。既存アプリのBearer認証は `Authorization` ヘッダーを使うため、同じヘッダーを使う標準のHTTP Basic認証を全APIへ重ねる構成は避けます。Accessの入口認証を通過した後も、アプリの認証・組織の権限検証を実行します。

- ブラウザ利用者は、既存GCPのIAPで許可している利用者に合わせたメールアドレスの明示的な許可リストで管理します。初期のログイン方式はメールへのOne-time PINとします。[メールコード認証の公式手順](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- 自動検証には、既存の検証クライアントが扱う専用サービストークンのService Authポリシーを使います。ユーザー用の共通パスワードは作りません。
- Worker単位でAll trafficを保護し、API・Scalar・OpenAPI JSON・healthを含む全パスを対象にします。`workers.dev`・カスタムドメイン・previewを含めて保護し、認証を通らず到達できる別URLを残しません。[Worker単位のAccess](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- Workerの配備前にZero Trustを初期設定し、外部から到達できるURLを有効にする前にAccessを設定します。実設定はCloudflareアカウント作成とCLI認証後に行います。

## 実Hyperdrive・Supabase検証の再実行

Accessの保護は `infra/cloudflare/` のTerraformを正本にしました。既存OTPと手動発行したサービストークンのIDを参照し、配備用configと検証用Secretはスクリプトで生成します。適用・配備コマンドと必要な秘密値は[配備手順](deployment-cloudflare.md)を参照してください。以下は配備の順序です。

初回配備は以下の順序で完了しました。別環境での準備・再配備も同じ順序を守ります。

1. ユーザーのCloudflareアカウントを作成し、検証パッケージの `bunx wrangler login` でCLIを認証します。APIトークン・DB接続文字列をチャットやGitへ貼りません。
2. 既存Supabaseの直接接続先を確認し、Cloudflare管理画面で検証専用Hyperdriveを作成します。クエリキャッシュを無効にし、GCP・メールJobと合計した接続数を制限します。
3. URL無効の状態でTerraformを適用して、Worker本体とAccess保護を作成します。
4. `deploy:remote` で適用済み設定からremote configを生成し、検証用 `SPIKE_TOKEN` をコードと同時にWorkers Secretとして配備します。未設定の場合、検証APIはすべて401です。
5. 最初は `workers_dev=false`・`preview_urls=false` で配備し、Worker単位のCloudflare Accessと専用サービストークンのService Authポリシーを設定します。許可なしで到達するURLを作らず、保護後に検証URLを有効にします。
6. ハッシュ・DB検証に加えて、実環境のCPU時間、メモリ制限時の挙動、TLS、接続数と後始末を確認します。実ユーザーデータは取得せず、専用検証行だけを使用します。
7. 結果を本書へ追記し、検証用Worker・Hyperdrive・Accessアプリ・サービストークンを整理します。既存GCPリソース・共有DBは削除しません。

Workers用Prismaクライアントは `prepare:remote`／`deploy:remote` が生成します。配備には元の `wrangler.json` やローカルの生成configを流用せず、Terraformから生成した専用remote configを使います。

検証クライアントは、次の環境変数を設定した状態で `bun run verify:database` を実行すると、ローカルWorker・Dockerを起動せず実環境へ接続します。秘密値はシェル履歴へ書かず、無視対象のローカル環境ファイルなどから読み込みます。

| 環境変数                                | 用途                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `CLOUDFLARE_SPIKE_URL`                  | 検証WorkerのHTTPS Origin                                                   |
| `CLOUDFLARE_SPIKE_TOKEN`                | 通常は省略。生成済みSecretファイルから読む。別端末ではWorkerと同じ値を設定 |
| `CLOUDFLARE_SPIKE_ACCESS_CLIENT_ID`     | 専用AccessサービストークンのID                                             |
| `CLOUDFLARE_SPIKE_ACCESS_CLIENT_SECRET` | 専用Accessサービストークンの秘密値                                         |

実環境では、Access資格情報なしで入口が拒否されることと、Access通過後も検証用秘密値なしでは401になることを先に確認します。HTTP redirectは追従しません。検証クライアントはDBを先に確認し、ハッシュ・DBいずれかが失敗しても独立した項目を実行して `failures` へ記録します。失敗が一つでもあれば終了コードは1です。

## 今回の検証証跡

- Prismaの新規migrationなし。既存migrationを新しい使い捨てDBへ適用しました。CloudflareのSQLite型namespace作成には別のWrangler migration tagを追加しました。
- `bun run verify:database`: ハッシュ相互検証4ケース、パスワードの並行2リクエスト、DB確認5項目、DBの並行2リクエストが成功しました。
- 検証用データが残っていないことを検証コードで確認し、検証用コンテナを停止・削除しました。
- `bun run typecheck`、`bun run lint:check`、`bun run spellcheck` は成功しました。
- Durable Objects追加時の `bun test --isolate` は1,418件、Cloudflare Terraformのモックテストは6件成功しました。Workers用クライアント生成の共通化後と、DBを先に確認して失敗を記録する検証クライアントへの変更後も、使い捨てDBでの全項目成功と後始末を再確認しました。
- 通常Workerでは一括・並行実行がCPU上限で未完了でしたが、追加したDurable Objects構成では、同じ実Hyperdrive・Supabaseで全項目と並行実行が成功しました。
- 並行実行への変更後は、Cloudflare補助コードのBunテスト17件、型チェック、lintが成功しました。使い捨てDBでのSQL重複実行と、実Cloudflareでの最大4件の同時送信も成功しています。
- 対象ソースは本書と検証スクリプトの作業ツリーです。実Workerのコードは上記Versionで、検証クライアントは失敗を記録する変更後のものを使用しました。

## 本体アプリへの適用

この文書の①の証跡は検証Workerのものであり、本体アプリ全体の実機検証とは区別します。②で追加した本体Worker・Durable Object・ローカルworkerd/実DB検証と残る制約は [本体アプリのCloudflare実行経路](cloudflare-app.md) を参照してください。
