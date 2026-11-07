---
name: claude-implementation-handoff
description: Codexから合意済みの設計を受け取り、Claude CodeのOpusがimplementerへの実装委譲、コミットのレビュー、push、PR作成を担当するときに使う。
---

# Codexからの実装引き継ぎ

Claude Codeの親セッション（Opus）として、Codexから受け取った設計を実装済みPRにする。PR公開後の独立レビューはCodexが担当する。

1. `CLAUDE.md` を読み、現在のブランチがCodexの指定した作業ブランチと一致し、`main` ではないことを確認する。その上で [implementerの入力契約](../../agents/implementer.md) を確認する。ブランチが一致しない場合や、設計判断が必要な不足や既存変更との衝突があれば、Codexに確認事項を返す。
2. PRの起点になる空コミットをリポジトリ規約に従って用意する。再開時は既存の起点を使う。
3. `Agent` ツールで `implementer` を明示的に起動し、入力契約を満たす依頼を渡す。子は実装・検証・コミットを担当する。子が停止した場合は、進捗と不足事項を確認し、合意済みの範囲で解決できるものは子へ戻す。追加の仕様判断が必要ならCodexへ返す。
4. 親のOpusが子のコミットと検証結果を読み、仕様との整合とリポジトリ規約を確認する。修正が必要なら反映し、最終HEADに必要な検証を済ませてから、親がpushして `[claude]: 関心事` の形式でPRを作成する。関連Issue、`実DB検証`、公開状態、push後の追跡参照は `CLAUDE.md` に従う。再開時は同じブランチの既存PRを確認する。
5. CodexにはPR URL・関連Issue・ブランチ・HEAD SHAを返す。PR作成前に停止した場合は、最後に完了した工程と残作業を返す。
