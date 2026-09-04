from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
XHS = ROOT / "promo" / "xhs"
ASSETS = ROOT / "docs" / "assets"
XHS.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

FONT_REGULAR = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

INK = "#202438"
MUTED = "#687086"
PURPLE = "#6D4AFF"
PURPLE_DARK = "#4D32C7"
ORANGE = "#FF6B35"
GREEN = "#20A66A"
RED = "#E84A5F"
GOLD = "#D68B00"
PAPER = "#F6F7FB"
WHITE = "#FFFFFF"
LINE = "#E2E5EE"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def wrap(draw, text, fnt, max_width):
    lines, current = [], ""
    for char in text:
        candidate = current + char
        if current and draw.textbbox((0, 0), candidate, font=fnt)[2] > max_width:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def text_block(draw, xy, text, fnt, fill=INK, max_width=None, spacing=8, anchor=None):
    x, y = xy
    lines = text.split("\n") if max_width is None else sum((wrap(draw, line, fnt, max_width) for line in text.split("\n")), [])
    line_height = fnt.size + spacing
    for i, line in enumerate(lines):
        draw.text((x, y + i * line_height), line, font=fnt, fill=fill, anchor=anchor)
    return y + len(lines) * line_height


def gradient(size, top, bottom):
    w, h = size
    a = tuple(int(top[i:i + 2], 16) for i in (1, 3, 5))
    b = tuple(int(bottom[i:i + 2], 16) for i in (1, 3, 5))
    img = Image.new("RGB", size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(int(a[j] * (1 - t) + b[j] * t) for j in range(3))
        d.line((0, y, w, y), fill=c)
    return img


def pill(draw, xy, text, fill, color=WHITE, padding=(18, 9), size=26):
    x, y = xy
    fnt = font(size, True)
    bbox = draw.textbbox((0, 0), text, font=fnt)
    w = bbox[2] - bbox[0] + padding[0] * 2
    h = bbox[3] - bbox[1] + padding[1] * 2
    rounded(draw, (x, y, x + w, y + h), h // 2, fill)
    draw.text((x + w / 2, y + h / 2 - 1), text, font=fnt, fill=color, anchor="mm")
    return w, h


def shadow_panel(base, box, radius=28, fill=WHITE, shadow=24, offset=12):
    x1, y1, x2, y2 = map(int, box)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle((x1 + offset, y1 + offset, x2 + offset, y2 + offset), radius=radius, fill=(18, 20, 38, 45))
    layer = layer.filter(ImageFilter.GaussianBlur(shadow))
    base.alpha_composite(layer)
    d = ImageDraw.Draw(base)
    rounded(d, box, radius, fill)
    return d


def ellipsize(draw, text, fnt, max_width):
    if draw.textbbox((0, 0), text, font=fnt)[2] <= max_width:
        return text
    result = text
    while result and draw.textbbox((0, 0), result + "…", font=fnt)[2] > max_width:
        result = result[:-1]
    return result + "…"


def draw_course_card(draw, box, name, code, note, total, wishes, accent=PURPLE, selected=False, small=False):
    x1, y1, x2, y2 = box
    rounded(draw, box, 14, "#F4F0FF" if accent == PURPLE else "#FFF7EF", outline="#D8DCE8", width=2)
    draw.rounded_rectangle((x1, y1, x1 + 9, y2), radius=5, fill=accent)
    check_size = 16 if small else 23
    check = (x1 + 14, y1 + 16, x1 + 14 + check_size, y1 + 16 + check_size)
    draw.rectangle(check, fill=GREEN if selected else WHITE, outline=GREEN if selected else "#9DA4B3", width=2)
    title_size = 12 if small else 30
    meta_size = 10 if small else 22
    title_x = x1 + (38 if small else 58)
    title_font = font(title_size, True)
    if small:
        draw.text((title_x, y1 + 15), ellipsize(draw, name, title_font, max(20, x2 - title_x - 8)), font=title_font, fill=INK)
    else:
        drop_w, drop_h = 132, 37
        drop_x1 = x2 - drop_w - 20
        draw.text((title_x, y1 + 18), ellipsize(draw, name, title_font, max(20, drop_x1 - title_x - 6)), font=title_font, fill=INK)
        rounded(draw, (drop_x1, y1 + 12, x2 - 20, y1 + 12 + drop_h), 6, WHITE, outline="#ADB4C2")
        draw.text(((drop_x1 + x2 - 20) / 2, y1 + 12 + drop_h / 2), "第三志愿", font=font(18), fill=INK, anchor="mm")
    positions = (43, 64, 86, 108) if small else (62, 92, 126, 158)
    draw.text((x1 + 14, y1 + positions[0]), ellipsize(draw, code, font(meta_size), x2 - x1 - 28), font=font(meta_size), fill=MUTED)
    if note:
        draw.text((x1 + 14, y1 + positions[1]), ellipsize(draw, note, font(meta_size), x2 - x1 - 28), font=font(meta_size), fill="#815C10")
    draw.text((x1 + 14, y1 + positions[2]), f"2学分 · {total}", font=font(meta_size, True), fill=GREEN if "—" not in total else MUTED)
    draw.text((x1 + 14, y1 + positions[3]), ellipsize(draw, wishes, font(meta_size), x2 - x1 - 28), font=font(meta_size), fill=INK)


def draw_browser_mock(base, box, dense=True):
    draw = ImageDraw.Draw(base)
    x1, y1, x2, y2 = box
    rounded(draw, box, 26, WHITE, outline="#CFD4E1", width=2)
    draw.rounded_rectangle((x1, y1, x2, y1 + 62), radius=26, fill="#303441")
    draw.rectangle((x1, y1 + 36, x2, y1 + 62), fill="#303441")
    for i, c in enumerate(("#FF6257", "#FFC043", "#31C853")):
        draw.ellipse((x1 + 25 + i * 34, y1 + 22, x1 + 41 + i * 34, y1 + 38), fill=c)
    draw.text((x1 + 142, y1 + 31), "研究生选课 · 课程表助手", font=font(20, True), fill="#E8EAF0", anchor="lm")

    sidebar = 120
    draw.rectangle((x1, y1 + 62, x1 + sidebar, y2), fill="#FFF6EF")
    draw.rectangle((x1, y1 + 62, x1 + sidebar, y1 + 124), fill=ORANGE)
    draw.text((x1 + sidebar / 2, y1 + 93), "研究生选课", font=font(18, True), fill=WHITE, anchor="mm")
    for i, label in enumerate(("时间安排", "选课帮助", "开课信息", "选课操作")):
        draw.text((x1 + 22, y1 + 160 + i * 50), label, font=font(17), fill=INK)

    mx1 = x1 + sidebar + 16
    my1 = y1 + 76
    draw.text((mx1, my1), "选课方案课程表", font=font(24, True), fill=INK)
    draw.text((mx1 + 244, my1 + 2), "65 个课序号  ·  人数查询完成", font=font(15), fill=MUTED)
    rounded(draw, (x2 - 177, my1 - 7, x2 - 20, my1 + 35), 10, WHITE, outline="#C9CEDA")
    draw.text((x2 - 99, my1 + 14), "刷新人数", font=font(16), fill=INK, anchor="mm")

    gx1, gy1, gx2, gy2 = mx1, my1 + 55, x2 - 20, y2 - 20
    time_w = 72
    cols = 5
    col_w = (gx2 - gx1 - time_w) / cols
    rows = 4 if dense else 3
    row_h = (gy2 - gy1 - 44) / rows
    rounded(draw, (gx1, gy1, gx2, gy2), 12, WHITE, outline=LINE, width=2)
    draw.rectangle((gx1, gy1, gx2, gy1 + 44), fill="#EBEEF5")
    draw.text((gx1 + time_w / 2, gy1 + 22), "时间", font=font(15, True), fill=INK, anchor="mm")
    for c, day in enumerate(("周一", "周二", "周三", "周四", "周五")):
        cx = gx1 + time_w + c * col_w
        draw.line((cx, gy1, cx, gy2), fill=LINE, width=2)
        draw.text((cx + col_w / 2, gy1 + 22), day, font=font(15, True), fill=INK, anchor="mm")
    for r in range(rows):
        yy = gy1 + 44 + r * row_h
        draw.line((gx1, yy, gx2, yy), fill=LINE, width=2)
        draw.text((gx1 + time_w / 2, yy + 24), f"第{r + 1}大节", font=font(13, True), fill=INK, anchor="mm")

    cards = [
        (1, 0, "工程硕士数学", "60428004-0 · 全周 · 陈俊清", "", "总108/159", "一15 · 二12 · 三81", PURPLE),
        (4, 0, "硕士生英语", "64200012-1 · 全周 · 张英", "论文阅读写作", "总144/35", "一78 · 二21 · 三45", ORANGE),
        (1, 2, "数据仓库与数据挖掘", "74100072-0 · 前八周 · 宋韶旭", "优先：软件学院学生", "总11/50", "一0 · 二0 · 三0 · 优11", PURPLE),
        (3, 3 if rows > 3 else 2, "领域特定语言设计", "84100293-0 · 全周 · 姜宇", "优先：软件学院学生", "总—/60", "暂无统计", GREEN),
    ]
    for col, row, name, code, note, total, wishes, color in cards:
        if row >= rows:
            continue
        cx1 = gx1 + time_w + col * col_w + 5
        cy1 = gy1 + 49 + row * row_h + 5
        cx2 = cx1 + col_w - 10
        cy2 = min(cy1 + row_h - 10, gy2 - 6)
        draw_course_card(draw, (cx1, cy1, cx2, cy2), name, code, note, total, wishes, color, small=True)


def cover():
    img = gradient((1080, 1440), "#5B3BE8", "#FF765A").convert("RGBA")
    d = ImageDraw.Draw(img)
    for x, y, r, alpha in ((930, 190, 210, 34), (120, 1120, 260, 26), (920, 1170, 150, 34)):
        d.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, alpha))
    pill(d, (72, 70), "研究生选课效率工具", "#FFFFFF33", WHITE, size=26)
    text_block(d, (72, 164), "清华研究生选课\n终于不用盯列表了", font(68, True), WHITE, spacing=12)
    d.text((74, 350), "课程表可视化 · 一二三志愿人数 · 登录保活", font=font(28), fill="#FFF4EE")
    shadow_panel(img, (55, 455, 1025, 1325), 34, WHITE, 30, 14)
    draw_browser_mock(img, (85, 485, 995, 1295), dense=False)
    d = ImageDraw.Draw(img)
    pill(d, (72, 1350), "油猴脚本 · 开源 MIT", "#202438", WHITE, size=23)
    img.convert("RGB").save(XHS / "01-cover.png", quality=95)


