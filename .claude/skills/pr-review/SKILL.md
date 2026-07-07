---
name: pr-review
description: Use when reviewing a GitHub Pull Request for this repository, especially when the user asks Claude to review a PR created by Codex, the user, or another agent. ClaudeがPRをレビューするときの入口Skill。
---

# PR Review Skill

## 概要

GitHubのPull Requestをレビューし、コメントを投稿するスキルです。

## 正本と責務分担

- PRレビューの実行手順・レビューコメントの見出し/出力フォーマット・inline suggestion comment の投稿手順は、このSkillを正本とする。[CLAUDE.md](../../../CLAUDE.md)「AIエージェント間レビュー」には、レビュー担当の割り当てなど常に守る共通原則だけが置かれている。
- コミット粒度の詳細・標準レイヤー順は、コミット粒度Skill（`.claude/skills/commit-granularity/SKILL.md`）を正本とする。レビューではそのチェックリストを使う。
- migration検証・コーディング規約など、本Skillで扱わない（Skill化していない）ルールは、引き続き [CLAUDE.md](../../../CLAUDE.md) を正本とし、必要な箇所で参照する。

## 使用タイミング

- ユーザーが「PRをレビューして」と依頼した時
- ユーザーがPR番号やURLを指定してレビューを求めた時
- 「最新のPRをレビューして」と依頼された時

## 実行手順

### 1. PR情報の取得

```bash
gh pr view <PR番号またはURL>
```

- PRのタイトル、説明、作成者、変更ファイル数などを確認

### 2. CI状態の確認

```bash
gh pr checks <PR番号>
```

- 差分レビューを始める前に、対象PRのCIが通っていることを確認
- CIが未完了または失敗している場合は、レビューコメントにCI状態を明記
- 問題がない場合の`Approve by Claude <claude@anthropic.com> :octocat:`コメントは、CI通過後に投稿

### 3. 対象Issueの確認

PR本文の `関連Issue` セクション、または `Closes #...` / `Fixes #...` / `Resolves #...` を確認する。

- 対象Issueがある場合は、レビュー前にIssue本文・コメント・受け入れ条件・完了条件・未完了TODOを読む
- PR差分、テスト、動作確認結果が対象Issueの意図を満たしているか確認する
- 対象IssueがあるのにPR本文から参照されていない場合は、PR本文更新を指摘する
- 紐付くIssue本文のチェックボックス更新は、レビュー完了時に「9. レビュー完了時の対象Issueチェック更新」で行う（満たしたと判断できる項目だけに限定する）

### 4. 差分の確認

```bash
gh pr diff <PR番号>
```

- 変更内容の全体像を把握
- 変更されたファイルとコード行を確認

### 5. コードレビューの実施

以下の観点でレビューを行う：

#### 必須チェック項目

- **[CLAUDE.md](../../../CLAUDE.md)の規約遵守**
  - コメントが日本語で記述されているか
  - 変数名・関数名が適切な英語になっているか
  - JSDocコメントが日本語で記述されているか

- **TypeScript型安全性**
  - 明示的な型定義があるか
  - `any`の使用を避けているか
  - 戻り値の型が明示されているか

- **エラーハンドリング**
  - try-catchが適切に使用されているか
  - エラーメッセージが適切か

- **コードの可読性**
  - 複雑なロジックにコメントがあるか
  - 関数が適切な粒度に分割されているか

- **ESLintルール準拠**
  - インポート順序が正しいか（simple-import-sort）
  - `console.log`ではなく`console.info`/`console.error`を使用しているか
  - 未使用変数がないか

- **対象Issueとの整合**
  - PR本文の関連Issueと差分内容が一致しているか
  - 受け入れ条件・完了条件・未完了TODOを満たしているか
  - 対象Issueがある場合に、PR本文から自動closeされる形で参照されているか

#### 推奨チェック項目

- パフォーマンスの問題
- セキュリティの懸念
- テストの必要性
- 潜在的なバグ

#### コミット粒度の確認（レビュー時・必須）

