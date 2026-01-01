---
name: experiment-design
description: Best practices for designing reproducible experiments
---

# Experiment Design Patterns

## When to Use
Load this skill when designing experiments that need to be reproducible and statistically valid.

## Reproducibility Setup

### Random Seeds
```python
import random
import numpy as np

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

print(f"[DECISION] Using random seed: {SEED}")
```

### Environment Recording
```python
import sys
print(f"[INFO] Python: {sys.version}")
print(f"[INFO] NumPy: {np.__version__}")
print(f"[INFO] Pandas: {pd.__version__}")
```

## Experimental Controls

### Train/Test Split
```python
from sklearn.model_selection import train_test_split

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=SEED, stratify=y
)
print(f"[EXPERIMENT] Train: {len(X_train)}, Test: {len(X_test)}")
```

### Cross-Validation
```python
from sklearn.model_selection import cross_val_score

scores = cross_val_score(model, X, y, cv=5, scoring='accuracy')
print(f"[METRIC] CV Accuracy: {scores.mean():.3f} (+/- {scores.std()*2:.3f})")
```

## A/B Testing Pattern
```python
print("[EXPERIMENT] A/B Test Design")
print(f"[INFO] Control group: {len(control)}")
print(f"[INFO] Treatment group: {len(treatment)}")

# Power analysis
from statsmodels.stats.power import TTestIndPower
power = TTestIndPower()
sample_size = power.solve_power(effect_size=0.5, alpha=0.05, power=0.8)
print(f"[CALC] Required sample size per group: {sample_size:.0f}")
```

## Documentation Pattern
```python
print("[DECISION] Chose Random Forest over XGBoost because:")
print("  - Better interpretability for stakeholders")
print("  - Comparable performance (within 1% accuracy)")
print("  - Faster training time for iteration")

print("[LIMITATION] Model may not generalize to:")
print("  - Data from different time periods")
print("  - Users from different demographics")
```
