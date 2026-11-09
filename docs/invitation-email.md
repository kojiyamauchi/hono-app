# 組織の招待メール

招待作成APIの `201 Created` は招待の保存を示します。配信有効時は、同じトランザクションで配信待ちも保存されます。GCP devでは手動実行まで配信待ちになります。将来、定期実行を有効にした場合は、通常は次の起動まで最大約15分待ちます。再試行や配信待ちの件数によってさらに遅れる場合があります。

## 環境設定とローカル実行

| 環境変数                      | 設定                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `ENABLE_INVITATION_EMAIL`     | `true` で新しい招待を配信待ちに登録。既定は `false`                |
| `ENABLE_API_DOCS`             | 配信有効時は `true`                                                |
| `INVITATION_EMAIL_FROM`       | Resendで検証したドメインの送信元メールアドレス                     |
| `INVITATION_EMAIL_SCALAR_URL` | `https://<ホスト>/open-api/scalar`。クエリとフラグメントは付けない |
| `RESEND_API_KEY`              | 既存のResend APIキー。アプリの配信有効時とワーカーの実行時に必要   |
| `DATABASE_URL`                | アプリとワーカーが共有するPostgreSQLへの接続先                     |

配信有効時はアプリの起動時に必須設定を検証します。送信元のドメイン認証とAPIキーの権限はResend側で確認します。メールには `AUTH_EMAIL_MODE` の値にかかわらず固定のScalar URLを記載します。配信無効時やmigration適用前に作成した招待に配信待ちは追加されません。

接続先を確認してmigrationを適用し、`bun run invitations:deliver` で配信待ちを1回につき最大30件処理します。ワーカーは保存済みの送信設定を使います。アプリの配信登録を止めた後も、実行すると既存の配信待ちを処理します。

## GCP devへの手動配備

