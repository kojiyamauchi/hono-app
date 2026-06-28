---
name: pr-review
description: Use when reviewing a GitHub Pull Request for this repository, especially when the user asks Codex to review a PR created by Claude, the user, or another agent.
---

# PR Review

このSkillは、GitHub Pull Requestをレビューするときに使う。

## 正本と責務分担

- PRレビューの実行手順・レビューコメントの見出し/出力フォーマット・inline suggestion comment の投稿手順は、このSkillを正本とする。`AGENTS.md` / `CLAUDE.md`「AIエージェント間レビュー」には、レビュー担当の割り当てなど常に守る共通原則だけが置かれている。
- コミット粒度の詳細・標準レイヤー順は、コミット粒度Skill（`.codex/skills/commit-granularity/SKILL.md`）を正本とする。レビューではそのチェックリストを使う。
- migration検証・コーディング規約など、本Skillで扱わない（Skill化していない）ルールは、引き続き `AGENTS.md` / `CLAUDE.md` を正本とし、必要な箇所で参照する。
- Codex版とClaude版（`.claude/skills/pr-review/SKILL.md`）のSkillで、方針・確認項目がずれないようにする。

## Trigger

- ユーザーが「PRをレビューして」と依頼したとき
- PR番号、PR URL、または現在のブランチのPRを指定されたとき
- Claude が作成したPRを Codex がレビューするとき
- ユーザーが作成したPRを Codex がレビューするとき

## Workflow

1. PRの対象リポジトリ、PR番号、base/head branchを確認する。
2. GitHub connectorが使える場合は、PR本文、差分、コメント、レビュー状態をconnectorで取得する。
3. PR本文の `関連Issue`、または `Closes #...` / `Fixes #...` / `Resolves #...` を確認する。
4. 対象Issueがある場合は、レビュー前にIssue本文・コメント・受け入れ条件・完了条件・未完了TODOを取得して、PR差分が意図を満たしているか確認する。対象IssueがあるのにPR本文から参照されていない場合は指摘する。
5. 差分レビューを始める前に、`gh pr checks` やGitHub connectorで対象PRのCIが通っていることを確認する。
6. CIが未完了または失敗している場合は、その状態をレビュー結果に明記し、問題なしの通常コメントはCI通過後に投稿する。
7. `gh` が必要な場合は、`gh pr view`, `gh pr diff`, `gh pr checks` を使って補足する。
8. 差分を読み、バグ、設計リスク、テスト不足、セキュリティ、運用上の問題を優先して確認する。
9. コミット履歴がレビュー可能な粒度か確認し、複数の関心事が明らかに混ざる場合は指摘する。
10. 必要に応じて `CLAUDE.md` の規約、CI設定、package scripts、Prisma/Supabase設定も確認する。
11. 変更内容が明確で、該当箇所へ直接適用できる指摘がある場合は、レビュー本文を投稿する前に inline suggestion comment を投稿し、発行されたURLを取得する。
12. 対象Issueに受け入れ条件または完了条件としてチェック項目がある場合の更新は、レビュー結果投稿後に「Related Issue Review」の手順で行う（満たしたと判断できる項目のみに限定する）。
13. レビュー結果は問題点を先に出し、重大度順に並べる。
14. 最新HEADに対するレビュー結果を、GitHub上へPR reviewとして投稿する。
15. レビュー結果投稿後に、紐付くIssueのチェック項目を確認し、満たしたと判断できる項目があれば更新し、更新した旨のコメントをIssueへ投稿する（手順は「Related Issue Review」を参照）。

## Review Priorities

- バグや仕様違反
- データ破壊、認証、権限、秘密情報の漏えい
- Prisma migration、DB schema、DTO、Entity、Responseの不整合
- Hono route、controller、service、repositoryの責務混在
- 入力検証、エラーハンドリング、HTTP statusの不備
- テスト不足、CIで検出できないリスク
- 対象Issueの受け入れ条件・完了条件との不整合
- コミット履歴の粒度が粗すぎてレビューや追跡が難しい状態
- migrationを含む場合の実DB検証（`Migration DB Verification` を参照）
- `CLAUDE.md` の規約違反
- 不要な大規模リファクタリングや責務外の変更

