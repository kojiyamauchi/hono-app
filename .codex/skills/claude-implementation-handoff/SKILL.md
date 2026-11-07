---
name: claude-implementation-handoff
description: Codexで合意した設計をClaude CodeのOpusに渡し、implementerによる実装からOpusによるPR作成、CI通過後のCodexによるGitHub上のレビューまで進めるときに使う。
---

# Claudeへの実装引き継ぎ

設計の壁打ちはCodexで行う。Claude CodeはOpusが親となり、リポジトリの `implementer` に実装・テスト・コミットを委譲する。Opusがコミットをレビューしてpush・PR作成を行い、CI通過後にCodexが独立してPRをレビューする。

## 設計の確定と引き継ぎ

- 壁打ちだけを依頼された段階では設計を詰める。設計が固まり、実装・PR作成まで依頼されてからClaudeを起動する。
- [implementerの入力契約](../../../.claude/agents/implementer.md) に沿って、作業ブランチ名、合意した設計、完了条件と検証コマンド、参照feature、変更可能な範囲をまとめる。関連Issueがある場合は番号を添える。壁打ちの履歴は渡さず、決定事項と実装に必要な背景に絞る。
- Codexが作業ブランチを用意し、そのブランチをチェックアウトした作業ディレクトリをClaudeへ渡す。既存の変更と衝突する場合は作業場所を分離する。作業ディレクトリにClaude用Skillと `implementer` の定義があることを確認する。
- `claude --version` でCLIを確認し、作業ディレクトリで `claude -p --model opus` を実行する。プロンプトはファイルから標準入力へ渡す。冒頭で [Claude側の受け取り手順](../../../.claude/skills/claude-implementation-handoff/SKILL.md) をパスで指定し、親セッションの `Agent` ツールで `implementer` を起動するよう明示する。親をOpusにするため、`--agent implementer` は指定しない。
- Claudeの認証・API接続と `gh auth status` でGitHubの認証を確認し、`--allowed-tools` は委譲・編集・検証・コミット・push・PR作成に必要な操作へ絞る。承認やサンドボックスの制約はCodex側でも守る。
- `--output-format stream-json --verbose` の出力を保存し、完了まで待つ。ログから `implementer` の呼び出しと結果、親の最終報告を確認する。PR URLが返った場合はGitHubで対象リポジトリ・作業ブランチ・HEAD SHA・公開状態を照合する。
- 中断した場合は、ローカルのコミット、リモートのブランチ、既存PRを確認してから残作業だけを再開する。委譲を確認できない場合は完了扱いにせず、再開時も既存の変更を保全する。
- Claudeが確認事項を返した場合、合意済みの設計で答えられるものは回答を渡して再開する。新たな仕様判断が必要な場合はユーザーの回答を得てから再開する。

## CIとPRレビュー

1. `gh pr checks <PR URL> --watch` などで対象HEADのCIを待つ。チェックがまだ登録されていない場合は、登録を待ってから再確認する。HEADが変わったら新しいHEADのCIを確認する。CIが失敗した場合は失敗したチェックとPR URLを報告し、レビューは通過後に行う。
2. CI通過後、[CodexのPRレビューSkill](../pr-review/SKILL.md) に従い、関連Issue・PR本文・最新差分を自分で確認する。Opusの所見はレビューの根拠に使わない。投稿直前にHEADとCIを再確認し、変更があれば新しいHEADでやり直す。
3. GitHubがPR作成者と同じアカウントからの修正要求を拒否した場合は、修正必須の指摘を明記した `COMMENT` としてPRレビューを投稿し、投稿種別を報告する。
4. 最新HEADへのレビューがGitHub上に投稿されたことを確認し、PRとレビューのURLを返す。関連Issueのチェック更新はPRレビューSkillに従い、ユーザーが依頼した範囲で実施する。ユーザーによる最終レビューは省略しない。レビュー後の修正・マージは別途依頼を受けたときに行う。
