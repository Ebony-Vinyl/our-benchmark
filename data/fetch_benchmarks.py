# -*- coding: utf-8 -*-
"""
Our Benchmark 题库抓取器 v2
目标套件（用户指定 + AA 指数体系公开替代）：
  swe-verified, swe-pro, hle, mmlu-pro, aime, hmmt, gpqa, terminal-bench,
  automationbench, mrcr, gdpval, scicode, simpleqa, itbench, mmmu-pro,
  cybergym, deepswe, frontiercode, critpt
输出:
  data/benchmarks-full/<id>.json  完整（服务器分发用）
  benchmarks/<id>.json            打包子集（桌面端内置，确定性采样 ≤ BUNDLE_CAP）
"""
import json
import os
import random
import re
import sys
import urllib.request

OUT_FULL = os.path.join(os.path.dirname(__file__), "benchmarks-full")
OUT_BUNDLED = os.path.join(os.path.dirname(__file__), "..", "benchmarks")
BUNDLE_CAP = 300
random.seed(20261023)
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from datasets import load_dataset  # noqa: E402

MIRROR = "https://hf-mirror.com"


def clip(s, n):
    s = str(s or "").strip()
    return s if len(s) <= n else s[:n] + "\n…(截断)"


def qid(suite, i):
    return f"{suite}-{i:05d}"


