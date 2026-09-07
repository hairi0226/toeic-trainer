from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(r"C:\Users\jhr59\Documents\Codex\2026-08-12\wo-x")
OUT = ROOT / "outputs" / "TOEIC_720_周末4套练习_Day3-6_v2.pdf"
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
OFFICIAL_LC_URL = "https://exam.toeic.co.kr/content/common/realQuestion.php"


def q(number, stem, answer, options):
    return {"n": number, "stem": stem, "answer": answer, "options": options}


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


def draw_header(c, sheet, side, subtitle):
    c.setFillColor(TEAL)
    c.rect(0, PAGE_H - 46, PAGE_W, 46, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("YaHei-Bold", 15)
    c.drawString(30, PAGE_H - 29, f"TOEIC 720 周末练习 | Day {sheet['day']}")
    c.setFont("YaHei", 8.5)
    c.drawRightString(PAGE_W - 30, PAGE_H - 27, subtitle)
    c.setFillColor(MUTED)
    c.setFont("YaHei", 7.4)
    c.drawRightString(PAGE_W - 30, 18, f"Weekend Pack | Sheet {sheet['index']}/4 | {side}/2 | 原创 TOEIC-style")


def section_bar(c, y, title, timing):
    c.setFillColor(PALE)
    c.roundRect(30, y - 15, PAGE_W - 60, 18, 4, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 9.5)
    c.drawString(38, y - 10, title)
    c.setFont("YaHei", 7.5)
    c.drawRightString(PAGE_W - 38, y - 10, timing)
    return y - 25


def draw_question(c, question, x, y, width, size=8.2):
    c.setFont("YaHei-Bold", size)
    c.setFillColor(INK)
    c.drawString(x, y, f"{question['n']}.")
    y = draw_wrapped(c, question["stem"], x + 16, y, width - 16, size=size, leading=10.5)
    y -= 1
    option_text = "    ".join(f"({letter}) {text}" for letter, text in question["options"])
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


def draw_qr(c, url, x, y, size=52):
    widget = qr.QrCodeWidget(url)
    x1, y1, x2, y2 = widget.getBounds()
    width, height = x2 - x1, y2 - y1
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    renderPDF.draw(drawing, c, x, y)


def draw_listening_box(c, assignment):
    x, y, width, height = 30, 31, PAGE_W - 60, 70
    c.setFillColor(PALE)
    c.roundRect(x, y, width, height, 5, stroke=0, fill=1)
    draw_qr(c, OFFICIAL_LC_URL, x + 8, y + 9, 52)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 8.2)
    c.drawString(x + 70, y + 51, "官方听力配套 | 扫码进入韩国 TOEIC 实际公开题")
    draw_wrapped(c, assignment, x + 70, y + 36, width - 82, size=7.4, leading=9.4, color=INK)
    c.setFont("YaHei", 6.7)
    c.setFillColor(MUTED)
    c.drawString(x + 70, y + 8, "方法：第一遍不暂停作答，第二遍看讲解；听力答案以官方页面为准。")


