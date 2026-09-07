# -*- coding: utf-8 -*-
"""
【一次性迁移脚本】把 tools/source_generators/ 下三份 reportlab 出题脚本里的题目数据，
用 Python 的 ast（语法树）安全提取出来，写成 data/sets/day1.json … day6.json 和清单 data/sets.json。

之后题库以 data/sets/*.json + data/sets.json 为准，新套题直接手写 JSON。
默认不覆盖已存在的文件（避免把手工修订过的题库冲掉），加 --force 才覆盖。

用法：
    py -3.11 tools/convert_questions.py [--force]
"""
import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "source_generators"
OUT_DIR = ROOT / "data" / "sets"
MANIFEST = ROOT / "data" / "sets.json"

PART_TITLES = {
    5: "Part 5 | Incomplete Sentences 句子填空",
    6: "Part 6 | Text Completion 短文填空",
    7: "Part 7 | Reading Comprehension 阅读理解",
}
PART_MINUTES = {5: 10, 6: 7, 7: 10}


# ---------- 通用工具 ----------

def read_source(name):
    return (SRC / name).read_text(encoding="utf-8")


def literal_assignments(tree):
    """收集语法树里所有 `name = <字面量>` 的赋值（包括函数体内部）。"""
    out = {}
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            try:
                out[node.targets[0].id] = ast.literal_eval(node.value)
            except (ValueError, SyntaxError, TypeError):
                pass
    return out


def parse_answer_key(src):
    """Day1/Day2 的答案写在 drawString(72, key_y, "1 B  2 C ...") 里，用正则抓出来。"""
    lines = re.findall(r'c\.drawString\(72, key_y(?: - 12)?, "([^"]+)"\)', src)
    assert len(lines) == 2, f"expected 2 answer lines, got {len(lines)}"
    key = {}
    for line in lines:
        for num, letter in re.findall(r"(\d+) ([A-D])", line):
            key[int(num)] = letter
    assert sorted(key) == list(range(1, 25)), sorted(key)
    return key


def parse_phrases(src):
    m = re.search(r'c\.drawString\(44, 41, "([^"]+)"\)', src)
    assert m, "phrases line not found"
    return [p.strip() for p in m.group(1).split("|")]


def parse_passage_titles(src):
    """draw_passage_box(c, "标题", 变量名, ...) → {变量名: 标题}"""
    return {var: title for title, var in re.findall(r'draw_passage_box\(c, "([^"]+)", (\w+),', src)}


def explain_map(reviews):
    """
    把 "1 by + 时间点 = ...；6 within + ..." 这种按行写的解析，
    拆成 {题号: 解析文字}。"21-24 ..." 这种范围会分配给每一题。
    没有题号开头的片段，跟着前一个片段的题号走。
    """
    per_q = {}
    for line in reviews:
        frags = [f.strip() for f in re.split(r"[；;]", line) if f.strip()]
        last_nums = []
        for frag in frags:
            m = re.match(r"^(\d+)(?:-(\d+))?\s+(.*)$", frag)
            if m:
                a = int(m.group(1))
                b = int(m.group(2)) if m.group(2) else a
                nums = list(range(a, b + 1))
                text = m.group(3)
                last_nums = nums
            else:
                nums = last_nums
                text = frag
            for n in nums:
                per_q.setdefault(n, []).append(text)
    return {n: "；".join(v) for n, v in per_q.items()}


def make_question(set_id, part, n, stem, answer, options, explain):
    bonus = stem.startswith("BONUS")
    if part == 6 and "sentence" in stem.lower():
        kind = "sentence"
    elif part == 6:
        kind = "blank"
    else:
        kind = "question"
    return {
        "id": f"{set_id}-q{n}",
        "n": n,
        "part": part,
        "kind": kind,
        "bonus": bonus,
        "rev": 0,
        "stem": stem,
        "options": [{"key": k, "text": t} for k, t in options],
        "answer": answer,
        "explain": explain.get(n, ""),
    }


def build_set(set_id, day, focus, listening, phrases, reviews, source_pdf,
              p5, p6_passage, p6, p7a_passage, p7a, p7b_passages, p7b):
    """p5/p6/p7a/p7b 都是 [(n, stem, answer, options), ...]"""
    explain = explain_map(reviews)
    groups = [
        {
            "id": f"{set_id}-p5", "part": 5, "title": PART_TITLES[5],
            "minutes": PART_MINUTES[5], "passages": [],
            "questions": [make_question(set_id, 5, *q, explain) for q in p5],
        },
        {
            "id": f"{set_id}-p6", "part": 6, "title": PART_TITLES[6],
            "minutes": PART_MINUTES[6], "passages": [p6_passage],
            "questions": [make_question(set_id, 6, *q, explain) for q in p6],
        },
        {
            "id": f"{set_id}-p7a", "part": 7, "title": PART_TITLES[7],
            "minutes": 4, "passages": [p7a_passage],
            "questions": [make_question(set_id, 7, *q, explain) for q in p7a],
        },
        {
            "id": f"{set_id}-p7b", "part": 7, "title": PART_TITLES[7],
            "minutes": 6, "passages": p7b_passages,
            "questions": [make_question(set_id, 7, *q, explain) for q in p7b],
        },
    ]
    return {
        "id": set_id,
        "day": day,
        "title": f"Day {day}",
        "focus": focus,
        "listening": listening,
        "phrases": phrases,
        "reviews": reviews,
        "source_pdf": source_pdf,
        "recommended_minutes": sum(PART_MINUTES.values()),
        "note": "原创 TOEIC-style 仿真题，不是 ETS 官方真题。",
        "groups": groups,
    }


