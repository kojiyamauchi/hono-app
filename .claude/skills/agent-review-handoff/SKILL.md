---
name: agent-review-handoff
description: Use when handing off a pull request Claude implemented to the other AI agent for review by launching its CLI non-interactively, including prerequisites, the fixed request prompt template, and how to confirm the posted review. Claudeが自分の実装したPRを他エージェントへCLIでレビュー依頼するときの入口Skill。
---

# Agent Review Handoff Skill

## 概要

Claudeが実装してPRを発行した後、レビュー担当であるCodexのCLIを非対話起動し、レビューを実施させるスキルです。

レビューを行う側の手順は `.claude/skills/pr-review/SKILL.md`、レビュー指摘へ対応する側の手順は `.claude/skills/review-response/SKILL.md` を使用し、このSkillでは依頼を渡す側の作業に集中します。

## 使用タイミング

- Claudeが実装したPRを発行し、レビュー担当エージェントへレビューを依頼する時
- レビュー対応コミットを追加した後に、再レビューを依頼する時
- ユーザーが「レビュー依頼して」「Codexにレビューしてもらって」と依頼した時

## 正本と責務分担

- レビュー依頼の前提条件、起動コマンド、依頼プロンプトのテンプレート、結果の確認手順は、このSkillを正本とする。
- [CLAUDE.md](../../../CLAUDE.md) の `### AIエージェント間レビュー` には、Skillを起動しなくても常に守る共通原則（レビュー担当の割り当て、依頼プロンプトに自己評価を含めない、レビュー結果はGitHubへ投稿する、など）だけが置かれている。共通原則とこのSkillの内容がずれないようにすること。
- レビューを実施する側の手順は `.claude/skills/pr-review/SKILL.md`、レビュー指摘へ対応する側の手順は `.claude/skills/review-response/SKILL.md` を正本とする。
- Skill化していない運用ルール（コミット粒度、PRタイトル、ブランチ命名、push方法）は、引き続き [CLAUDE.md](../../../CLAUDE.md) を正本とし、必要な箇所で参照する。

## 前提条件

### 1. 起動するCLIの選択

Codexを起動する場合は、ChatGPT.app同梱のCLIを使用する。

```bash
/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex --version
```

PATH上の `codex` は同梱版より古い場合があり、`model_not_found`（ChatGPTアカウントでモデル非対応）で起動に失敗することがある。失敗した場合は同梱版のフルパスを使用する。

### 2. 権限とサンドボックス

レビュー結果をGitHubへ投稿させるため、起動時にネットワークと `gh` の実行を許可する。

- Codexを起動する場合は、`--sandbox workspace-write` に加えて `-c sandbox_workspace_write.network_access=true` でネットワークアクセスを明示的に許可する。`workspace-write` は既定でコマンドのネットワークアクセスを無効にするため、このオプションを省くと `gh pr checks` / `gh pr review` が実行できない。`--sandbox read-only` でも投稿できない。
- ローカル設定ファイル（`.claude/settings.local.json` など）はgit管理外であり、環境によって内容が異なる。許可はローカル設定に依存せず、起動時のオプションで明示する。
- `codex exec` の承認ポリシーは `never` であり、承認を要求する操作は実行されずに落ちる。CodexのGitHubプラグイン経由の投稿は承認を要求する場合があるため、投稿には `gh` を使うよう依頼プロンプトで明示する。プラグイン経由でレビュー本体の投稿が承認待ちとなり、inline commentだけが投稿された事例がある。

### 3. 依頼前のCI確認

レビュー担当エージェントはCI状態を確認してからレビューを開始する。依頼前にCIが通過していることを確認しておく。

```bash
gh pr checks <PR番号>
```

CIが未完了・失敗の状態で依頼した場合、レビュー結果にはその状態が明記され、問題なしの通常コメントはCI通過後に投稿される。

## 実行手順

### 1. 依頼前の確認

```bash
gh pr view <PR番号> --json number,url,headRefName,headRefOid,isDraft,state
gh pr checks <PR番号>

# 依頼前のレビュー・レビューコメントの最大IDを記録する（ステップ4の照合に使用する）
# 一覧APIは既定で30件しか返さないため、per_pageはクエリ文字列へ置き --paginate で全ページを取得する
# ページごとに max // 0 を求めてから全ページの最大値を取る（0件のPRでも 0 が得られる）
gh api "repos/kojiyamauchi/hono-app/pulls/<PR番号>/reviews?per_page=100" --paginate --jq '[.[].id] | max // 0' | sort -n | tail -1
gh api "repos/kojiyamauchi/hono-app/pulls/<PR番号>/comments?per_page=100" --paginate --jq '[.[].id] | max // 0' | sort -n | tail -1
```