SHEETS = [
    {
        "index": 1,
        "day": 3,
        "focus": "基础语法与日程信息",
        "listening": "练 Part 2 质疑应答 10-15 分钟，重点分辨 Who / When / Where / Why 和间接回答。",
        "p5": [
            q(1, "All visitors must sign in ___ entering the production area.", "A", [("A", "before"), ("B", "between"), ("C", "beside"), ("D", "since")]),
            q(2, "This year's sales figures were ___ higher than expected.", "D", [("A", "significance"), ("B", "signify"), ("C", "significant"), ("D", "significantly")]),
            q(3, "Ms. Chen has worked for the company ___ 2019.", "B", [("A", "for"), ("B", "since"), ("C", "during"), ("D", "until")]),
            q(4, "The workshop was canceled because too few people ___ registered.", "C", [("A", "have"), ("B", "will have"), ("C", "had"), ("D", "are")]),
            q(5, "Confidential documents must be stored in a ___ location.", "A", [("A", "secure"), ("B", "securely"), ("C", "security"), ("D", "securedly")]),
            q(6, "Neither the director nor her assistants ___ able to attend tomorrow.", "D", [("A", "is"), ("B", "was"), ("C", "be"), ("D", "are")]),
            q(7, "Please send the completed invoice ___ e-mail.", "B", [("A", "at"), ("B", "by"), ("C", "among"), ("D", "until")]),
            q(8, "The revised safety policy will take effect ___ September 1.", "C", [("A", "at"), ("B", "in"), ("C", "on"), ("D", "from")]),
            q(9, "Staff members are encouraged ___ suggestions for improving the process.", "A", [("A", "to submit"), ("B", "submitted"), ("C", "submitting"), ("D", "submission")]),
            q(10, "The report contains ___ information about travel expenses.", "D", [("A", "detail"), ("B", "details"), ("C", "detailing"), ("D", "detailed")]),
            q(11, "The manufacturer agreed to replace the component at no ___ cost.", "B", [("A", "addition"), ("B", "additional"), ("C", "additionally"), ("D", "add")]),
            q(12, "___ the weather improves, the outdoor inspection will be postponed.", "C", [("A", "Because"), ("B", "During"), ("C", "Unless"), ("D", "Despite")]),
        ],
        "p6_text": (
            "PARKING PERMIT RENEWAL\n"
            "Employees may renew campus parking permits beginning September 1. The application form can be [13] "
            "from the Human Resources portal. Applications [14] after September 15 may require additional processing "
            "time. [15] Employees who no longer need a permit should return it to the security office. Staff members "
            "are advised to apply [16] to avoid delays. Thank you for your [17] during the renewal period."
        ),
        "p6": [
            q(13, "", "B", [("A", "download"), ("B", "downloaded"), ("C", "downloading"), ("D", "downloads")]),
            q(14, "", "D", [("A", "submit"), ("B", "submission"), ("C", "submitting"), ("D", "submitted")]),
            q(15, "Choose the best sentence for blank [15].", "A", [("A", "Current permits remain valid through September 30."), ("B", "The cafeteria closes at 6:00 P.M."), ("C", "Several parking spaces were recently painted."), ("D", "Visitors may enter through the east gate.")]),
            q(16, "", "C", [("A", "earlier"), ("B", "earliest"), ("C", "early"), ("D", "earliness")]),
            q(17, "BONUS: Choose the best word for blank [17].", "B", [("A", "patient"), ("B", "patience"), ("C", "patiently"), ("D", "patients")]),
        ],
        "p7a_title": "Questions 18-20 refer to the following e-mail.",
        "p7a_text": (
            "From: Event Coordinator\nTo: Laboratory Members\nSubject: Networking Breakfast\n"
            "Our department will host a research networking breakfast this Friday at 8:30 A.M. in the Conference "
            "Center. Ten seats have been reserved for laboratory members. Please confirm your attendance by noon "
            "on Wednesday. Anyone requesting a vegetarian meal should notify me no later than Tuesday afternoon."
        ),
        "p7a": [
            q(18, "What is the main purpose of the e-mail?", "C", [("A", "To report a catering problem"), ("B", "To change a research deadline"), ("C", "To invite members to an event"), ("D", "To announce laboratory results")]),
            q(19, "When must attendance be confirmed?", "A", [("A", "Wednesday at noon"), ("B", "Tuesday morning"), ("C", "Friday at 8:30 A.M."), ("D", "Friday afternoon")]),
            q(20, "What should a person with a dietary request do?", "D", [("A", "Contact the Conference Center"), ("B", "Bring food to the event"), ("C", "Arrive before 8:00 A.M."), ("D", "Notify the coordinator by Tuesday afternoon")]),
        ],
        "p7b_left": (
            "LIBRARY STUDY ROOM POLICY\nRooms may be reserved for up to two hours on weekdays between 9:00 A.M. "
            "and 9:00 P.M. Groups must check in within 15 minutes of the reservation time or the room may be released. "
            "Each room holds no more than six people. Food is not permitted."
        ),
        "p7b_right": (
            "To: Mina\nI reserved Room 3 this Thursday from 3:00 to 5:00 P.M. for our group of five. The experiment "
            "meeting begins at 3:30, but I may be about ten minutes late. Could you check in for us? Please bring your "
            "laptop. We can go to the cafe after the meeting. - Sam"
        ),
        "p7b": [
            q(21, "What is the maximum reservation length?", "B", [("A", "One hour"), ("B", "Two hours"), ("C", "Three hours"), ("D", "Four hours")]),
            q(22, "Why does Sam ask Mina to check in?", "C", [("A", "The room number changed"), ("B", "The group has six people"), ("C", "He may arrive late"), ("D", "He forgot his laptop")]),
            q(23, "How many people are in Sam's group?", "A", [("A", "Five"), ("B", "Six"), ("C", "Seven"), ("D", "Eight")]),
            q(24, "What will the group most likely do after the meeting?", "D", [("A", "Reserve another room"), ("B", "Visit a laboratory"), ("C", "Return a laptop"), ("D", "Go to a cafe")]),
        ],
        "reviews": [
            "1 before doing = 在做某事之前；3 since + 起始时间，常与现在完成时连用。",
            "2 higher 需要副词 significantly 修饰；5 location 前用形容词 secure。",
            "4 取消发生前已经报名，用过去完成时 had registered。",
            "6 neither...nor 的谓语通常跟靠近它的主语一致；9 encourage someone to do。",
            "12 unless = 如果不/除非；13 can be downloaded 是被动语态。",
            "15 A 交代旧证有效期；16 apply early；17 your 后需要名词 patience。",
            "21-24 同时核对房间规则、迟到时间、人数和会后安排。",
        ],
        "phrases": "sign in | take effect on | at no additional cost | apply early | confirm attendance",
    },
    {
        "index": 2,
        "day": 4,
        "focus": "商务词汇与条件关系",
        "listening": "练 Part 3 对话 1-2 组，播放前先扫三道题，只抓人物、问题和下一步行动。",
        "p5": [
            q(1, "The company plans to ___ a new branch near the airport.", "B", [("A", "opening"), ("B", "open"), ("C", "opened"), ("D", "openness")]),
            q(2, "The shipment arrived two days ___ schedule.", "C", [("A", "next to"), ("B", "except for"), ("C", "ahead of"), ("D", "because of")]),
            q(3, "The manager requested that the revised proposal be submitted ___.", "D", [("A", "prompt"), ("B", "promptness"), ("C", "prompts"), ("D", "promptly")]),
            q(4, "Employees must obtain written ___ before traveling on company business.", "A", [("A", "approval"), ("B", "approve"), ("C", "approved"), ("D", "approving")]),
            q(5, "Since the laboratory opened, the number of projects ___ steadily.", "B", [("A", "increased"), ("B", "has increased"), ("C", "will increase"), ("D", "is increasing yesterday")]),
            q(6, "The requested item is unavailable, but a suitable substitute ___ recommended.", "C", [("A", "have"), ("B", "are"), ("C", "is"), ("D", "be")]),
            q(7, "The annual budget includes funds ___ equipment maintenance.", "D", [("A", "at"), ("B", "among"), ("C", "until"), ("D", "for")]),
            q(8, "The meeting will not begin ___ the committee chair arrives.", "A", [("A", "until"), ("B", "during"), ("C", "despite"), ("D", "beside")]),
            q(9, "Applicants should describe their relevant qualifications ___.", "B", [("A", "clear"), ("B", "clearly"), ("C", "clearness"), ("D", "cleared")]),
            q(10, "The documents are ___ to contain confidential information.", "C", [("A", "like"), ("B", "likelihood"), ("C", "likely"), ("D", "likewise")]),
            q(11, "The company will reimburse the costs ___ original receipts are included.", "D", [("A", "even though"), ("B", "rather than"), ("C", "because of"), ("D", "provided that")]),
            q(12, "The position requires both technical knowledge ___ strong communication skills.", "A", [("A", "and"), ("B", "but"), ("C", "or"), ("D", "so")]),
        ],
        "p6_text": (
            "ORDER STATUS UPDATE\n"
            "Thank you for order 7842. Two items are temporarily [13] because a shipment from our supplier has been "
            "delayed. We expect the new stock [14] next Tuesday. [15] If you prefer not to wait, contact a customer "
            "service representative [16] Friday to request a substitute or a refund. We apologize for the inconvenience "
            "and appreciate your [17]."
        ),
        "p6": [
            q(13, "", "C", [("A", "availability"), ("B", "available"), ("C", "unavailable"), ("D", "availably")]),
            q(14, "", "A", [("A", "to arrive"), ("B", "arrived"), ("C", "arrival"), ("D", "arriving at")]),
            q(15, "Choose the best sentence for blank [15].", "D", [("A", "The store opened five years ago."), ("B", "Our website has a new design."), ("C", "The supplier employs 50 people."), ("D", "The remaining items will be sent immediately.")]),
            q(16, "", "B", [("A", "among"), ("B", "by"), ("C", "during"), ("D", "beside")]),
            q(17, "BONUS: Choose the best word for blank [17].", "C", [("A", "understand"), ("B", "understood"), ("C", "understanding"), ("D", "understandably")]),
        ],
        "p7a_title": "Questions 18-20 refer to the following e-mail.",
        "p7a_text": (
            "From: Training Office\nTo: Workshop Participants\nSubject: Schedule Change\n"
            "The project management workshop originally scheduled for August 22 has been moved to August 29. It will "
            "be held in Room 310 instead of Room 204, but the time remains 1:00 to 4:00 P.M. Course materials will be "
            "sent by e-mail. Anyone unable to attend should request the recorded session by August 25."
        ),
        "p7a": [
            q(18, "Why was the e-mail sent?", "B", [("A", "To cancel a workshop"), ("B", "To announce workshop changes"), ("C", "To request course payment"), ("D", "To hire a trainer")]),
            q(19, "Where will the workshop be held?", "C", [("A", "Room 204"), ("B", "Room 301"), ("C", "Room 310"), ("D", "The Training Office")]),
            q(20, "What should someone who cannot attend do?", "A", [("A", "Request a recording by August 25"), ("B", "Return the course materials"), ("C", "Attend on August 22"), ("D", "Call Room 204")]),
        ],
        "p7b_left": (
            "CATERING SERVICE\nOrders must be placed at least 48 hours in advance, with a minimum of ten guests. "
            "The standard lunch costs $18 per person, and vegetarian meals are available at the same price. Delivery "
            "is free for orders over $200; otherwise, a $20 delivery charge applies."
        ),
        "p7b_right": (
            "To: Catering Team\nPlease prepare lunch for 12 researchers at noon this Wednesday. Three guests need "
            "vegetarian meals. I will place the final order on Monday morning. Our total budget is $250, and delivery "
            "should be made to Laboratory Building B. - Nari"
        ),
        "p7b": [
            q(21, "What is the latest time the order may be placed?", "B", [("A", "Sunday at noon"), ("B", "Monday at noon"), ("C", "Tuesday morning"), ("D", "Wednesday morning")]),
            q(22, "What special meal is needed?", "C", [("A", "Gluten-free"), ("B", "Low-sodium"), ("C", "Vegetarian"), ("D", "Seafood")]),
            q(23, "How much will the lunches cost before any delivery charge?", "A", [("A", "$216"), ("B", "$220"), ("C", "$236"), ("D", "$250")]),
            q(24, "Why will the delivery most likely be free?", "D", [("A", "The order is for researchers"), ("B", "It includes vegetarian meals"), ("C", "It was placed on Monday"), ("D", "The food costs more than $200")]),
        ],
        "reviews": [
            "1 plan to do；2 ahead of schedule = 提前；3 submitted 由副词 promptly 修饰。",
            "4 obtain approval；5 since 引导的时间段常对应现在完成时。",
            "6 主语 substitute 为单数；8 not...until = 直到……才。",
            "10 be likely to do = 很可能；11 provided that = 条件是/只要。",
            "13 unavailable 与延迟到货一致；14 expect something to arrive。",
            "15 D 承接部分发货；16 by Friday = 最迟周五；17 understanding 是名词。",
            "21-24 先算 12 x 18 = 216，再判断超过 200 可免配送费。",
        ],
        "phrases": "ahead of schedule | obtain approval | be likely to | provided that | request a refund",
    },
    {
        "index": 3,
        "day": 5,
        "focus": "阅读定位与流程判断",
        "listening": "练 Part 4 独白 1-2 组，先看题干中的地点、目的、时间和 next step，再听同义替换。",
        "p5": [
            q(1, "The committee will meet to discuss the ___ to the employee survey.", "C", [("A", "respond"), ("B", "responsive"), ("C", "responses"), ("D", "responding")]),
            q(2, "The software update ___ automatically at midnight tonight.", "A", [("A", "will begin"), ("B", "began"), ("C", "beginning"), ("D", "has begun yesterday")]),
            q(3, "The laboratory remained open ___ the renovation.", "D", [("A", "unless"), ("B", "beside"), ("C", "although"), ("D", "during")]),
            q(4, "The results were ___ consistent across all three trials.", "B", [("A", "remarkable"), ("B", "remarkably"), ("C", "remark"), ("D", "remarks")]),
            q(5, "The supervisor asked the technicians ___ each device's serial number.", "C", [("A", "recorded"), ("B", "recording"), ("C", "to record"), ("D", "record")]),
            q(6, "The equipment cannot be used ___ the safety check is completed.", "A", [("A", "until"), ("B", "during"), ("C", "among"), ("D", "despite")]),
            q(7, "The announcement was made ___ all employees yesterday afternoon.", "D", [("A", "at"), ("B", "among"), ("C", "with"), ("D", "to")]),
            q(8, "The new supplier offers prices that are ___ than those of the former supplier.", "B", [("A", "low"), ("B", "lower"), ("C", "lowest"), ("D", "lowly")]),
            q(9, "All reimbursement forms require the department manager's ___.", "C", [("A", "sign"), ("B", "signed"), ("C", "signature"), ("D", "signing")]),
            q(10, "Please make sure that all doors are ___ before leaving.", "A", [("A", "locked"), ("B", "locking"), ("C", "lock"), ("D", "locks")]),
            q(11, "The researcher spoke ___ about the preliminary findings.", "D", [("A", "confidence"), ("B", "confident"), ("C", "confide"), ("D", "confidently")]),
            q(12, "The event was canceled ___ a lack of registrations.", "B", [("A", "because"), ("B", "because of"), ("C", "although"), ("D", "unless")]),
        ],
        "p6_text": (
            "CONFERENCE CHECK-IN\n"
            "Attendees who registered online may collect badges in the main lobby beginning at 7:30 A.M. To receive "
            "a badge, present a registration e-mail or photo identification. Those who have not paid the full fee will "
            "be asked to do so [13] receiving a badge. [14] Self-service kiosks are available for attendees [15] names "
            "have not changed. Help desk staff can assist with corrections. Badges should be worn [16] all sessions. "
            "We appreciate your [17]."
        ),
        "p6": [
            q(13, "", "A", [("A", "before"), ("B", "during"), ("C", "unless"), ("D", "beside")]),
            q(14, "Choose the best sentence for blank [14].", "C", [("A", "The conference was held overseas last year."), ("B", "Most hotels offer free breakfast."), ("C", "Lines are expected to be longest between 8:00 and 9:00."), ("D", "The lobby was recently painted.")]),
            q(15, "", "B", [("A", "who"), ("B", "whose"), ("C", "which"), ("D", "whom")]),
            q(16, "", "D", [("A", "among"), ("B", "until"), ("C", "beside"), ("D", "during")]),
            q(17, "BONUS: Choose the best word for blank [17].", "A", [("A", "cooperation"), ("B", "cooperate"), ("C", "cooperative"), ("D", "cooperatively")]),
        ],
        "p7a_title": "Questions 18-20 refer to the following e-mail.",
        "p7a_text": (
            "From: North City Electronics\nTo: Customers\nSubject: Product Recall\n"
            "We are recalling model HN-20 portable heaters because of a possible problem with the power cord. Stop "
            "using the heater immediately and return it to any North City Electronics store. A receipt is not required. "
            "Customers may choose either a full refund or a replacement. Visit our website to check affected serial numbers."
        ),
        "p7a": [
            q(18, "What is the purpose of the e-mail?", "C", [("A", "To advertise a heater"), ("B", "To change store hours"), ("C", "To announce a product recall"), ("D", "To request customer reviews")]),
            q(19, "What does the e-mail state about a receipt?", "B", [("A", "It must be original"), ("B", "It is not required"), ("C", "It can be obtained online"), ("D", "It is needed for a replacement")]),
            q(20, "What may customers receive?", "D", [("A", "A power cord only"), ("B", "A store membership"), ("C", "Free delivery"), ("D", "A refund or replacement")]),
        ],
        "p7b_left": (
            "LABORATORY COURIER SERVICE\nPickups are made at 9:00 A.M. and 4:00 P.M. on weekdays. Request forms "
            "received at least 30 minutes before a pickup will be included. Hazardous materials require special labels. "
            "The courier does not operate on weekends."
        ),
        "p7b_right": (
            "To: Courier Desk\nIt is Monday at 3:20 P.M., and our samples are ready. I have completed the request "
            "form. The samples are not hazardous and need to reach the central laboratory by Tuesday morning. Please "
            "confirm that they can be included in today's final pickup. - Leo"
        ),
        "p7b": [
            q(21, "Which pickup can include Leo's samples?", "B", [("A", "Monday at 9:00 A.M."), ("B", "Monday at 4:00 P.M."), ("C", "Tuesday at 4:00 P.M."), ("D", "Saturday morning")]),
            q(22, "Why are special labels unnecessary?", "C", [("A", "The form is complete"), ("B", "The samples are urgent"), ("C", "The samples are not hazardous"), ("D", "The courier knows Leo")]),
            q(23, "When must the samples reach the central laboratory?", "A", [("A", "Tuesday morning"), ("B", "Tuesday afternoon"), ("C", "Friday"), ("D", "The weekend")]),
            q(24, "What is indicated about the courier service?", "D", [("A", "It charges for forms"), ("B", "It has three daily pickups"), ("C", "It handles only hazardous materials"), ("D", "It is unavailable on weekends")]),
        ],
        "reviews": [
            "1 responses 是可数名词复数；2 tonight 对应将来时 will begin。",
            "3 during + 名词；4 consistent 由副词 remarkably 修饰。",
            "5 ask someone to do；6 not...until = 直到……才。",
            "8 than 提示比较级 lower；9 所有格后需要名词 signature。",
            "12 because of + 名词；because 后应接完整句。",
            "14 C 提供排队时间信息；15 whose names；16 during all sessions。",
            "21 申请在 3:30 前提交即可赶上 4:00 取件，3:20 符合条件。",
        ],
        "phrases": "remain open | ask someone to do | make an announcement | product recall | final pickup",
    },
    {
        "index": 4,
        "day": 6,
        "focus": "综合推断与考场节奏",
        "listening": "混合练 Part 2 + Part 3 共 15 分钟，全程只放一遍；漏题立刻猜，不回想上一题。",
        "p5": [
            q(1, "The board approved the proposal ___ several minor changes.", "D", [("A", "except"), ("B", "among"), ("C", "during"), ("D", "subject to")]),
            q(2, "Customers wishing to return a product should ___ the original receipt.", "A", [("A", "present"), ("B", "presented"), ("C", "presentation"), ("D", "presenting")]),
            q(3, "The laboratory moved to a larger facility ___ accommodate its growing staff.", "B", [("A", "for"), ("B", "to"), ("C", "by"), ("D", "so")]),
            q(4, "Additional training materials are available ___ request.", "C", [("A", "between"), ("B", "beside"), ("C", "upon"), ("D", "until")]),
            q(5, "Only applicants ___ meet all requirements will be contacted.", "D", [("A", "which"), ("B", "whose"), ("C", "whom"), ("D", "who")]),
            q(6, "The report must be ___ reviewed before publication.", "A", [("A", "carefully"), ("B", "careful"), ("C", "care"), ("D", "caring")]),
            q(7, "No final decision has been made ___ the proposed expansion.", "B", [("A", "during"), ("B", "regarding"), ("C", "although"), ("D", "unless")]),
            q(8, "The conference registration fee ___ lunch and printed materials.", "C", [("A", "include"), ("B", "including"), ("C", "includes"), ("D", "included by")]),
            q(9, "All devices should remain ___ while the update is being installed.", "D", [("A", "connect"), ("B", "connection"), ("C", "connecting"), ("D", "connected")]),
            q(10, "The director was pleased ___ the team's performance.", "A", [("A", "with"), ("B", "at"), ("C", "among"), ("D", "until")]),
            q(11, "The new product is expected to be ___ available next month.", "B", [("A", "wide"), ("B", "widely"), ("C", "width"), ("D", "widen")]),
            q(12, "___ participation in the survey is optional, employees are encouraged to respond.", "C", [("A", "During"), ("B", "Unless"), ("C", "Although"), ("D", "Because of")]),
        ],
        "p6_text": (
            "PUBLIC HEALTH SEMINAR\n"
            "Due to an unforeseen scheduling conflict, the seminar originally planned for October 12 has been [13] "
            "to October 14. It will begin at 2:00 P.M. rather than 1:00 P.M. [14] Attendees who already registered do "
            "not need to register again. Anyone unable to attend on the new date may request a refund [15] October 10. "
            "The organizer will send an updated confirmation [16]. Thank you for your [17]."
        ),
        "p6": [
            q(13, "", "D", [("A", "move"), ("B", "moving"), ("C", "movement"), ("D", "moved")]),
            q(14, "Choose the best sentence for blank [14].", "A", [("A", "The venue will remain Hall B."), ("B", "The speaker has written three books."), ("C", "Lunch is available near the station."), ("D", "The seminar was popular last year.")]),
            q(15, "", "B", [("A", "among"), ("B", "by"), ("C", "during"), ("D", "beside")]),
            q(16, "", "C", [("A", "short"), ("B", "shortness"), ("C", "shortly"), ("D", "shorten")]),
            q(17, "BONUS: Choose the best word for blank [17].", "D", [("A", "flexible"), ("B", "flexibly"), ("C", "flex"), ("D", "flexibility")]),
        ],
        "p7a_title": "Questions 18-20 refer to the following announcement.",
        "p7a_text": (
            "ANNUAL RESEARCH FORUM\nThe forum will take place at the Weston Hotel on November 8. Registration "
            "opens at 8:00 A.M., and the opening presentation begins at 9:00. Poster presenters must finish setting "
            "up by 8:45. Attendees should wear their name badges throughout the event. Lunch is included, and parking "
            "vouchers may be collected from the registration desk."
        ),
        "p7a": [
            q(18, "What is the purpose of the announcement?", "C", [("A", "To advertise hotel rooms"), ("B", "To recruit forum speakers"), ("C", "To provide event information"), ("D", "To change a parking policy")]),
            q(19, "By what time must posters be set up?", "B", [("A", "8:00 A.M."), ("B", "8:45 A.M."), ("C", "9:00 A.M."), ("D", "Noon")]),
            q(20, "Where can parking vouchers be obtained?", "A", [("A", "At the registration desk"), ("B", "At the hotel entrance"), ("C", "In the poster area"), ("D", "During lunch")]),
        ],
        "p7b_left": (
            "SPECTROMETER DEMONSTRATION\nA demonstration of the new spectrometer will be held Tuesday from 2:00 "
            "to 3:00 P.M. in Laboratory 12. Attendance is limited to eight people. Reserve a place by Monday. All "
            "participants must complete the online safety orientation before attending."
        ),
        "p7b_right": (
            "To: Clara\nI completed the safety orientation last month. Could you reserve two places for me and our "
            "visiting student, Eric? Eric has not completed the orientation yet, so please send him the link today. "
            "If he cannot finish it in time, I will attend alone. - Priya"
        ),
        "p7b": [
            q(21, "What is required before attending the demonstration?", "D", [("A", "A printed report"), ("B", "A laboratory purchase"), ("C", "A hotel reservation"), ("D", "An online safety orientation")]),
            q(22, "What is indicated about Eric?", "B", [("A", "He attended last month"), ("B", "He is not yet eligible to attend"), ("C", "He works in Laboratory 12"), ("D", "He organized the demonstration")]),
            q(23, "How many places does Priya initially request?", "A", [("A", "Two"), ("B", "Three"), ("C", "Eight"), ("D", "Twelve")]),
            q(24, "What should Clara do by Monday?", "C", [("A", "Purchase a spectrometer"), ("B", "Complete Priya's orientation"), ("C", "Reserve places"), ("D", "Change the demonstration time")]),
        ],
        "reviews": [
            "1 subject to = 以……为条件/经修改；2 should 后接动词原形 present。",
            "3 to accommodate 表示目的；4 upon request = 应要求。",
            "5 who 指代 applicants 并作从句主语；6 reviewed 由副词 carefully 修饰。",
            "8 fee 为单数，谓语 includes；9 remain connected。",
            "12 although + 完整句，表示让步；13 has been moved 是被动语态。",
            "14 A 说明只有日期和时间改变；15 by October 10 = 最迟 10 月 10 日。",
            "22 Eric 尚未完成强制培训，因此目前不能参加；24 预约截止到周一。",
        ],
        "phrases": "subject to | upon request | be pleased with | remain connected | complete orientation",
    },
]


