---
name: agent-review-handoff
description: Use when handing off a pull request Codex implemented to the other AI agent for review by launching its CLI non-interactively, including prerequisites, the fixed request prompt template, and how to confirm the posted review. Codexが自分の実装したPRを他エージェントへCLIでレビュー依頼するときの入口Skill。
---

# Agent Review Handoff

このSkillは、Codexが実装してPRを発行した後、レビュー担当であるClaudeのCLIを非対話起動し、レビューを実施させるときに使う。

レビューを行う側の手順は `.codex/skills/pr-review/SKILL.md`、レビュー指摘へ対応する側の手順は `.codex/skills/review-response/SKILL.md` を使い、このSkillでは依頼を渡す側の作業に集中する。

## 使うタイミング

- Codexが実装したPRを発行し、レビュー担当エージェントへレビューを依頼するとき
- レビュー対応コミットを追加した後に、再レビューを依頼するとき
- ユーザーが「レビュー依頼して」「Claudeにレビューしてもらって」と依頼したとき

## 正本と責務分担

- レビュー依頼の前提条件、起動コマンド、依頼プロンプトのテンプレート、結果の確認手順は、このSkillを正本とする。
- `AGENTS.md` / `CLAUDE.md` の `### AIエージェント間レビュー` には、Skillを起動しなくても常に守る共通原則（レビュー担当の割り当て、依頼プロンプトに自己評価を含めない、レビュー結果はGitHubへ投稿する、など）だけが置かれている。共通原則とこのSkillの内容がずれないようにすること。
- レビューを実施する側の手順は `.codex/skills/pr-review/SKILL.md`、レビュー指摘へ対応する側の手順は `.codex/skills/review-response/SKILL.md` を正本とする。
- Skill化していない運用ルール（コミット粒度、PRタイトル、ブランチ命名、push方法）は、引き続き `AGENTS.md` を正本とし、必要な箇所で参照する。
- Codex版とClaude版（`.claude/skills/agent-review-handoff/SKILL.md`）のSkillで、方針・確認項目がずれないようにする。

## 前提条件

### 1. 起動するCLIの確認

```bash
claude --version
```

Claudeのプロジェクト内Skill（`.claude/skills/`）と `CLAUDE.md` は、`claude -p` の非対話実行でも自動で読み込まれる。

### 2. 権限とサンドボックス

- Claudeの起動時に `--allowed-tools` で `gh` の実行を明示する。`.claude/settings.local.json` はgit管理外であり環境によって内容が異なるため、ローカル設定に依存させない。
- Codex自身のサンドボックスがネットワークを遮断していると、起動したClaudeがAPIへ到達できない。ネットワークアクセスを許可した状態で起動する。
- 非対話実行では、承認を要求する操作は承認待ちのまま実行されずに落ちる。投稿に必要なツールを `--allowed-tools` へ漏れなく含め、投稿には `gh` を使うよう依頼プロンプトで明示する。許可が不足すると、inline commentだけが投稿されレビュー本体が落ちるなど、部分的に成功した状態になりうる。

### 3. 依頼前のCI確認

レビュー担当エージェントはCI状態を確認してからレビューを開始する。依頼前にCIが通過していることを確認しておく。

```bash
gh pr checks <PR番号>
```

CIが未完了・失敗の状態で依頼した場合、レビュー結果にはその状態が明記され、問題なしの通常コメントはCI通過後に投稿される。

## 実行手順

### 1. 依頼前の確認

GitHub connectorが使える場合はconnectorで取得し、必要に応じて `gh` で補足する。

```bash
gh pr view <PR番号> --json number,url,headRefName,headRefOid,isDraft,state
gh pr checks <PR番号>

# 依頼前のレビュー・レビューコメントの最大IDを記録する（ステップ4の照合に使用する）
gh api repos/kojiyamauchi/hono-app/pulls/<PR番号>/reviews --jq '[.[].id] | max // 0'
gh api repos/kojiyamauchi/hono-app/pulls/<PR番号>/comments --jq '[.[].id] | max // 0'
```

- 対象PRがopen状態であることを確認する。
- 最新HEADのSHAを確認する（レビュー対象を明示するため依頼プロンプトへ含める）。
- 対象Issueがある場合はIssue番号を確認する。
- PR本文の `## 実DB検証` セクションが記載済みであることを確認する。
- 依頼前のレビュー・レビューコメントの最大IDを記録する（記録しないと、ステップ4で過去のレビューを今回の投稿と誤認する）。

### 2. 依頼プロンプトの作成

依頼プロンプトは実装したCodex自身が書くため、書き方によってレビューの独立性が落ちる。渡す内容は以下のテンプレートに固定する。

含めるもの:

