from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(r"C:\Users\jhr59\Documents\Codex\2026-08-12\wo-x")
OUT = ROOT / "outputs" / "TOEIC_720_Day1_双面练习_v3.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
pdfmetrics.registerFont(TTFont("YaHei", FONT_REGULAR))
pdfmetrics.registerFont(TTFont("YaHei-Bold", FONT_BOLD))

PAGE_W, PAGE_H = A4
INK = HexColor("#17212B")
MUTED = HexColor("#586572")
TEAL = HexColor("#147D78")
PALE = HexColor("#EAF5F3")
LINE = HexColor("#C9D5D7")
LIGHT = HexColor("#F5F7F8")


def wrap_text(text, font, size, width):
    words = text.split()
    if not words:
        return [""]
    lines = []
    current = words[0]
    for word in words[1:]:
        candidate = current + " " + word
        if pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def wrap_mixed(text, font, size, width):
    if " " in text:
        return wrap_text(text, font, size, width)
    lines, current = [], ""
    for ch in text:
        candidate = current + ch
        if not current or pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines


def draw_wrapped(c, text, x, y, width, font="YaHei", size=8.4, leading=11, color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    lines = wrap_mixed(text, font, size, width)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_header(c, page_no, subtitle):
    c.setFillColor(TEAL)
    c.rect(0, PAGE_H - 46, PAGE_W, 46, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("YaHei-Bold", 15)
    c.drawString(30, PAGE_H - 29, "TOEIC 720 稳过计划 | Day 1")
    c.setFont("YaHei", 8.5)
    c.drawRightString(PAGE_W - 30, PAGE_H - 27, subtitle)
    c.setFillColor(MUTED)
    c.setFont("YaHei", 7.4)
    c.drawRightString(PAGE_W - 30, 18, f"Day 1 | {page_no}/2 | 原创 TOEIC-style 练习")


def section_bar(c, y, title, timing):
    c.setFillColor(PALE)
    c.roundRect(30, y - 15, PAGE_W - 60, 18, 4, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 9.5)
    c.drawString(38, y - 10, title)
    c.setFont("YaHei", 7.5)
    c.drawRightString(PAGE_W - 38, y - 10, timing)
    return y - 25


def draw_question(c, number, stem, options, x, y, width, size=8.2):
    c.setFont("YaHei-Bold", size)
    c.setFillColor(INK)
    c.drawString(x, y, f"{number}.")
    y = draw_wrapped(c, stem, x + 16, y, width - 16, size=size, leading=10.5)
    y -= 1
    opt_text = "    ".join(f"({letter}) {text}" for letter, text in options)
    y = draw_wrapped(c, opt_text, x + 16, y, width - 16, size=7.7, leading=10, color=MUTED)
    return y - 7


def draw_passage_box(c, title, text, x, y_top, width, size=8.1, leading=10.4):
    lines = []
    for paragraph in text.split("\n"):
        lines.extend(wrap_text(paragraph, "YaHei", size, width - 20))
        lines.append("")
    if lines and lines[-1] == "":
        lines.pop()
    height = len(lines) * leading + 27
    c.setFillColor(LIGHT)
    c.setStrokeColor(LINE)
    c.roundRect(x, y_top - height, width, height, 5, stroke=1, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 8.2)
    c.drawString(x + 10, y_top - 16, title)
    c.setFillColor(INK)
    c.setFont("YaHei", size)
    y = y_top - 30
    for line in lines:
        c.drawString(x + 10, y, line)
        y -= leading
    return y_top - height


part5 = [
    (1, "Applicants must submit all required documents ___ Friday.", [("A", "from"), ("B", "by"), ("C", "among"), ("D", "during")]),
    (2, "The new laboratory instrument is more ___ than the previous model.", [("A", "rely"), ("B", "reliably"), ("C", "reliable"), ("D", "reliance")]),
    (3, "The seminar was postponed ___ the keynote speaker was unable to attend.", [("A", "because"), ("B", "despite"), ("C", "during"), ("D", "unless")]),
    (4, "Ms. Patel is responsible for ___ the equipment before delivery.", [("A", "inspect"), ("B", "inspected"), ("C", "inspection"), ("D", "inspecting")]),
    (5, "Dr. Han ___ the revised manuscript before the meeting began.", [("A", "reviews"), ("B", "had reviewed"), ("C", "will review"), ("D", "is reviewing")]),
    (6, "All expense reports must be submitted ___ three days after the trip.", [("A", "within"), ("B", "beside"), ("C", "among"), ("D", "during")]),
    (7, "The final report will be distributed ___ it has been approved.", [("A", "during"), ("B", "despite"), ("C", "once"), ("D", "except")]),
    (8, "The technicians worked ___ to finish the repairs ahead of schedule.", [("A", "efficient"), ("B", "efficiency"), ("C", "more efficient"), ("D", "efficiently")]),
    (9, "Visitors must present ___ identification at the reception desk.", [("A", "they"), ("B", "their"), ("C", "them"), ("D", "theirs")]),
    (10, "The samples were stored at a low temperature ___ prevent degradation.", [("A", "to"), ("B", "so"), ("C", "for"), ("D", "by")]),
    (11, "Any employee who needs access to the archive should ___ the manager.", [("A", "contacted"), ("B", "contacts"), ("C", "contact"), ("D", "contacting")]),
    (12, "Because of a shipping delay, the supplies arrived later than ___.", [("A", "expect"), ("B", "expected"), ("C", "expecting"), ("D", "expectation")]),
]


def page_one(c):
    draw_header(c, 1, "FRONT | QUESTIONS 1-17")
    c.setFillColor(INK)
    c.setFont("YaHei-Bold", 9)
    c.drawString(30, PAGE_H - 64, "建议：先独立完成，再翻面核对 | 今日总时长约 40 分钟")
    c.setFont("YaHei", 7.8)
    c.setFillColor(MUTED)
    c.drawRightString(PAGE_W - 30, PAGE_H - 64, "姓名：____________  日期：____________")

    y = section_bar(c, PAGE_H - 78, "Part 5 | Incomplete Sentences 句子填空", "12题 / 建议10分钟")
    for number, stem, options in part5:
        y = draw_question(c, number, stem, options, 30, y, PAGE_W - 60, size=8.0)
    y -= 2
    c.setStrokeColor(LINE)
    c.line(30, y + 12, PAGE_W - 30, y + 12)
    y = section_bar(c, y, "Part 6 | Text Completion 短文填空", "4道正式编组 + 1道加练 / 建议7分钟")
    passage = (
        "NOTICE TO ALL STAFF\n"
        "Beginning next Monday, the west entrance of the Dalton Research Center will be closed [13] repairs. "
        "Employees should use the east entrance [14] further notice. Visitors must sign in at the reception desk, "
        "where they will receive temporary badges. Because parking spaces near the east entrance are limited, "
        "staff members are [15] to use public transportation whenever possible. The work is expected to take "
        "approximately two weeks. [16] The center apologizes for any inconvenience this may [17]."
    )
    y = draw_passage_box(c, "Staff Notice", passage, 30, y, PAGE_W - 60, size=8.2, leading=10.4) - 9
    q13 = (13, "", [("A", "among"), ("B", "although"), ("C", "from"), ("D", "due to")])
    q14 = (14, "", [("A", "until"), ("B", "during"), ("C", "between"), ("D", "beside")])
    q15 = (15, "", [("A", "encourage"), ("B", "encouraging"), ("C", "encouraged"), ("D", "encouragement")])
    q16 = (16, "Choose the best sentence for the blank.", [
        ("A", "The center opened several years ago."),
        ("B", "A notice will be sent when the entrance reopens."),
        ("C", "Most visitors prefer to drive to the center."),
        ("D", "The reception desk is on the second floor."),
    ])
    q17 = (17, "BONUS: Choose the best word for blank [17].", [
        ("A", "cause"), ("B", "causes"), ("C", "caused"), ("D", "causing")
    ])
    small_gap = 12
    small_w = (PAGE_W - 60 - small_gap) / 2
    left_y = y
    for q in (q13, q14, q15):
        left_y = draw_question(c, *q, 30, left_y, small_w, size=8.0)
    right_y = draw_question(c, *q16, 30 + small_w + small_gap, y, small_w, size=8.0)
    bonus_y = min(left_y, right_y) - 3
    c.setFillColor(PALE)
    c.roundRect(30, bonus_y - 43, PAGE_W - 60, 43, 4, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 7.4)
    c.drawString(38, bonus_y - 11, "额外加练：正式考试每篇 Part 6 仍为 4 题")
    draw_question(c, *q17, 38, bonus_y - 24, PAGE_W - 76, size=7.8)


def page_two(c):
    draw_header(c, 2, "BACK | QUESTIONS 18-24 + ANSWERS")
    y = section_bar(c, PAGE_H - 58, "Part 7 | Reading Comprehension 阅读理解", "7题 / 建议10分钟")

    email = (
        "From: Ava Lin <a.lin@northlab.org>\n"
        "To: Research Team\n"
        "Subject: Centrifuge Training\n"
        "A required training session for the laboratory's new centrifuge will be held on Tuesday at 10:00 A.M. "
        "in Room B214. The session will last approximately one hour. Please bring your employee identification "
        "badge. Staff members who completed the manufacturer's online training last month do not need to attend. "
        "If you have a scheduling conflict, reply to this message by noon on Monday."
    )
    y = draw_passage_box(c, "Questions 18-20 refer to the following e-mail.", email, 30, y, PAGE_W - 60, size=7.9, leading=9.8) - 8
    p7a = [
        (18, "What is the purpose of the e-mail?", [("A", "To request new equipment"), ("B", "To change a room reservation"), ("C", "To announce required training"), ("D", "To report an accident")]),
        (19, "Who does NOT need to attend the session?", [("A", "Staff who already completed online training"), ("B", "Employees who bring identification"), ("C", "People working in Room B214"), ("D", "New research team members")]),
        (20, "What should an employee with a scheduling conflict do?", [("A", "Contact the manufacturer"), ("B", "Attend on Tuesday afternoon"), ("C", "Return an identification badge"), ("D", "Reply by Monday at noon")]),
    ]
    for q in p7a:
        y = draw_question(c, *q, 30, y, PAGE_W - 60, size=7.8)

    c.setStrokeColor(LINE)
    c.line(30, y + 5, PAGE_W - 30, y + 5)
    y -= 4
    notice = (
        "CAMPUS SHUTTLE NOTICE\n"
        "Due to roadwork, the shuttle stop in front of Science Hall will be unavailable from August 24 through "
        "August 28. During this period, passengers should use the temporary stop at East Library. Shuttles will "
        "run every 20 minutes from 7:00 A.M. to 7:00 P.M. Normal service will resume on August 31. Passengers who "
        "need mobility assistance should call the transportation office at least one day in advance."
    )
    message = (
        "To: Professor Kim\n"
        "My train is scheduled to arrive at Central Station at 8:30 A.M. on Wednesday, August 26. I had planned "
        "to take the campus shuttle directly to Science Hall, but I saw the route notice. Since I will be carrying "
        "two equipment cases, could a laboratory member meet me at the East Library stop at about 9:00? I have an "
        "orientation meeting at 9:30 and would like to store the cases beforehand. - Leo Martin"
    )
    box_gap = 10
    box_w = (PAGE_W - 60 - box_gap) / 2
    y1 = draw_passage_box(c, "Questions 21-24: Notice", notice, 30, y, box_w, size=7.35, leading=9.0)
    y2 = draw_passage_box(c, "Questions 21-24: Message", message, 30 + box_w + box_gap, y, box_w, size=7.35, leading=9.0)
    y = min(y1, y2) - 8

    p7b = [
        (21, "Why was the shuttle stop moved?", [("A", "A conference is taking place"), ("B", "Roadwork is being done"), ("C", "The library is closed"), ("D", "A shuttle is being repaired")]),
        (22, "When will normal shuttle service resume?", [("A", "August 24"), ("B", "August 26"), ("C", "August 31"), ("D", "September 1")]),
        (23, "Why does Mr. Martin request help?", [("A", "He will have equipment cases"), ("B", "He cannot find the station"), ("C", "He needs mobility assistance"), ("D", "He missed his train")]),
        (24, "What will Mr. Martin most likely do before orientation?", [("A", "Call the transportation office"), ("B", "Visit Central Station"), ("C", "Repair laboratory equipment"), ("D", "Store his cases")]),
    ]
    col_gap = 12
    col_w = (PAGE_W - 60 - col_gap) / 2
    left_y = y
    right_y = y
    for q in p7b[:2]:
        left_y = draw_question(c, *q, 30, left_y, col_w, size=7.65)
    for q in p7b[2:]:
        right_y = draw_question(c, *q, 30 + col_w + col_gap, right_y, col_w, size=7.65)
    y = min(left_y, right_y) + 2

    answer_top = max(190, y)
    c.setFillColor(TEAL)
    c.roundRect(30, answer_top - 19, PAGE_W - 60, 19, 4, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("YaHei-Bold", 9)
    c.drawString(38, answer_top - 13, "答案与快速复盘 | 做完再看")
    c.setFont("YaHei", 7.2)
    c.drawRightString(PAGE_W - 38, answer_top - 13, "得分：____ / 24    用时：____ 分钟")

    key_y = answer_top - 35
    c.setFillColor(INK)
    c.setFont("YaHei-Bold", 8.1)
    c.drawString(36, key_y, "答案")
    c.setFont("YaHei", 7.8)
    c.drawString(72, key_y, "1 B  2 C  3 A  4 D  5 B  6 A  7 C  8 D  9 B  10 A  11 C  12 B")
    c.drawString(72, key_y - 12, "13 D  14 A  15 C  16 B  17 A  18 C  19 A  20 D  21 B  22 C  23 A  24 D")

    review_y = key_y - 31
    c.setFont("YaHei-Bold", 8.0)
    c.drawString(36, review_y, "关键解析")
    c.setFont("YaHei", 7.35)
    c.setFillColor(MUTED)
    reviews = [
        "1 by + 时间点 = 最迟不晚于；6 within + 时间长度 = 在这段时间内。",
        "2 more 后接形容词 reliable；8 worked 需要副词 efficiently 修饰。",
        "3 because 后接完整句；13 due to 后接名词 repairs。",
        "4 responsible for doing；11 should 后接动词原形；12 later than expected 是固定省略结构。",
        "7 once + 完整句 = 一经/一旦；14 until further notice = 另行通知前。",
        "15 be encouraged to do = 被鼓励做；16 只有 B 能承接维修结束后的安排。",
        "17 may 后接动词原形 cause；18-20 先看 purpose / who / conflict，再回邮件定位。",
        "21-24 两篇材料共同定位；equipment cases 对应需要接应，beforehand 对应会前存放。",
    ]
    yy = review_y - 13
    for line in reviews:
        c.drawString(45, yy, "- " + line)
        yy -= 10.2

    c.setFillColor(PALE)
    c.roundRect(36, 29, PAGE_W - 72, 38, 4, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 7.8)
    c.drawString(44, 54, "Day 1 只记 5 个搭配")
    c.setFont("YaHei", 7.2)
    c.setFillColor(INK)
    c.drawString(44, 41, "by Friday | within three days | responsible for doing | once approved | later than expected")


c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle("TOEIC 720 Day 1 双面练习")
c.setAuthor("Codex - Original TOEIC-style Practice")
page_one(c)
c.showPage()
page_two(c)
c.showPage()
c.save()
print("PDF_CREATED")