def features():
    img = Image.new("RGBA", (1080, 1440), PAPER)
    d = ImageDraw.Draw(img)
    pill(d, (68, 62), "功能总览", PURPLE, WHITE, size=24)
    text_block(d, (68, 132), "把难用的选课列表\n变成真正的课程表", font(58, True), INK, spacing=10)
    d.text((70, 280), "按时间看冲突，按人数填志愿", font=font(27), fill=MUTED)
    shadow_panel(img, (50, 345, 1030, 1120), 30, WHITE, 22, 10)
    draw_browser_mock(img, (74, 370, 1006, 1095), dense=False)
    d = ImageDraw.Draw(img)
    badges = [
        ("01", "课程表排布", "星期 × 大节，一眼看冲突"),
        ("02", "志愿竞争", "总人数、一二三志愿、优先人数"),
        ("03", "备注区分", "论文写作 / 国际交流不再混淆"),
        ("04", "登录保活", "绿色状态点，每 3 分钟检查"),
    ]
    y = 1155
    for i, (num, title, sub) in enumerate(badges):
        x = 60 + (i % 2) * 510
        yy = y + (i // 2) * 105
        rounded(d, (x, yy, x + 490, yy + 88), 18, WHITE, outline=LINE, width=2)
        rounded(d, (x + 14, yy + 16, x + 72, yy + 72), 14, PURPLE if i < 2 else ORANGE)
        d.text((x + 43, yy + 44), num, font=font(20, True), fill=WHITE, anchor="mm")
        d.text((x + 88, yy + 18), title, font=font(23, True), fill=INK)
        d.text((x + 88, yy + 51), sub, font=font(17), fill=MUTED)
    img.convert("RGB").save(XHS / "02-features.png", quality=95)


def counts():
    img = gradient((1080, 1440), "#FFF5EA", "#F0EBFF").convert("RGBA")
    d = ImageDraw.Draw(img)
    pill(d, (65, 62), "志愿人数怎么读", ORANGE, WHITE, size=24)
    text_block(d, (65, 132), "不只看总人数\n一二三志愿要分开看", font(58, True), INK, spacing=10)
    d.text((67, 286), "同样 100 人，志愿结构不同，中签难度也不同", font=font(25), fill=MUTED)
    shadow_panel(img, (110, 390, 970, 760), 30, WHITE, 24, 10)
    d = ImageDraw.Draw(img)
    draw_course_card(d, (150, 435, 930, 710), "工程硕士数学", "60428004-0 · 全周 · 陈俊清", "", "总108/159", "一15 · 二12 · 三81", PURPLE)

    callouts = [
        ("总108/159", "报名总人数 / 学校可选容量", GREEN),
        ("一15", "第一志愿 15 人", PURPLE),
        ("二12", "第二志愿 12 人", PURPLE),
        ("三81", "第三志愿 81 人", RED),
        ("优8", "括号里的优先报名人数", GOLD),
        ("总—/60", "不是确定为 0，而是暂无统计", MUTED),
    ]
    y = 820
    for i, (big, small, color) in enumerate(callouts):
        x = 62 + (i % 2) * 505
        yy = y + (i // 2) * 150
        rounded(d, (x, yy, x + 465, yy + 120), 22, WHITE, outline="#E0DCEA", width=2)
        d.text((x + 24, yy + 19), big, font=font(30, True), fill=color)
        d.text((x + 24, yy + 67), small, font=font(20), fill=INK)
    d.text((65, 1320), "数据以学校“填报志愿情况查询”的统计时间为准", font=font(22), fill=MUTED)
    img.convert("RGB").save(XHS / "03-counts.png", quality=95)


def steps():
    img = Image.new("RGBA", (1080, 1440), "#F8F9FD")
    d = ImageDraw.Draw(img)
    pill(d, (65, 62), "4 步开始使用", PURPLE, WHITE, size=24)
    text_block(d, (65, 132), "安装后这样选课", font(60, True), INK)
    d.text((67, 226), "无需改学校网页，油猴脚本自动接管展示", font=font(25), fill=MUTED)
    items = [
        ("1", "安装 Tampermonkey", "Edge / Chrome 扩展商店均可", "扩展"),
        ("2", "粘贴并保存脚本", "打开 .user.js，Ctrl+S 保存", "脚本"),
        ("3", "从信息门户进入选课", "应用导航 → 研究生选课 → 选课", "门户"),
        ("4", "打开课程表并填志愿", "勾选课序 → 选志愿 → 确认提交", "课程表"),
    ]
    y = 330
    colors = (PURPLE, ORANGE, GREEN, RED)
    for i, (num, title, sub, tag) in enumerate(items):
        yy = y + i * 240
        shadow_panel(img, (68, yy, 1012, yy + 190), 28, WHITE, 16, 7)
        d = ImageDraw.Draw(img)
        d.ellipse((98, yy + 42, 208, yy + 152), fill=colors[i])
        d.text((153, yy + 97), num, font=font(50, True), fill=WHITE, anchor="mm")
        d.text((240, yy + 35), title, font=font(32, True), fill=INK)
        d.text((240, yy + 88), sub, font=font(23), fill=MUTED)
        pill(d, (240, yy + 126), tag, "#F0EDFF" if i == 0 else "#FFF2EA", colors[i], size=18)
        if i < 3:
            d.line((153, yy + 190, 153, yy + 232), fill="#C8CDDA", width=6)
            d.polygon(((141, yy + 221), (165, yy + 221), (153, yy + 239)), fill="#C8CDDA")
    img.convert("RGB").save(XHS / "04-steps.png", quality=95)


def keepalive():
    img = gradient((1080, 1440), "#EAF9F2", "#F1ECFF").convert("RGBA")
    d = ImageDraw.Draw(img)
    pill(d, (65, 62), "登录保活", GREEN, WHITE, size=24)
    text_block(d, (65, 132), "页面挂久了\n也尽量不掉登录", font(60, True), INK, spacing=10)
    d.text((67, 286), "每 3 分钟访问一次同站轻量页面，不刷新、不提交", font=font(24), fill=MUTED)
    shadow_panel(img, (105, 390, 975, 650), 30, WHITE, 22, 10)
    d = ImageDraw.Draw(img)
    rounded(d, (240, 475, 840, 570), 20, WHITE, outline="#C9CEDA", width=3)
    d.text((320, 522), "选课课程表", font=font(34, True), fill=INK, anchor="lm")
    d.ellipse((770, 505, 798, 533), fill=GREEN)
    d.text((520, 605), "绿色：最近一次保活检查成功", font=font(22), fill=GREEN, anchor="mm")

    states = [
        (GREEN, "绿色", "保活正常"),
        (GOLD, "橙色", "网络请求失败"),
        (RED, "红色", "登录已经失效"),
        ("#999999", "灰色", "首次检查中"),
    ]
    y = 735
    for i, (color, name, desc) in enumerate(states):
        yy = y + i * 115
        rounded(d, (115, yy, 965, yy + 90), 20, WHITE, outline=LINE, width=2)
        d.ellipse((150, yy + 30, 180, yy + 60), fill=color)
        d.text((210, yy + 24), name, font=font(25, True), fill=INK)
        d.text((350, yy + 26), desc, font=font(23), fill=MUTED)
    rounded(d, (115, 1225, 965, 1358), 22, "#FFF5E5", outline="#F3C76E", width=2)
    d.text((150, 1250), "注意", font=font(24, True), fill=GOLD)
    text_block(d, (150, 1288), "已经过期的会话仍需从信息门户重新进入；\n服务器绝对期限和浏览器彻底休眠无法绕过。", font(19), INK, spacing=7)
    img.convert("RGB").save(XHS / "05-keepalive.png", quality=95)


def opensource():
    img = Image.new("RGBA", (1080, 1440), "#171A28")
    d = ImageDraw.Draw(img)
    for x, y, r, c in ((930, 170, 190, "#6D4AFF"), (120, 1230, 260, "#FF6B35")):
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.ellipse((x - r, y - r, x + r, y + r), fill=c + "66")
        img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(70)))
    d = ImageDraw.Draw(img)
    pill(d, (65, 65), "OPEN SOURCE", PURPLE, WHITE, size=24)
    text_block(d, (65, 145), "脚本已整理成\n完整 Git 仓库", font(62, True), WHITE, spacing=10)
    d.text((67, 302), "README · 自动测试 · MIT License", font=font(27), fill="#C8CDDC")
    cards = [
        ("01", "隐私安全", "只访问清华选课系统自身页面"),
        ("02", "不会自动提交", "提交前仍需人工确认"),
        ("03", "可自行审计", "核心逻辑全部在一个 user.js 文件"),
        ("04", "MIT 许可", "可以自由使用、修改和分享"),
    ]
    y = 405
    for i, (num, title, sub) in enumerate(cards):
        yy = y + i * 175
        rounded(d, (65, yy, 1015, yy + 140), 24, "#24283B", outline="#393F58", width=2)
        rounded(d, (90, yy + 28, 174, yy + 112), 20, PURPLE if i % 2 == 0 else ORANGE)
        d.text((132, yy + 70), num, font=font(25, True), fill=WHITE, anchor="mm")
        d.text((205, yy + 27), title, font=font(29, True), fill=WHITE)
        d.text((205, yy + 78), sub, font=font(22), fill="#C8CDDC")
    rounded(d, (65, 1140, 1015, 1325), 28, WHITE)
    d.text((100, 1175), "仓库文件", font=font(24, True), fill=INK)
    text_block(d, (100, 1220), "thu-graduate-course-helper.user.js\nREADME.md  ·  test.cjs  ·  LICENSE", font(22), PURPLE_DARK, spacing=9)
    d.text((65, 1370), "非官方工具 · 选课结果以学校系统为准", font=font(20), fill="#9DA5BA")
    img.convert("RGB").save(XHS / "06-open-source.png", quality=95)


