---
name: agent-issue-review-handoff
description: Use when handing off a GitHub issue Codex authored to Claude for its initial body review or re-review through the non-interactive CLI. Codexが起票したIssueの本文レビューをClaudeへ依頼し、コメント投稿を確認するときに使う。
---

# Agent Issue Review Handoff

Codexが起票したIssueの本文レビュー・再レビューをClaudeのCLIへ非対話で依頼するときに使う。起票者はIssue本文末尾の `Created by:` で確認する。GitHub上の投稿者は `gh` の認証アカウントになるため、レビューを実施したエージェントはコメントの見出しに自分の名前を書く。

## 依頼前の確認

- 起票後または指摘対応後に、レビュー依頼とGitHubへの投稿がユーザーの依頼範囲に含まれることを確認する。
- 対象IssueのURL、open状態、タイトル・本文の版を確認する。依頼時点の `updatedAt` を控え、レビュワーが取得する版と照合する。
- 過去の投稿との混同を防ぐため、Issueコメントの最大IDを全ページから求めて `comment_since` に保存する。コメントが0件の場合は `0` とする。取得に失敗した場合は依頼前に原因を確認する。

```bash
issue_number='<Issue番号>'
issue_url="https://github.com/kojiyamauchi/hono-app/issues/${issue_number}"
gh issue view "$issue_url" --json title,body,state,updatedAt
comments_endpoint="repos/kojiyamauchi/hono-app/issues/${issue_number}/comments?per_page=100"
comment_page_maxima="$(gh api "$comments_endpoint" --paginate --jq '[.[].id] | max // 0')" &&
  comment_since="$(printf '%s\n' "$comment_page_maxima" | sort -n | tail -1)"
```

## 依頼プロンプト

初回と再レビューで同じテンプレートを使う。依頼元の評価や結論は含めない。

```txt
次のGitHub Issueの本文をレビューしてください。

- 対象Issue: <Issue URL>
- 依頼時点の更新日時: <updatedAt>

.claude/skills/issue-management/SKILL.md の「本文レビュー運用」に従ってください。
gh issue view <Issue URL> --json title,body,state,updatedAt,comments で対象Issueを取得してください。
必要に応じて関連する実装や規約も確認してください。
Issueが閉じているか、取得時のupdatedAtが依頼時点と異なる場合は、投稿せず依頼元に報告してください。
投稿直前にIssueを再取得し、タイトル・本文・状態・updatedAtが変わっていた場合も同様に扱ってください。
レビュー結果は、見出しに Claude と明記して対象Issueへ1件コメントしてください。本文や既存コメントは編集しないでください。
投稿は次のように標準入力で本文を渡し、最後に投稿したコメントのURLを返してください。
gh issue comment <Issue URL> --body-file - <<'ISSUE_REVIEW'
<コメント本文>
ISSUE_REVIEW
投稿に失敗した場合は、失敗の内容を返してください。
```

## CLIの起動

リポジトリルートから実行する。`review_prompt` に上のテンプレートを埋めた依頼文を設定する。

Claudeを起動するときは、ネットワークに接続できる状態で、対象Issueの取得とコメント投稿を許可する。

```bash
claude -p "$review_prompt" \
  --allowed-tools 'Read' 'Grep' 'Glob' \
  "Bash(gh issue view ${issue_url} *)" \
  "Bash(gh issue comment ${issue_url} *)"
```

## 投稿の確認と再レビュー

CLIの完了後、GitHubから対象Issueのコメントを再取得し、CLIが返したURLのコメントが今回追加されたものか確認する。依頼前に保存した `comment_since` を使う。

```bash
ISSUE_REVIEW_COMMENT_SINCE="$comment_since" gh api "$comments_endpoint" --paginate \
  --jq '.[] | select(.id > (env.ISSUE_REVIEW_COMMENT_SINCE | tonumber)) | {id, url: .html_url, heading: (.body | split("\n")[0])}'
```

- 投稿済みと判断するには、コメントURLが一致し、IDが `comment_since` より大きく、見出しに Claude と明記されていることを確認する。既存コメントやCLI出力だけで完了扱いにしない。
- 投稿を確認できない場合はCLIの出力とGitHubを照合する。失敗と判断でき、今回の投稿がないことを確認した場合に限り、原因を解消してから再実行する。依頼元はレビュー担当名義のコメントを代筆しない。
- 指摘があれば、起票者または引き継いだ担当者が本文を更新し、レビューコメントへのリンク付きで対応を返信する。再レビューは更新後のIssueに対して依頼前の確認から行う。