コミット粒度ルールに従っているかを、`git log --oneline <base>..HEAD` と `git show --stat <commit>` で**1コミットずつ**確認する。詳細・標準レイヤー順は コミット粒度Skill（`.claude/skills/commit-granularity/SKILL.md`）を正本とし、そのチェックリストを使う。CLAUDE.md「コミットの粒度」には常に守る共通原則がある。

- **レイヤー混在がないか**: 1コミットが複数の標準レイヤーを跨いでいないか（特に `controllers/` と `routes/` を同一コミットに混ぜていないか、`DTO + mapper + repository` をまとめていないか）。
- **実装→テストの隣接**: 新規実装コミットに対応するテストが同一または隣接コミットにあるか。middleware・`app.ts`（CORS等）の横断的な追加にもテストがあるか。
- **review対応コミット**: 指摘ごと・関心事ごとに分かれているか。
- 逸脱を見つけたら、Suggestions/Issues として指摘する（重大度に応じて分類）。実装者由来（implementer委譲）のPRでは特に見落としやすいため必ず確認する。

#### 実DB検証欄の確認とmigrationを含むPRの実DB検証

PR本文の `## 実DB検証` セクションは、migrationの有無にかかわらず必須記載とする運用になっている。まず全PR共通で、このセクションが存在し記載漏れになっていないかを確認する。

- migrationを含まないPRでは、同セクションに `- migrationを含まないため検証なし` が記載されていることを確認する。セクション自体が無い、または空欄のままの場合はPR本文更新を指摘する。
- migrationを含むPRでは、同セクションに以下の証跡が記載されていることを確認する。

テスト/CIはDB非依存のため、migrationの適用や実DB挙動はCIで検証されない。migrationを含むPRでは、CLAUDE.md「migrationを含む変更の実DB検証」に従って確認する。詳細・原則はCLAUDE.mdを正本とし、ここでは手順の要点のみ示す。

1. まずPR本文/コメントの**実DB検証証跡**（commit SHA・適用migration・確認内容と結果・データ削除・DB起動状態）を確認する。
2. 次のいずれかのときのみ再実行する: 証跡が無い/不明確、検証後にmigration・repository・transaction等が変更、並行制御や制約など再現確認すべき高リスク箇所がある。
3. 再実行する場合:
   - `bun run db:start` → `bunx prisma migrate status` で履歴とDB状態を確認（**未適用を前提にしない**）
   - 未適用なら `bunx prisma migrate deploy`、適用済みなら実装者の証跡を確認
   - clean適用そのものの再検証が必要な場合のみ、使い捨てDBまたは**ユーザー承認済みの `bun run db:reset`** を使う（`db:reset`は既存データを削除するため明示承認を必須とする）
   - 非自明なデータ層は smoke（実APIへのHTTPリクエスト / repository・serviceを呼ぶ使い捨てスクリプト / `psql`）で確認する。使い捨てスクリプトはコミットせず、検証データは削除する。

### 6. inline suggestion comment の投稿（必要な場合）

`Suggestions` または `Issues` に指摘を出す場合、変更内容が明確で、該当箇所へ直接適用できるものは、可能な範囲で inline suggestion comment を併用する。

- inline suggestion comment は、レビュー本文を投稿する前に投稿する
- inline suggestion comment では、必要に応じて GitHub の suggestion ブロックで変更案を提示する
- inline suggestion comment は対象PRのdiffに含まれる行にのみ投稿できる。差分外の既存行に対する指摘は、suggestionを付けず通常のレビュー本文で行う
- 投稿後に取得した inline suggestion comment のURLを、該当する `Suggestions` または `Issues` の指摘に `comment: コメントURL` の形式で記載する
- `comment:` が指すのは inline suggestion comment（`#discussion_r...` のレビューコメント）のURLであり、そのコメント本文に含める GitHub の suggestion ブロックとは別物として扱う
- suggestion は、そのまま適用しても意図が崩れない最小単位にする
- 複数ファイルにまたがる修正、設計判断、テスト追加、責務分離など、単一suggestionで表現しづらい内容は無理に suggestion 化しない
- GitHub APIやツール制約で inline suggestion comment のURL取得が難しい場合は、通常のレビュー本文のみで指摘してよい