def operation_flow():
    img = Image.new("RGBA", (1600, 900), PAPER)
    d = ImageDraw.Draw(img)
    d.text((70, 60), "清华研究生选课课程表助手｜操作流程", font=font(46, True), fill=INK)
    d.text((72, 125), "安装脚本后，从信息门户进入选课系统即可使用", font=font(24), fill=MUTED)
    steps_data = [
        ("1", "安装油猴", "安装 Tampermonkey\n粘贴 user.js 并保存"),
        ("2", "进入选课", "信息门户 → 应用导航\n→ 研究生选课"),
        ("3", "查看课程表", "点击右上角\n“选课课程表 ●”"),
        ("4", "填报志愿", "看人数与备注\n勾选课序并确认提交"),
    ]
    colors = (PURPLE, ORANGE, GREEN, RED)
    for i, (num, title, sub) in enumerate(steps_data):
        x = 70 + i * 380
        rounded(d, (x, 230, x + 310, 690), 28, WHITE, outline=LINE, width=2)
        d.ellipse((x + 100, 275, x + 210, 385), fill=colors[i])
        d.text((x + 155, 330), num, font=font(48, True), fill=WHITE, anchor="mm")
        d.text((x + 155, 430), title, font=font(31, True), fill=INK, anchor="mm")
        text_block(d, (x + 155, 500), sub, font(22), MUTED, spacing=10, anchor="ma")
        if i < 3:
            d.line((x + 325, 460, x + 365, 460), fill="#B6BDCC", width=8)
            d.polygon(((x + 355, 445), (x + 380, 460), (x + 355, 475)), fill="#B6BDCC")
    rounded(d, (70, 760, 1530, 835), 18, "#EFEAFF")
    d.text((800, 797), "绿色状态点＝保活正常｜人数以学校最近一次统计时间为准｜脚本不会自动提交", font=font(22), fill=PURPLE_DARK, anchor="mm")
    img.convert("RGB").save(ASSETS / "operation-flow.png", quality=95)