- 対象PR番号またはURL
- 対象Issue番号（ある場合）
- レビュー対象の最新HEAD SHA
- 読むべきSkillの明示
- レビュー結果をGitHubへ投稿する指示

含めてはいけないもの:

- 自己評価や結論の先出し（「問題ないと思うが」「軽微な変更なので」など）
- レビュー範囲の限定（「この差分だけ見て」「テストは見なくていい」など）
- 指摘を予防する説明（レビュアーが差分とPR本文から読み取れる内容を超えた弁明）

テンプレート:

```txt
PR #<PR番号> をレビューしてください。

- 対象PR: https://github.com/kojiyamauchi/hono-app/pull/<PR番号>
- 対象Issue: #<Issue番号>（ない場合は「なし」）
- レビュー対象HEAD: <SHA>

.claude/skills/pr-review/SKILL.md をSkillとして読み、その手順に従ってレビューを実施してください。
CLAUDE.md の規約も確認してください。
レビュー結果はGitHub上へPR reviewとして投稿してください。
投稿には gh コマンドを使ってください。
```

### 3. レビュー担当エージェントの起動

```bash
cd /Users/kojiyamauchi/Desktop/personal/hono-app && \
  claude -p "<ステップ2のテンプレートに値を埋めたもの>" \
  --allowed-tools 'Bash(gh:*)' 'Bash(git:*)' 'Read' 'Grep' 'Glob' 'Skill'
```

- 長時間かかるため、タイムアウトに余裕を持たせる。
- 起動後は完了まで待ち、標準出力を最後まで確認する。

### 4. 投稿結果の確認

標準出力の報告だけでは、レビューが実際にGitHubへ投稿されたかは確認できない。投稿を必ず確認する。

最新のレビューを1件見るだけでは不十分である。過去のレビューが残っているPRでは、今回の実行が投稿前に失敗していても「レビューが存在する」状態は満たされてしまう。ステップ1で記録したIDを使い、今回追加されたものだけを抽出して照合する。

```bash
REVIEW_SINCE=<ステップ1で記録したレビューの最大ID>
COMMENT_SINCE=<ステップ1で記録したレビューコメントの最大ID>
HEAD_SHA=<依頼したレビュー対象HEAD>

gh api repos/kojiyamauchi/hono-app/pulls/<PR番号>/reviews \
  --jq ".[] | select(.id > $REVIEW_SINCE) | {id, user: .user.login, state, commit_id, bodyLength: (.body | length)}"
gh api repos/kojiyamauchi/hono-app/pulls/<PR番号>/comments \
  --jq ".[] | select(.id > $COMMENT_SINCE) | {id, path, line, commit_id, url: .html_url}"
```

- 今回追加されたレビューが1件以上あることを確認する。
- 追加されたレビュー・レビューコメントの `commit_id` が、依頼した `HEAD_SHA` と一致することを確認する。
- `bodyLength` が0のレビューは、inline commentの投稿に付随して作られる本文なしのレビューであり、総評の投稿成功を意味しない。総評を含むレビュー本体が投稿されたかは、本文があるレビューの有無で判定する。
- 投稿されていない場合、または本文なしのレビューしか増えていない場合は、標準出力のエラーを確認し、許可したツール・ネットワーク・承認ポリシーの設定を見直して再実行する。
- 投稿されたレビュー・レビューコメントのURLを記録する（レビュー対応コミットの `comment:` に使用する）。

### 5. レビュー対応への引き継ぎ

レビュー指摘がある場合は、`.codex/skills/review-response/SKILL.md` の手順に従ってレビュー対応フローへ移る。

- レビュー指摘は、指摘ごと・関心事ごとに `review:` コミットへ分けて対応する。
- 対応後に再レビューが必要な場合は、ステップ1から再度依頼する。

## 注意事項

- このSkillは、自分が実装したPRのレビューを他エージェントへ依頼する場合にのみ使う。自分がレビューする側の場合は `pr-review` Skillを使う。
- CLI委譲は非対話実行であり、レビュー担当エージェントは依頼元へ聞き返せない。判断に迷う論点はレビューコメントとして出てくる前提で、必要な文脈は依頼時に渡し切る。
- レビューのGitHub上の投稿名義は `gh` の認証アカウントになる。どのエージェントのレビューかは、レビュー本文の見出しやApproveコメントの `Approve by エージェント名 <メールアドレス> :octocat:` の表記で区別する。
- CLI委譲でレビューを実施した場合も、エージェント間レビューが完了したことに変わりはなく、`AGENTS.md` の共通原則どおりユーザーによる最終レビューは省略しない。
- Claude版（`.claude/skills/agent-review-handoff/SKILL.md`）と方針・確認項目がずれないようにする。
- コメント、ドキュメント、コミットメッセージは日本語ルールに従う。