def dump_suite(meta, questions, bundle_cap=BUNDLE_CAP):
    os.makedirs(OUT_FULL, exist_ok=True)
    os.makedirs(OUT_BUNDLED, exist_ok=True)
    json.dump({**meta, "fullSize": len(questions), "sampled": False, "questions": questions},
              open(os.path.join(OUT_FULL, meta["id"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
    if len(questions) > bundle_cap:
        bundled = sorted(random.sample(questions, bundle_cap), key=lambda q: q["id"])
        meta_b = {**meta, "fullSize": len(questions), "sampled": True, "sampleSize": bundle_cap}
        json.dump({**meta_b, "questions": bundled},
                  open(os.path.join(OUT_BUNDLED, meta["id"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
    else:
        json.dump({**meta, "fullSize": len(questions), "sampled": False, "questions": questions},
                  open(os.path.join(OUT_BUNDLED, meta["id"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  [ok] {meta['id']}: {len(questions)} 题", flush=True)


# ================================================================ SWE-bench Verified
def fetch_swe_verified():
    ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
    qs = []
    for i, r in enumerate(ds):
        prompt = (f"开源项目 {r['repo']} 的一个真实 GitHub Issue 需要你修复。\n\n"
                  f"【Issue #{r['instance_id'].split('-')[-1]}】\n{clip(r['problem_statement'], 8000)}")
        qs.append({"id": r["instance_id"], "type": "patch", "prompt": prompt,
                   "goldPatch": clip(r["patch"], 6000), "repo": r["repo"],
                   "meta": {"difficulty": r.get("difficulty", "")}})
    dump_suite({"id": "swe-verified", "name": "SWE-bench Verified", "nameZh": "真实开源项目修复（已验证集）",
                "category": "code",
                "description": "AI 作为程序员处理真实开源项目：读 Issue、改代码、过单元测试。桌面版以补丁相似度近似判分。",
                "source": "princeton-nlp/SWE-bench_Verified", "license": "MIT"}, qs)


# ================================================================ SWE-bench Pro
def fetch_swe_pro():
    total = 0
    qs = []
    ds = load_dataset("ScaleAI/SWE-bench_Pro", split="test")
    for r in ds:
        prompt = (f"开源项目 {r['repo']}（{r.get('repo_language','')}）的真实工单，需要跨多文件的工程级修复。\n\n"
                  f"【问题】\n{clip(r['problem_statement'], 6000)}\n\n【要求】\n{clip(r.get('requirements',''), 2000)}\n\n"
                  f"【接口约定】\n{clip(r.get('interface',''), 2000)}")
        qs.append({"id": r["instance_id"][:80], "type": "patch", "prompt": prompt,
                   "goldPatch": clip(r["patch"], 6000), "repo": r["repo"],
                   "meta": {"hard": bool(r.get("hard"))}})
        total += 1
    dump_suite({"id": "swe-pro", "name": "SWE-bench Pro", "nameZh": "高难度软件工程实操",
                "category": "code",
                "description": "真实项目工单，补丁平均改动 100+ 行、跨多文件。桌面版以补丁相似度近似判分。",
                "source": "ScaleAI/SWE-bench_Pro", "license": "Apache-2.0"}, qs)


# ================================================================ HLE（纯文本公开镜像）
def fetch_hle():
    ds = load_dataset("macabdul9/hle_text_only", split="test")
    qs = []
    L = "ABCDEFGHIJ"
    for i, r in enumerate(ds):
        q = clip(r.get("question") or r.get("prompt"), 6000)
        ans = str(r.get("answer") or r.get("gold") or "").strip()
        opts = r.get("choices") or r.get("options")
        if isinstance(opts, str):
            try:
                import ast
                opts = ast.literal_eval(opts)
            except Exception:
                opts = None
        # 1) 数据集自带选项数组 + 字母答案
        if opts and len(opts) >= 2 and len(ans) <= 3 and ans.upper() in L[:len(opts)]:
            qs.append({"id": qid("hle", i), "type": "choice", "prompt": q, "choices": opts, "answer": ans.upper()})
            continue
        # 2) 题面内嵌 "Answer Choices:\nA. …\nB. …" 且答案为单个字母
        if len(ans) == 1 and ans.upper() in L and "Answer Choices" in q:
            letters = re.findall(r"^([A-J])[\.\、\)]\s", q, flags=re.M)
            if letters:
                order = [c for c in L if c in letters]
                qs.append({"id": qid("hle", i), "type": "choice", "prompt": q, "choices": [], "answer": ans.upper(), "inlineChoices": len(order)})
                continue
        # 3) 其余按简答 exact
        qs.append({"id": qid("hle", i), "type": "exact", "prompt": q + "\n\n请直接给出简洁准确的最终答案。", "answer": clip(ans, 200)})
    dump_suite({"id": "hle", "name": "Humanity's Last Exam", "nameZh": "人类最后一卷", "category": "general",
                "description": "数学/科学/人文专家难题 2500+，要求可核验答案、拒绝空话套话（文本子集）。",
                "source": "macabdul9/hle_text_only (HLE 公开镜像)", "license": "CC BY-NC-SA 4.0"}, qs)


# ================================================================ MMLU-Pro
def fetch_mmlu_pro():
    ds = load_dataset("TIGER-Lab/MMLU-Pro", split="test")
    L = "ABCDEFGHIJ"
    qs = []
    for i, r in enumerate(ds):
        opts = [o for o in r["options"] if o and str(o).strip() != "N/A"]
        ai = r["answer_index"]
        if ai >= len(opts):
            continue
        qs.append({"id": qid("mmlu-pro", i), "type": "choice", "prompt": clip(r["question"], 3000),
                   "choices": opts, "answer": L[ai], "subject": r.get("category", "")})
    dump_suite({"id": "mmlu-pro", "name": "MMLU-Pro", "nameZh": "研究生水平综合学科", "category": "general",
                "description": "10 选项、重推理的 MMLU 升级版，思维链可显著提升得分。",
                "source": "TIGER-Lab/MMLU-Pro", "license": "CC BY-NC-SA 4.0"}, qs)


# ================================================================ AIME（2024+2025）
def fetch_aime():
    qs = []
    for repo, split in [("HuggingFaceH4/aime_2024", "train"), ("MathArena/aime_2025", "train")]:
        ds = load_dataset(repo, split=split)
        for r in ds:
            qs.append({"id": qid("aime", len(qs)), "type": "numeric", "prompt": clip(r["problem"], 3000),
                       "answer": str(r["answer"]), "tolerance": 0.0, "year": str(r.get("year", ""))})
    dump_suite({"id": "aime", "name": "AIME 2024/2025", "nameZh": "高中数学奥赛", "category": "science",
                "description": "奥赛级数学，单题 5-10 步推理，答案为 0-999 整数。",
                "source": "HuggingFaceH4/aime_2024 + MathArena/aime_2025", "license": "MIT / CC"}, qs)


# ================================================================ HMMT（多届合并）
def fetch_hmmt():
    qs = []
    for repo in ["MathArena/hmmt_feb_2024", "MathArena/hmmt_feb_2025", "MathArena/hmmt_nov_2025"]:
        try:
            ds = load_dataset(repo, split="train")
        except Exception as e:
            print(f"    - {repo} 跳过: {str(e)[:80]}", flush=True)
            continue
        for r in ds:
            ans = str(r["answer"]).strip()
            try:
                float(ans.replace(",", ""))
                q = {"id": qid("hmmt", len(qs)), "type": "numeric", "prompt": clip(r["problem"], 3000),
                     "answer": ans, "tolerance": 0.0}
            except ValueError:
                q = {"id": qid("hmmt", len(qs)), "type": "math_boxed", "prompt": clip(r["problem"], 3000),
                     "answer": ans}
            q["meet"] = repo.split("hmmt_")[-1]
            qs.append(q)
    dump_suite({"id": "hmmt", "name": "HMMT 2024-2025", "nameZh": "哈佛-MIT 数学竞赛", "category": "science",
                "description": "难度高于 AIME 的数学竞赛测试（Feb/Nov 多届合并）。",
                "source": "MathArena/hmmt_*", "license": "CC"}, qs)


# ================================================================ GPQA Diamond（完整原版镜像：含选项）
def fetch_gpqa():
    ds = load_dataset("JingzeShi/gpqa_diamond", split="test")
    qs = []
    L = "ABCD"
    for i, r in enumerate(ds):
        q = (r.get("Question") or "").strip()
        gold = (r.get("Correct Answer") or "").strip()
        wrongs = [str(r.get(k) or "").strip() for k in ["Incorrect Answer 1", "Incorrect Answer 2", "Incorrect Answer 3"]]
        if not q or not gold or len([w for w in wrongs if w]) < 3:
            continue
        opts = [gold] + wrongs
        idx = list(range(4))
        random.Random(1000 + i).shuffle(idx)  # 固定乱序（可复现）
        choices = [opts[j] for j in idx]
        qs.append({"id": qid("gpqa", i), "type": "choice", "prompt": clip(q, 4000),
                   "choices": [clip(c, 800) for c in choices], "answer": L[idx.index(0)],
                   "domain": r.get("High-level domain", "")})
    dump_suite({"id": "gpqa", "name": "GPQA Diamond", "nameZh": "博士级科学考题", "category": "science",
                "description": "生物/物理/化学博士级四选一，题目设计规避网络检索，闭卷考察专业推理（198 题完整集）。",
                "source": "JingzeShi/gpqa_diamond (GPQA 原版镜像)", "license": "CC BY-NC-SA 4.0 (原版)"}, qs)


# ================================================================ Terminal-Bench 2.0（原始任务目录直抓）
def fetch_terminal_bench():
    repo = "harborframework/terminal-bench-2.0"
    info = json.load(urllib.request.urlopen(f"{MIRROR}/api/datasets/{repo}", timeout=30))
    files = [s["rfilename"] for s in info.get("siblings", [])]
    tasks = sorted(set(f.split("/")[0] for f in files if "/" in f and not f.split("/")[0].startswith(".")))
    qs = []
    for t in tasks:
        try:
            inst = urllib.request.urlopen(f"{MIRROR}/datasets/{repo}/resolve/main/{t}/instruction.md", timeout=30).read().decode("utf-8")
        except Exception:
            continue
        sol = ""
        try:
            sol = urllib.request.urlopen(f"{MIRROR}/datasets/{repo}/resolve/main/{t}/solution/solve.sh", timeout=30).read().decode("utf-8")
        except Exception:
            pass
        if not inst.strip() or not sol.strip():
            continue
        sol = "\n".join(ln for ln in sol.split("\n") if "CANARY" not in ln and "BENCHMARK DATA" not in ln and "canary GUID" not in ln).strip()
        qs.append({"id": f"tb-{t[:60]}", "type": "patch",
                   "prompt": "在真实 Linux 终端环境中完成以下工程任务，请给出完成该任务的 shell 命令/脚本：\n\n" + clip(inst, 5000),
                   "goldPatch": clip(sol, 5000), "threshold": 0.30})
    dump_suite({"id": "terminal-bench", "name": "Terminal-Bench 2.0", "nameZh": "真实终端工程任务", "category": "code",
                "description": "编译内核、配 TLS、调试并发 bug 等真实命令行实操。桌面版以方案脚本相似度近似判分。",
                "source": "harborframework/terminal-bench-2.0", "license": "MIT"}, qs)


# ================================================================ AutomationBench（Upstage 公开镜像 600 题）
def fetch_automationbench():
    ds = load_dataset("UpstageShareSpace/automationBench", split="train")
    qs = []
    for i, r in enumerate(ds):
        msgs = r.get("prompt") or []
        user_texts = [m.get("content", "") for m in msgs if isinstance(m, dict) and m.get("role") == "user"]
        tools = []
        assertions = []
        try:
            info = json.loads(r.get("info") or "{}")
            tools = info.get("zapier_tools") or []
            assertions = info.get("assertions") or []
        except Exception:
            pass
        if not user_texts:
            continue
        prompt = "你是一个办公自动化智能体，可调用以下工具：\n" + ", ".join(tools[:18]) + "\n\n任务：" + clip(user_texts[0], 3000)
        # 从断言中提取必须命中的关键值（写入电子表格的单元格值等）
        required = []
        def walk(x):
            if isinstance(x, dict):
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
            elif isinstance(x, str) and 3 <= len(x) <= 40 and not x.startswith(("ss_", "ws_", "msg_", "th_")):
                required.append(x)
        for a in assertions:
            if a.get("type") in ("google_sheets_row_exists", "google_sheets_cell_equals", "gmail_send_email", "google_drive_upload"):
                walk(a.get("cell_contains", a.get("value", a)))
        # 去重保序，最多 8 个
        seen, uniq = set(), []
        for v in required:
            if v not in seen and v not in tools:
                seen.add(v)
                uniq.append(v)
        uniq = uniq[:8]
        if len(uniq) < 2:
            continue
        qs.append({"id": qid("automationbench", i), "type": "keyset", "prompt": prompt + "\n\n请列出你将执行的操作序列（每行一条 工具(参数)），并明确写出要写入/发送的具体数据值。",
                   "required": uniq, "threshold": 0.75, "taskName": json.loads(r.get("info") or "{}").get("task_name", "")})
    dump_suite({"id": "automationbench", "name": "AutomationBench", "nameZh": "办公自动化工作流", "category": "agent",
                "description": "跨软件完成整套业务流程：查客户、更新 CRM、安排跟进等（Upstage 公开镜像 600 题）。按关键值命中率判分。",
                "source": "UpstageShareSpace/automationBench", "license": "Apache-2.0 (镜像)"}, qs)


# ================================================================ MRCR（长上下文检索，流式取样）
def fetch_mrcr():
    # 真实字段：prompt = 消息列表的字符串（含超长多轮上下文），answer = 要检索的 needle
    qs = []
    n = 0
    try:
        ds = load_dataset("openai/mrcr", split="train", streaming=True)
        for r in ds:
            if n >= 100:
                break
            raw_prompt = r.get("prompt") or ""
            try:
                msgs = json.loads(raw_prompt)
                text = "\n".join(m.get("content", "") for m in msgs if isinstance(m, dict))
            except Exception:
                text = str(raw_prompt)
            ans = r.get("answer") or ""
            if not text.strip() or not str(ans).strip():
                continue
            # 上下文截断 ~40K 字符（保留尾部：follow-up 问题通常在末尾）
            head = text[:8000]
            tail = text[-32000:]
            prompt = (head + "\n…（中段省略）…\n" + tail if len(text) > 40000 else text) + "\n\n【任务】请从上面对话中检索出目标内容，只输出目标内容本身。"
            qs.append({"id": qid("mrcr", n), "type": "exact", "prompt": prompt,
                       "answer": clip(str(ans), 300), "nNeedles": r.get("n_needles"), "origChars": r.get("n_chars")})
            n += 1
    except Exception as e:
        print(f"  [warn] mrcr 流式失败: {str(e)[:150]}", flush=True)
        return
    if not qs:
        print("  [skip] mrcr: 无有效行", flush=True)
        return
    dump_suite({"id": "mrcr", "name": "MRCR", "nameZh": "长上下文精准检索", "category": "long_context",
                "description": "多版本文档中定位指定版本内容，测试长文本信息定位（上下文截断到 ~40K 字符的桌面可跑版）。",
                "source": "openai/mrcr", "license": "MIT"}, qs)


# ================================================================ GDPval（rubric 关键值判分）
def fetch_gdpval():
    ds = load_dataset("openai/gdpval", split="train")
    qs = []
    for i, r in enumerate(ds):
        rubric = str(r.get("rubric_json") or "")
        vals = re.findall(r"[\w\-]+\.(?:xlsx|xls|csv|json|pdf|docx|txt)", rubric)
        vals += [m.strip("'\"") for m in re.findall(r"'([^']{4,38})'", rubric)]
        vals += re.findall(r"\b\d[\d,.]*\s?(?:%|USD|EUR|dollars|euros|days|hours)\b", rubric, flags=re.I)
        seen, uniq = set(), []
        for v in vals:
            vl = v.lower()
            if vl not in seen and not vl.startswith(("the ", "a ", "all ")):
                seen.add(vl)
                uniq.append(v)
        uniq = uniq[:6]
        if len(uniq) < 2:
            continue
        qs.append({"id": qid("gdpval", i), "type": "keyset",
                   "prompt": clip(r.get("prompt"), 6000) + "\n\n请给出完成该任务的关键产出说明（涉及的文件名、数值结果等具体信息）。",
                   "required": uniq, "threshold": 0.5,
                   "occupation": r.get("occupation", ""), "sector": r.get("sector", "")})
    dump_suite({"id": "gdpval", "name": "GDPval", "nameZh": "真实职业场景任务", "category": "agent",
                "description": "OpenAI 真实职业场景智能体任务（审计/金融/生物等专家任务）。按 rubric 关键值命中率近似判分。",
                "source": "openai/gdpval", "license": "MIT"}, qs)


# ================================================================ SciCode（真实可执行：Python 沙箱跑测试）
def fetch_scicode():
    ds = load_dataset("shhu2001/SciCode-Verified", split="test")
    qs = []
    for r in ds:
        desc = r.get("problem_description_main") or ""
        if not desc.strip():
            continue
        bg = r.get("problem_background_main") or ""
        io = r.get("problem_io") or ""
        deps = r.get("required_dependencies") or ""
        steps = []
        for st in r.get("sub_steps") or []:
            if isinstance(st, dict) and st.get("step_description_prompt"):
                steps.append(f"步骤 {st.get('step_number', '')}: {clip(st['step_description_prompt'], 800)}")
        tests = r.get("general_tests") or []
        if not tests:
            continue
        test_code = (deps + "\n" if deps else "") + "\n".join(str(t) for t in tests)
        qs.append({"id": f"scicode-{r.get('problem_name', len(qs))}"[:60], "type": "code_py",
                   "prompt": clip(f"{desc}\n\n{bg}\n\n【输入输出】{io}\n\n{chr(10).join(steps)}", 6000) +
                     "\n\n请给出完整的 Python 实现（包含所有步骤要求的函数）。",
                   "testCode": clip(test_code, 8000), "entryPoint": None,
                   "dependencies": deps})
    dump_suite({"id": "scicode", "name": "SciCode", "nameZh": "科学代码生成", "category": "code",
                "description": "科学计算代码生成（数值方法/物理仿真），沙箱执行官方测试用例真实判分 (pass@1)。",
                "source": "shhu2001/SciCode-Verified", "license": "CC BY-NC (原版)"}, qs)


# ================================================================ SimpleQA（AA-Omniscience 替代）
def fetch_simpleqa():
    ds = load_dataset("google/simpleqa-verified", split="eval")
    print("    cols:", ds.column_names, flush=True)
    qs = []
    for i, r in enumerate(ds):
        qs.append({"id": qid("simpleqa", i), "type": "exact",
                   "prompt": str(r.get("problem") or r.get("question") or "")[:2000],
                   "answer": clip(str(r.get("answer") or ""), 200)})
    dump_suite({"id": "simpleqa", "name": "AA-Omniscience (SimpleQA)", "nameZh": "事实知识记忆与幻觉率", "category": "general",
                "description": "AA-Omniscience 的公开等价物：SimpleQA Verified，考察事实记忆与幻觉率。",
                "source": "google/simpleqa-verified", "license": "CC BY 4.0"}, qs)


# ================================================================ ITBench-AA（AA 官方公开镜像！）
def fetch_itbench():
    ds = load_dataset("ArtificialAnalysis/ITBench-AA", split="test")
    print("    cols:", ds.column_names, flush=True)
    qs = []
    for i, r in enumerate(ds):
        qs.append({"id": qid("itbench", i), "type": "exact",
                   "prompt": clip(r.get("problem") or r.get("question") or r.get("prompt") or r.get("task"), 6000),
                   "answer": clip(str(r.get("answer") or r.get("solution") or ""), 500)})
    dump_suite({"id": "itbench", "name": "ITBench-AA", "nameZh": "K8s 故障根因分析", "category": "cyber",
                "description": "Kubernetes 故障根因分析（ArtificialAnalysis 官方公开镜像）。",
                "source": "ArtificialAnalysis/ITBench-AA", "license": "Apache-2.0"}, qs)


# ================================================================ MMMU-Pro（多模态，文本可用子集）
def fetch_mmmu_pro():
    from datasets import get_dataset_config_names
    configs = get_dataset_config_names("MMMU/MMMU_Pro")
    configs = [c for c in configs if c not in ("default",)]
    print("    configs:", configs[:12], flush=True)
    L = "ABCDEFGHIJ"
    qs = []
    for cfg in configs:
        try:
            ds = load_dataset("MMMU/MMMU_Pro", cfg, split="test")
        except Exception as e:
            print(f"    - mmmu-pro/{cfg} 跳过: {str(e)[:70]}", flush=True)
            continue
        for r in ds:
            opts = r.get("options")
            if isinstance(opts, str):
                import ast
                try:
                    opts = ast.literal_eval(opts)
                except Exception:
                    opts = None
            if not opts:
                continue
            ai = r.get("answer_index")
            ans = r.get("answer")
            letter = None
            if isinstance(ai, int) and ai < len(opts):
                letter = L[ai]
            elif str(ans).upper() in L[:len(opts)]:
                letter = str(ans).upper()
            if not letter:
                continue
            qs.append({"id": qid("mmmu-pro", len(qs)), "type": "choice",
                       "prompt": clip(r.get("question") or r.get("prompt"), 3000) + "\n(注：原题含配图，纯文本模型按文字信息作答)",
                       "choices": [clip(o, 600) for o in opts], "answer": letter})
    dump_suite({"id": "mmmu-pro", "name": "MMMU-Pro", "nameZh": "多模态视觉推理（文本版）", "category": "general",
                "description": "大学水平多模态推理（AA 独立评测）。本套为文本可用子集，配图题已尽力降级。",
                "source": "MMMU/MMMU_Pro", "license": "CC BY-NC-ND 4.0"}, qs)


# ================================================================ CyberGym（纯容器执行型，无文本金标，不收录）
def fetch_cybergym():
    print("  [skip] cybergym: 纯容器执行型基准（tar 仓库 + 利用验证），无文本可判分数据", flush=True)
    return


# ================================================================ DeepSWE v1.1
def fetch_deepswe():
    ds = load_dataset("luolc/deep-swe-1-1-materialized", split="train")
    qs = []
    for i, r in enumerate(ds):
        inst = r.get("instruction") or ""
        gold = r.get("solution_patch") or ""
        if not inst.strip() or not gold.strip():
            continue
        qs.append({"id": f"deepswe-{r.get('task_id', i)}"[:70], "type": "patch",
                   "prompt": f"开源项目 {r.get('repository_url', '')} 的工程任务（{r.get('language', '')}）：\n\n" + clip(inst, 6000),
                   "goldPatch": clip(gold, 6000), "taskCategory": r.get("category", "")})
    dump_suite({"id": "deepswe", "name": "DeepSWE v1.1", "nameZh": "深度软件工程智能体", "category": "code",
                "description": "DataCurve DeepSWE v1.1 公开物化版（Coding Agent Index 成员）。补丁相似度近似判分。",
                "source": "luolc/deep-swe-1-1-materialized", "license": "CC BY-NC (原版)"}, qs)


# ================================================================ FrontierCode
def fetch_frontiercode():
    try:
        ds = load_dataset("yuanbopang/Frontier-code", split="test")
    except Exception as e:
        print(f"  [skip] frontiercode: {str(e)[:120]}", flush=True)
        return
    print("    cols:", ds.column_names, flush=True)
    qs = []
    for i, r in enumerate(ds):
        qs.append({"id": qid("frontiercode", i), "type": "patch",
                   "prompt": clip(r.get("problem_statement") or r.get("problem") or r.get("prompt"), 6000),
                   "goldPatch": clip(r.get("patch") or r.get("solution") or r.get("answer"), 6000)})
    dump_suite({"id": "frontiercode", "name": "FrontierCode 1.1", "nameZh": "前沿软件工程", "category": "code",
                "description": "开源仓库真实软件工程（社区镜像，可信度中等）。",
                "source": "yuanbopang/Frontier-code", "license": "未知(研究用)"}, qs)


# ================================================================ CritPt（物理科学推理：代码作答）
def fetch_critpt():
    ds = load_dataset("CritPt-Benchmark/CritPt", split="train")
    qs = []
    for r in ds:
        desc = (r.get("problem_description") or "").strip()
        tpl = (r.get("code_template") or "").strip()
        gold = (r.get("answer_code") or "").strip()
        if not desc or not gold:
            continue
        qs.append({"id": str(r.get("problem_id") or qid("critpt", len(qs))), "type": "patch",
                   "prompt": desc + "\n\n【代码模板】\n```python\n" + clip(tpl, 2000) + "\n```\n请给出完整的 answer() 函数实现（Python）。",
                   "goldPatch": clip(gold, 5000), "threshold": 0.35})
    dump_suite({"id": "critpt", "name": "CritPt", "nameZh": "物理科学推理", "category": "science",
                "description": "物理科学推理（AA Intelligence Index 成员的官方公开版），以 Python 代码作答、按金标代码相似度判分。",
                "source": "CritPt-Benchmark/CritPt", "license": "CC BY-NC 4.0"}, qs)


ALL = {
    "swe-verified": fetch_swe_verified,
    "swe-pro": fetch_swe_pro,
    "hle": fetch_hle,
    "mmlu-pro": fetch_mmlu_pro,
    "aime": fetch_aime,
    "hmmt": fetch_hmmt,
    "gpqa": fetch_gpqa,
    "terminal-bench": fetch_terminal_bench,
    "automationbench": fetch_automationbench,
    "mrcr": fetch_mrcr,
    "gdpval": fetch_gdpval,
    "scicode": fetch_scicode,
    "simpleqa": fetch_simpleqa,
    "itbench": fetch_itbench,
    "mmmu-pro": fetch_mmmu_pro,
    "cybergym": fetch_cybergym,
    "deepswe": fetch_deepswe,
    "frontiercode": fetch_frontiercode,
    "critpt": fetch_critpt,
}

if __name__ == "__main__":
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].split(",")
    for name, fn in ALL.items():
        if only and name not in only:
            continue
        print(f">>> 抓取 {name} ...", flush=True)
        try:
            fn()
        except Exception as e:
            import traceback
            print(f"  [FAIL] {name}: {type(e).__name__}: {str(e)[:220]}", flush=True)
            traceback.print_exc(limit=1)
    print("\n抓取结束。", flush=True)
