# PR Review Skill

## 概要

GitHubのPull Requestをレビューし、コメントを投稿するスキルです。

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

### 3. 差分の確認

```bash
gh pr diff <PR番号>
```

- 変更内容の全体像を把握
- 変更されたファイルとコード行を確認

### 4. コードレビューの実施

以下の観点でレビューを行う：

#### 必須チェック項目

- **[CLAUDE.md](../../CLAUDE.md)の規約遵守**
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

#### 推奨チェック項目

- パフォーマンスの問題
- セキュリティの懸念
- テストの必要性
- 潜在的なバグ

### 5. inline suggestion comment の投稿（必要な場合）

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

### 6. レビューコメントの作成

レビューコメントは以下の構成で記述：

```markdown
## レビュー結果

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

### 7. GitHub上にコメント投稿

```bash
gh pr review <PR番号> --comment -b "レビューコメント内容"
```

- 重大な問題がある場合: `--request-changes`
- 問題がない場合: レビュー結果を投稿した後、別途`--comment -b "Approve by Claude <claude@anthropic.com> :octocat:"`
- コメントのみ: `--comment`（デフォルト）
- 再レビュー時は、前回指摘への対応状況、新規差分、残る任意提案、結論をレビュー結果に記載する
- 初回レビュー、再レビュー、修正後レビューを問わず、問題がない場合はレビュー結果とは別の通常コメントとして`Approve by Claude <claude@anthropic.com> :octocat:`を投稿する
- 修正コミット追加後は、過去の承認に依存せず最新HEADを確認して再レビューする

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
