[English](README.md) | **中文** | [한국어](README.ko.md) | [日本語](README.ja.md)

# 🎓 Gyoshu & Jogyo

> *"每一位伟大的教授都需要一位优秀的助教。"*

**Gyoshu**（교수，*教授*）负责统筹。**Jogyo**（조교，*助教*）负责执行。

它们共同构成了一个面向 [OpenCode](https://github.com/opencode-ai/opencode) 的端到端研究自动化系统，能够将您的研究目标转化为可复现的 Jupyter notebook——包含完整的假设、实验、发现和可发表的研究报告。

---

## 🎭 角色介绍

| 智能体 | 角色 | 韩语 | 职责 |
|-------|------|------|------|
| **Gyoshu** | 🎩 教授 | 교수 | 规划研究、协调工作流程、管理会话 |
| **Jogyo** | 📚 助教 | 조교 | 执行 Python 代码、运行实验、生成输出 |
| **Baksa** | 🔍 博士审稿人 | 박사 | 对抗性验证者——质疑每个结论，计算可信度分数 |
| **Jogyo Paper Writer** | ✍️ 研究生 | 조교 | 将原始发现转化为流畅的研究报告 |

可以把它想象成一个研究实验室：
- **教授**（Gyoshu）设定研究方向并审查进度
- **助教**（Jogyo）执行实际的实验和分析工作
- **博士审稿人**（Baksa）扮演"唱反调"的角色，质疑每一个结论
- 到了发表的时候，**研究生**将研究发现撰写成优美的论文

---

## ✨ 功能特性

<!-- TODO: Add demo GIF showing /gyoshu-auto workflow -->
<p align="center">
  <em>🎬 演示即将推出！请尝试<a href="docs/user-guide.md">快速入门教程</a>体验 Gyoshu 的强大功能。</em>
</p>

- 🔬 **假设驱动研究** — 使用 `[OBJECTIVE]`、`[HYPOTHESIS]`、`[FINDING]` 标记来组织您的研究工作
- 🐍 **持久化 Python REPL** — 变量在会话间保持不变，就像真正的 Jupyter 内核一样
- 📓 **自动生成 Notebook** — 每个实验都被记录为可复现的 `.ipynb` 文件
- 🤖 **自主模式** — 设定目标，离开去做其他事情，回来就能看到结果
- 🔍 **对抗性验证** — 博士审稿人会在接受结论前质疑每一个论断
- 📝 **AI 驱动的报告** — 将杂乱的输出转化为精美的研究叙述
- 🔄 **会话管理** — 随时继续、回放或分支您的研究

---

## 🚀 安装

```bash
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/My-Jogyo/main/install.sh | bash
```

<details>
<summary>📦 其他安装方式</summary>

**克隆并安装**（如果您想贡献或修改）
```bash
git clone https://github.com/Yeachan-Heo/My-Jogyo.git
cd My-Jogyo && ./install.sh
```

**npm/bunx**（包管理器）
```bash
npm install -g gyoshu && gyoshu install
# 或
bunx gyoshu install
```

</details>

**验证安装：**
```bash
./install.sh --check   # 如果您克隆了仓库
# 或直接运行 opencode 并尝试 /gyoshu
```

---

## 🤖 LLM 安装指南

> *正在使用 Claude、GPT、Gemini 或其他 AI 助手配合 OpenCode？本节专为您准备。*

**安装方式相同** — 使用上述方法安装 Gyoshu，然后为您的 LLM 提供所需的上下文：

1. **将您的 LLM 指向指南：**
   > "阅读 Gyoshu 目录中的 `AGENTS.md` 以获取如何使用研究工具的完整上下文。"

2. **或者粘贴这个快速入门提示：**
   ```
   I've installed Gyoshu. Read AGENTS.md and help me run /gyoshu to analyze my data.
   ```

**您的 LLM 应该知道的关键命令：**
| 命令 | 功能 |
|-----|------|
| `/gyoshu` | 启动交互式研究 |
| `/gyoshu-auto <目标>` | 自主研究（无需干预） |
| `/gyoshu doctor` | 检查系统健康状态并诊断问题 |

> **提示：** [AGENTS.md](AGENTS.md) 包含 LLM 所需的一切——智能体、命令、标记、故障排除等。

---

## 🏃 快速开始

```bash
# 启动 OpenCode
opencode

# 👋 向教授打个招呼
/gyoshu

# 🎯 开始一个新的研究项目
/gyoshu analyze customer churn patterns in the telecom dataset

# 🤖 或者让它自主运行（无需干预！）
/gyoshu-auto classify iris species using random forest

# 📊 生成报告
/gyoshu report

# 🔄 继续上次的工作
/gyoshu continue
```

---

## 📖 命令

### 教授的命令（`/gyoshu`）

| 命令 | 功能 |
|-----|------|
| `/gyoshu` | 显示状态和下一步操作 |
| `/gyoshu <目标>` | 启动交互式研究 |
| `/gyoshu-auto <目标>` | 自主模式（设定后就不用管了！） |
| `/gyoshu plan <目标>` | 只创建计划，不执行 |
| `/gyoshu continue` | 继续上次的工作 |
| `/gyoshu report` | 生成研究报告 |
| `/gyoshu list` | 查看所有研究项目 |
| `/gyoshu search <查询>` | 在所有 notebook 中搜索内容 |
| `/gyoshu doctor` | 检查系统健康状态并诊断问题 |

### 研究模式

| 模式 | 适用场景 | 命令 |
|-----|---------|-----|
| 🎓 **交互式** | 学习、探索、迭代 | `/gyoshu <目标>` |
| 🤖 **自主式** | 明确目标、无需干预执行 | `/gyoshu-auto <目标>` |
| 🔧 **REPL** | 快速探索、调试 | `/gyoshu repl <查询>` |

---

## 🔬 研究工作流程

### 1. 设定目标
```
/gyoshu analyze wine quality factors and build a predictive model
```

### 2. 教授制定计划
Gyoshu 创建一个结构化的研究计划，包含明确的目标和假设。

### 3. 助教执行
Jogyo 运行 Python 代码，使用结构化标记来组织输出：

```python
print("[OBJECTIVE] Predict wine quality from physicochemical properties")
print("[HYPOTHESIS] Alcohol content is the strongest predictor")

# ... 分析代码 ...

print(f"[METRIC:accuracy] {accuracy:.3f}")
print("[FINDING] Alcohol shows r=0.47 correlation with quality")
print("[CONCLUSION] Hypothesis supported - alcohol is key predictor")
```

### 4. 自动生成 Notebook
所有内容都被记录在 `notebooks/wine-quality.ipynb` 中，确保完全可复现。

### 5. AI 撰写报告
Paper Writer 智能体将标记转化为叙述性报告：

> *"我们对 1,599 个葡萄酒样本的分析表明，酒精含量是质量评分的主要预测因子（r = 0.47）。最终的随机森林模型达到了 87% 的准确率..."*

---

## 📁 项目结构

```
your-project/
├── notebooks/                    # 📓 研究 notebook
│   ├── wine-quality.ipynb
│   └── customer-churn.ipynb
├── reports/                      # 📝 生成的报告
│   └── wine-quality/
│       ├── report.md             # AI 撰写的叙述性报告
│       ├── figures/              # 保存的图表
│       └── models/               # 保存的模型
├── data/                         # 📊 您的数据集
└── .venv/                        # 🐍 Python 环境
```

**运行时文件**（套接字、锁）存放在操作系统临时目录中——不会污染您的项目！🧹

### Gyoshu 创建的内容

当您运行研究时，Gyoshu 会在您的项目中创建这些产出物：

```
your-project/
├── notebooks/
│   └── your-research.ipynb    ← 研究 notebook（真实来源）
├── reports/
│   └── your-research/
│       ├── figures/           ← 保存的图表（.png, .svg）
│       ├── models/            ← 训练好的模型（.pkl, .joblib）
│       └── report.md          ← 生成的研究报告
└── (您现有的文件保持不变！)
```

> **注意：** Gyoshu 永远不会修改您的 `.venv/`、`data/` 或其他现有项目文件。

---

## 🎯 输出标记

助教使用结构化标记来组织研究输出：

| 标记 | 用途 | 示例 |
|-----|-----|-----|
| `[OBJECTIVE]` | 研究目标 | `[OBJECTIVE] Classify iris species` |
| `[HYPOTHESIS]` | 待验证的假设 | `[HYPOTHESIS] Petal length is most predictive` |
| `[DATA]` | 数据集信息 | `[DATA] Loaded 150 samples` |
| `[METRIC:name]` | 定量结果 | `[METRIC:accuracy] 0.95` |
| `[FINDING]` | 关键发现 | `[FINDING] Setosa is linearly separable` |
| `[CONCLUSION]` | 最终结论 | `[CONCLUSION] Hypothesis confirmed` |

---

## 🐍 Python 环境

Gyoshu 使用您项目的 `.venv/` 虚拟环境：

| 优先级 | 类型 | 检测方式 |
|-------|-----|---------|
| 1️⃣ | 自定义 | `GYOSHU_PYTHON_PATH` 环境变量 |
| 2️⃣ | venv | `.venv/bin/python` 存在 |

**快速设置：**
```bash
python3 -m venv .venv
.venv/bin/pip install pandas numpy scikit-learn matplotlib seaborn
```

> **注意：** Gyoshu 使用您项目的虚拟环境，永远不会修改系统 Python。

---

## 🛠️ 系统要求

- **OpenCode** v0.1.0+
- **Python** 3.10+ 
- **可选**：`psutil`（用于内存跟踪）

### 支持的平台

| 平台 | 状态 | 备注 |
|-----|-----|-----|
| **Linux** | ✅ 主要支持 | 在 Ubuntu 22.04+ 上测试 |
| **macOS** | ✅ 支持 | Intel 和 Apple Silicon |
| **Windows** | ⚠️ 仅限 WSL2 | 不支持原生 Windows |

---

## 🔄 更新

### 选项 1：重新运行安装程序

```bash
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/My-Jogyo/main/install.sh | bash
```

### 选项 2：拉取并重新安装（如果您克隆了仓库）

```bash
cd My-Jogyo
git pull
./install.sh
```

### 验证更新

```bash
opencode
/gyoshu doctor
```

查看 [CHANGELOG.md](CHANGELOG.md) 了解每个版本的更新内容。

---

## 🎓 为什么叫 "Gyoshu" 和 "Jogyo"？

在韩国学术界：

- **교수 (Gyoshu/Kyosu)** = 教授——指导、规划和监督的人
- **조교 (Jogyo)** = 助教——执行、实验和承担繁重工作的人

这反映了系统架构：Gyoshu 是规划和管理研究流程的协调智能体，而 Jogyo 是实际运行 Python 代码并产生结果的执行智能体。

这是一种合作关系。教授有远见，助教将其实现。他们一起发表论文。📚

---

## 🤝 可选配套工具：Oh-My-OpenCode

> **Gyoshu 完全独立运行。** 它拥有自己的智能体栈，不需要其他 OpenCode 扩展（如 oh-my-opencode）。

对于**数据驱动的产品开发工作流程**，您可以选择将 Gyoshu 与 [Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode) 结合使用：

| 工具 | 聚焦领域 | 独立运行？ |
|-----|---------|----------|
| **Gyoshu（本项目）** | 📊 研究与分析 | ✅ 完全独立 |
| **[Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)** | 🏗️ 产品开发 | ✅ 完全独立 |

### Gyoshu 的智能体栈

Gyoshu 包含研究所需的一切：

| 智能体 | 角色 | 职责 |
|-------|-----|-----|
| `@gyoshu` | 教授 | 规划研究、协调工作流程 |
| `@jogyo` | 助教 | 执行 Python 代码、运行实验 |
| `@baksa` | 博士审稿人 | 质疑结论、验证证据 |
| `@jogyo-insight` | 证据收集者 | 搜索文档、查找示例 |
| `@jogyo-feedback` | 学习探索者 | 回顾过往会话寻找模式 |
| `@jogyo-paper-writer` | 报告撰写者 | 将发现转化为叙述性报告 |

### 可选工作流程（两者结合使用时）

如果您选择同时使用这两个工具：

1. **使用 Gyoshu 进行研究：**
   ```
   /gyoshu-auto analyze user behavior and identify churn predictors
   ```
   → 产出洞察："7 天内未使用功能 X 的用户流失率高 3 倍"

2. **使用 Oh-My-OpenCode 进行构建：**
   ```
   /planner implement onboarding flow that guides users to feature X
   ```
   → 发布解决该洞察的功能

**数据指导决策，代码实现解决方案。** 🚀

> **注意：** 使用 Gyoshu 不需要 Oh-My-OpenCode。每个工具都可以独立工作。

---

## 🔧 故障排除

| 问题 | 解决方案 |
|-----|---------|
| **"No .venv found"** | 创建虚拟环境：`python3 -m venv .venv && .venv/bin/pip install pandas numpy` |
| **"Bridge failed to start"** | 检查 Python 版本（需要 3.10+）：`python3 --version`。检查套接字路径权限。 |
| **"Session locked"** | 在确认没有进程运行后使用 `/gyoshu unlock <sessionId>` |
| **OpenCode not in PATH** | 从 [opencode-ai/opencode](https://github.com/opencode-ai/opencode) 安装 |

还有问题？运行 `/gyoshu doctor` 来诊断问题。

---

## 📄 许可证

MIT — 使用它、分叉它、用它来教学！

---

<div align="center">

**为那些宁愿思考也不愿打字的研究者而作 🎓**

[报告 Bug](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [请求功能](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [文档](https://github.com/Yeachan-Heo/My-Jogyo/wiki)

</div>