## Related Issue Review

対象Issueの確認は `AGENTS.md` / `CLAUDE.md` の「PR本文の関連Issue」「AIエージェント間レビュー」を正本とし、ここでは実行手順だけを示す。

1. PR本文の `関連Issue` セクションと closing keyword を確認する。
2. 対象Issueがある場合は、Issue本文とコメントを読む。
3. 受け入れ条件・完了条件・未完了TODOがある場合は、PR差分、テスト、動作確認結果と照合する。
4. 対象IssueがあるのにPR本文から参照されていない場合は、PR本文更新をFindingに含める。
5. Issue側のチェック更新は、受け入れ条件または完了条件として明確で、PR差分・テスト・動作確認により満たしたと判断できる項目だけに限定する。

### レビュー完了時のチェック更新とコメント

レビュー結果を投稿したあとに、紐付くIssueのチェック項目を確認・更新する。

1. PR本文の `関連Issue`・関連Issue本文・コメントから、紐付くIssueとそのチェックボックスを確認する。
2. 紐付くIssue本文にチェックボックスがある場合は、PR差分・CI・テスト・動作確認・レビュー結果から**満たしたと判断できる項目だけ**を更新する。満たしたと判断できない項目、レビュー担当者だけでは判断できない項目は更新しない。更新対象が無ければIssue本文・コメントの更新は不要。
3. チェックボックスを更新した場合は、Issueへ更新した旨のコメントを投稿する。
   - コメントから、**どのPRレビューに基づいて何を更新したか**が分かるようにする。
   - コメント形式は issue-management Skill のコメント記法（`## <コメントの関心事> (<エージェント名>)`）に従う。
   - 全ての受け入れ条件・完了条件のチェックが完了した場合は、次の内容でコメントする:

     ````bash
     gh issue comment <issue番号> -b "$(cat <<'EOF'
     ## PRレビュー完了 (Codex)

     PR #<PR番号> のレビュー結果に基づき、全ての受け入れ条件・完了条件の更新を完了しました。
     EOF
     )"
     ````

## Commit Granularity Review

コミット粒度の詳細・標準レイヤー順は コミット粒度Skill（`.codex/skills/commit-granularity/SKILL.md`）を正本とし、そのチェックリストを使う。`AGENTS.md` / `CLAUDE.md`「コミットの粒度」には常に守る共通原則がある。

- `git log --oneline <base>..HEAD` でコミット一覧を確認する。
- `git show --stat <commit>` で、各コミットが1つの関心事に閉じているか確認する。
- feature実装では、DTO / mapper / repository / service / schema / controller / routes などの標準レイヤーが不自然に混ざっていないか確認する。
- 実装コミットと対応するテストコミットが隣接しているか確認する。
- review対応コミットは、指摘ごと、または関心事ごとに分かれているか確認する。

## Output Format

レビュー結果は次の順で書く。

1. Review by Codex
2. Findings
3. Open Questions
4. Summary

Findingsでは、可能な限りファイルパスと行番号を示す。
inline suggestion comment を投稿したFindingには、該当コメントへのリンクを `comment: コメントURL` の形式で記載する。

```txt
## Review by Codex

## Findings

[P1] 問題の短い説明
path/to/file.ts:123
理由と影響。必要なら修正方針。

comment: https://github.com/owner/repo/pull/xx#discussion_rxxxxxxxx
```

問題がない場合は、問題が見つからなかったことを明確に書き、残るリスクや未確認事項だけを短く補足する。

## Inline Suggestion Comments

Findingsに指摘を出す場合、変更内容が明確で、該当箇所へ直接適用できるものは、可能な範囲で inline suggestion comment を併用する。