def all_questions(sheet):
    return sheet["p5"] + sheet["p6"] + sheet["p7a"] + sheet["p7b"]


def validate_sheet(sheet):
    questions = all_questions(sheet)
    numbers = [item["n"] for item in questions]
    assert numbers == list(range(1, 25)), (sheet["day"], numbers)
    for item in questions:
        letters = [letter for letter, _ in item["options"]]
        assert letters == ["A", "B", "C", "D"], (sheet["day"], item["n"], letters)
        assert item["answer"] in letters, (sheet["day"], item["n"], item["answer"])


def answer_line(sheet, start, end):
    answers = {item["n"]: item["answer"] for item in all_questions(sheet)}
    return "  ".join(f"{number} {answers[number]}" for number in range(start, end + 1))


def render_front(c, sheet):
    draw_header(c, sheet, 1, "FRONT | QUESTIONS 1-17")
    c.setFillColor(INK)
    c.setFont("YaHei-Bold", 9)
    c.drawString(30, PAGE_H - 64, f"主题：{sheet['focus']} | 建议做题 25 分钟 + 复盘 15 分钟")
    c.setFont("YaHei", 7.8)
    c.setFillColor(MUTED)
    c.drawRightString(PAGE_W - 30, PAGE_H - 64, "得分：____ / 24  用时：____ 分钟")

    y = section_bar(c, PAGE_H - 78, "Part 5 | Incomplete Sentences 句子填空", "12题 / 建议10分钟")
    for question in sheet["p5"]:
        y = draw_question(c, question, 30, y, PAGE_W - 60, size=8.0)
    y -= 2
    c.setStrokeColor(LINE)
    c.line(30, y + 12, PAGE_W - 30, y + 12)
    y = section_bar(c, y, "Part 6 | Text Completion 短文填空", "4道正式编组 + 1道加练 / 建议7分钟")
    y = draw_passage_box(c, "Questions 13-17", sheet["p6_text"], 30, y, PAGE_W - 60, size=8.1, leading=10.2) - 8

    by_number = {item["n"]: item for item in sheet["p6"]}
    gap = 12
    width = (PAGE_W - 60 - gap) / 2
    left_y = y
    for number in (13, 14, 16):
        left_y = draw_question(c, by_number[number], 30, left_y, width, size=7.9)
    right_y = draw_question(c, by_number[15], 30 + width + gap, y, width, size=7.9)
    bonus_y = min(left_y, right_y) - 2
    c.setFillColor(PALE)
    c.roundRect(30, bonus_y - 42, PAGE_W - 60, 42, 4, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 7.2)
    c.drawString(38, bonus_y - 11, "额外加练：正式考试每篇 Part 6 仍为 4 题")
    draw_question(c, by_number[17], 38, bonus_y - 23, PAGE_W - 76, size=7.6)
    draw_listening_box(c, sheet["listening"])