`gh api` を使う場合の例:

````bash
gh api --method POST \
  repos/{owner}/{repo}/pulls/{pr番号}/comments \
  -f commit_id="$(gh pr view {pr番号} --json headRefOid --jq .headRefOid)" \
  -f path="path/to/file.ts" \
  -F line=123 \
  -f side="RIGHT" \
  -f body=$'修正方針を簡潔に書く。\n\n```suggestion\n修正後のコード\n```' \
  --jq .html_url
````

- `line` は対象ファイルの新側（RIGHT）の行番号を指定する
- 複数行に跨る場合は、必要に応じて `start_line` / `line` を使う
- 出力された `html_url` をレビュー本文の該当指摘に `comment:` として記載する

### 7. レビューコメントの作成

レビューコメントは以下の構成で記述：

```markdown
## レビュー結果（Claude）

### ✅ Good Points

- [良い点を箇条書き]

### 🔍 Suggestions

- [改善提案を箇条書き]
- inline suggestion comment がある指摘には `comment: コメントURL` を記載する

### ⚠️ Issues (あれば)

- [問題点を箇条書き]
- inline suggestion comment がある指摘には `comment: コメントURL` を記載する

### 📝 その他

- [その他気づいた点]
```

### 8. GitHub上にコメント投稿

```bash
gh pr review <PR番号> --comment -b "レビューコメント内容"
```

- 重大な問題がある場合: `--request-changes`
- 問題がない場合: レビュー結果を投稿した後、別途`--comment -b "Approve by Claude <claude@anthropic.com> :octocat:"`
- コメントのみ: `--comment`（デフォルト）
- 再レビュー時は、前回指摘への対応状況、新規差分、残る任意提案、結論をレビュー結果に記載する
- 初回レビュー、再レビュー、修正後レビューを問わず、問題がない場合はレビュー結果とは別の通常コメントとして`Approve by Claude <claude@anthropic.com> :octocat:`を投稿する
- 修正コミット追加後は、過去の承認に依存せず最新HEADを確認して再レビューする

### 9. レビュー完了時の対象Issueチェック更新

レビュー結果を投稿したあと、PRに紐付くIssueの受け入れ条件・完了条件チェックを確認し、必要に応じて更新する。

1. PR本文の `関連Issue`・関連Issue本文・コメントから、紐付くIssueとそのチェックボックスを確認する。
2. 紐付くIssue本文にチェックボックスがある場合は、PR差分・CI・テスト・動作確認・レビュー結果から**満たしたと判断できる項目だけ**を更新する。
   - 満たしたと判断できない項目、レビュー担当者だけでは判断できない項目は更新しない。
   - チェックを更新する項目が無ければ、Issue本文・コメントの更新は不要。
3. チェックボックスを更新した場合は、Issueへ更新した旨のコメントを投稿する。
   - コメントから、**どのPRレビューに基づいて何を更新したか**が分かるようにする。
   - コメント形式は issue-management Skill のコメント記法（`## <コメントの関心事> (<エージェント名>)`）に従う。
   - 全ての受け入れ条件・完了条件のチェックが完了した場合は、次の内容でコメントする:

     ````bash
     gh issue comment <issue番号> -b "$(cat <<'EOF'
     ## PRレビュー完了 (Claude)

     PR #<PR番号> のレビュー結果に基づき、全ての受け入れ条件・完了条件の更新を完了しました。
     EOF
     )"
     ````

## 注意事項

- レビューは建設的で丁寧な表現を使用する
- 問題点だけでなく、良い点も指摘する
- 具体的な改善案を提示する
- CLAUDE.mdのコーディング規約を最優先で確認する
- コメントは必ず日本語で記述する

## 例

### ユーザーの依頼例

```
PR #10 をレビューして
```

### 実行例

1. `gh pr view 10` でPR情報確認
2. `gh pr diff 10` で差分確認
3. コードをレビュー
4. `gh pr review 10 --comment -b "レビュー結果..."` で投稿
