[English](README.md) | [中文](README.zh.md) | [한국어](README.ko.md) | **日本語**

# 🎓 Gyoshu & Jogyo

> *「すべての優れた教授には、優れた助手が必要です。」*

**Gyoshu**（教授）がオーケストレーションし、**Jogyo**（助教/TA）が実行します。

この2つが組み合わさることで、[OpenCode](https://github.com/opencode-ai/opencode)のためのエンドツーエンドの研究自動化システムを形成します。研究目標を、仮説・実験・発見・出版可能なレポートを含む再現可能なJupyterノートブックに変換します。

---

## 🎭 キャスト紹介

| エージェント | 役割 | 韓国語 | 担当 |
|-------------|------|--------|------|
| **Gyoshu** | 🎩 教授 | 교수 | 研究計画の立案、ワークフローの統括、セッション管理 |
| **Jogyo** | 📚 助教/TA | 조교 | Pythonコードの実行、実験の実施、出力の生成 |
| **Baksa** | 🔍 博士審査員 | 박사 | 敵対的検証者 — 主張に異議を唱え、信頼スコアを算出 |
| **Jogyo Paper Writer** | ✍️ 大学院生 | 조교 | 生の発見をナラティブな研究レポートに変換 |

研究室のようなイメージです：
- **教授**（Gyoshu）が研究の方向性を設定し、進捗を確認
- **助教/TA**（Jogyo）が実際の実験と分析を実行
- **博士審査員**（Baksa）が悪魔の代弁者として、すべての主張に疑問を投げかける
- 出版時には、**大学院生**が発見を美しくまとめる

---

## ✨ 機能

<!-- TODO: Add demo GIF showing /gyoshu-auto workflow -->
<p align="center">
  <em>🎬 デモ準備中！<a href="docs/user-guide.md">クイックチュートリアル</a>でGyoshuを体験してください。</em>
</p>

- 🔬 **仮説駆動型研究** — `[OBJECTIVE]`、`[HYPOTHESIS]`、`[FINDING]`マーカーで作業を構造化
- 🐍 **永続的Python REPL** — 実際のJupyterカーネルのように、セッション間で変数が保持
- 📓 **自動生成ノートブック** — すべての実験が再現可能な`.ipynb`として記録
- 🤖 **自律モード** — 目標を設定して離席、戻ったら結果が待っている
- 🔍 **敵対的検証** — 博士審査員がすべての主張を承認前にチャレンジ
- 📝 **AI生成レポート** — 乱雑な出力を洗練された研究ナラティブに変換
- 🔄 **セッション管理** — いつでも研究の継続、再生、分岐が可能

---

## 🚀 インストール

```bash
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/My-Jogyo/main/install.sh | bash
```

<details>
<summary>📦 その他のインストール方法</summary>

**クローン＆インストール**（貢献や変更を行う場合）
```bash
git clone https://github.com/Yeachan-Heo/My-Jogyo.git
cd My-Jogyo && ./install.sh
```

**npm/bunx**（パッケージマネージャー）
```bash
npm install -g gyoshu && gyoshu install
# または
bunx gyoshu install
```

</details>

**インストールの確認：**
```bash
./install.sh --check   # リポジトリをクローンした場合
# またはopencodeを実行して/gyoshuを試す
```

---

## 🤖 LLM向けインストール

> *Claude、GPT、Gemini、その他のAIアシスタントをOpenCodeで使用していますか？このセクションはあなたのためのものです。*

**セットアップは同じです** — 上記の方法でGyoshuをインストールし、LLMに必要なコンテキストを与えます：

1. **LLMにガイドを指示：**
   > 「Gyoshuディレクトリの`AGENTS.md`を読んで、研究ツールの使い方の全コンテキストを把握してください。」

2. **またはこのクイックスタートプロンプトを貼り付け：**
   ```
   I've installed Gyoshu. Read AGENTS.md and help me run /gyoshu to analyze my data.
   ```

**LLMが知っておくべき主要コマンド：**
| コマンド | 機能 |
|---------|------|
| `/gyoshu` | インタラクティブ研究を開始 |
| `/gyoshu-auto <目標>` | 自律研究（ハンズオフ） |
| `/gyoshu doctor` | システムの健全性をチェックし問題を診断 |

> **ヒント：** [AGENTS.md](AGENTS.md)にはLLMに必要なすべてが含まれています — エージェント、コマンド、マーカー、トラブルシューティングなど。

---

## 🏃 クイックスタート

```bash
# OpenCodeを起動
opencode

# 👋 教授に挨拶
/gyoshu

# 🎯 新しい研究プロジェクトを開始
/gyoshu analyze customer churn patterns in the telecom dataset

# 🤖 または自律的に実行（ハンズオフ！）
/gyoshu-auto classify iris species using random forest

# 📊 レポートを生成
/gyoshu report

# 🔄 中断したところから再開
/gyoshu continue
```

---

## 📖 コマンド

### 教授のコマンド（`/gyoshu`）

| コマンド | 機能 |
|---------|------|
| `/gyoshu` | ステータスと次のアクションを表示 |
| `/gyoshu <目標>` | インタラクティブ研究を開始 |
| `/gyoshu-auto <目標>` | 自律モード（設定したら放置！） |
| `/gyoshu plan <目標>` | 計画のみ作成、実行しない |
| `/gyoshu continue` | 中断したところから再開 |
| `/gyoshu report` | 研究レポートを生成 |
| `/gyoshu list` | すべての研究プロジェクトを表示 |
| `/gyoshu search <クエリ>` | 全ノートブックを横断検索 |
| `/gyoshu doctor` | システムの健全性をチェックし問題を診断 |

### 研究モード

| モード | 最適な用途 | コマンド |
|--------|-----------|---------|
| 🎓 **インタラクティブ** | 学習、探索、反復 | `/gyoshu <目標>` |
| 🤖 **自律** | 明確な目標、ハンズオフ実行 | `/gyoshu-auto <目標>` |
| 🔧 **REPL** | 素早い探索、デバッグ | `/gyoshu repl <クエリ>` |

---

## 🔬 研究の仕組み

### 1. 目標を設定

```
/gyoshu analyze wine quality factors and build a predictive model
```

### 2. 教授が計画

Gyoshuが明確な目標と仮説を持つ構造化された研究計画を作成します。

### 3. TAが実行

Jogyoが構造化マーカーを使用してPythonコードを実行し、出力を整理します：

```python
print("[OBJECTIVE] Predict wine quality from physicochemical properties")
print("[HYPOTHESIS] Alcohol content is the strongest predictor")

# ... 分析コード ...

print(f"[METRIC:accuracy] {accuracy:.3f}")
print("[FINDING] Alcohol shows r=0.47 correlation with quality")
print("[CONCLUSION] Hypothesis supported - alcohol is key predictor")
```

### 4. 自動生成ノートブック

すべてが完全な再現性を持つ`notebooks/wine-quality.ipynb`に記録されます。

### 5. AI執筆レポート

Paper Writerエージェントがマーカーをナラティブレポートに変換します：

> *「1,599のワインサンプルの分析により、アルコール含有量が品質評価の主要な予測因子であることが明らかになりました（r = 0.47）。最終的なRandom Forestモデルは87%の精度を達成しました...」*

---

## 📁 プロジェクト構造

```
your-project/
├── notebooks/                    # 📓 研究ノートブック
│   ├── wine-quality.ipynb
│   └── customer-churn.ipynb
├── reports/                      # 📝 生成されたレポート
│   └── wine-quality/
│       ├── report.md             # AI執筆のナラティブレポート
│       ├── figures/              # 保存されたプロット
│       └── models/               # 保存されたモデル
├── data/                         # 📊 データセット
└── .venv/                        # 🐍 Python環境
```

**ランタイムファイル**（ソケット、ロック）はOSの一時ディレクトリに保存されます — プロジェクト内ではありません！🧹

### Gyoshuが作成するもの

研究を実行すると、Gyoshuはプロジェクト内にこれらの成果物を作成します：

```
your-project/
├── notebooks/
│   └── your-research.ipynb    ← 研究ノートブック（真実の源）
├── reports/
│   └── your-research/
│       ├── figures/           ← 保存されたプロット（.png、.svg）
│       ├── models/            ← 学習済みモデル（.pkl、.joblib）
│       └── report.md          ← 生成された研究レポート
└── (既存のファイルはそのまま！)
```

> **注意：** Gyoshuは`.venv/`、`data/`、その他の既存プロジェクトファイルを変更することはありません。

---

## 🎯 出力マーカー

TAは構造化マーカーを使用して研究出力を整理します：

| マーカー | 目的 | 例 |
|---------|------|-----|
| `[OBJECTIVE]` | 研究目標 | `[OBJECTIVE] Classify iris species` |
| `[HYPOTHESIS]` | テスト対象 | `[HYPOTHESIS] Petal length is most predictive` |
| `[DATA]` | データセット情報 | `[DATA] Loaded 150 samples` |
| `[METRIC:name]` | 定量的結果 | `[METRIC:accuracy] 0.95` |
| `[FINDING]` | 重要な発見 | `[FINDING] Setosa is linearly separable` |
| `[CONCLUSION]` | 最終結論 | `[CONCLUSION] Hypothesis confirmed` |

---

## 🐍 Python環境

Gyoshuはプロジェクトの`.venv/`仮想環境を使用します：

| 優先度 | タイプ | 検出方法 |
|--------|--------|----------|
| 1️⃣ | カスタム | `GYOSHU_PYTHON_PATH`環境変数 |
| 2️⃣ | venv | `.venv/bin/python`が存在 |

**クイックセットアップ：**
```bash
python3 -m venv .venv
.venv/bin/pip install pandas numpy scikit-learn matplotlib seaborn
```

> **注意：** Gyoshuはプロジェクトの仮想環境を使用します。システムPythonを変更することはありません。

---

## 🛠️ 要件

- **OpenCode** v0.1.0以上
- **Python** 3.10以上
- **オプション**：`psutil`（メモリ追跡用）

### 対応プラットフォーム

| プラットフォーム | 状態 | 備考 |
|------------------|------|------|
| **Linux** | ✅ 主要 | Ubuntu 22.04以上でテスト済み |
| **macOS** | ✅ 対応 | Intel & Apple Silicon |
| **Windows** | ⚠️ WSL2のみ | ネイティブWindowsは非対応 |

---

## 🔄 アップデート

### オプション1：インストーラーを再実行

```bash
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/My-Jogyo/main/install.sh | bash
```

### オプション2：pullして再インストール（クローンした場合）

```bash
cd My-Jogyo
git pull
./install.sh
```

### アップデートの確認

```bash
opencode
/gyoshu doctor
```

各リリースの新機能については[CHANGELOG.md](CHANGELOG.md)を参照してください。

---

## 🎓 なぜ「Gyoshu」と「Jogyo」？

韓国の学術界では：

- **교수（Gyoshu/Kyosu）** = 教授 — 指導し、計画し、監督する人
- **조교（Jogyo）** = 助教/TA — 実行し、実験し、重労働を担う人

これはアーキテクチャを反映しています：Gyoshuは研究フローを計画・管理するオーケストレーターエージェントであり、Jogyoは実際にPythonコードを実行して結果を生成するエグゼキューターエージェントです。

これはパートナーシップです。教授がビジョンを持ち、TAがそれを実現する。一緒に論文を出版します。📚

> **日本の読者へ：** 韓国語の「교수」は日本の「教授」、「조교」は「助教」や「TA（ティーチングアシスタント）」、「박사」は「博士」に相当します。日本の大学でも馴染みのある役職構造です。

---

## 🤝 オプションのコンパニオン：Oh-My-OpenCode

> **Gyoshuは完全にスタンドアロンで動作します。** 独自のエージェントスタックを持ち、他のOpenCode拡張機能（oh-my-opencodeなど）を必要としません。

**データ駆動型プロダクト開発ワークフロー**には、オプションでGyoshuと[Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)を組み合わせることができます：

| ツール | フォーカス | 独立？ |
|--------|-----------|--------|
| **Gyoshu（このプロジェクト）** | 📊 研究と分析 | ✅ 完全スタンドアロン |
| **[Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)** | 🏗️ プロダクト開発 | ✅ 完全スタンドアロン |

### Gyoshu独自のエージェントスタック

Gyoshuには研究に必要なすべてが含まれています：

| エージェント | 役割 | 担当 |
|-------------|------|------|
| `@gyoshu` | 教授 | 研究計画、ワークフロー統括 |
| `@jogyo` | TA | Pythonコード実行、実験実施 |
| `@baksa` | 博士審査員 | 主張に異議、証拠検証 |
| `@jogyo-insight` | 証拠収集者 | ドキュメント検索、例の発見 |
| `@jogyo-feedback` | 学習探索者 | 過去のセッションからパターンを確認 |
| `@jogyo-paper-writer` | レポートライター | 発見をナラティブレポートに変換 |

### オプションのワークフロー（組み合わせ使用時）

両方のツールを一緒に使用する場合：

1. **Gyoshuで研究**：
   ```
   /gyoshu-auto analyze user behavior and identify churn predictors
   ```
   → インサイトを生成：「7日以内に機能Xを使用しないユーザーは3倍の離脱率」

2. **Oh-My-OpenCodeで構築**：
   ```
   /planner implement onboarding flow that guides users to feature X
   ```
   → インサイトに対応する機能をリリース

**データが意思決定を導き、コードがソリューションを提供します。** 🚀

> **注意：** Gyoshuを使用するためにOh-My-OpenCodeは必要ありません。各ツールは独立して動作します。

---

## 🔧 トラブルシューティング

| 問題 | 解決策 |
|------|--------|
| **「No .venv found」** | 仮想環境を作成：`python3 -m venv .venv && .venv/bin/pip install pandas numpy` |
| **「Bridge failed to start」** | Pythonバージョンを確認（3.10以上が必要）：`python3 --version`。ソケットパスの権限を確認。 |
| **「Session locked」** | プロセスが実行されていないことを確認後、`/gyoshu unlock <sessionId>`を使用 |
| **OpenCode not in PATH** | [opencode-ai/opencode](https://github.com/opencode-ai/opencode)からインストール |

まだ解決しない場合は、`/gyoshu doctor`を実行して問題を診断してください。

---

## 📄 ライセンス

MIT — 使用、フォーク、教育に自由にお使いください！

---

<div align="center">

**タイピングよりも思考に集中したい研究者のために🎓で作られました**

[バグ報告](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [機能リクエスト](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [ドキュメント](https://github.com/Yeachan-Heo/My-Jogyo/wiki)

</div>
