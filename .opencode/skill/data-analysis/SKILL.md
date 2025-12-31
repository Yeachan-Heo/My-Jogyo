---
name: data-analysis
description: Patterns for data loading, exploration, and statistical analysis
---

# Data Analysis Patterns

## When to Use
Load this skill when working with datasets that require exploration, cleaning, and statistical analysis.

## Data Loading
```python
print("[DATA] Loading dataset")
df = pd.read_csv("data.csv")
print(f"[SHAPE] {df.shape[0]} rows, {df.shape[1]} columns")
print(f"[DTYPE] {dict(df.dtypes)}")
print(f"[MISSING] {df.isnull().sum().to_dict()}")
```

## Exploratory Data Analysis (EDA)

### Descriptive Statistics
```python
print("[STAT] Descriptive statistics:")
print(df.describe())

print(f"[RANGE] {col}: {df[col].min()} to {df[col].max()}")
```

### Distribution Analysis
```python
print("[ANALYSIS] Checking distribution normality")
from scipy import stats
stat, p_value = stats.shapiro(df[col])
print(f"[STAT] Shapiro-Wilk p-value: {p_value:.4f}")
```

### Correlation Analysis
```python
print("[CORR] Correlation matrix:")
print(df.corr())
```

## Statistical Tests

### T-Test
```python
from scipy.stats import ttest_ind
stat, p = ttest_ind(group1, group2)
print(f"[STAT] T-test: t={stat:.3f}, p={p:.4f}")
```

### ANOVA
```python
from scipy.stats import f_oneway
stat, p = f_oneway(group1, group2, group3)
print(f"[STAT] ANOVA: F={stat:.3f}, p={p:.4f}")
```

## Memory Management
```python
print(f"[MEMORY] DataFrame size: {df.memory_usage(deep=True).sum() / 1024**2:.2f} MB")
# Clean up
del large_df
import gc; gc.collect()
```
