from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(r"C:\Users\jhr59\Documents\Codex\2026-08-12\wo-x")
OUT = ROOT / "outputs" / "TOEIC_720_Day2_双面练习_v1.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)

pdfmetrics.registerFont(TTFont("YaHei", r"C:\Windows\Fonts\msyh.ttc"))
pdfmetrics.registerFont(TTFont("YaHei-Bold", r"C:\Windows\Fonts\msyhbd.ttc"))

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
    lines, current = [], words[0]
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
    for char in text:
        candidate = current + char
        if not current or pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines


def draw_wrapped(c, text, x, y, width, font="YaHei", size=8.4, leading=11, color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    for line in wrap_mixed(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_header(c, page_no, subtitle):
    c.setFillColor(TEAL)
    c.rect(0, PAGE_H - 46, PAGE_W, 46, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("YaHei-Bold", 15)
    c.drawString(30, PAGE_H - 29, "TOEIC 720 稳过计划 | Day 2")
    c.setFont("YaHei", 8.5)
    c.drawRightString(PAGE_W - 30, PAGE_H - 27, subtitle)
    c.setFillColor(MUTED)
    c.setFont("YaHei", 7.4)
    c.drawRightString(PAGE_W - 30, 18, f"Day 2 | {page_no}/2 | 原创 TOEIC-style 练习")


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
    option_text = "    ".join(f"({letter}) {text}" for letter, text in options)
    y = draw_wrapped(c, option_text, x + 16, y, width - 16, size=7.7, leading=10, color=MUTED)
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


PART5 = [
    (1, "The purchasing department will review all bids ___ making a final decision.", [("A", "before"), ("B", "between"), ("C", "beside"), ("D", "since")]),
    (2, "The conference room is currently ___ for a meeting at 2:00 P.M.", [("A", "reserve"), ("B", "reservation"), ("C", "reserved"), ("D", "reserving")]),
    (3, "Please notify your supervisor ___ you need to change your work schedule.", [("A", "despite"), ("B", "if"), ("C", "during"), ("D", "until")]),
    (4, "The committee has not yet ___ whether to extend the application deadline.", [("A", "decide"), ("B", "decision"), ("C", "deciding"), ("D", "decided")]),
    (5, "Ms. Rivera will prepare the summary while her assistant ___ the charts.", [("A", "updated"), ("B", "has updated"), ("C", "is updating"), ("D", "update")]),
    (6, "Applicants with relevant laboratory experience will receive ___ consideration.", [("A", "special"), ("B", "specially"), ("C", "specialize"), ("D", "specialty")]),
    (7, "The replacement parts should arrive ___ the end of the week.", [("A", "from"), ("B", "among"), ("C", "during"), ("D", "by")]),
    (8, "The research team worked ___ with external consultants on the project.", [("A", "close"), ("B", "closely"), ("C", "closed"), ("D", "closeness")]),
    (9, "Neither the manager nor the assistants ___ available yesterday afternoon.", [("A", "is"), ("B", "was"), ("C", "were"), ("D", "be")]),
    (10, "Due to ___ demand, an additional workshop has been scheduled.", [("A", "increase"), ("B", "increasingly"), ("C", "increased"), ("D", "increases")]),
    (11, "Employees may request reimbursement, ___ they provide the original receipts.", [("A", "even though"), ("B", "provided that"), ("C", "rather than"), ("D", "because of")]),
    (12, "The new device is easy to operate and requires very ___ maintenance.", [("A", "little"), ("B", "few"), ("C", "several"), ("D", "many")]),
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
    for question in PART5:
        y = draw_question(c, *question, 30, y, PAGE_W - 60, size=8.0)
    y -= 2
    c.setStrokeColor(LINE)
    c.line(30, y + 12, PAGE_W - 30, y + 12)
    y = section_bar(c, y, "Part 6 | Text Completion 短文填空", "4道正式编组 + 1道加练 / 建议7分钟")

    passage = (
        "LABORATORY INVENTORY AUDIT\n"
        "The annual inventory audit will be conducted on September 4. Team leaders must review their equipment "
        "lists and report any missing or damaged items [13] Wednesday. All equipment purchased during the past "
        "year should be [14] to the list. Employees who have borrowed portable devices must return them before "
        "the audit begins. [15] Questions should be directed to Ms. Owens, who is [16] for coordinating the audit. "
        "Thank you in advance for your [17]."
    )
    y = draw_passage_box(c, "Internal Notice", passage, 30, y, PAGE_W - 60, size=8.2, leading=10.4) - 9
    q13 = (13, "", [("A", "since"), ("B", "among"), ("C", "during"), ("D", "by")])
    q14 = (14, "", [("A", "add"), ("B", "adding"), ("C", "added"), ("D", "addition")])
    q15 = (15, "Choose the best sentence for the blank.", [
        ("A", "The audit was canceled last year."),
        ("B", "This will allow auditors to verify each item's location."),
        ("C", "Portable devices are usually expensive."),
        ("D", "Some employees prefer printed lists."),
    ])
    q16 = (16, "", [("A", "responsible"), ("B", "responsibly"), ("C", "responsibility"), ("D", "respond")])
    q17 = (17, "BONUS: Choose the best word for blank [17].", [
        ("A", "cooperate"), ("B", "cooperative"), ("C", "cooperatively"), ("D", "cooperation")
    ])

    column_gap = 12
    column_width = (PAGE_W - 60 - column_gap) / 2
    left_y = y
    for question in (q13, q14, q16):
        left_y = draw_question(c, *question, 30, left_y, column_width, size=8.0)
    right_y = draw_question(c, *q15, 30 + column_width + column_gap, y, column_width, size=8.0)
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
        "From: Facilities Office\n"
        "To: Fourth-Floor Staff\n"
        "Subject: Printer Replacement\n"
        "A new high-capacity printer will be installed in Room 405 this Thursday. The existing printer will be "
        "unavailable from 1:00 to 4:00 P.M. Staff members who need to print urgent documents during that period "
        "may use the printer in Room 210. Employee identification cards will continue to work with the new machine. "
        "An optional demonstration of its features will be offered Friday at 9:00 A.M. in Room 405."
    )
    y = draw_passage_box(c, "Questions 18-20 refer to the following e-mail.", email, 30, y, PAGE_W - 60, size=7.9, leading=9.8) - 8
    questions_a = [
        (18, "What is the purpose of the e-mail?", [("A", "To request printer supplies"), ("B", "To announce an equipment change"), ("C", "To reserve a meeting room"), ("D", "To explain an identification policy")]),
        (19, "Where should urgent documents be printed during the installation?", [("A", "Room 205"), ("B", "Room 405"), ("C", "Room 210"), ("D", "The Facilities Office")]),
        (20, "What is indicated about Friday's demonstration?", [("A", "Attendance is optional"), ("B", "It begins at 1:00 P.M."), ("C", "It requires advance payment"), ("D", "It will be held online")]),
    ]
    for question in questions_a:
        y = draw_question(c, *question, 30, y, PAGE_W - 60, size=7.8)

    c.setStrokeColor(LINE)
    c.line(30, y + 5, PAGE_W - 30, y + 5)
    y -= 4
    notice = (
        "UNIVERSITY PRINT CENTER\n"
        "Research posters must be submitted as PDF files sized 90 x 120 centimeters. Orders received by noon "
        "Monday through Thursday will be ready by 4:00 P.M. the same day. Orders received after noon will be "
        "ready the next business day. Friday orders may be collected on Monday. Standard printing is free for "
        "faculty and students. Same-day rush service is available for an additional $15."
    )
    message = (
        "To: Hana Lee\n"
        "I plan to upload my research poster at about 1:30 P.M. on Monday. My presentation is Wednesday morning, "
        "so the normal service should be fast enough. I will be at an off-campus meeting until 5:00 P.M. on Tuesday. "
        "Could you collect the poster when it is ready and leave it in my office? I cannot use the rush option "
        "because the project budget has already been spent. - Marco"
    )
    box_gap = 10
    box_width = (PAGE_W - 60 - box_gap) / 2
    y1 = draw_passage_box(c, "Questions 21-24: Notice", notice, 30, y, box_width, size=7.35, leading=9.0)
    y2 = draw_passage_box(c, "Questions 21-24: Message", message, 30 + box_width + box_gap, y, box_width, size=7.35, leading=9.0)
    y = min(y1, y2) - 8

    questions_b = [
        (21, "In what format must posters be submitted?", [("A", "JPEG"), ("B", "PDF"), ("C", "PNG"), ("D", "PPT")]),
        (22, "When will Marco's poster most likely be ready without rush service?", [("A", "Monday morning"), ("B", "Monday at 4:00 P.M."), ("C", "Tuesday"), ("D", "Wednesday")]),
        (23, "Why does Marco ask Ms. Lee to collect the poster?", [("A", "He will be at an off-campus meeting"), ("B", "He does not have an identification card"), ("C", "He must revise the poster"), ("D", "He is leaving the university")]),
        (24, "What is scheduled for Wednesday?", [("A", "A budget review"), ("B", "A printing appointment"), ("C", "An off-campus meeting"), ("D", "Marco's presentation")]),
    ]
    column_gap = 12
    column_width = (PAGE_W - 60 - column_gap) / 2
    left_y = y
    right_y = y
    for question in questions_b[:2]:
        left_y = draw_question(c, *question, 30, left_y, column_width, size=7.65)
    for question in questions_b[2:]:
        right_y = draw_question(c, *question, 30 + column_width + column_gap, right_y, column_width, size=7.65)
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
    c.drawString(72, key_y, "1 A  2 C  3 B  4 D  5 C  6 A  7 D  8 B  9 C  10 C  11 B  12 A")
    c.drawString(72, key_y - 12, "13 D  14 C  15 B  16 A  17 D  18 B  19 C  20 A  21 B  22 C  23 A  24 D")

    review_y = key_y - 31
    c.setFont("YaHei-Bold", 8.0)
    c.drawString(36, review_y, "关键解析")
    c.setFont("YaHei", 7.35)
    c.setFillColor(MUTED)
    reviews = [
        "1 before doing = 在做某事之前；7 by + 时间点 = 最迟不晚于。",
        "2 be reserved = 被预订；6 consideration 前需要形容词 special。",
        "3 if + 完整句表示条件；11 provided that = 只要/条件是。",
        "4 has not yet 后用过去分词 decided；5 while 表示两件事同时进行。",
        "8 closely 是副词；9 neither...nor 的谓语通常跟靠近它的主语一致。",
        "12 maintenance 不可数，用 little；14 be added to = 被添加到。",
        "15 B 承接归还设备的目的；16 be responsible for = 负责；17 cooperation 是名词。",
        "21-24 要把通知的截单时间与邮件的提交时间对应起来，再判断取件日。",
    ]
    y_review = review_y - 13
    for line in reviews:
        c.drawString(45, y_review, "- " + line)
        y_review -= 10.2

    c.setFillColor(PALE)
    c.roundRect(36, 29, PAGE_W - 72, 38, 4, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 7.8)
    c.drawString(44, 54, "Day 2 只记 5 个搭配")
    c.setFont("YaHei", 7.2)
    c.setFillColor(INK)
    c.drawString(44, 41, "before doing | be reserved for | provided that | be added to | be responsible for")


c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle("TOEIC 720 Day 2 双面练习")
c.setAuthor("Codex - Original TOEIC-style Practice")
page_one(c)
c.showPage()
page_two(c)
c.showPage()
c.save()
print("PDF_CREATED")