- 対象PRがopen状態であることを確認する
- 最新HEADのSHAを確認する（レビュー対象を明示するため依頼プロンプトへ含める）
- 対象Issueがある場合はIssue番号を確認する
- PR本文の `## 実DB検証` セクションが記載済みであることを確認する
- 依頼前のレビュー・レビューコメントの最大IDを記録する（記録しないと、ステップ4で過去のレビューを今回の投稿と誤認する）
- 最大IDは全ページを対象に求める。一覧APIは既定で古い順の最初の30件しか返さないため、先頭ページだけでは31件目以降の投稿を取得できず、正常に投稿されたものを失敗と誤判定する
- レビューやレビューコメントが0件のPRでは、最大IDを `0` として記録する。`.[].id` をそのまま並べる形だと0件時に出力が空になり、ステップ4の `tonumber` がエラー終了して投稿成功を確認できない
- `per_page` は `-F` で渡さないこと。`gh api` は `-F` をリクエストボディと解釈してGETをPOSTへ変えるため、レビューの下書き（`PENDING` のレビュー）を誤って作成してしまう。下書きは1 PRにつき1つしか持てず、残すと以降のレビュー作成が失敗する

### 2. 依頼プロンプトの作成

依頼プロンプトは実装したClaude自身が書くため、書き方によってレビューの独立性が落ちる。渡す内容は以下のテンプレートに固定する。

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

.codex/skills/pr-review/SKILL.md をSkillとして読み、その手順に従ってレビューを実施してください。
AGENTS.md の規約も確認してください。
レビュー結果はGitHub上へPR reviewとして投稿してください。
投稿には gh コマンドを使ってください。
```

### 3. レビュー担当エージェントの起動

```bash
cd /Users/kojiyamauchi/Desktop/personal/hono-app && \
  /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex exec \
  --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  "<ステップ2のテンプレートに値を埋めたもの>"
```

- 長時間かかるため、タイムアウトに余裕を持たせる
- 起動後は完了まで待ち、標準出力を最後まで確認する

### 4. 投稿結果の確認

標準出力の報告だけでは、レビューが実際にGitHubへ投稿されたかは確認できない。投稿を必ず確認する。

最新のレビューを1件見るだけでは不十分である。過去のレビューが残っているPRでは、今回の実行が投稿前に失敗していても「レビューが存在する」状態は満たされてしまう。ステップ1で記録したIDを使い、今回追加されたものだけを抽出して照合する。

```bash
export REVIEW_SINCE=<ステップ1で記録したレビューの最大ID>
export COMMENT_SINCE=<ステップ1で記録したレビューコメントの最大ID>
export HEAD_SHA=<依頼したレビュー対象HEAD>

gh api "repos/kojiyamauchi/hono-app/pulls/<PR番号>/reviews?per_page=100" --paginate \
  --jq '.[] | select(.id > (env.REVIEW_SINCE | tonumber)) | select(.state != "PENDING") | {id, user: .user.login, state, commit_id, bodyLength: (.body | length), url: .html_url}'
gh api "repos/kojiyamauchi/hono-app/pulls/<PR番号>/comments?per_page=100" --paginate \
  --jq '.[] | select(.id > (env.COMMENT_SINCE | tonumber)) | {id, path, line, commit_id, url: .html_url}'
```

- 抽出はステップ1と同様に全ページを対象にする。先頭ページだけでは31件目以降の投稿を取得できない
- `state` が `PENDING` のレビューは未投稿の下書きであり、投稿済みとして数えない
- 今回追加されたレビューが1件以上あることを確認する
- 追加されたレビュー・レビューコメントの `commit_id` が、依頼した `HEAD_SHA` と一致することを確認する
- `bodyLength` が0のレビューは、inline commentの投稿に付随して作られる本文なしのレビューであり、総評の投稿成功を意味しない。総評を含むレビュー本体が投稿されたかは、本文があるレビューの有無で判定する
- 投稿されていない場合、または本文なしのレビューしか増えていない場合は、標準出力のエラーを確認し、権限・サンドボックス・承認ポリシーの設定を見直して再実行する
- 投稿されたレビュー・レビューコメントのURLを記録する（レビュー対応コミットの `comment:` に使用する）

### 5. レビュー対応への引き継ぎ

レビュー指摘がある場合は、`.claude/skills/review-response/SKILL.md` をSkillとしてinvokeし、レビュー対応フローへ移る。

- レビュー指摘は、指摘ごと・関心事ごとに `review:` コミットへ分けて対応する
- 対応後に再レビューが必要な場合は、ステップ1から再度依頼する

## 注意事項

- このSkillは、自分が実装したPRのレビューを他エージェントへ依頼する場合にのみ使用する。自分がレビューする側の場合は `pr-review` Skillを使用する
- CLI委譲は非対話実行であり、レビュー担当エージェントは依頼元へ聞き返せない。判断に迷う論点はレビューコメントとして出てくる前提で、必要な文脈は依頼時に渡し切る
- レビューのGitHub上の投稿名義は `gh` の認証アカウントになる。どのエージェントのレビューかは、レビュー本文の `## レビュー結果（Claude）` やApproveコメントの `Approve by エージェント名 <メールアドレス> :octocat:` の表記で区別する
- CLI委譲でレビューを実施した場合も、エージェント間レビューが完了したことに変わりはなく、[CLAUDE.md](../../../CLAUDE.md) の共通原則どおりユーザーによる最終レビューは省略しない
- Codex版（`.codex/skills/agent-review-handoff/SKILL.md`）と方針・確認項目がずれないようにする
- コメント、ドキュメント、コミットメッセージは日本語ルールに従う
