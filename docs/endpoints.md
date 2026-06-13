# エンドポイント一覧

このドキュメントは、公開APIエンドポイント一覧の正本です。

APIの追加・変更・削除を行う場合は、実装と同じPRでこのドキュメントも更新してください。

## 共通

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/` | 不要 | 動作確認用のテキストを返す |
| GET | `/health` | 不要 | ヘルスチェック結果を返す |

## Auth

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/auth/signup` | 不要 | ユーザーを登録する |
| POST | `/auth/login` | 不要 | ログインして認証トークンを取得する |
| GET | `/auth/me` | 必要 | 認証トークンに紐づくユーザー情報を取得する |

## Supabase Auth

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/supabase-auth/signup` | 不要 | Supabase Authでユーザーを登録する |
| POST | `/supabase-auth/login` | 不要 | Supabase Authでログインする |
| GET | `/supabase-auth/me` | 必要 | Supabase Authの認証情報に紐づくユーザー情報を取得する |

## Users

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/users/me` | 必要 | 認証トークンに紐づくユーザー情報を取得する |
| PATCH | `/users/me` | 必要 | 認証トークンに紐づくユーザー情報を更新する |
| GET | `/users/:id` | 必要 | 指定したユーザーの公開情報を取得する |

## Organizations

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| POST | `/organizations` | 必要 | 組織を作成する |
| GET | `/organizations` | 必要 | 自分が所属する組織一覧を取得する |
| GET | `/organizations/:id` | 必要 | 所属している組織の詳細を取得する |
| PATCH | `/organizations/:id` | 必要 | OWNERまたはADMINが組織情報を更新する |
| DELETE | `/organizations/:id` | 必要 | OWNERのみ、組織を削除する |

## Organization Members

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/organizations/:id/members` | 必要 | 所属している組織のメンバー一覧を取得する |
| POST | `/organizations/:id/members` | 必要 | OWNERまたはADMINがメンバーを追加する |
| PATCH | `/organizations/:id/members/:membershipId` | 必要 | OWNERまたはADMINがメンバーのロールを更新する |
| DELETE | `/organizations/:id/members/:membershipId` | 必要 | OWNERまたはADMINがメンバーを削除する |

## Organization Invitations

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/organizations/:id/invitations` | 必要 | OWNERまたはADMINがPENDING状態の招待一覧を取得する |
| POST | `/organizations/:id/invitations` | 必要 | OWNERまたはADMINが招待を作成する |
| DELETE | `/organizations/:id/invitations/:invitationId` | 必要 | OWNERまたはADMINがPENDING状態の招待をキャンセルする |