# ---------- Day 1 / Day 2（元组写法） ----------

def convert_day12(filename, day, source_pdf, part5_name, p7a_name, p7b_name):
    src = read_source(filename)
    tree = ast.parse(src)
    lit = literal_assignments(tree)
    key = parse_answer_key(src)
    titles = parse_passage_titles(src)

    def with_answer(items):
        return [(n, stem, key[n], opts) for n, stem, opts in items]

    p5 = with_answer(lit[part5_name])
    p6 = with_answer([lit[f"q{n}"] for n in (13, 14, 15, 16, 17)])
    p7a = with_answer(lit[p7a_name])
    p7b = with_answer(lit[p7b_name])

    p6_passage = {"title": titles["passage"], "text": lit["passage"]}
    p7a_passage = {"title": titles["email"], "text": lit["email"]}
    p7b_passages = [
        {"title": titles["notice"], "text": lit["notice"]},
        {"title": titles["message"], "text": lit["message"]},
    ]
    return build_set(
        f"day{day}", day, "", None, parse_phrases(src), lit["reviews"], source_pdf,
        p5, p6_passage, p6, p7a_passage, p7a, p7b_passages, p7b,
    )


# ---------- Day 3-6（SHEETS 字典写法） ----------

def convert_weekend(filename, source_pdf):
    src = read_source(filename)
    tree = ast.parse(src)
    sheets_node = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) \
                and node.targets[0].id == "SHEETS":
            sheets_node = node.value
    assert sheets_node is not None, "SHEETS not found"
    ns = {"q": lambda n, stem, answer, options: (n, stem, answer, options)}
    sheets = eval(compile(ast.Expression(sheets_node), filename, "eval"), ns)

    sets = []
    for sheet in sheets:
        day = sheet["day"]
        sets.append(build_set(
            f"day{day}", day, sheet["focus"], sheet["listening"],
            [p.strip() for p in sheet["phrases"].split("|")],
            sheet["reviews"], source_pdf,
            sheet["p5"],
            {"title": "Questions 13-17", "text": sheet["p6_text"]},
            sorted(sheet["p6"], key=lambda t: t[0]),
            {"title": sheet["p7a_title"], "text": sheet["p7a_text"]},
            sheet["p7a"],
            [
                {"title": "Questions 21-24: Notice", "text": sheet["p7b_left"]},
                {"title": "Questions 21-24: Message", "text": sheet["p7b_right"]},
            ],
            sheet["p7b"],
        ))
    return sets


# ---------- 校验 ----------

def validate(sets):
    seen_ids = set()
    for s in sets:
        qs = [q for g in s["groups"] for q in g["questions"]]
        nums = [q["n"] for q in qs]
        assert nums == list(range(1, 25)), (s["id"], nums)
        for q in qs:
            assert q["id"] not in seen_ids, q["id"]
            seen_ids.add(q["id"])
            keys = [o["key"] for o in q["options"]]
            assert keys == ["A", "B", "C", "D"], (q["id"], keys)
            assert q["answer"] in keys, (q["id"], q["answer"])
            assert all(o["text"] for o in q["options"]), q["id"]
        for g in s["groups"]:
            for p in g["passages"]:
                assert p["title"] and p["text"], (s["id"], g["id"])
        # Part 6 空格编号必须都出现在文章里
        p6 = s["groups"][1]
        for q in p6["questions"]:
            assert f"[{q['n']}]" in p6["passages"][0]["text"], (s["id"], q["n"])
    return len(seen_ids)


def main():
    force = "--force" in sys.argv
    sets = [
        convert_day12("generate_toeic_day1.py", 1, "TOEIC_720_Day1_双面练习_v3.pdf",
                      "part5", "p7a", "p7b"),
        convert_day12("generate_toeic_day2.py", 2, "TOEIC_720_Day2_双面练习_v1.pdf",
                      "PART5", "questions_a", "questions_b"),
    ]
    sets += convert_weekend("generate_toeic_weekend_pack.py", "TOEIC_720_周末4套练习_Day3-6_v2.pdf")
    total = validate(sets)
    missing_explain = [q["id"] for s in sets for g in s["groups"] for q in g["questions"] if not q["explain"]]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for s in sets:
        path = OUT_DIR / f"{s['id']}.json"
        if path.exists() and not force:
            print(f"SKIP  {path.relative_to(ROOT)} 已存在（加 --force 才覆盖）")
            continue
        path.write_text(json.dumps(s, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"WROTE {path.relative_to(ROOT)}")
    if not MANIFEST.exists() or force:
        MANIFEST.write_text(json.dumps({
            "schema_version": 1,
            "note": "sets 里的顺序就是首页展示顺序；新增套题：把 id 追加到这里，并在 data/sets/<id>.json 放题目。",
            "sets": [s["id"] for s in sets],
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"WROTE {MANIFEST.relative_to(ROOT)}")
    print(f"sets={len(sets)}  questions={total}")
    print(f"questions without per-question explanation: {len(missing_explain)}")
    if missing_explain:
        print("  " + ", ".join(missing_explain))


if __name__ == "__main__":
    sys.exit(main())
