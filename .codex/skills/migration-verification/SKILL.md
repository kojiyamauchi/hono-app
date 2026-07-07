---
name: migration-verification
description: Use when a change includes Prisma migrations or non-trivial data-layer logic (transactions, unique constraints, foreign keys), to verify migration apply and real-DB behavior locally and to record verification evidence in the PR. migrationを含む変更の実DB検証の入口Skill。
---

# Migration Verification Skill

## 概要

migrationを含む変更（およびtransaction・一意制約・外部キーなど非自明なデータ層ロジック）を、ローカル実DBで検証し、PRへ検証証跡を残すためのスキルです。

テスト/CIは意図的にDB非依存（`mock.module`でrepositoryをモック）のため、migrationの適用や実DBでのSQL/transaction/一意制約/外部キーの挙動はCIで検証されません。以下の確認項目は別物として扱います:

- `prisma generate`: 現在のschemaからPrisma clientを再生成する
- `typecheck`: 生成済みclientとアプリケーションコードの型整合を確認する（生成済みclientが古くても、変更したmodel/fieldをコードが参照していなければ通るため、clientが最新であることまでは保証しない）
- migration適用: 実DBとmigration履歴・SQLの整合を確認する

CIがDBを動かさない以上、migration適用と実DB挙動の検証はローカルのどこかで必ず行うこと。

## 正本と責務分担

- 実DB検証の詳細手順（タイミング別の責務・smokeの手段・PR証跡の項目・レビュー時の再実行手順）は、このSkillを正本とする。
- [CLAUDE.md](../../../CLAUDE.md) / [AGENTS.md](../../../AGENTS.md) の「migrationを含む変更の実DB検証」には、Skillを起動しなくても常に守る共通原則だけが置かれている。共通原則とこのSkillの内容がずれないようにすること。
- Codex版とClaude版（`.claude/skills/migration-verification/SKILL.md`）で方針・確認項目がずれないようにする。

## 使用タイミング

- Prisma migrationを作成・適用する実装を行う時
- transaction・条件付き更新・一意制約・外部キーなど非自明なデータ層ロジックを追加・変更する時
- migrationを含むPRを発行（push）する時
- migrationを含むPRをレビューし、検証証跡を確認・再実行する時

## 基本原則

- migrationを含む変更は、push（マージ）される最終コミットに対して、実DB検証（適用＋必要ならsmoke）が少なくとも一度ローカルでgreenであることを担保すること。
- 対象コミット（migration/データ層コード）が変わったら再検証すること。変わっていなければ証跡を流用してよい。
- 検証の粒度は中身次第:
  - 非自明なデータ層ロジック（transaction・条件付き更新・一意制約・外部キー等）→ migration適用＋実DB smokeを行う。
  - 単純なschema変更のみ（nullableカラム追加など）→ migration適用確認＋`prisma generate`/`typecheck`でほぼ十分（smokeは任意）。

## smokeの手段（変更内容に応じて選ぶ）

- 実APIへのHTTPリクエスト（HTTP層〜DBを縦に確認できる。機能変更の第一候補）
- repository/serviceを呼ぶ使い捨てTSスクリプト（データ層単体の確認向け）
- `psql`等によるDB状態・制約・件数の直接確認（cascade後の件数確認など）

使い捨てスクリプトはリポジトリ直下に残さないこと（`/tmp`等を使うか、終了後に`git status`で未追跡ファイルが無いことを確認する）。コミットしない。

## タイミング別の責務

- **実装時（実装担当=一次検証）**: `prisma migrate dev`は実DBが必要なため、migrationの作成・適用・`prisma generate`の時点でDB起動が前提（適用は自動的に確認される）。非自明なデータ層を追加した場合はsmokeで挙動を確認し結果を報告する。
- **PR発行（push）時（発行者=最終担保）**: push する最終コミットでmigration適用＋（非自明なら）smokeがgreenであることを担保し、PRへ検証証跡を残す。最終コミットが変わっていなければ実装時の結果を流用してよい。
- **レビュー時（確認）**: まずPRの検証証跡を確認し、(a)記録が無い/結果が不明確、(b)検証後にmigration・repository・transaction等が変更、(c)並行制御や制約など再現確認すべき高リスク箇所がある、のいずれかのときのみ再実行する。
  - 再実行手順: `bunx prisma migrate status`で履歴とDB状態を確認（**未適用であることを前提にしない**。`bun run db:start`がバックアップから起動すると対象migrationが適用済みのこともある）→ 未適用なら`bunx prisma migrate deploy`、適用済みなら実装者の証跡を確認 → clean適用そのものの再検証が必要な場合のみ、使い捨てDBまたは**ユーザー承認済みの`bun run db:reset`**を使う（`db:reset`は既存データを削除するため自動実行せず明示的な承認を必須とする）→ 非自明なデータ層はsmokeで確認する。
- マージ後は各環境で`prisma migrate deploy`を実行して適用する前提（CIは適用しない）。

## PRへの検証証跡

PR本文の `## 実DB検証` セクションは、migrationの有無にかかわらず必ず記載すること。

- migrationを含むPRは、同セクション（本文またはコメント）へ最低限以下を残すこと（レビュー担当が結果を流用できるか判断するため）:
  - 検証対象のcommit SHA
  - 適用・確認したmigration
  - 実行した確認内容と結果（適用、smokeで確認した制約・transactionの挙動など）
  - 検証用データを削除したこと
  - DBを起動状態で残したか停止したか
- migrationを含まないPRは、同セクションへ `- migrationを含まないため検証なし` のようにリスト形式で記載すること（記載漏れと、migrationが無いため不要な状態を読み手が区別できるようにするため）。

## 検証データとローカル環境の保護

- 検証用データは既存データと衝突しない値を使うこと
- 検証後に作成したデータを削除すること
- cascadeなど削除動作も対象なら、削除後の件数まで確認すること
- 既存DBのreset・全削除はユーザー承認なしで行わないこと
