# -*- coding: utf-8 -*-
"""探查全部候选数据集 schema（每个只加载1行）"""
import os, sys
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
from datasets import load_dataset

PROBES = [
    ("princeton-nlp/SWE-bench_Verified", None, "test"),
    ("ScaleAI/SWE-bench_Pro", None, "test"),
    ("cais/hle", "all", "test"),
    ("TIGER-Lab/MMLU-Pro", None, "test"),
    ("HuggingFaceH4/aime_2024", None, "train"),
    ("MathArena/aime_2025", None, "train"),
    ("MathArena/hmmt_feb_2025", None, "train"),
    ("hendrydong/gpqa_diamond", None, "train"),
    ("harborframework/terminal-bench", None, "test"),
    ("harborframework/terminal-bench-science", None, "test"),
    ("Leo-dm/AutomationBench", None, "train"),
    ("UpstageShareSpace/automationBench", None, "train"),
    ("openai/mrcr", None, "test"),
    ("openai/gdpval", None, "test"),
    ("shhu2001/SciCode-Verified", None, "test"),
    ("google/simpleqa-verified", None, "test"),
    ("ArtificialAnalysis/ITBench-AA", None, "test"),
    ("MMMU/MMMU_Pro", None, "test"),
    ("sunblaze-ucb/cybergym", None, "test"),
    ("luolc/deep-swe-1-1-materialized", None, "test"),
    ("yuanbopang/Frontier-code", None, "test"),
    ("CritPt-Benchmark/CritPt", None, "test"),
]

for repo, cfg, split in PROBES:
    print("=" * 78, flush=True)
    print(repo, flush=True)
    try:
        ds = load_dataset(repo, cfg, split=split) if cfg else load_dataset(repo, split=split)
        print(" rows:", len(ds), "| cols:", ds.column_names, flush=True)
        r = ds[0]
        for k, v in r.items():
            s = str(v).replace("\n", "\\n")
            print(f"  {k}: {type(v).__name__} = {s[:200]}", flush=True)
    except Exception as e:
        print(" FAIL:", type(e).__name__, str(e)[:180], flush=True)
