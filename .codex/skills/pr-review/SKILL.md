---
name: pr-review
description: Use when reviewing a GitHub Pull Request for this repository, especially when the user asks Codex to review a PR created by Claude, the user, or another agent.
---

# PR Review

このSkillは、GitHub Pull Requestをレビューするときに使う。

## Trigger

- ユーザーが「PRをレビューして」と依頼したとき
- PR番号、PR URL、または現在のブランチのPRを指定されたとき
- Claude が作成したPRを Codex がレビューするとき
- ユーザーが作成したPRを Codex がレビューするとき

## Workflow

1. PRの対象リポジトリ、PR番号、base/head branchを確認する。
2. GitHub connectorが使える場合は、PR本文、差分、コメント、レビュー状態をconnectorで取得する。
3. `gh` が必要な場合は、`gh pr view`, `gh pr diff`, `gh pr checks` を使って補足する。
4. 差分を読み、バグ、設計リスク、テスト不足、セキュリティ、運用上の問題を優先して確認する。
5. 必要に応じて `CLAUDE.md` の規約、CI設定、package scripts、Prisma/Supabase設定も確認する。
6. レビュー結果は問題点を先に出し、重大度順に並べる。
7. 最新HEADに対するレビュー結果を、GitHub上へPR reviewとして投稿する。

## Review Priorities

- バグや仕様違反
- データ破壊、認証、権限、秘密情報の漏えい
- Prisma migration、DB schema、DTO、Entity、Responseの不整合
- Hono route、controller、service、repositoryの責務混在
- 入力検証、エラーハンドリング、HTTP statusの不備
- テスト不足、CIで検出できないリスク
- `CLAUDE.md` の規約違反
- 不要な大規模リファクタリングや責務外の変更

## Output Format

レビュー結果は次の順で書く。

1. Findings
2. Open Questions
3. Summary

Findingsでは、可能な限りファイルパスと行番号を示す。

```txt
[P1] 問題の短い説明
path/to/file.ts:123
理由と影響。必要なら修正方針。
```

問題がない場合は、問題が見つからなかったことを明確に書き、残るリスクや未確認事項だけを短く補足する。

## Posting To GitHub

PRレビューを依頼された場合は、初回レビュー、再レビュー、修正後レビューを問わず、最新HEADに対するレビュー結果をGitHubへ投稿する。

- コメントのみ: `COMMENT`
- 修正必須: `REQUEST_CHANGES`
- 問題なし: レビュー結果を投稿した後、本文が`Approve by Codex :octocat:`の通常コメントを別途投稿
- 修正コミット追加後は、過去の承認に依存せず最新HEADを確認して再レビューする。
- 再レビュー時は、前回指摘への対応状況、新規差分、残る任意提案、結論をレビュー結果に記載する。
- 問題がない場合は、レビュー回数にかかわらず、レビュー結果とは別の通常コメントとして`Approve by Codex :octocat:`を投稿する。

投稿前に、対象PR番号と投稿種別を確認する。

## Style

- コメントは日本語で書く。
- 良い点の列挙より、修正すべき問題を優先する。
- 好みの指摘ではなく、実害のあるリスクを優先する。
- 指摘は具体的にし、可能なら修正方針も添える。
- Claude が作成したPRでも、Codex が作成したPRでも、同じ基準でレビューする。