- inline suggestion comment は、レビュー本文を投稿する前に投稿する。
- inline suggestion comment では、必要に応じて GitHub の suggestion ブロックで変更案を提示する。
- inline suggestion comment は対象PRのdiffに含まれる行にのみ投稿できる。差分外の既存行に対する指摘は、suggestionを付けず通常のレビュー本文で行う。
- 投稿後に取得した inline suggestion comment のURLを、該当Findingに `comment: コメントURL` の形式で記載する。
- `comment:` が指すのは inline suggestion comment（`#discussion_r...` のレビューコメント）のURLであり、そのコメント本文に含める GitHub の suggestion ブロックとは別物として扱う。
- suggestion は、そのまま適用しても意図が崩れない最小単位にする。
- 複数ファイルにまたがる修正、設計判断、テスト追加、責務分離など、単一suggestionで表現しづらい内容は無理に suggestion 化しない。
- GitHub APIやツール制約で inline suggestion comment のURL取得が難しい場合は、通常のレビュー本文のみで指摘してよい。

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

- `line` は対象ファイルの新側（RIGHT）の行番号を指定する。
- 複数行に跨る場合は、必要に応じて `start_line` / `line` を使う。
- 出力された `html_url` をレビュー本文の該当Findingに `comment:` として記載する。

## Migration DB Verification

PR本文の `## 実DB検証` セクションは、migrationの有無にかかわらず必須記載とする運用になっている。まず全PR共通で、このセクションが存在し記載漏れになっていないかを確認する。

- migrationを含まないPRでは、同セクションに `- migrationを含まないため検証なし` が記載されていることを確認する。セクション自体が無い、または空欄のままの場合はPR本文更新を指摘する。
- migrationを含むPRでは、同セクションに以下の証跡が記載されていることを確認する。

テスト/CIはDB非依存のため、migrationの適用や実DB挙動（transaction・一意制約・外部キー等）はCIで検証されない。migrationを含むPRのレビューでは、`AGENTS.md` / `CLAUDE.md`「migrationを含む変更の実DB検証」に従う。詳細・原則は `AGENTS.md` を正本とし、ここでは手順の要点のみ示す。

1. まずPR本文/コメントの**実DB検証証跡**（commit SHA・適用migration・確認内容と結果・データ削除・DB起動状態）を確認する。
2. 次のいずれかのときのみ再実行する: 証跡が無い/不明確、検証後にmigration・repository・transaction等が変更、並行制御や制約など再現確認すべき高リスク箇所がある。
3. 再実行する場合:
   - `bun run db:start` → `bunx prisma migrate status` で履歴とDB状態を確認する（**未適用を前提にしない**）。
   - 未適用なら `bunx prisma migrate deploy`、適用済みなら実装者の証跡を確認する。
   - clean適用そのものの再検証が必要な場合のみ、使い捨てDBまたは**ユーザー承認済みの `bun run db:reset`** を使う（`db:reset` は既存データを削除するため明示承認を必須とする）。
   - 非自明なデータ層は smoke（実APIへのHTTPリクエスト / repository・serviceを呼ぶ使い捨てスクリプト / `psql`）で確認する。使い捨てスクリプトはコミットせず、検証データは削除する。

## Posting To GitHub

PRレビューを依頼された場合は、初回レビュー、再レビュー、修正後レビューを問わず、最新HEADに対するレビュー結果をGitHubへ投稿する。

- コメントのみ: `COMMENT`
- 修正必須: `REQUEST_CHANGES`
- 問題なし: レビュー結果を投稿した後、本文が`Approve by Codex <codex@openai.com> :octocat:`の通常コメントを別途投稿
- 修正コミット追加後は、過去の承認に依存せず最新HEADを確認して再レビューする。
- 再レビュー時は、前回指摘への対応状況、新規差分、残る任意提案、結論をレビュー結果に記載する。
- 問題がない場合は、レビュー回数にかかわらず、レビュー結果とは別の通常コメントとして`Approve by Codex <codex@openai.com> :octocat:`を投稿する。

投稿前に、対象PR番号と投稿種別を確認する。

## Style

- コメントは日本語で書く。
- 良い点の列挙より、修正すべき問題を優先する。
- 好みの指摘ではなく、実害のあるリスクを優先する。
- 指摘は具体的にし、可能なら修正方針も添える。
- Claude が作成したPRでも、Codex が作成したPRでも、同じ基準でレビューする。