def render_back(c, sheet):
    draw_header(c, sheet, 2, "BACK | QUESTIONS 18-24 + ANSWERS")
    y = section_bar(c, PAGE_H - 58, "Part 7 | Reading Comprehension 阅读理解", "7题 / 建议10分钟")
    y = draw_passage_box(c, sheet["p7a_title"], sheet["p7a_text"], 30, y, PAGE_W - 60, size=7.9, leading=9.8) - 8
    for question in sheet["p7a"]:
        y = draw_question(c, question, 30, y, PAGE_W - 60, size=7.8)

    c.setStrokeColor(LINE)
    c.line(30, y + 5, PAGE_W - 30, y + 5)
    y -= 4
    gap = 10
    width = (PAGE_W - 60 - gap) / 2
    y1 = draw_passage_box(c, "Questions 21-24: Notice", sheet["p7b_left"], 30, y, width, size=7.35, leading=9.0)
    y2 = draw_passage_box(c, "Questions 21-24: Message", sheet["p7b_right"], 30 + width + gap, y, width, size=7.35, leading=9.0)
    y = min(y1, y2) - 8

    question_gap = 12
    question_width = (PAGE_W - 60 - question_gap) / 2
    left_y = y
    right_y = y
    for question in sheet["p7b"][:2]:
        left_y = draw_question(c, question, 30, left_y, question_width, size=7.55)
    for question in sheet["p7b"][2:]:
        right_y = draw_question(c, question, 30 + question_width + question_gap, right_y, question_width, size=7.55)
    y = min(left_y, right_y) + 2

    answer_top = max(190, y)
    c.setFillColor(TEAL)
    c.roundRect(30, answer_top - 19, PAGE_W - 60, 19, 4, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("YaHei-Bold", 9)
    c.drawString(38, answer_top - 13, "答案与快速复盘 | 做完再看")
    c.setFont("YaHei", 7.2)
    c.drawRightString(PAGE_W - 38, answer_top - 13, "记录错因：词汇 / 语法 / 定位 / 时间")

    key_y = answer_top - 35
    c.setFillColor(INK)
    c.setFont("YaHei-Bold", 8.1)
    c.drawString(36, key_y, "答案")
    c.setFont("YaHei", 7.8)
    c.drawString(72, key_y, answer_line(sheet, 1, 12))
    c.drawString(72, key_y - 12, answer_line(sheet, 13, 24))

    review_y = key_y - 31
    c.setFont("YaHei-Bold", 8.0)
    c.drawString(36, review_y, "关键解析")
    c.setFont("YaHei", 7.25)
    c.setFillColor(MUTED)
    current_y = review_y - 13
    for line in sheet["reviews"]:
        c.drawString(45, current_y, "- " + line)
        current_y -= 10.2

    c.setFillColor(PALE)
    c.roundRect(36, 29, PAGE_W - 72, 38, 4, stroke=0, fill=1)
    c.setFillColor(TEAL)
    c.setFont("YaHei-Bold", 7.8)
    c.drawString(44, 54, f"Day {sheet['day']} 只记 5 个搭配")
    c.setFont("YaHei", 7.2)
    c.setFillColor(INK)
    c.drawString(44, 41, sheet["phrases"])


for sheet in SHEETS:
    validate_sheet(sheet)

pdf = canvas.Canvas(str(OUT), pagesize=A4)
pdf.setTitle("TOEIC 720 Weekend Practice Pack Day 3-6")
pdf.setAuthor("Codex - Original TOEIC-style Practice")
for sheet in SHEETS:
    render_front(pdf, sheet)
    pdf.showPage()
    render_back(pdf, sheet)
    pdf.showPage()
pdf.save()
print("PDF_CREATED")
