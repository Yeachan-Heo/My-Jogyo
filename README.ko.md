[English](README.md) | [中文](README.zh.md) | **한국어** | [日本語](README.ja.md)

# 🎓 교수(Gyoshu) & 조교(Jogyo)

> *"훌륭한 교수에게는 훌륭한 조교가 필요합니다."*

**교수**(Gyoshu)가 지휘합니다. **조교**(Jogyo)가 실행합니다.

이 둘은 [OpenCode](https://github.com/opencode-ai/opencode)를 위한 엔드투엔드 연구 자동화 시스템을 형성합니다. 연구 목표를 가설, 실험, 발견, 그리고 출판 가능한 보고서가 포함된 재현 가능한 Jupyter 노트북으로 변환해 드립니다.

---

## 🎭 등장인물

| 에이전트 | 역할 | 한국어 | 하는 일 |
|----------|------|--------|---------|
| **Gyoshu** | 🎩 교수 | 교수 | 연구 계획, 워크플로우 조율, 세션 관리 |
| **Jogyo** | 📚 조교 | 조교 | Python 코드 실행, 실험 수행, 결과 생성 |
| **Baksa** | 🔍 박사 심사위원 | 박사 | 적대적 검증자 — 주장에 도전하고 신뢰도 점수 계산 |
| **Jogyo Paper Writer** | ✍️ 대학원생 | 조교 | 원시 발견을 서사적 연구 보고서로 변환 |

연구실처럼 생각해 보세요:
- **교수**(Gyoshu)가 연구 방향을 설정하고 진행 상황을 검토합니다
- **조교**(Jogyo)가 실제 실험과 분석을 수행합니다
- **박사 심사위원**(Baksa)이 악마의 변호인 역할을 하며 모든 주장에 의문을 제기합니다
- 출판할 때가 되면, **대학원생**이 발견을 아름답게 정리합니다

---

## ✨ 주요 기능

<!-- TODO: Add demo GIF showing /gyoshu-auto workflow -->
<p align="center">
  <em>🎬 데모가 곧 공개됩니다! <a href="docs/user-guide.md">빠른 튜토리얼</a>을 통해 Gyoshu를 직접 체험해 보세요.</em>
</p>

- 🔬 **가설 기반 연구** — `[OBJECTIVE]`, `[HYPOTHESIS]`, `[FINDING]` 마커로 연구를 구조화합니다
- 🐍 **영속적인 Python REPL** — 실제 Jupyter 커널처럼 변수가 세션 간에 유지됩니다
- 📓 **자동 생성 노트북** — 모든 실험이 재현 가능한 `.ipynb`로 기록됩니다
- 🤖 **자율 모드** — 목표를 설정하고, 자리를 비우고, 결과를 받아보세요
- 🔍 **적대적 검증** — 박사 심사위원이 수락 전 모든 주장에 도전합니다
- 📝 **AI 기반 보고서** — 복잡한 출력을 세련된 연구 서사로 변환합니다
- 🔄 **세션 관리** — 언제든지 연구를 계속, 재생 또는 분기할 수 있습니다

---

## 🚀 설치

```bash
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/My-Jogyo/main/install.sh | bash
```

<details>
<summary>📦 기타 설치 방법</summary>

**Clone & 설치** (기여하거나 수정하려는 경우)
```bash
git clone https://github.com/Yeachan-Heo/My-Jogyo.git
cd My-Jogyo && ./install.sh
```

**npm/bunx** (패키지 매니저)
```bash
npm install -g gyoshu && gyoshu install
# 또는
bunx gyoshu install
```

</details>

**설치 확인:**
```bash
./install.sh --check   # 저장소를 클론한 경우
# 또는 opencode를 실행하고 /gyoshu 시도
```

---

## 🤖 LLM을 위한 설치 가이드

> *Claude, GPT, Gemini 또는 다른 AI 어시스턴트를 OpenCode와 함께 사용하시나요? 이 섹션이 도움이 될 것입니다.*

**설치 방법은 동일합니다** — 위의 방법으로 Gyoshu를 설치한 후, LLM에게 필요한 컨텍스트를 제공하세요:

1. **LLM에게 가이드를 알려주세요:**
   > "Gyoshu 디렉토리의 `AGENTS.md`를 읽고 연구 도구 사용법에 대한 전체 컨텍스트를 파악해."

2. **또는 이 빠른 시작 프롬프트를 붙여넣으세요:**
   ```
   I've installed Gyoshu. Read AGENTS.md and help me run /gyoshu to analyze my data.
   ```

**LLM이 알아야 할 핵심 명령어:**
| 명령어 | 기능 |
|--------|------|
| `/gyoshu` | 대화형 연구 시작 |
| `/gyoshu-auto <목표>` | 자율 연구 (핸즈프리) |
| `/gyoshu doctor` | 시스템 상태 확인 및 문제 진단 |

> **팁:** [AGENTS.md](AGENTS.md)에는 LLM이 필요로 하는 모든 것이 포함되어 있습니다 — 에이전트, 명령어, 마커, 문제 해결 등.

---

## 🏃 빠른 시작

```bash
# OpenCode 시작
opencode

# 👋 교수님께 인사
/gyoshu

# 🎯 새로운 연구 프로젝트 시작
/gyoshu analyze customer churn patterns in the telecom dataset

# 🤖 또는 자율 모드로 실행 (핸즈프리!)
/gyoshu-auto classify iris species using random forest

# 📊 보고서 생성
/gyoshu report

# 🔄 중단한 곳에서 계속
/gyoshu continue
```

---

## 📖 명령어

### 교수의 명령어 (`/gyoshu`)

| 명령어 | 기능 |
|--------|------|
| `/gyoshu` | 상태 확인 및 다음 할 일 표시 |
| `/gyoshu <목표>` | 대화형 연구 시작 |
| `/gyoshu-auto <목표>` | 자율 모드 (설정하고 잊어버리세요!) |
| `/gyoshu plan <목표>` | 계획만 생성, 실행하지 않음 |
| `/gyoshu continue` | 중단한 곳에서 계속 |
| `/gyoshu report` | 연구 보고서 생성 |
| `/gyoshu list` | 모든 연구 프로젝트 보기 |
| `/gyoshu search <쿼리>` | 모든 노트북에서 검색 |
| `/gyoshu doctor` | 시스템 상태 확인 및 문제 진단 |

### 연구 모드

| 모드 | 적합한 용도 | 명령어 |
|------|-------------|--------|
| 🎓 **대화형** | 학습, 탐색, 반복 | `/gyoshu <목표>` |
| 🤖 **자율** | 명확한 목표, 핸즈프리 실행 | `/gyoshu-auto <목표>` |
| 🔧 **REPL** | 빠른 탐색, 디버깅 | `/gyoshu repl <쿼리>` |

---

## 🔬 연구 작동 방식

### 1. 목표 설정
```
/gyoshu analyze wine quality factors and build a predictive model
```

### 2. 교수가 계획
Gyoshu가 명확한 목표와 가설이 포함된 구조화된 연구 계획을 생성합니다.

### 3. 조교가 실행
Jogyo가 구조화된 마커를 사용하여 Python 코드를 실행하고 출력을 정리합니다:

```python
print("[OBJECTIVE] Predict wine quality from physicochemical properties")
print("[HYPOTHESIS] Alcohol content is the strongest predictor")

# ... 분석 코드 ...

print(f"[METRIC:accuracy] {accuracy:.3f}")
print("[FINDING] Alcohol shows r=0.47 correlation with quality")
print("[CONCLUSION] Hypothesis supported - alcohol is key predictor")
```

### 4. 자동 생성 노트북
모든 것이 `notebooks/wine-quality.ipynb`에 완전한 재현성과 함께 기록됩니다.

### 5. AI가 작성하는 보고서
Paper Writer 에이전트가 마커를 서사적 보고서로 변환합니다:

> *"1,599개의 와인 샘플을 분석한 결과, 알코올 함량이 품질 등급의 주요 예측 변수로 나타났습니다 (r = 0.47). 최종 Random Forest 모델은 87%의 정확도를 달성했습니다..."*

---

## 📁 프로젝트 구조

```
your-project/
├── notebooks/                    # 📓 연구 노트북
│   ├── wine-quality.ipynb
│   └── customer-churn.ipynb
├── reports/                      # 📝 생성된 보고서
│   └── wine-quality/
│       ├── report.md             # AI가 작성한 서사적 보고서
│       ├── figures/              # 저장된 플롯
│       └── models/               # 저장된 모델
├── data/                         # 📊 데이터셋
└── .venv/                        # 🐍 Python 환경
```

**런타임 파일** (소켓, 락)은 프로젝트가 아닌 OS 임시 디렉토리에 저장됩니다! 🧹

### Gyoshu가 생성하는 것

연구를 실행하면 Gyoshu가 프로젝트에 다음 아티팩트를 생성합니다:

```
your-project/
├── notebooks/
│   └── your-research.ipynb    ← 연구 노트북 (진실의 원천)
├── reports/
│   └── your-research/
│       ├── figures/           ← 저장된 플롯 (.png, .svg)
│       ├── models/            ← 학습된 모델 (.pkl, .joblib)
│       └── report.md          ← 생성된 연구 보고서
└── (기존 파일은 건드리지 않습니다!)
```

> **참고:** Gyoshu는 `.venv/`, `data/` 또는 기타 기존 프로젝트 파일을 절대 수정하지 않습니다.

---

## 🎯 출력 마커

조교는 구조화된 마커를 사용하여 연구 출력을 정리합니다:

| 마커 | 용도 | 예시 |
|------|------|------|
| `[OBJECTIVE]` | 연구 목표 | `[OBJECTIVE] Classify iris species` |
| `[HYPOTHESIS]` | 테스트할 가설 | `[HYPOTHESIS] Petal length is most predictive` |
| `[DATA]` | 데이터셋 정보 | `[DATA] Loaded 150 samples` |
| `[METRIC:name]` | 정량적 결과 | `[METRIC:accuracy] 0.95` |
| `[FINDING]` | 핵심 발견 | `[FINDING] Setosa is linearly separable` |
| `[CONCLUSION]` | 최종 결론 | `[CONCLUSION] Hypothesis confirmed` |

---

## 🐍 Python 환경

Gyoshu는 프로젝트의 `.venv/` 가상 환경을 사용합니다:

| 우선순위 | 유형 | 감지 방법 |
|----------|------|-----------|
| 1️⃣ | 사용자 지정 | `GYOSHU_PYTHON_PATH` 환경 변수 |
| 2️⃣ | venv | `.venv/bin/python` 존재 확인 |

**빠른 설정:**
```bash
python3 -m venv .venv
.venv/bin/pip install pandas numpy scikit-learn matplotlib seaborn
```

> **참고:** Gyoshu는 프로젝트의 가상 환경을 사용합니다. 시스템 Python을 절대 수정하지 않습니다.

---

## 🛠️ 요구 사항

- **OpenCode** v0.1.0+
- **Python** 3.10+ 
- **선택 사항**: `psutil` (메모리 추적용)

### 지원 플랫폼

| 플랫폼 | 상태 | 비고 |
|--------|------|------|
| **Linux** | ✅ 기본 지원 | Ubuntu 22.04+에서 테스트됨 |
| **macOS** | ✅ 지원 | Intel & Apple Silicon |
| **Windows** | ⚠️ WSL2만 지원 | 네이티브 Windows 미지원 |

---

## 🔄 업데이트

### 옵션 1: 설치 스크립트 재실행

```bash
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/My-Jogyo/main/install.sh | bash
```

### 옵션 2: Pull 후 재설치 (클론한 경우)

```bash
cd My-Jogyo
git pull
./install.sh
```

### 업데이트 확인

```bash
opencode
/gyoshu doctor
```

각 릴리스의 새로운 기능은 [CHANGELOG.md](CHANGELOG.md)를 참조하세요.

---

## 🎓 왜 "교수(Gyoshu)"와 "조교(Jogyo)"인가요?

한국 학계에서:

- **교수 (敎授/Kyosu)** = Professor — 안내하고, 계획하고, 감독하는 사람
- **조교 (助敎/Jogyo)** = Teaching Assistant — 실행하고, 실험하고, 힘든 일을 하는 사람

> **로마자 표기에 대하여:** "Gyoshu"는 일본식 발음에 가까운 로마자 표기입니다. 한국어로는 "교수(Kyosu)"가 더 정확하지만, 프로젝트명으로서 "Gyoshu"를 채택했습니다.

이것은 아키텍처를 반영합니다: Gyoshu는 연구 흐름을 계획하고 관리하는 오케스트레이터 에이전트이고, Jogyo는 실제로 Python 코드를 실행하고 결과를 생성하는 실행자 에이전트입니다.

이것은 파트너십입니다. 교수는 비전을 가지고 있습니다. 조교가 그것을 실현합니다. 함께, 그들은 논문을 출판합니다. 📚

---

## 🤝 선택적 동반자: Oh-My-OpenCode

> **Gyoshu는 완전히 독립적으로 작동합니다.** 자체 에이전트 스택을 갖추고 있으며 oh-my-opencode와 같은 다른 OpenCode 확장을 필요로 하지 않습니다.

**데이터 기반 제품 개발 워크플로우**를 위해 선택적으로 Gyoshu와 [Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)를 함께 사용할 수 있습니다:

| 도구 | 집중 분야 | 독립적? |
|------|----------|---------|
| **Gyoshu (이 프로젝트)** | 📊 연구 & 분석 | ✅ 완전히 독립적 |
| **[Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)** | 🏗️ 제품 개발 | ✅ 완전히 독립적 |

### Gyoshu의 자체 에이전트 스택

Gyoshu는 연구에 필요한 모든 것을 포함합니다:

| 에이전트 | 역할 | 하는 일 |
|----------|------|---------|
| `@gyoshu` | 교수 | 연구 계획, 워크플로우 조율 |
| `@jogyo` | 조교 | Python 코드 실행, 실험 수행 |
| `@baksa` | 박사 심사위원 | 주장에 도전, 증거 검증 |
| `@jogyo-insight` | 증거 수집가 | 문서 검색, 예제 찾기 |
| `@jogyo-feedback` | 학습 탐색가 | 패턴을 위한 과거 세션 검토 |
| `@jogyo-paper-writer` | 보고서 작성자 | 발견을 서사적 보고서로 변환 |

### 선택적 워크플로우 (함께 사용할 때)

두 도구를 함께 사용하기로 선택한 경우:

1. Gyoshu로 **연구**:
   ```
   /gyoshu-auto analyze user behavior and identify churn predictors
   ```
   → 인사이트 생성: "7일 내에 기능 X를 사용하지 않는 사용자는 이탈률이 3배 높음"

2. Oh-My-OpenCode로 **구축**:
   ```
   /planner implement onboarding flow that guides users to feature X
   ```
   → 인사이트를 해결하는 기능 배포

**데이터가 결정을 알려줍니다. 코드가 솔루션을 배포합니다.** 🚀

> **참고:** Gyoshu를 사용하기 위해 Oh-My-OpenCode가 필요하지 않습니다. 각 도구는 독립적으로 작동합니다.

---

## 🔧 문제 해결

| 문제 | 해결 방법 |
|------|-----------|
| **".venv를 찾을 수 없음"** | 가상 환경 생성: `python3 -m venv .venv && .venv/bin/pip install pandas numpy` |
| **"브리지 시작 실패"** | Python 버전 확인 (3.10+ 필요): `python3 --version`. 소켓 경로 권한 확인. |
| **"세션 잠김"** | 실행 중인 프로세스가 없는지 확인 후 `/gyoshu unlock <sessionId>` 사용 |
| **OpenCode가 PATH에 없음** | [opencode-ai/opencode](https://github.com/opencode-ai/opencode)에서 설치 |

아직 문제가 있나요? `/gyoshu doctor`를 실행하여 문제를 진단하세요.

---

## 📄 라이선스

MIT — 사용하고, 포크하고, 교육에 활용하세요!

---

<div align="center">

**타이핑보다 생각하고 싶은 연구자를 위해 🎓 만들었습니다**

[버그 제보](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [기능 요청](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [문서](https://github.com/Yeachan-Heo/My-Jogyo/wiki)

</div>