配備とCDの再開は[インフラ変更の手動適用](deployment-gcp-cd.md#インフラ変更の手動適用)に従います。各段階の設定は `infra/gcp/env/dev.cd.tfvars.json` に反映し、dev workspaceで同じtfvarsと現在のServiceのdigestを使って保存planを確認・適用します。シークレットはSecret Managerで管理し、tfvarsの `secret_versions` に数値のバージョンを指定します。JobはDBとResendの2種類をServiceと共有します。

1. 初回PRでは配信無効、Jobのdigest未指定、Scheduler停止を維持します。マージ後にCDの読み取り権限を手動適用し、通常CDでmigrationを適用してワーカーを含むruntimeイメージを用意します。
2. Jobの配備前に、対象digestに専用の保持タグを付けます。Service CDはこのタグを整理せず、Artifact Registryの `release-` 保持ポリシーが対象イメージを保護します。

   ```bash
   image='<リージョン>-docker.pkg.dev/<プロジェクト>/<リポジトリ>/hono'
   digest='sha256:<64桁のdigest>'
   gcloud artifacts docker tags add "${image}@${digest}" "${image}:release-invitation-worker-${digest#sha256:}"
   ```

3. `invitation_email.worker_image_digest` に保護済みのdigestを設定します。`schedule_paused: true` と `enabled: false` で、Job、専用SA、Schedulerを手動適用します。通常CDのイメージ更新対象はServiceです。
4. 検証済み送信元とScalar URLを確認し、`invitation_email.enabled: true` を手動適用します。許可済みのテスト受信者への招待を作成し、次のコマンドでJobを実行します。

   ```bash
   gcloud run jobs execute hono-app-dev-invite-worker \
     --project='<devプロジェクトID>' --region=asia-northeast1 --wait
   ```

5. テスト受信者が実際に受信したことを確認します。メールの固定URLを開いて許可済みGoogleアカウントでIAPへログインします。既存のアプリアカウントでは `POST /auth/login` 後に `POST /invitations/accept`、未登録の場合は `POST /invitations/signup` を使い、本文のトークンをAPIのリクエスト本文に入力します。宛先が異なる既存ユーザー、キャンセル済み・期限切れの招待が拒否されることも確認し、検証データを削除します。
6. 手動での受信確認後も `schedule_paused: true` を維持し、Schedulerが停止状態であることを確認します。以降の配信と再試行はJobの手動実行で行います。各手動適用後は同じtfvarsで全体planを確認し、JobとSchedulerの設定差分がないことを確認してから通常CDを再開します。再開後の最初の通常CDで、plan検査と配備が成功することを確認します。

Jobを更新する場合は新しいdigestを保持タグで保護し、tfvarsを更新してから手動適用します。現行と直前のJob用タグを保持し、ロールバックが不要になった古いJob用タグを手動で整理します。配信形式を変える場合は旧形式を処理できるJobを先に配備します。CDのmigrationは旧Jobが稼働したまま適用されるため、旧Jobが参照する列の削除などはJob切り替え後のmigrationへ分けます。ServiceとJobで共有するSecretの参照バージョン変更も手動適用します。

## 状態の確認と停止

障害時はCloud Run Jobの実行履歴と、`InvitationEmailDelivery` の `status`、`attemptCount`、`lastError`、`nextAttemptAt`、`leaseUntil` を確認します。配信IDと分類済みのエラーを照合に使います。宛先、トークン、メール本文、APIキーはログやトレースに出力しません。

| 状態       | 意味                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| `PENDING`  | 実行・再試行待ち、または処理権の取得中                                                   |
| `ACCEPTED` | Resendが受付済み。実配達はResendのイベントや受信者で確認                                 |
| `REJECTED` | 恒久エラー、または明示的な拒否のまま再試行上限に到達。分類済みの `lastError` を確認      |
| `UNKNOWN`  | 受付結果が不明な試行が残ったまま終了                                                     |
| `SKIPPED`  | 受付結果が不明な試行がなく、招待の無効化・期限切れ・未対応テンプレートで送信を打ち切った |

通信障害・タイムアウト・5xx・429・`concurrent_idempotent_requests` は15分、30分、60分、120分の順に待って再試行します。`invalid_idempotent_request` 等の恒久エラーは終了します。初回を含め最大5回で、招待の有効期限と配信作成から6時間の早い方で打ち切ります。6時間はResendの冪等キー保持期間24時間より短く、同じ配信IDで同じ内容を再送します。[Resendの冪等キー仕様](https://resend.com/docs/dashboard/emails/idempotency-keys)

配信待ちの期限はSchedulerの停止中も進みます。期限を過ぎた配信は、次回の手動実行で終端状態に更新されます。将来、定期実行を有効にする場合は、別途判断したうえで `schedule_paused: false` を手動適用します。15分間隔を止めるには、同じ手順で `schedule_paused: true` に戻します。新しい配信待ちも止める場合は `enabled: false` にします。実行中のJobはSchedulerを停止しても継続します。即時停止が必要な場合は、対象のJob実行もCloud Runからキャンセルします。

## 費用

- 将来15分間隔で定期実行する場合は、31日で2,976回です。Cloud Run Jobsは実行インスタンスごとに最低1分課金されます。1 vCPU・512 MiBで全実行が1分以内なら月178,560 vCPU秒と89,280 GiB秒が最低使用量の目安です。無料枠は請求先アカウントで共有され、長い実行・通信・イメージ保持・ログも費用に影響します。[Cloud Runの料金](https://cloud.google.com/run/pricing)
- Cloud Schedulerは既存のIAP監視と合わせてdevで計2件です。停止中のジョブも数え、請求先アカウントあたりの無料枠は3件、超過は1件につき31日あたり0.10米ドルです。[Cloud Schedulerの料金](https://cloud.google.com/scheduler/pricing)
- Resend Freeの上限は1日100通、月3,000通です。他の認証メール等も同じ利用枠に含めて確認します。[Resendの料金](https://resend.com/pricing)
- 既存の月100円の予算通知を使います。手動実行時もJobの使用量を確認します。