def feature_overview():
    img = Image.new("RGBA", (1600, 900), "#F4F5FA")
    d = ImageDraw.Draw(img)
    d.text((65, 55), "从课程列表到可视化课程表", font=font(44, True), fill=INK)
    d.text((67, 115), "真实功能结构示意（示例人数）", font=font(22), fill=MUTED)
    shadow_panel(img, (55, 180, 1120, 840), 28, WHITE, 18, 8)
    draw_browser_mock(img, (80, 205, 1095, 815), dense=False)
    d = ImageDraw.Draw(img)
    features_data = [
        ("课程冲突", "按星期和大节排布"),
        ("志愿结构", "总数 + 一二三志愿 + 优先"),
        ("课程备注", "英语课方向清晰可见"),
        ("登录保活", "每 3 分钟轻量检查"),
        ("安全提交", "同步原表单，提交前确认"),
    ]
    y = 205
    for i, (title, sub) in enumerate(features_data):
        yy = y + i * 120
        rounded(d, (1160, yy, 1540, yy + 94), 20, WHITE, outline=LINE, width=2)
        d.ellipse((1184, yy + 30, 1218, yy + 64), fill=(PURPLE, ORANGE, GREEN, GOLD, RED)[i])
        d.text((1238, yy + 18), title, font=font(25, True), fill=INK)
        d.text((1238, yy + 55), sub, font=font(17), fill=MUTED)
    img.convert("RGB").save(ASSETS / "feature-overview.png", quality=95)


if __name__ == "__main__":
    cover()
    features()
    counts()
    steps()
    keepalive()
    opensource()
    operation_flow()
    feature_overview()
    print(f"Generated assets in {XHS} and {ASSETS}")
